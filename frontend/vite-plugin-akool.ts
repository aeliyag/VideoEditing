import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const AKOOL_ORIGIN = 'https://openapi.akool.com'

interface AkoolEnvelope<T> {
  code: number
  msg?: string
  data?: T
}

interface VoiceListItem {
  voice_id: string
  name?: string
  gender?: string
  preview?: string
}

interface CreateTtsData {
  _id: string
  status: number
  url?: string
}

interface AudioInfoData {
  _id: string
  status: number
  url?: string
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

async function akoolFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<AkoolEnvelope<T>> {
  const url = `${AKOOL_ORIGIN}${path}`
  const response = await fetch(url, {
    ...init,
    headers: {
      'x-api-key': apiKey,
      ...(init?.headers ?? {}),
    },
  })
  const json = (await response.json()) as AkoolEnvelope<T>
  return json
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function pollTtsUrl(apiKey: string, audioModelId: string): Promise<string> {
  const maxAttempts = 60
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await akoolFetch<AudioInfoData>(
      apiKey,
      `/api/open/v3/audio/infobymodelid?audio_model_id=${encodeURIComponent(audioModelId)}`,
      { method: 'GET' },
    )
    if (result.code !== 1000 || !result.data) {
      throw new Error(result.msg ?? `Akool poll failed (code ${result.code})`)
    }
    const { status, url } = result.data
    if (status === 3 && url) {
      return url
    }
    if (status === 4) {
      throw new Error('Akool TTS job failed')
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('Akool TTS timed out')
}

export function akoolProxyPlugin(apiKey: string | undefined): Plugin {
  return {
    name: 'akool-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/akool/')) {
          next()
          return
        }

        if (!apiKey?.trim()) {
          sendJson(res, 503, {
            error: 'AKOOL_API_KEY is not set. Add it to frontend/.env (see .env.example).',
          })
          return
        }

        try {
          if (url === '/api/akool/voices' && req.method === 'GET') {
            const result = await akoolFetch<VoiceListItem[]>(
              apiKey,
              '/api/open/v3/voice/list?from=3',
              { method: 'GET' },
            )
            if (result.code !== 1000) {
              sendJson(res, 502, { error: result.msg ?? 'Voice list failed' })
              return
            }
            const voices = (result.data ?? []).map((v) => ({
              voiceId: v.voice_id,
              name: v.name ?? v.voice_id,
              gender: v.gender,
              previewUrl: v.preview,
            }))
            sendJson(res, 200, { voices })
            return
          }

          if (url === '/api/akool/tts' && req.method === 'POST') {
            const body = (await readJsonBody(req)) as {
              input_text?: string
              voice_id?: string
              rate?: string
            }
            const inputText = body.input_text?.trim()
            const voiceId = body.voice_id?.trim()
            const rate = body.rate?.trim() || '100%'
            if (!inputText || !voiceId) {
              sendJson(res, 400, { error: 'input_text and voice_id are required' })
              return
            }

            const created = await akoolFetch<CreateTtsData>(apiKey, '/api/open/v3/audio/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                input_text: inputText,
                voice_id: voiceId,
                rate,
                webhookUrl: '',
              }),
            })
            if (created.code !== 1000 || !created.data?._id) {
              sendJson(res, 502, { error: created.msg ?? 'TTS create failed' })
              return
            }

            let audioUrl = created.data.url
            if (created.data.status !== 3 || !audioUrl) {
              audioUrl = await pollTtsUrl(apiKey, created.data._id)
            }

            const audioRes = await fetch(audioUrl)
            if (!audioRes.ok) {
              sendJson(res, 502, { error: 'Failed to download generated audio' })
              return
            }
            const buffer = Buffer.from(await audioRes.arrayBuffer())
            res.statusCode = 200
            res.setHeader('Content-Type', 'audio/mpeg')
            res.setHeader('Content-Length', buffer.length)
            res.end(buffer)
            return
          }

          sendJson(res, 404, { error: 'Not found' })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Akool proxy error'
          sendJson(res, 500, { error: message })
        }
      })
    },
  }
}
