import { v4 as uuidv4 } from 'uuid'

import { importDebug } from '../debug/importDebug'
import type { MediaAsset } from '../types/project'

export interface ProbeMediaOptions {
  /** Used when the container has no duration metadata (common for MediaRecorder WebM). */
  durationHint?: number
}

export function resolveProbedVideoDuration(input: {
  elementDuration: number
  seekableEnd: number
  discoveredEnd?: number
  durationHint?: number
}): number {
  if (
    Number.isFinite(input.elementDuration) &&
    input.elementDuration > 0 &&
    input.elementDuration !== Infinity
  ) {
    return input.elementDuration
  }
  if (Number.isFinite(input.seekableEnd) && input.seekableEnd > 0) {
    return input.seekableEnd
  }
  if (
    input.discoveredEnd != null &&
    Number.isFinite(input.discoveredEnd) &&
    input.discoveredEnd > 0
  ) {
    return input.discoveredEnd
  }
  if (
    input.durationHint != null &&
    Number.isFinite(input.durationHint) &&
    input.durationHint > 0
  ) {
    return input.durationHint
  }
  return 0
}

export function probeMediaFile(
  file: File,
  options?: ProbeMediaOptions,
): Promise<MediaAsset> {
  importDebug('probeMediaFile start', { name: file.name, type: file.type, size: file.size })
  const isLikelyImage =
    file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)

  if (isLikelyImage) {
    importDebug('probe route: image')
    return probeImageFile(file)
  }

  const isLikelyAudio =
    file.type.startsWith('audio/') ||
    /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)

  if (isLikelyAudio) {
    importDebug('probe route: audio')
    return probeAudioFile(file)
  }
  importDebug('probe route: video')
  return probeVideoFile(file, options)
}

function probeImageFile(file: File): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      importDebug('probe image ok', { w: img.naturalWidth, h: img.naturalHeight })
      resolve({
        id: uuidv4(),
        file,
        objectUrl,
        duration: 5,
        fps: 30,
        width: img.naturalWidth,
        height: img.naturalHeight,
        hasAudio: false,
      })
    }
    img.onerror = () => {
      importDebug('probe image FAILED', { name: file.name })
      URL.revokeObjectURL(objectUrl)
      reject(new Error(`Unable to read image metadata for ${file.name}`))
    }
    img.src = objectUrl
  })
}

function probeAudioFile(file: File): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.src = objectUrl
    audio.style.display = 'none'
    document.body.appendChild(audio)

    const cleanup = () => {
      audio.removeAttribute('src')
      audio.load()
      audio.remove()
    }

    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0
      importDebug('probe audio ok', { duration })
      cleanup()
      resolve({
        id: uuidv4(),
        file,
        objectUrl,
        duration,
        fps: 0,
        width: 0,
        height: 0,
        hasAudio: true,
      })
    }

    audio.onerror = () => {
      importDebug('probe audio FAILED', { name: file.name })
      URL.revokeObjectURL(objectUrl)
      cleanup()
      reject(new Error(`Unable to read audio metadata for ${file.name}`))
    }
  })
}

function readVideoDuration(
  video: HTMLVideoElement,
  extra?: { discoveredEnd?: number; durationHint?: number },
): number {
  const seekableEnd =
    video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : 0
  return resolveProbedVideoDuration({
    elementDuration: video.duration,
    seekableEnd,
    discoveredEnd: extra?.discoveredEnd,
    durationHint: extra?.durationHint,
  })
}

function fallbackVideoAsset(file: File, objectUrl: string, hasAudio = true): MediaAsset {
  return {
    id: uuidv4(),
    file,
    objectUrl,
    duration: 30,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio,
  }
}

function detectVideoHasAudio(video: HTMLVideoElement): boolean {
  const extended = video as HTMLVideoElement & {
    audioTracks?: { length: number }
    mozHasAudio?: boolean
    webkitAudioDecodedByteCount?: number
  }

  if (extended.audioTracks && extended.audioTracks.length > 0) {
    return true
  }

  if (typeof extended.mozHasAudio === 'boolean') {
    return extended.mozHasAudio
  }

  if (typeof extended.webkitAudioDecodedByteCount === 'number') {
    return extended.webkitAudioDecodedByteCount > 0
  }

  return true
}

function probeVideoFile(file: File, options?: ProbeMediaOptions): Promise<MediaAsset> {
  importDebug('probeVideoFile start', { name: file.name })
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')
    video.src = objectUrl
    video.style.position = 'fixed'
    video.style.width = '1px'
    video.style.height = '1px'
    video.style.opacity = '0'
    video.style.pointerEvents = 'none'
    video.style.left = '-9999px'
    document.body.appendChild(video)
    video.load()

    let settled = false
    let seekingForDuration = false

    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
      video.remove()
    }

    const fail = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      importDebug('probe video fallback (error/timeout)', { name: file.name })
      resolve(fallbackVideoAsset(file, objectUrl))
    }

    const finish = (extra?: { discoveredEnd?: number }) => {
      if (settled) {
        return
      }

      const duration = readVideoDuration(video, {
        discoveredEnd: extra?.discoveredEnd,
        durationHint: options?.durationHint,
      })
      const width = video.videoWidth
      const height = video.videoHeight

      if (duration <= 0 || width <= 0 || height <= 0) {
        return
      }

      settled = true
      cleanup()
      importDebug('probe video ok', { duration, width, height })
      resolve({
        id: uuidv4(),
        file,
        objectUrl,
        duration,
        fps: 30,
        width,
        height,
        hasAudio: detectVideoHasAudio(video),
      })
    }

    const kickDecode = () => {
      void video
        .play()
        .then(() => {
          video.pause()
          finish()
        })
        .catch(() => {
          finish()
        })
    }

    const seekToEndForDuration = () => {
      if (settled || seekingForDuration) {
        return
      }
      seekingForDuration = true
      try {
        video.currentTime = 1e101
      } catch {
        seekingForDuration = false
        kickDecode()
      }
    }

    const onDurationSeeked = () => {
      if (!seekingForDuration || settled) {
        return
      }
      const discoveredEnd = video.currentTime
      seekingForDuration = false
      try {
        video.currentTime = 0
      } catch {
        /* ignore */
      }
      finish({ discoveredEnd })
    }

    video.onloadedmetadata = () => finish()
    video.onloadeddata = () => {
      finish()
      if (!settled) {
        kickDecode()
      }
    }
    video.ondurationchange = () => finish()
    video.oncanplay = () => {
      finish()
      if (!settled) {
        seekToEndForDuration()
      }
    }
    video.onseeked = onDurationSeeked
    video.onerror = () => fail()

    video.ontimeupdate = () => {
      if (seekingForDuration && video.currentTime > 0.25) {
        onDurationSeeked()
        return
      }
      if (!seekingForDuration && video.currentTime > 0) {
        video.ontimeupdate = null
        finish()
      }
    }

    window.setTimeout(() => {
      if (!settled) {
        finish()
      }
      if (!settled) {
        settled = true
        cleanup()
        importDebug('probe video timeout fallback', { name: file.name })
        resolve(fallbackVideoAsset(file, objectUrl))
      }
    }, 12000)
  })
}

export function revokeMediaAsset(asset: MediaAsset): void {
  URL.revokeObjectURL(asset.objectUrl)
}
