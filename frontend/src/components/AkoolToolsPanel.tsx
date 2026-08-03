import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createAkoolImageToVideo,
  fetchAkoolVoices,
  generateAkoolImage,
  generateAkoolTts,
  waitForAkoolImage,
  waitForAkoolImageToVideo,
  type AkoolVoice,
} from '../akool/client'
import { fetchRemoteAsFile, uploadTempAssetUrl } from '../lib/uploadTempAsset'
import { useAuth } from '../state/AuthProvider'
import { useProject } from '../state/ProjectProvider'

const RATE_OPTIONS = ['75%', '90%', '100%', '110%', '125%']
const SCALE_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4']
const RESOLUTION_OPTIONS = ['1080p', '4k']

type AkoolTab = 'tts' | 'image' | 'i2v'

function previewCacheKey(inputText: string, voiceId: string, rate: string): string {
  return `${voiceId}|${rate}|${inputText}`
}

export function AkoolToolsPanel() {
  const { user } = useAuth()
  const { state, mediaStore, addMaterialAsset, addTtsAudio } = useProject()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<AkoolTab>('tts')

  const [text, setText] = useState('')
  const [voices, setVoices] = useState<AkoolVoice[]>([])
  const [voiceId, setVoiceId] = useState('')
  const [rate, setRate] = useState('100%')
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [previewKey, setPreviewKey] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement>(null)

  const [imagePrompt, setImagePrompt] = useState('')
  const [imageScale, setImageScale] = useState('16:9')
  const [imageResolution, setImageResolution] = useState('1080p')

  const [i2vPrompt, setI2vPrompt] = useState('')
  const [i2vSourceMaterialId, setI2vSourceMaterialId] = useState('')
  const [i2vResolution, setI2vResolution] = useState('1080p')
  const [i2vLength, setI2vLength] = useState(5)

  const [loadingVoices, setLoadingVoices] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const autoLoadDone = useRef(false)

  const imageMaterials = state.document.materials.filter((m) => m.kind === 'image')

  const loadVoices = useCallback(async () => {
    setLoadingVoices(true)
    setError('')
    try {
      const list = await fetchAkoolVoices()
      setVoices(list)
      setVoiceId((prev) => prev || list[0]?.voiceId || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load voices')
    } finally {
      setLoadingVoices(false)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      autoLoadDone.current = false
      return
    }
    if (autoLoadDone.current) {
      return
    }
    autoLoadDone.current = true
    void loadVoices()
  }, [open, loadVoices])

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const clearPreview = useCallback(() => {
    setPreviewBlob(null)
    setPreviewKey('')
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return null
    })
  }, [])

  const requestTtsBlob = async (inputText: string): Promise<Blob> => {
    const key = previewCacheKey(inputText, voiceId, rate)
    if (previewBlob && previewKey === key) {
      return previewBlob
    }
    const blob = await generateAkoolTts({ inputText, voiceId, rate })
    setPreviewBlob(blob)
    setPreviewKey(key)
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return URL.createObjectURL(blob)
    })
    return blob
  }

  const onAddTtsToMaterials = async (alsoTimeline: boolean) => {
    const inputText = text.trim()
    if (!inputText || !voiceId) {
      setError('Enter narration text and choose a voice.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const blob = await requestTtsBlob(inputText)
      const fileName = `tts_${Date.now()}.mp3`
      if (alsoTimeline) {
        await addTtsAudio(blob, fileName, state.ui.playhead)
      } else {
        const file = new File([blob], fileName, { type: 'audio/mpeg' })
        await addMaterialAsset({ file, name: fileName, kind: 'audio', origin: 'tts' })
      }
      setText('')
      clearPreview()
      setStatus(alsoTimeline ? 'Added TTS to materials and timeline.' : 'Added TTS to materials.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'TTS failed')
    } finally {
      setBusy(false)
    }
  }

  const onGenerateImage = async () => {
    const prompt = imagePrompt.trim()
    if (!prompt) {
      setError('Enter an image prompt.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('Starting image generation…')
    try {
      const { modelId } = await generateAkoolImage({
        prompt,
        scale: imageScale,
        resolution: imageResolution,
      })
      const imageUrl = await waitForAkoolImage(modelId, setStatus)
      const file = await fetchRemoteAsFile(imageUrl, `ai_image_${Date.now()}.png`, 'image/png')
      await addMaterialAsset({
        file,
        name: file.name,
        kind: 'image',
        origin: 'image-generate',
      })
      setImagePrompt('')
      setStatus('Image added to materials.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed')
    } finally {
      setBusy(false)
    }
  }

  const onGenerateImageToVideo = async () => {
    const prompt = i2vPrompt.trim()
    if (!prompt) {
      setError('Enter an animation prompt.')
      return
    }
    if (!i2vSourceMaterialId) {
      setError('Select a source image from materials.')
      return
    }
    if (!user?.id) {
      setError('Sign in required.')
      return
    }
    const sourceAsset = mediaStore.get(i2vSourceMaterialId)
    if (!sourceAsset) {
      setError('Source image not found in materials.')
      return
    }

    setBusy(true)
    setError('')
    setStatus('Preparing source image…')
    try {
      const imageUrl = await uploadTempAssetUrl(sourceAsset.file, user.id)
      setStatus('Creating image-to-video job…')
      const { taskId } = await createAkoolImageToVideo({
        imageUrl,
        prompt,
        resolution: i2vResolution,
        videoLength: i2vLength,
      })
      const videoUrl = await waitForAkoolImageToVideo(taskId, setStatus)
      const file = await fetchRemoteAsFile(videoUrl, `ai_video_${Date.now()}.mp4`, 'video/mp4')
      await addMaterialAsset({
        file,
        name: file.name,
        kind: 'video',
        origin: 'image-to-video',
      })
      setI2vPrompt('')
      setStatus('Video added to materials.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image-to-video failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="akool-tools-wrap">
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? 'Hide AI tools' : 'AI tools (TTS / Image / Video)'}
      </button>
      {open && (
        <div className="akool-tools-panel">
          <div className="akool-tabs">
            {(['tts', 'image', 'i2v'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`akool-tab ${tab === t ? 'akool-tab-active' : ''}`}
                onClick={() => {
                  setTab(t)
                  setError('')
                  setStatus('')
                }}
              >
                {t === 'tts' ? 'Text to speech' : t === 'image' ? 'Image gen' : 'Image to video'}
              </button>
            ))}
          </div>

          {tab === 'tts' && (
            <div className="akool-tab-panel">
              <label className="tts-field">
                Narration
                <textarea
                  className="tts-textarea"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Enter script…"
                />
              </label>
              <div className="tts-row">
                <label className="tts-field tts-field-grow">
                  Voice
                  <select
                    className="tts-select"
                    value={voiceId}
                    disabled={loadingVoices}
                    onChange={(e) => setVoiceId(e.target.value)}
                  >
                    {voices.map((v) => (
                      <option key={v.voiceId} value={v.voiceId}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="tts-field">
                  Rate
                  <select className="tts-select" value={rate} onChange={(e) => setRate(e.target.value)}>
                    {RATE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {previewUrl && (
                <audio ref={previewAudioRef} controls src={previewUrl} className="tts-preview-audio" />
              )}
              <div className="frame-bank-buttons">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy || !text.trim()}
                  onClick={() => void onAddTtsToMaterials(false)}
                >
                  Save to materials
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  disabled={busy || !text.trim()}
                  onClick={() => void onAddTtsToMaterials(true)}
                >
                  Save + add to timeline
                </button>
              </div>
            </div>
          )}

          {tab === 'image' && (
            <div className="akool-tab-panel">
              <label className="tts-field">
                Prompt
                <textarea
                  className="tts-textarea"
                  rows={3}
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="Describe the image to generate…"
                />
              </label>
              <div className="tts-row">
                <label className="tts-field">
                  Aspect
                  <select className="tts-select" value={imageScale} onChange={(e) => setImageScale(e.target.value)}>
                    {SCALE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="tts-field">
                  Resolution
                  <select
                    className="tts-select"
                    value={imageResolution}
                    onChange={(e) => setImageResolution(e.target.value)}
                  >
                    {RESOLUTION_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={busy}
                onClick={() => void onGenerateImage()}
              >
                {busy ? 'Generating…' : 'Generate image → materials'}
              </button>
            </div>
          )}

          {tab === 'i2v' && (
            <div className="akool-tab-panel">
              <label className="tts-field">
                Source image (from materials)
                <select
                  className="tts-select"
                  value={i2vSourceMaterialId}
                  onChange={(e) => setI2vSourceMaterialId(e.target.value)}
                >
                  <option value="">Select an image…</option>
                  {imageMaterials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tts-field">
                Animation prompt
                <textarea
                  className="tts-textarea"
                  rows={3}
                  value={i2vPrompt}
                  onChange={(e) => setI2vPrompt(e.target.value)}
                  placeholder="Describe how the image should move…"
                />
              </label>
              <div className="tts-row">
                <label className="tts-field">
                  Resolution
                  <select className="tts-select" value={i2vResolution} onChange={(e) => setI2vResolution(e.target.value)}>
                    {RESOLUTION_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="tts-field">
                  Length (s)
                  <select
                    className="tts-select"
                    value={i2vLength}
                    onChange={(e) => setI2vLength(Number(e.target.value))}
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={busy || imageMaterials.length === 0}
                onClick={() => void onGenerateImageToVideo()}
              >
                {busy ? 'Generating…' : 'Generate video → materials'}
              </button>
            </div>
          )}

          {status && <p className="akool-status">{status}</p>}
          {error && <p className="tts-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
