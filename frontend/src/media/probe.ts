import { v4 as uuidv4 } from 'uuid'

import type { MediaAsset } from '../types/project'

function containsAscii(bytes: Uint8Array, value: string): boolean {
  const needle = new TextEncoder().encode(value)
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) {
        continue outer
      }
    }
    return true
  }
  return false
}

async function fileHasAudioTrack(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // MP4/MOV audio handler plus common WebM audio codec identifiers.
  return (
    containsAscii(bytes, 'soun') ||
    containsAscii(bytes, 'OpusHead') ||
    containsAscii(bytes, 'A_VORBIS')
  )
}

export function probeMediaFile(file: File): Promise<MediaAsset> {
  const isLikelyAudio =
    file.type.startsWith('audio/') ||
    /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)

  if (isLikelyAudio) {
    return probeAudioFile(file)
  }
  return probeVideoFile(file)
}

function probeAudioFile(file: File): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.src = objectUrl

    const cleanup = () => {
      audio.removeAttribute('src')
      audio.load()
    }

    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0
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
      URL.revokeObjectURL(objectUrl)
      cleanup()
      reject(new Error(`Unable to read audio metadata for ${file.name}`))
    }
  })
}

function probeVideoFile(file: File): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = objectUrl

    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }

    video.onloadedmetadata = async () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const width = video.videoWidth
      const height = video.videoHeight
      const hasAudio = await fileHasAudioTrack(file)

      cleanup()
      resolve({
        id: uuidv4(),
        file,
        objectUrl,
        duration,
        fps: 30,
        width,
        height,
        hasAudio,
      })
    }

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      cleanup()
      reject(new Error(`Unable to read video metadata for ${file.name}`))
    }
  })
}

export function revokeMediaAsset(asset: MediaAsset): void {
  URL.revokeObjectURL(asset.objectUrl)
}
