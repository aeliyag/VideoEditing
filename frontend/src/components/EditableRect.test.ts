/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'

import { pixelRectToNormalized, rectToPixel } from '../components/EditableRect'

describe('EditableRect output-frame coordinates', () => {
  const display = { x: 0, y: 0, width: 800, height: 500 }

  it('round-trips output-frame rects used by cropped preview overlays', () => {
    const rect = { x: 0.2, y: 0.3, width: 0.25, height: 0.2 }
    const pixel = rectToPixel(rect, display, undefined, 3456, 2234, true)
    const roundTrip = pixelRectToNormalized(
      pixel,
      display,
      undefined,
      3456,
      2234,
      false,
      true,
    )
    expect(roundTrip.x).toBeCloseTo(rect.x, 2)
    expect(roundTrip.y).toBeCloseTo(rect.y, 2)
    expect(roundTrip.width).toBeCloseTo(rect.width, 2)
    expect(roundTrip.height).toBeCloseTo(rect.height, 2)
  })
})
