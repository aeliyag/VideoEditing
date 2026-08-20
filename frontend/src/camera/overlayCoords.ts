import type { FrameRect } from '../types/project'
import { mediaRectInContainer } from '../timeline/helpers'

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function clampBoxDimension(value: number): number {
  return Math.max(1, Math.round(value))
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

export function clampOutputFrameRect(rect: FrameRect): FrameRect {
  const width = Math.max(0.02, Math.min(1, rect.width))
  const height = Math.max(0.02, Math.min(1, rect.height))
  return {
    x: Math.max(0, Math.min(1 - width, rect.x)),
    y: Math.max(0, Math.min(1 - height, rect.y)),
    width,
    height,
  }
}

/** Map a normalized output-frame rect to pixel coordinates for preview overlays. */
export function mapOutputFrameRectToPixel(
  rect: FrameRect,
  display: DisplayRect,
): PixelRect {
  return {
    x: display.x + rect.x * display.width,
    y: display.y + rect.y * display.height,
    width: rect.width * display.width,
    height: rect.height * display.height,
  }
}

/** Map a normalized output-frame rect to ffmpeg drawbox pixel coordinates. */
export function mapOutputFrameRectToDrawbox(
  rect: FrameRect,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; width: number; height: number } {
  const evenW = evenDimension(frameWidth)
  const evenH = evenDimension(frameHeight)
  return {
    x: Math.round(rect.x * evenW),
    y: Math.round(rect.y * evenH),
    width: clampBoxDimension(rect.width * evenW),
    height: clampBoxDimension(rect.height * evenH),
  }
}

export interface RedBoxOverlayLayout {
  display: DisplayRect
  frameWidth: number
  frameHeight: number
  usesOutputFrameSpace: boolean
}

/**
 * Preview layout for red-box overlays.
 * When camera crop fills the stage, rects are in output-frame space (full stage).
 * Otherwise they map against the clip's letterboxed source rect.
 */
export function resolveRedBoxOverlayLayout(args: {
  stageWidth: number
  stageHeight: number
  clipWidth: number
  clipHeight: number
  cameraPreviewActive: boolean
}): RedBoxOverlayLayout {
  const { stageWidth, stageHeight, clipWidth, clipHeight, cameraPreviewActive } = args
  if (cameraPreviewActive) {
    return {
      display: { x: 0, y: 0, width: stageWidth, height: stageHeight },
      frameWidth: clipWidth,
      frameHeight: clipHeight,
      usesOutputFrameSpace: true,
    }
  }
  return {
    display: mediaRectInContainer(stageWidth, stageHeight, clipWidth, clipHeight),
    frameWidth: clipWidth,
    frameHeight: clipHeight,
    usesOutputFrameSpace: false,
  }
}
