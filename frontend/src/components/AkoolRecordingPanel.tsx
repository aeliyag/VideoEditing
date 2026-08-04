import { useCallback, useEffect, useRef, useState } from 'react'

import {
  captureAkoolTab,
  isScreenCaptureSupported,
  type ScreenCaptureSession,
} from '../media/screenCapture'
import { useProject } from '../state/ProjectProvider'

type PanelPhase = 'idle' | 'recording' | 'review'

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AkoolRecordingPanel() {
  const { importRecordingFile } = useProject()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<PanelPhase>('idle')
  const [includeTabAudio, setIncludeTabAudio] = useState(true)
  const [includeMic, setIncludeMic] = useState(false)
  const [autoAddToTimeline, setAutoAddToTimeline] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [reviewFile, setReviewFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const sessionRef = useRef<ScreenCaptureSession | null>(null)
  const timerRef = useRef<number | null>(null)
  const supported = isScreenCaptureSupported()

  const clearReview = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl(null)
    setReviewFile(null)
  }, [previewUrl])

  const resetToIdle = useCallback(() => {
    setPhase('idle')
    setElapsed(0)
    setStatus('')
    setError('')
    clearReview()
  }, [clearReview])

  useEffect(() => {
    return () => {
      sessionRef.current?.dispose()
      sessionRef.current = null
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
      }
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const handleRecordingComplete = useCallback(
    async (file: File) => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      sessionRef.current = null

      if (file.size === 0) {
        setError('Recording was empty. Try again and share a tab with video content.')
        resetToIdle()
        return
      }

      if (autoAddToTimeline) {
        setBusy(true)
        setStatus('Adding recording to timeline…')
        try {
          await importRecordingFile(file, { addToTimeline: true })
          setStatus('Recording added to materials and timeline.')
          resetToIdle()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to import recording.')
          setPhase('idle')
        } finally {
          setBusy(false)
        }
        return
      }

      const url = URL.createObjectURL(file)
      setReviewFile(file)
      setPreviewUrl(url)
      setPhase('review')
      setStatus('Review your recording, then add it to the timeline or discard.')
    },
    [autoAddToTimeline, importRecordingFile, resetToIdle],
  )

  const startRecording = async () => {
    setError('')
    setStatus('Select the Akool tab in the browser picker…')
    setPhase('recording')
    setElapsed(0)

    const session = await captureAkoolTab({
      includeTabAudio,
      includeMic,
      onMicUnavailable: () => {
        setStatus('Microphone unavailable — recording tab audio only.')
      },
      onStop: (file) => {
        void handleRecordingComplete(file)
      },
      onError: (err) => {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
        sessionRef.current = null
        setError(err.message)
        setPhase('idle')
      },
    })

    if (!session) {
      setPhase('idle')
      setStatus('')
      return
    }

    sessionRef.current = session
    setStatus('Recording — use Akool in the shared tab. Stop sharing when done.')
    timerRef.current = window.setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)
  }

  const handleAddToTimeline = async () => {
    if (!reviewFile) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await importRecordingFile(reviewFile, { addToTimeline: true })
      resetToIdle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add recording.')
    } finally {
      setBusy(false)
    }
  }

  const handleAddToLibrary = async () => {
    if (!reviewFile) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await importRecordingFile(reviewFile, { addToTimeline: false })
      resetToIdle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add recording.')
    } finally {
      setBusy(false)
    }
  }

  const handleDiscard = () => {
    resetToIdle()
  }

  return (
    <div className="akool-recording-wrap">
      <button
        type="button"
        className="btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? 'Hide Akool recording' : 'Akool recording'}
      </button>
      {open && (
        <div className="akool-recording-panel">
          {!supported && (
            <p className="crop-panel-hint">
              Screen capture requires HTTPS (or localhost) and a browser that supports
              getDisplayMedia. Chrome is recommended.
            </p>
          )}

          {phase === 'idle' && (
            <>
              <p className="crop-panel-hint">
                Open Akool in another tab, then record that tab. When you stop sharing in
                the browser toolbar, the recording appears here automatically.
              </p>
              <div className="akool-recording-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => window.open('https://www.akool.com/', '_blank', 'noopener')}
                >
                  Open Akool
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!supported || busy}
                  onClick={() => void startRecording()}
                >
                  Record Akool tab
                </button>
              </div>
              <label className="akool-recording-option">
                <input
                  type="checkbox"
                  checked={includeTabAudio}
                  onChange={(e) => setIncludeTabAudio(e.target.checked)}
                />
                Include tab audio
              </label>
              <label className="akool-recording-option">
                <input
                  type="checkbox"
                  checked={includeMic}
                  onChange={(e) => setIncludeMic(e.target.checked)}
                />
                Include microphone narration
              </label>
              <label className="akool-recording-option">
                <input
                  type="checkbox"
                  checked={autoAddToTimeline}
                  onChange={(e) => setAutoAddToTimeline(e.target.checked)}
                />
                Automatically add completed recording to timeline
              </label>
            </>
          )}

          {phase === 'recording' && (
            <>
              <p className="akool-recording-timer">{formatElapsed(elapsed)}</p>
              <p className="akool-status">{status}</p>
              <p className="crop-panel-hint">
                Stop sharing in the browser toolbar when you are finished.
              </p>
            </>
          )}

          {phase === 'review' && reviewFile && previewUrl && (
            <>
              <video
                className="akool-recording-preview"
                src={previewUrl}
                controls
                playsInline
              />
              <div className="akool-recording-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void handleAddToTimeline()}
                >
                  Add to timeline
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void handleAddToLibrary()}
                >
                  Add to library only
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={handleDiscard}
                >
                  Discard
                </button>
              </div>
              <p className="crop-panel-hint">
                Trim the clip on the timeline after adding using clip handles.
              </p>
            </>
          )}

          {status && phase !== 'recording' && <p className="akool-status">{status}</p>}
          {error && <p className="akool-recording-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
