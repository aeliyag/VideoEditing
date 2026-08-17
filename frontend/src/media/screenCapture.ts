const VP9_MIME = 'video/webm;codecs=vp9,opus'
const WEBM_MIME = 'video/webm'

export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(VP9_MIME)) {
    return VP9_MIME
  }
  return WEBM_MIME
}

export function recordingFileName(timestamp = Date.now()): string {
  return `akool-recording-${timestamp}.webm`
}

export function isScreenCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  )
}

export async function mixAudioTracks(
  displayStream: MediaStream,
  micStream: MediaStream | null,
): Promise<MediaStream> {
  const videoTracks = displayStream.getVideoTracks()
  const displayAudioTracks = displayStream.getAudioTracks()

  if (!micStream) {
    return displayStream
  }

  const micTracks = micStream.getAudioTracks()
  if (micTracks.length === 0) {
    return displayStream
  }

  const audioContext = new AudioContext()
  const destination = audioContext.createMediaStreamDestination()

  if (displayAudioTracks.length > 0) {
    const displaySource = audioContext.createMediaStreamSource(
      new MediaStream(displayAudioTracks),
    )
    displaySource.connect(destination)
  }

  const micSource = audioContext.createMediaStreamSource(new MediaStream(micTracks))
  micSource.connect(destination)

  const mixedAudio = destination.stream.getAudioTracks()
  return new MediaStream([...videoTracks, ...mixedAudio])
}

export interface ScreenCaptureSession {
  stop: () => void
  dispose: () => void
}

export interface CaptureStopMeta {
  durationSeconds: number
}

export interface CaptureAkoolTabOptions {
  includeTabAudio: boolean
  includeMic: boolean
  onStop: (file: File, meta: CaptureStopMeta) => void
  onError: (err: Error) => void
  onMicUnavailable?: () => void
}

function isUserCancellation(err: unknown): boolean {
  if (!(err instanceof DOMException)) {
    return false
  }
  return err.name === 'NotAllowedError' || err.name === 'AbortError'
}

export async function captureAkoolTab(
  options: CaptureAkoolTabOptions,
): Promise<ScreenCaptureSession | null> {
  if (!isScreenCaptureSupported()) {
    options.onError(new Error('Screen capture is not supported in this browser.'))
    return null
  }

  let displayStream: MediaStream | null = null
  let micStream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let recordStream: MediaStream | null = null
  let disposed = false

  const stopAllTracks = () => {
    displayStream?.getTracks().forEach((track) => track.stop())
    micStream?.getTracks().forEach((track) => track.stop())
    recordStream?.getTracks().forEach((track) => track.stop())
  }

  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser',
        frameRate: 30,
      } as MediaTrackConstraints,
      audio: options.includeTabAudio,
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    } as DisplayMediaStreamOptions)

    if (options.includeMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch {
        options.onMicUnavailable?.()
      }
    }

    recordStream = await mixAudioTracks(displayStream, micStream)

    const mimeType = pickRecorderMimeType()
    const chunks: Blob[] = []
    recorder = new MediaRecorder(recordStream, { mimeType })
    const startedAt = performance.now()

    const finishRecording = () => {
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop()
      }
    }

    const videoTrack = displayStream.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.addEventListener('ended', finishRecording)
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    recorder.onstop = () => {
      if (disposed) {
        return
      }
      stopAllTracks()
      const blob = new Blob(chunks, { type: mimeType })
      const file = new File([blob], recordingFileName(), { type: mimeType })
      const durationSeconds = Math.max(0, (performance.now() - startedAt) / 1000)
      options.onStop(file, { durationSeconds })
    }

    recorder.onerror = () => {
      if (!disposed) {
        stopAllTracks()
        options.onError(new Error('Recording failed.'))
      }
    }

    recorder.start(1000)

    return {
      stop: finishRecording,
      dispose: () => {
        disposed = true
        finishRecording()
        stopAllTracks()
      },
    }
  } catch (err) {
    stopAllTracks()
    if (isUserCancellation(err)) {
      return null
    }
    options.onError(err instanceof Error ? err : new Error(String(err)))
    return null
  }
}
