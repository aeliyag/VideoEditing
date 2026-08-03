import { v4 as uuidv4 } from 'uuid'

import { importDebug } from '../debug/importDebug'
import type { MediaAsset } from '../types/project'

export function probeMediaFile(file: File): Promise<MediaAsset> {
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
  return probeVideoFile(file)
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

function readVideoDuration(video: HTMLVideoElement): number {
  if (Number.isFinite(video.duration) && video.duration > 0 && video.duration !== Infinity) {
    return video.duration
  }
  if (video.seekable.length > 0) {
    const end = video.seekable.end(video.seekable.length - 1)
    if (Number.isFinite(end) && end > 0) {
      return end
    }
  }
  return 0
}

function fallbackVideoAsset(file: File, objectUrl: string): MediaAsset {
  return {
    id: uuidv4(),
    file,
    objectUrl,
    duration: 30,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
  }
}

function probeVideoFile(file: File): Promise<MediaAsset> {
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

    const finish = () => {
      if (settled) {
        return
      }

      let duration = readVideoDuration(video)
      const width = video.videoWidth
      const height = video.videoHeight

      if (duration <= 0 && width > 0 && height > 0) {
        duration = 10
      }

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
        hasAudio: true,
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

    video.onloadedmetadata = finish
    video.onloadeddata = () => {
      finish()
      if (!settled) {
        kickDecode()
      }
    }
    video.ondurationchange = finish
    video.oncanplay = () => {
      finish()
      if (!settled) {
        try {
          video.currentTime = 1e101
        } catch {
          kickDecode()
        }
      }
    }
    video.onerror = () => fail()

    video.ontimeupdate = () => {
      if (video.currentTime > 0) {
        video.ontimeupdate = null
        try {
          video.currentTime = 0
        } catch {
          /* ignore */
        }
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
