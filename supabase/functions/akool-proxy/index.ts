import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const AKOOL_ORIGIN = 'https://openapi.akool.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
  image_status: number
  image?: string
}

interface Image2VideoCreateData {
  _id: string
  status: number
}

interface Image2VideoResultItem {
  status: number
  video_url?: string
}

interface Image2VideoResultsData {
  result: Image2VideoResultItem[]
}

function subRoute(pathname: string): string {
  const parts = pathname.replace(/\/+$/, '').split('/')
  const fnIdx = parts.indexOf('akool-proxy')
  if (fnIdx >= 0) {
    return parts.slice(fnIdx + 1).join('/')
  }
  return parts.slice(-2).join('/')
}

async function akoolFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<AkoolEnvelope<T>> {
  const response = await fetch(`${AKOOL_ORIGIN}${path}`, {
    ...init,
    headers: {
      'x-api-key': apiKey,
      ...(init?.headers ?? {}),
    },
  })
  return (await response.json()) as AkoolEnvelope<T>
}

async function pollTtsUrl(apiKey: string, audioModelId: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await akoolFetch<AudioInfoData>(
      apiKey,
      `/api/open/v3/audio/infobymodelid?audio_model_id=${encodeURIComponent(audioModelId)}`,
      { method: 'GET' },
    )
    if (result.code !== 1000 || !result.data) {
      throw new Error(result.msg ?? `Akool poll failed (code ${result.code})`)
    }
    if (result.data.status === 3 && result.data.url) {
      return result.data.url
    }
    if (result.data.status === 4) {
      throw new Error('Akool TTS job failed')
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error('Akool TTS timed out')
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const apiKey = Deno.env.get('AKOOL_API_KEY')
  if (!apiKey?.trim()) {
    return jsonResponse(503, { error: 'AKOOL_API_KEY secret is not configured.' })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'Unauthorized. Sign in required.' })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    return jsonResponse(401, { error: 'Unauthorized. Sign in required.' })
  }

  const pathname = new URL(req.url).pathname.replace(/\/+$/, '')
  const route = subRoute(pathname)

  try {
    if (route === 'voices' && req.method === 'GET') {
      const result = await akoolFetch<VoiceListItem[]>(
        apiKey,
        '/api/open/v3/voice/list?from=3',
        { method: 'GET' },
      )
      if (result.code !== 1000) {
        return jsonResponse(502, { error: result.msg ?? 'Voice list failed' })
      }
      const voices = (result.data ?? []).map((v) => ({
        voiceId: v.voice_id,
        name: v.name ?? v.voice_id,
        gender: v.gender,
        previewUrl: v.preview,
      }))
      return jsonResponse(200, { voices })
    }

    if (route === 'tts' && req.method === 'POST') {
      const body = (await req.json()) as {
        input_text?: string
        voice_id?: string
        rate?: string
      }
      const inputText = body.input_text?.trim()
      const voiceId = body.voice_id?.trim()
      const rate = body.rate?.trim() || '100%'
      if (!inputText || !voiceId) {
        return jsonResponse(400, { error: 'input_text and voice_id are required' })
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
        return jsonResponse(502, { error: created.msg ?? 'TTS create failed' })
      }

      let audioUrl = created.data.url
      if (created.data.status !== 3 || !audioUrl) {
        audioUrl = await pollTtsUrl(apiKey, created.data._id)
      }

      const audioRes = await fetch(audioUrl)
      if (!audioRes.ok) {
        return jsonResponse(502, { error: 'Failed to download generated audio' })
      }
      const buffer = await audioRes.arrayBuffer()
      return new Response(buffer, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg' },
      })
    }

    if (route === 'image/generate' && req.method === 'POST') {
      const body = (await req.json()) as {
        prompt?: string
        scale?: string
        resolution?: string
        batch_quantity?: number
        negative_prompt?: string
        source_images?: string[]
      }
      const prompt = body.prompt?.trim()
      if (!prompt) {
        return jsonResponse(400, { error: 'prompt is required' })
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
        return jsonResponse(502, { error: result.msg ?? 'Image create failed' })
      }
      const item = Array.isArray(result.data) ? result.data[0] : result.data
      if (!item?._id) {
        return jsonResponse(502, { error: 'Image create returned no task id' })
      }
      return jsonResponse(200, { modelId: item._id })
    }

    if (route === 'image/result' && req.method === 'GET') {
      const modelId = new URL(req.url).searchParams.get('model_id')?.trim()
      if (!modelId) {
        return jsonResponse(400, { error: 'model_id is required' })
      }
      const result = await akoolFetch<ImageResultData>(
        apiKey,
        `/api/open/v3/content/image/infobymodelid?image_model_id=${encodeURIComponent(modelId)}`,
        { method: 'GET' },
      )
      if (result.code !== 1000 || !result.data) {
        return jsonResponse(502, { error: result.msg ?? 'Image result failed' })
      }
      return jsonResponse(200, {
        status: result.data.image_status,
        imageUrl: result.data.image,
      })
    }

    if (route === 'image2video/create' && req.method === 'POST') {
      const body = (await req.json()) as {
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
        return jsonResponse(400, { error: 'image_url and prompt are required' })
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
        return jsonResponse(502, { error: result.msg ?? 'Image-to-video create failed' })
      }
      return jsonResponse(200, { taskId: result.data._id })
    }

    if (route === 'image2video/result' && req.method === 'POST') {
      const body = (await req.json()) as { task_id?: string }
      const taskId = body.task_id?.trim()
      if (!taskId) {
        return jsonResponse(400, { error: 'task_id is required' })
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
        return jsonResponse(502, { error: result.msg ?? 'Image-to-video result failed' })
      }
      const item = result.data.result[0]
      return jsonResponse(200, {
        status: item.status,
        videoUrl: item.video_url,
      })
    }

    return jsonResponse(404, { error: 'Not found' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Akool proxy error'
    return jsonResponse(500, { error: message })
  }
})
