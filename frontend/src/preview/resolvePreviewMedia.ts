import { isImageAsset } from '../export/buildExportGraph'
import type {
  MaterialEntry,
  MediaAsset,
  ProjectDocument,
  TimelineClip,
} from '../types/project'

export function materialForClip(
  doc: ProjectDocument,
  clip: TimelineClip,
): MaterialEntry | undefined {
  return doc.materials?.find((m) => m.id === clip.sourceId)
}

/** True when the clip should render through the preview <img> path. */
export function isImagePreviewClip(
  doc: ProjectDocument,
  clip: TimelineClip,
  asset: MediaAsset | undefined,
): boolean {
  if (!asset) {
    return false
  }
  const material = materialForClip(doc, clip)
  if (material?.kind === 'image') {
    return true
  }
  if (material?.kind === 'video' || material?.kind === 'audio') {
    return false
  }
  return isImageAsset(asset.file, asset)
}

/** Session object URL for preview; recreates from File when URL is missing. */
export function resolvePreviewObjectUrl(asset: MediaAsset): string {
  if (asset.objectUrl.startsWith('blob:') || asset.objectUrl.startsWith('data:')) {
    return asset.objectUrl
  }
  if (asset.file) {
    return URL.createObjectURL(asset.file)
  }
  return asset.objectUrl
}

/** Camera/Ken Burns transform applies to video clips only — not still images. */
export function shouldApplyCameraPreview(
  doc: ProjectDocument,
  clip: TimelineClip,
  asset: MediaAsset | undefined,
): boolean {
  return !isImagePreviewClip(doc, clip, asset)
}

export function isImagePreviewClipFromStore(
  doc: ProjectDocument,
  clip: TimelineClip,
  mediaStore: ReadonlyMap<string, MediaAsset>,
): boolean {
  return isImagePreviewClip(doc, clip, mediaStore.get(clip.sourceId))
}
