import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
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

interface ImageCreateData {
  _id: string
  image_status: number
}

interface ImageResultData {
  _id: string
  image_status: number
  image?: string
}

interface Image2VideoCreateData {
  _id: string
  status: number
}

interface Image2VideoResultItem {
  _id: string
  status: number
  video_url?: string
}

interface Image2VideoResultsData {
  result: Image2VideoResultItem[]
}

interface AkoolProxyOptions {
  apiKey: string | undefined
  supabaseUrl: string | undefined
  supabaseAnonKey: string | undefined
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

async function verifyAuthToken(
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string | undefined,
): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) {
    return false
  }
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) {
    return false
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(token)
  return !error && Boolean(data.user)
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

export function akoolProxyPlugin(options: AkoolProxyOptions): Plugin {
  const { apiKey, supabaseUrl, supabaseAnonKey } = options

  return {
    name: 'akool-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/akool/')) {
          next()
          return
        }

        if (!supabaseUrl?.trim() || !supabaseAnonKey?.trim()) {
          sendJson(res, 503, {
            error:
              'SUPABASE_URL and SUPABASE_ANON_KEY are required for API auth. Add them to frontend/.env.',
          })
          return
        }

        const authorized = await verifyAuthToken(
          supabaseUrl,
          supabaseAnonKey,
          req.headers.authorization,
        )
        if (!authorized) {
          sendJson(res, 401, { error: 'Unauthorized. Sign in required.' })
          return
        }

        if (!apiKey?.trim()) {
          sendJson(res, 503, {
            error: 'AKOOL_API_KEY is not set. Add it to frontend/.env (see .env.example).',
          })
          return
        }

        try {
          const parsedUrl = new URL(url, 'http://localhost')
          const pathname = parsedUrl.pathname

          if (pathname === '/api/akool/voices' && req.method === 'GET') {
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

          if (pathname === '/api/akool/tts' && req.method === 'POST') {
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

          if (pathname === '/api/akool/image/generate' && req.method === 'POST') {
            const body = (await readJsonBody(req)) as {
              prompt?: string
              scale?: string
              resolution?: string
              batch_quantity?: number
              negative_prompt?: string
              source_images?: string[]
            }
            const prompt = body.prompt?.trim()
            if (!prompt) {
              sendJson(res, 400, { error: 'prompt is required' })
              return
            }
            const result = await akoolFetch<ImageCreateData | ImageCreateData[]>(
              apiKey,
              '/api/open/v4/content/image/createBySourcePrompt',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt,
                  scale: body.scale ?? '16:9',
                  resolution: body.resolution ?? '1080p',
                  batch_quantity: body.batch_quantity ?? 1,
                  negative_prompt: body.negative_prompt,
                  source_images: body.source_images,
                }),
              },
            )
            if (result.code !== 1000 || !result.data) {
              sendJson(res, 502, { error: result.msg ?? 'Image create failed' })
              return
            }
            const item = Array.isArray(result.data) ? result.data[0] : result.data
            if (!item?._id) {
              sendJson(res, 502, { error: 'Image create returned no task id' })
              return
            }
            sendJson(res, 200, { modelId: item._id })
            return
          }

          if (pathname === '/api/akool/image/result' && req.method === 'GET') {
            const modelId = parsedUrl.searchParams.get('model_id')?.trim()
            if (!modelId) {
              sendJson(res, 400, { error: 'model_id is required' })
              return
            }
            const result = await akoolFetch<ImageResultData>(
              apiKey,
              `/api/open/v3/content/image/infobymodelid?image_model_id=${encodeURIComponent(modelId)}`,
              { method: 'GET' },
            )
            if (result.code !== 1000 || !result.data) {
              sendJson(res, 502, { error: result.msg ?? 'Image result failed' })
              return
            }
            sendJson(res, 200, {
              status: result.data.image_status,
              imageUrl: result.data.image,
            })
            return
          }

          if (pathname === '/api/akool/image2video/create' && req.method === 'POST') {
            const body = (await readJsonBody(req)) as {
              image_url?: string
              prompt?: string
              negative_prompt?: string
              resolution?: string
              audio_type?: number
              video_length?: number
            }
            const imageUrl = body.image_url?.trim()
            const prompt = body.prompt?.trim()
            if (!imageUrl || !prompt) {
              sendJson(res, 400, { error: 'image_url and prompt are required' })
              return
            }
            const result = await akoolFetch<Image2VideoCreateData>(
              apiKey,
              '/api/open/v4/image2Video/createBySourcePrompt',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  image_url: imageUrl,
                  prompt,
                  negative_prompt:
                    body.negative_prompt ??
                    'blurry, low quality, distorted, watermark, text, logo',
                  resolution: body.resolution ?? '1080p',
                  audio_type: body.audio_type ?? 3,
                  video_length: body.video_length ?? 5,
                  extend_prompt: true,
                  webhookurl: '',
                }),
              },
            )
            if (result.code !== 1000 || !result.data?._id) {
              sendJson(res, 502, { error: result.msg ?? 'Image-to-video create failed' })
              return
            }
            sendJson(res, 200, { taskId: result.data._id })
            return
          }

          if (pathname === '/api/akool/image2video/result' && req.method === 'POST') {
            const body = (await readJsonBody(req)) as { task_id?: string }
            const taskId = body.task_id?.trim()
            if (!taskId) {
              sendJson(res, 400, { error: 'task_id is required' })
              return
            }
            const result = await akoolFetch<Image2VideoResultsData>(
              apiKey,
              '/api/open/v4/image2Video/resultsByIds',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ _ids: taskId }),
              },
            )
            if (result.code !== 1000 || !result.data?.result?.[0]) {
              sendJson(res, 502, { error: result.msg ?? 'Image-to-video result failed' })
              return
            }
            const item = result.data.result[0]
            sendJson(res, 200, {
              status: item.status,
              videoUrl: item.video_url,
            })
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
