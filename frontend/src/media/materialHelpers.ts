import type { MaterialKind, MaterialOrigin } from '../types/project'
import { importDebug } from '../debug/importDebug'
import { probeMediaFile, type ProbeMediaOptions } from '../media/probe'

export function inferMaterialKind(
  file: File,
  asset: { width: number; height: number; hasAudio: boolean; fps: number },
): MaterialKind {
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
    return 'image'
  }
  if (
    file.type.startsWith('audio/') ||
    /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name) ||
    (asset.fps === 0 && asset.hasAudio)
  ) {
    return 'audio'
  }
  return 'video'
}

export function materialLabel(origin: MaterialOrigin): string {
  switch (origin) {
    case 'upload':
      return 'Upload'
    case 'tts':
      return 'TTS'
    case 'image-generate':
      return 'AI Image'
    case 'image-to-video':
      return 'AI Video'
    case 'akool-record':
      return 'Akool Recording'
    case 'freeze-frame':
      return 'Freeze Frame'
  }
}

export async function probeFileAsMaterial(
  file: File,
  options?: ProbeMediaOptions,
): Promise<{
  asset: Awaited<ReturnType<typeof probeMediaFile>>
  kind: MaterialKind
}> {
  const asset = await probeMediaFile(file, options)
  const kind = inferMaterialKind(file, asset)
  importDebug('probeFileAsMaterial done', { kind, assetId: asset.id, duration: asset.duration })
  return { asset, kind }
}
