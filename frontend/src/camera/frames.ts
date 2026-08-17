import type { FrameRect, ProjectDocument, TimelineClip } from '../types/project'
import { isCameraEffect } from '../types/project'

export const FULL_FRAME_RECT: FrameRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
}

export const CAMERA_ASPECT = 16 / 9
const MIN_SIZE = 0.05

/** Free-form rect for annotations (any 4-sided rectangle, including squares). */
export function clampFreeRect(rect: FrameRect): FrameRect {
  const width = Math.max(MIN_SIZE, Math.min(1, rect.width))
  const height = Math.max(MIN_SIZE, Math.min(1, rect.height))
  return {
    x: Math.max(0, Math.min(1 - width, rect.x)),
    y: Math.max(0, Math.min(1 - height, rect.y)),
    width,
    height,
  }
}

/**
 * Camera crop locked to 16:9 in source pixel space.
 * Normalized width/height depend on the source aspect ratio.
 */
export function clampCameraRect(
  rect: FrameRect,
  sourceWidth: number,
  sourceHeight: number,
  aspect = CAMERA_ASPECT,
): FrameRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return FULL_FRAME_RECT
  }

  // (w*sw)/(h*sh) = aspect  =>  w/h = aspect * sh/sw
  const normRatio = aspect * (sourceHeight / sourceWidth)

  let width = Math.max(MIN_SIZE, Math.min(1, rect.width))
  let height = width / normRatio

  if (height > 1) {
    height = 1
    width = height * normRatio
  }
  if (height < MIN_SIZE) {
    height = MIN_SIZE
    width = Math.min(1, height * normRatio)
  }
  if (width > 1) {
    width = 1
    height = width / normRatio
  }

  const x = Math.max(0, Math.min(1 - width, rect.x))
  const y = Math.max(0, Math.min(1 - height, rect.y))
  return { x, y, width, height }
}

/** @deprecated use clampCameraRect / clampFreeRect */
export function clampFrameRect(rect: FrameRect): FrameRect {
  // Backward-compatible: treat as source-aspect crop (square in normalized space).
  const size = Math.max(MIN_SIZE, Math.min(1, Math.min(rect.width, rect.height)))
  return {
    x: Math.max(0, Math.min(1 - size, rect.x)),
    y: Math.max(0, Math.min(1 - size, rect.y)),
    width: size,
    height: size,
  }
}

export function resolveFrameRect(
  doc: ProjectDocument,
  frameId: string | null,
  sourceWidth = 1920,
  sourceHeight = 1080,
): FrameRect {
  if (!frameId) {
    return FULL_FRAME_RECT
  }
  const preset = doc.frameBank.find((f) => f.id === frameId)
  return preset
    ? clampCameraRect(preset.rect, sourceWidth, sourceHeight)
    : FULL_FRAME_RECT
}

export function lerpFrameRect(
  a: FrameRect,
  b: FrameRect,
  t: number,
  sourceWidth = 1920,
  sourceHeight = 1080,
): FrameRect {
  const u = Math.max(0, Math.min(1, t))
  // Smoothstep eases in/out so Ken Burns doesn't feel abrupt.
  const s = u * u * (3 - 2 * u)
  return clampCameraRect(
    {
      x: a.x + (b.x - a.x) * s,
      y: a.y + (b.y - a.y) * s,
      width: a.width + (b.width - a.width) * s,
      height: a.height + (b.height - a.height) * s,
    },
    sourceWidth,
    sourceHeight,
  )
}

export function getCameraEffect(clip: TimelineClip) {
  return clip.effects.find(isCameraEffect) ?? null
}

export function clipLocalProgress(clip: TimelineClip, timelineTime: number): number {
  const duration = clip.sourceEnd - clip.sourceStart
  if (duration <= 0) {
    return 0
  }
  const local = timelineTime - clip.timelineStart
  return Math.max(0, Math.min(1, local / duration))
}

export function getClipCameraRectAtTimelineTime(
  doc: ProjectDocument,
  clip: TimelineClip,
  timelineTime: number,
  sourceWidth = 1920,
  sourceHeight = 1080,
): FrameRect {
  const camera = getCameraEffect(clip)
  if (!camera) {
    return FULL_FRAME_RECT
  }
  const start = resolveFrameRect(doc, camera.startFrameId, sourceWidth, sourceHeight)
  const end = resolveFrameRect(
    doc,
    camera.endFrameId ?? camera.startFrameId,
    sourceWidth,
    sourceHeight,
  )
  const progress = clipLocalProgress(clip, timelineTime)
  return lerpFrameRect(start, end, progress, sourceWidth, sourceHeight)
}

export function isFullFrameRect(rect: FrameRect): boolean {
  const r = clampFreeRect(rect)
  return r.x <= 0.001 && r.y <= 0.001 && r.width >= 0.999 && r.height >= 0.999
}

/** Layout styles for a sharp cropped preview (renders crop at higher resolution). */
export function cropRectToPreviewLayout(rect: FrameRect): {
  transform?: string
  transformOrigin?: string
  imageRendering?: 'crisp-edges'
} {
  const r = clampFreeRect(rect)
  if (isFullFrameRect(r)) {
    return {}
  }

  // Use transform-based cropping but render quality hints for sharper upscaling
  const scaleX = 1 / Math.max(0.001, r.width)
  const scaleY = 1 / Math.max(0.001, r.height)
  const tx = -r.x * 100
  const ty = -r.y * 100

  return {
    transform: `scale(${scaleX}, ${scaleY}) translate(${tx}%, ${ty}%)`,
    transformOrigin: '0 0',
    imageRendering: 'crisp-edges',
  }
}

/** CSS transform so the crop fills the stage (may be non-uniform if aspect differs). */
export function cropRectToVideoTransform(rect: FrameRect): string {
  const r = clampFreeRect(rect)
  const scaleX = 1 / Math.max(0.001, r.width)
  const scaleY = 1 / Math.max(0.001, r.height)
  const tx = -r.x * 100
  const ty = -r.y * 100
  return `scale(${scaleX}, ${scaleY}) translate(${tx}%, ${ty}%)`
}
