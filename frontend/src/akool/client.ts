export interface AkoolVoice {
  voiceId: string
  name: string
  gender?: string
  previewUrl?: string
}

export async function fetchAkoolVoices(): Promise<AkoolVoice[]> {
  const response = await fetch('/api/akool/voices')
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Voice list failed (${response.status})`)
  }
  const data = (await response.json()) as { voices: AkoolVoice[] }
  return data.voices
}

export async function generateAkoolTts(params: {
  inputText: string
  voiceId: string
  rate: string
}): Promise<Blob> {
  const response = await fetch('/api/akool/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_text: params.inputText,
      voice_id: params.voiceId,
      rate: params.rate,
    }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `TTS failed (${response.status})`)
  }
  return response.blob()
}
