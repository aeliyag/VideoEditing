import { describe, expect, it } from 'vitest'

import {
  FULL_FRAME_RECT,
  clampCameraRect,
  clipLocalProgress,
  lerpFrameRect,
  resolveFrameRect,
} from './frames'
import type { ProjectDocument, TimelineClip } from '../types/project'

describe('camera frames', () => {
  it('locks camera crop to 16:9 for 1920x1080 sources', () => {
    const rect = clampCameraRect(
      { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
      1920,
      1080,
    )
    // On a 16:9 source, normalized width === height for a 16:9 crop.
    expect(rect.width).toBeCloseTo(rect.height, 5)
    expect((rect.width * 1920) / (rect.height * 1080)).toBeCloseTo(16 / 9, 5)
  })

  it('locks camera crop to 16:9 for non-16:9 sources', () => {
    const rect = clampCameraRect(
      { x: 0, y: 0, width: 0.4, height: 0.4 },
      3456,
      2234,
    )
    expect((rect.width * 3456) / (rect.height * 2234)).toBeCloseTo(16 / 9, 5)
  })

  it('lerps between start and end at t=0.5', () => {
    const a = { x: 0, y: 0, width: 1, height: 1 }
    const b = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }
    const mid = lerpFrameRect(a, b, 0.5, 1920, 1080)
    expect(mid.x).toBeCloseTo(0.1, 2)
    expect(mid.width).toBeCloseTo(0.75, 2)
  })

  it('resolves full frame when id is null', () => {
    const doc: ProjectDocument = {
      id: '1',
      frameBank: [],
      tracks: [],
      materials: [],
    }
    expect(resolveFrameRect(doc, null)).toEqual(FULL_FRAME_RECT)
  })

  it('computes clip local progress', () => {
    const clip: TimelineClip = {
      id: 'c',
      sourceId: 's',
      sourceStart: 0,
      sourceEnd: 10,
      timelineStart: 5,
      effects: [],
    }
    expect(clipLocalProgress(clip, 5)).toBe(0)
    expect(clipLocalProgress(clip, 10)).toBe(0.5)
    expect(clipLocalProgress(clip, 15)).toBe(1)
  })
})
