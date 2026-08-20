/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'

import { assignClipCameraStart } from '../camera/frameBankOps'
import { DEFAULT_RED_BOX_STROKE_WIDTH } from '../camera/redBoxOps'
import { addClipFromSource, createEmptyProject } from './operations'
import { migrateLoadedProject } from './migrateProject'
import type { MediaAsset, ProjectDocument } from '../types/project'
import { MAIN_VIDEO_TRACK_ID } from '../types/project'

function mockAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: overrides.id ?? 'source-1',
    file: overrides.file ?? new File([], 'shot.png', { type: 'image/png' }),
    objectUrl: 'blob:test',
    duration: 10,
    fps: 0,
    width: 3456,
    height: 2234,
    hasAudio: false,
    ...overrides,
  }
}

describe('migrateLoadedProject', () => {
  it('defaults missing red-box stroke width and clamps rects', () => {
    const asset = mockAsset()
    let doc = addClipFromSource(createEmptyProject(), asset, 0)
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    track.clips[0] = {
      ...track.clips[0]!,
      effects: [
        {
          type: 'red-box',
          id: 'rb1',
          rect: { x: -0.1, y: 0, width: 1.5, height: 0.5 },
          strokeWidth: undefined as unknown as number,
          startOffset: 0,
          endOffset: 5,
        },
      ],
    }

    const migrated = migrateLoadedProject(doc, new Map([[asset.id, asset]]))
    const box = migrated.tracks[0]!.clips[0]!.effects[0]!
    expect(box.type).toBe('red-box')
    if (box.type === 'red-box') {
      expect(box.strokeWidth).toBe(DEFAULT_RED_BOX_STROKE_WIDTH)
      expect(box.rect.x).toBeGreaterThanOrEqual(0)
      expect(box.rect.width).toBeLessThanOrEqual(1)
    }
  })

  it('drops camera effects with invalid frame-bank references', () => {
    const asset = mockAsset()
    let doc = addClipFromSource(createEmptyProject(), asset, 0)
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    track.clips[0] = {
      ...track.clips[0]!,
      effects: [
        {
          type: 'camera',
          startFrameId: 'missing-frame',
          endFrameId: null,
        },
      ],
    }

    const migrated = migrateLoadedProject(doc, new Map([[asset.id, asset]]))
    expect(migrated.tracks[0]!.clips[0]!.effects).toHaveLength(0)
  })

  it('re-clamps frame-bank presets using clip source dimensions', () => {
    const asset = mockAsset({ width: 3456, height: 2234 })
    let doc = addClipFromSource(createEmptyProject(), asset, 0)
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!.id
    doc = assignClipCameraStart(
      doc,
      clipId,
      { x: 0, y: 0, width: 0.4, height: 0.4 },
      'Crop',
      1920,
      1080,
    )

    const migrated = migrateLoadedProject(doc, new Map([[asset.id, asset]]))
    const preset = migrated.frameBank[0]!
    expect((preset.rect.width * 3456) / (preset.rect.height * 2234)).toBeCloseTo(16 / 9, 5)
  })
})
