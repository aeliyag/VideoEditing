import { describe, expect, it } from 'vitest'

import {
  clampOutputFrameRect,
  mapOutputFrameRectToDrawbox,
  mapOutputFrameRectToPixel,
  resolveRedBoxOverlayLayout,
} from './overlayCoords'

describe('overlayCoords', () => {
  it('maps output-frame rects to drawbox pixels with even dimensions', () => {
    expect(
      mapOutputFrameRectToDrawbox(
        { x: 0.2, y: 0.3, width: 0.25, height: 0.2 },
        3456,
        2234,
      ),
    ).toEqual({
      x: Math.round(0.2 * 3456),
      y: Math.round(0.3 * 2234),
      width: Math.max(1, Math.round(0.25 * 3456)),
      height: Math.max(1, Math.round(0.2 * 2234)),
    })
  })

  it('maps output-frame rects to preview pixels against the stage', () => {
    expect(
      mapOutputFrameRectToPixel(
        { x: 0.25, y: 0.35, width: 0.2, height: 0.15 },
        { x: 0, y: 0, width: 800, height: 500 },
      ),
    ).toEqual({
      x: 200,
      y: 175,
      width: 160,
      height: 75,
    })
  })

  it('uses full stage bounds when camera preview is active', () => {
    const layout = resolveRedBoxOverlayLayout({
      stageWidth: 900,
      stageHeight: 520,
      clipWidth: 3456,
      clipHeight: 2234,
      cameraPreviewActive: true,
    })
    expect(layout.usesOutputFrameSpace).toBe(true)
    expect(layout.display).toEqual({ x: 0, y: 0, width: 900, height: 520 })
  })

  it('letterboxes red boxes against the clip when camera preview is inactive', () => {
    const layout = resolveRedBoxOverlayLayout({
      stageWidth: 900,
      stageHeight: 520,
      clipWidth: 3456,
      clipHeight: 2234,
      cameraPreviewActive: false,
    })
    expect(layout.usesOutputFrameSpace).toBe(false)
    expect(layout.display.width).toBeLessThan(900)
    expect(layout.display.height).toBeCloseTo(520, 0)
    expect(layout.display.x).toBeGreaterThan(0)
  })

  it('clamps output-frame rects with the annotation minimum size', () => {
    expect(
      clampOutputFrameRect({ x: 0.99, y: 0.99, width: 0.001, height: 0.001 }),
    ).toEqual({
      x: expect.closeTo(0.98, 2),
      y: expect.closeTo(0.98, 2),
      width: 0.02,
      height: 0.02,
    })
  })
})
