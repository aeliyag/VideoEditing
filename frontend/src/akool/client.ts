import { getAccessToken } from '../lib/supabase'

export interface AkoolVoice {
  voiceId: string
  name: string
  gender?: string
  previewUrl?: string
}

export interface AkoolImageGenerateParams {
  prompt: string
  scale?: string
  resolution?: string
  batchQuantity?: number
  negativePrompt?: string
  sourceImageUrl?: string
}

export interface AkoolImageToVideoParams {
  imageUrl: string
  prompt: string
  negativePrompt?: string
  resolution?: string
  videoLength?: number
  audioType?: number
}

const AKOOL_API_BASE =
  (import.meta.env.VITE_AKOOL_API_BASE as string | undefined)?.replace(/\/$/, '') ??
  '/api/akool'

async function authHeaders(json = false): Promise<HeadersInit> {
  const token = await getAccessToken()
  if (!token) {
    throw new Error('Sign in required to use Akool features.')
  }
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function parseError(response: Response, fallback: string): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  throw new Error(body.error ?? `${fallback} (${response.status})`)
}

export async function downloadAkoolRemoteFile(
  url: string,
  fileName: string,
  mimeType: string,
): Promise<File> {
  const response = await fetch(
    `${AKOOL_API_BASE}/download?url=${encodeURIComponent(url)}`,
    { headers: await authHeaders() },
  )
  if (!response.ok) {
    await parseError(response, 'Download failed')
  }
  const blob = await response.blob()
  return new File([blob], fileName, {
    type: mimeType || blob.type || 'application/octet-stream',
  })
}

export async function fetchAkoolVoices(): Promise<AkoolVoice[]> {
  const response = await fetch(`${AKOOL_API_BASE}/voices`, {
    headers: await authHeaders(),
  })
  if (!response.ok) {
    await parseError(response, 'Voice list failed')
  }
  const data = (await response.json()) as { voices: AkoolVoice[] }
  return data.voices
}

export async function generateAkoolTts(params: {
  inputText: string
  voiceId: string
  rate: string
}): Promise<Blob> {
  const response = await fetch(`${AKOOL_API_BASE}/tts`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({
      input_text: params.inputText,
      voice_id: params.voiceId,
      rate: params.rate,
    }),
  })
  if (!response.ok) {
    await parseError(response, 'TTS failed')
  }
  return response.blob()
}

export async function generateAkoolImage(
  params: AkoolImageGenerateParams,
): Promise<{ modelId: string }> {
  const response = await fetch(`${AKOOL_API_BASE}/image/generate`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({
      prompt: params.prompt,
      scale: params.scale ?? '16:9',
      resolution: params.resolution ?? '1080p',
      batch_quantity: params.batchQuantity ?? 1,
      negative_prompt: params.negativePrompt,
      source_images: params.sourceImageUrl ? [params.sourceImageUrl] : undefined,
    }),
  })
  if (!response.ok) {
    await parseError(response, 'Image generation failed')
  }
  const data = (await response.json()) as { modelId: string }
  return data
}

export async function pollAkoolImageResult(modelId: string): Promise<string> {
  const response = await fetch(
    `${AKOOL_API_BASE}/image/result?model_id=${encodeURIComponent(modelId)}`,
    { headers: await authHeaders() },
  )
  if (!response.ok) {
    await parseError(response, 'Image result failed')
  }
  const data = (await response.json()) as {
    status: number
    imageUrl?: string
  }
  if (data.status === 4) {
    throw new Error('Image generation failed')
  }
  if (data.status === 3 && data.imageUrl) {
    return data.imageUrl
  }
  throw new Error('Image still processing')
}

export async function createAkoolImageToVideo(
  params: AkoolImageToVideoParams,
): Promise<{ taskId: string }> {
  const response = await fetch(`${AKOOL_API_BASE}/image2video/create`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({
      image_url: params.imageUrl,
      prompt: params.prompt,
      negative_prompt:
        params.negativePrompt ??
        'blurry, low quality, distorted, watermark, text, logo',
      resolution: params.resolution ?? '1080p',
      audio_type: params.audioType ?? 3,
      video_length: params.videoLength ?? 5,
      extend_prompt: true,
      webhookurl: '',
    }),
  })
  if (!response.ok) {
    await parseError(response, 'Image-to-video failed')
  }
  const data = (await response.json()) as { taskId: string }
  return data
}

export async function pollAkoolImageToVideoResult(taskId: string): Promise<string> {
  const response = await fetch(`${AKOOL_API_BASE}/image2video/result`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({ task_id: taskId }),
  })
  if (!response.ok) {
    await parseError(response, 'Image-to-video result failed')
  }
  const data = (await response.json()) as {
    status: number
    videoUrl?: string
  }
  if (data.status === 4) {
    throw new Error('Image-to-video generation failed')
  }
  if (data.status === 3 && data.videoUrl) {
    return data.videoUrl
  }
  throw new Error('Video still processing')
}

export async function waitForAkoolImage(
  modelId: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  for (let attempt = 0; attempt < 90; attempt++) {
    onProgress?.(`Generating image… (${attempt + 1}/90)`)
    try {
      return await pollAkoolImageResult(modelId)
    } catch (err) {
      if (err instanceof Error && err.message === 'Image still processing') {
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      throw err
    }
  }
  throw new Error('Image generation timed out')
}

export async function waitForAkoolImageToVideo(
  taskId: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt++) {
    onProgress?.(`Generating video… (${attempt + 1}/120)`)
    try {
      return await pollAkoolImageToVideoResult(taskId)
    } catch (err) {
      if (err instanceof Error && err.message === 'Video still processing') {
        await new Promise((r) => setTimeout(r, 3000))
        continue
      }
      throw err
    }
  }
  throw new Error('Image-to-video generation timed out')
}
