import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchAkoolVoices, generateAkoolTts, type AkoolVoice } from '../akool/client'
import { useProject } from '../state/ProjectProvider'

const RATE_OPTIONS = ['75%', '90%', '100%', '110%', '125%']

function previewCacheKey(inputText: string, voiceId: string, rate: string): string {
  return `${voiceId}|${rate}|${inputText}`
}

export function TtsPanel() {
  const { addTtsAudio, state } = useProject()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [voices, setVoices] = useState<AkoolVoice[]>([])
  const [voiceId, setVoiceId] = useState('')
  const [rate, setRate] = useState('100%')
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [previewKey, setPreviewKey] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const autoLoadDone = useRef(false)
  const previewAudioRef = useRef<HTMLAudioElement>(null)

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

  const invalidatePreviewIfStale = useCallback(
    (inputText: string) => {
      const key = previewCacheKey(inputText, voiceId, rate)
      if (previewKey && previewKey !== key) {
        clearPreview()
      }
    },
    [clearPreview, previewKey, rate, voiceId],
  )

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

  const onPreview = async () => {
    const inputText = text.trim()
    if (!inputText || !voiceId) {
      setError('Enter narration text and choose a voice.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await requestTtsBlob(inputText)
      queueMicrotask(() => {
        void previewAudioRef.current?.play()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'TTS preview failed')
    } finally {
      setBusy(false)
    }
  }

  const onAddToTimeline = async () => {
    const inputText = text.trim()
    if (!inputText || !voiceId) {
      setError('Enter narration text and choose a voice.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const blob = await requestTtsBlob(inputText)
      const safeName = `tts_${Date.now()}.mp3`
      await addTtsAudio(blob, safeName, state.ui.playhead, {
        prompt: inputText,
        voiceId,
        rate,
      })
      setText('')
      clearPreview()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add audio to timeline')
    } finally {
      setBusy(false)
    }
  }

  const onPlayVoiceSample = () => {
    const voice = voices.find((v) => v.voiceId === voiceId)
    if (!voice?.previewUrl) {
      return
    }
    const sample = new Audio(voice.previewUrl)
    void sample.play()
  }

  const hasReadyPreview =
    previewBlob !== null &&
    previewKey === previewCacheKey(text.trim(), voiceId, rate)

  return (
    <div className="tts-panel-wrap">
      <button
        type="button"
        className="btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? 'Hide text to speech' : 'Text to speech'}
      </button>
      {open && (
        <div className="tts-panel">
          <p className="crop-panel-hint">
            Preview narration before placing it on the timeline at the current playhead.
            Set <code>AKOOL_API_KEY</code> in <code>frontend/.env</code>, then restart{' '}
            <code>npm run dev</code>.
          </p>
          <label className="tts-field">
            Narration
            <textarea
              className="tts-textarea"
              rows={4}
              value={text}
              onChange={(e) => {
                invalidatePreviewIfStale(e.target.value.trim())
                setText(e.target.value)
              }}
              placeholder="Enter the script to speak…"
            />
          </label>
          <div className="tts-row">
            <label className="tts-field tts-field-grow">
              Voice
              <select
                className="tts-select"
                value={voiceId}
                disabled={loadingVoices || voices.length === 0}
                onChange={(e) => {
                  clearPreview()
                  setVoiceId(e.target.value)
                }}
              >
                {voices.length === 0 && (
                  <option value="">
                    {loadingVoices ? 'Loading…' : 'No voices — check API key'}
                  </option>
                )}
                {voices.map((v) => (
                  <option key={v.voiceId} value={v.voiceId}>
                    {v.name}
                    {v.gender ? ` (${v.gender})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="tts-field">
              Rate
              <select
                className="tts-select"
                value={rate}
                onChange={(e) => {
                  clearPreview()
                  setRate(e.target.value)
                }}
              >
                {RATE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {voices.find((v) => v.voiceId === voiceId)?.previewUrl && (
            <button
              type="button"
              className="btn btn-small tts-voice-sample-btn"
              onClick={onPlayVoiceSample}
            >
              Play voice sample
            </button>
          )}
          {previewUrl && (
            <div className="tts-preview-player">
              <span className="tts-preview-label">
                {hasReadyPreview ? 'Preview ready' : 'Preview outdated — generate again'}
              </span>
              <audio ref={previewAudioRef} controls src={previewUrl} className="tts-preview-audio" />
            </div>
          )}
          {error && <p className="tts-error">{error}</p>}
          <div className="frame-bank-buttons">
            <button
              type="button"
              className="btn btn-small"
              disabled={loadingVoices}
              onClick={() => void loadVoices()}
            >
              Refresh voices
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy || !text.trim() || !voiceId}
              onClick={() => void onPreview()}
            >
              {busy && !hasReadyPreview ? 'Generating…' : 'Preview audio'}
            </button>
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={busy || !text.trim() || !voiceId}
              onClick={() => void onAddToTimeline()}
            >
              {busy && hasReadyPreview ? 'Adding…' : 'Add to timeline'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
