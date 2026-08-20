import { describe, expect, it } from 'vitest'

import { MIN_CLIP_DURATION } from '../timeline/helpers'
import { createEmptyProject, addClipFromSource } from '../timeline/operations'
import type { MediaAsset } from '../types/project'
import { MAIN_VIDEO_TRACK_ID } from '../types/project'
import {
  addClipRedBox,
  DEFAULT_RED_BOX_DURATION,
  moveClipRedBox,
  removeClipRedBox,
  trimClipRedBox,
  updateClipRedBox,
} from './redBoxOps'

function mockAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: overrides.id ?? 'source-1',
    file: overrides.file ?? new File([], 'test.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:test',
    duration: 10,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
    ...overrides,
  }
}

describe('redBoxOps', () => {
  it('defaults new red boxes to five seconds from the playhead', () => {
    const asset = mockAsset()
    let doc = createEmptyProject()
    doc = addClipFromSource(doc, asset, 0)
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!.id

    doc = addClipRedBox(doc, clipId, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 0)!.document

    const box = doc.tracks
      .find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
      .clips[0]!.effects.find((effect) => effect.type === 'red-box')!
    expect(DEFAULT_RED_BOX_DURATION).toBe(5)
    expect(box.startOffset).toBeCloseTo(0)
    expect(box.endOffset).toBeCloseTo(5)
  })

  it('adds multiple red boxes without replacing existing ones', () => {
    const asset = mockAsset()
    let doc = createEmptyProject()
    doc = addClipFromSource(doc, asset, 0)
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!.id

    doc = addClipRedBox(doc, clipId, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 0)!.document
    doc = addClipRedBox(doc, clipId, { x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, 2)!.document

    const clip = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!
    const boxes = clip.effects.filter((effect) => effect.type === 'red-box')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]?.rect.x).toBeCloseTo(0.1)
    expect(boxes[1]?.rect.x).toBeCloseTo(0.5)
  })

  it('updates one red box by effect id', () => {
    const asset = mockAsset()
    let doc = createEmptyProject()
    doc = addClipFromSource(doc, asset, 0)
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!.id

    doc = addClipRedBox(doc, clipId, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 0)!.document
    doc = addClipRedBox(doc, clipId, { x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, 2)!.document

    const clip = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!
    const firstId = clip.effects.find((effect) => effect.type === 'red-box')!.id

    doc = updateClipRedBox(doc, clipId, firstId, {
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.3,
    })

    const updated = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!
    const boxes = updated.effects.filter((effect) => effect.type === 'red-box')
    expect(boxes).toHaveLength(2)
    expect(boxes.find((box) => box.id === firstId)?.rect.x).toBeCloseTo(0.2)
    expect(boxes.find((box) => box.id !== firstId)?.rect.x).toBeCloseTo(0.5)
  })

  it('removes one red box by effect id', () => {
    const asset = mockAsset()
    let doc = createEmptyProject()
    doc = addClipFromSource(doc, asset, 0)
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!.id

    doc = addClipRedBox(doc, clipId, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 0)!.document
    doc = addClipRedBox(doc, clipId, { x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, 2)!.document

    const clip = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!
    const firstId = clip.effects.find((effect) => effect.type === 'red-box')!.id

    doc = removeClipRedBox(doc, clipId, firstId)

    const remaining = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!
    const boxes = remaining.effects.filter((effect) => effect.type === 'red-box')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]?.rect.x).toBeCloseTo(0.5)
  })

  it('moves a red box while preserving its duration and clip bounds', () => {
    const asset = mockAsset()
    let doc = createEmptyProject()
    doc = addClipFromSource(doc, asset, 0)
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!.id

    doc = addClipRedBox(doc, clipId, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 0)!.document
    const effectId = doc.tracks
      .find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
      .clips[0]!.effects.find((effect) => effect.type === 'red-box')!.id
    doc = trimClipRedBox(doc, clipId, effectId, 'end', 4)

    const readBox = (document: typeof doc) =>
      document.tracks
        .find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
        .clips[0]!.effects.find((effect) => effect.type === 'red-box')!

    const moved = readBox(moveClipRedBox(doc, clipId, effectId, 3))
    expect(moved.startOffset).toBeCloseTo(3)
    expect(moved.endOffset).toBeCloseTo(7)

    const pastEnd = readBox(moveClipRedBox(doc, clipId, effectId, 100))
    expect(pastEnd.startOffset).toBeCloseTo(6)
    expect(pastEnd.endOffset).toBeCloseTo(10)

    const beforeStart = readBox(moveClipRedBox(doc, clipId, effectId, -5))
    expect(beforeStart.startOffset).toBeCloseTo(0)
    expect(beforeStart.endOffset).toBeCloseTo(4)
  })

  it('keeps the red-box rect untouched when moving it', () => {
    const asset = mockAsset()
    let doc = createEmptyProject()
    doc = addClipFromSource(doc, asset, 0)
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!.id

    doc = addClipRedBox(doc, clipId, { x: 0.25, y: 0.35, width: 0.2, height: 0.2 }, 0)!.document
    const effectId = doc.tracks
      .find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
      .clips[0]!.effects.find((effect) => effect.type === 'red-box')!.id
    doc = trimClipRedBox(doc, clipId, effectId, 'end', 2)
    doc = moveClipRedBox(doc, clipId, effectId, 5)

    const box = doc.tracks
      .find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
      .clips[0]!.effects.find((effect) => effect.type === 'red-box')!
    expect(box.rect.x).toBeCloseTo(0.25)
    expect(box.rect.y).toBeCloseTo(0.35)
    expect(box.startOffset).toBeCloseTo(5)
    expect(box.endOffset).toBeCloseTo(7)
  })

  it('does not trim red-box annotations below the minimum duration', () => {
    const asset = mockAsset()
    let doc = createEmptyProject()
    doc = addClipFromSource(doc, asset, 0)
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!.id

    doc = addClipRedBox(doc, clipId, { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 0)!.document
    const clip = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!
    const effectId = clip.effects.find((effect) => effect.type === 'red-box')!.id

    doc = trimClipRedBox(doc, clipId, effectId, 'end', 0.05)

    const updated = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0]!
    const box = updated.effects.find((effect) => effect.type === 'red-box')!
    expect(box.endOffset - box.startOffset).toBeCloseTo(MIN_CLIP_DURATION, 2)
  })
})
