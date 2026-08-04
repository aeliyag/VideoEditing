import type { FrameRect } from '../types/project'

const SEEK_TIMEOUT_MS = 8000

export class FrameCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameCaptureError'
  }
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: 'seeked' | 'loadeddata',
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new FrameCaptureError('Timed out while seeking video for frame capture.'))
    }, timeoutMs)

    const onEvent = () => {
      cleanup()
      resolve()
    }

    const onError = () => {
      cleanup()
      reject(new FrameCaptureError('Video failed to load while capturing frame.'))
    }

    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener(eventName, onEvent)
      video.removeEventListener('error', onError)
    }

    video.addEventListener(eventName, onEvent, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

export async function seekVideoToTime(
  video: HTMLVideoElement,
  sourceTime: number,
): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : undefined
  const clamped =
    duration != null && duration > 0
      ? Math.max(0, Math.min(sourceTime, Math.max(0, duration - 1e-4)))
      : Math.max(0, sourceTime)

  if (Math.abs(video.currentTime - clamped) < 1e-4 && video.readyState >= 2) {
    return
  }

  const seekPromise = waitForVideoEvent(video, 'seeked', SEEK_TIMEOUT_MS)
  video.currentTime = clamped
  await seekPromise

  if (video.readyState < 2) {
    await waitForVideoEvent(video, 'loadeddata', SEEK_TIMEOUT_MS)
  }
}

function drawCropToCanvas(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  cropRect: FrameRect | undefined,
  outputWidth: number,
  outputHeight: number,
): void {
  const sourceWidth = video.videoWidth
  const sourceHeight = video.videoHeight
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new FrameCaptureError('Video has no decoded frame dimensions.')
  }

  ctx.clearRect(0, 0, outputWidth, outputHeight)

  if (!cropRect || (cropRect.width >= 0.999 && cropRect.height >= 0.999 && cropRect.x <= 0.001 && cropRect.y <= 0.001)) {
    ctx.drawImage(video, 0, 0, outputWidth, outputHeight)
    return
  }

  const sx = cropRect.x * sourceWidth
  const sy = cropRect.y * sourceHeight
  const sw = cropRect.width * sourceWidth
  const sh = cropRect.height * sourceHeight
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight)
}

function assertCanvasReadable(canvas: HTMLCanvasElement): void {
  try {
    canvas.getContext('2d')?.getImageData(0, 0, 1, 1)
  } catch {
    throw new FrameCaptureError(
      'Cannot capture this video frame — the source is not CORS-accessible. Re-import the file from this origin or use a locally uploaded video.',
    )
  }
}

export async function captureVideoFrameBlob(
  video: HTMLVideoElement,
  sourceTime: number,
  options?: {
    cropRect?: FrameRect
    mimeType?: string
  },
): Promise<Blob> {
  await seekVideoToTime(video, sourceTime)

  const width = video.videoWidth
  const height = video.videoHeight
  if (width <= 0 || height <= 0) {
    throw new FrameCaptureError('Video frame is not available at the requested time.')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new FrameCaptureError('Canvas is unavailable in this browser.')
  }

  drawCropToCanvas(ctx, video, options?.cropRect, width, height)
  assertCanvasReadable(canvas)

  const mimeType = options?.mimeType ?? 'image/png'
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType)
  })

  if (!blob) {
    throw new FrameCaptureError('Failed to encode captured frame as PNG.')
  }

  return blob
}

export async function captureVideoFrameToFile(
  video: HTMLVideoElement,
  sourceTime: number,
  fileName: string,
  options?: {
    cropRect?: FrameRect
  },
): Promise<File> {
  const blob = await captureVideoFrameBlob(video, sourceTime, options)
  return new File([blob], fileName, { type: blob.type || 'image/png' })
}

/** Hidden video element for frame capture (reused across calls). */
export function createCaptureVideoElement(): HTMLVideoElement {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.style.position = 'fixed'
  video.style.width = '1px'
  video.style.height = '1px'
  video.style.opacity = '0'
  video.style.pointerEvents = 'none'
  video.style.left = '-9999px'
  document.body.appendChild(video)
  return video
}

export async function loadCaptureVideoSource(
  video: HTMLVideoElement,
  objectUrl: string,
): Promise<void> {
  if (/^https?:\/\//i.test(objectUrl)) {
    video.crossOrigin = 'anonymous'
  } else {
    video.removeAttribute('crossorigin')
  }
  if (video.src !== objectUrl) {
    video.src = objectUrl
    video.load()
    await waitForVideoEvent(video, 'loadeddata', SEEK_TIMEOUT_MS)
  }
}
