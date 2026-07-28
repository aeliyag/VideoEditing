import { describe, expect, it } from 'vitest'

import type { MediaAsset, ProjectDocument, TimelineClip } from '../types/project'
import { MAIN_VIDEO_TRACK_ID } from '../types/project'
import { clipDuration, totalDuration } from './helpers'
import {
  addClipFromSource,
  createEmptyProject,
  deleteClip,
  reorderClipByDrag,
  splitAtPlayhead,
  trimClip,
} from './operations'

const FPS = 30

function mockAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'source-1',
    file: new File([], 'test.mp4'),
    objectUrl: 'blob:test',
    duration: 10,
    fps: FPS,
    width: 1920,
    height: 1080,
    hasAudio: true,
    ...overrides,
  }
}

function docWithClip(clip: Partial<TimelineClip> = {}): ProjectDocument {
  let doc = createEmptyProject()
  doc = addClipFromSource(doc, mockAsset())
  const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
  const base = track.clips[0]
  track.clips[0] = { ...base, ...clip }
  return doc
}

describe('timeline operations', () => {
  it('creates a full-length clip on import', () => {
    const doc = addClipFromSource(createEmptyProject(), mockAsset())
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    expect(track.clips).toHaveLength(1)
    expect(track.clips[0].sourceStart).toBe(0)
    expect(track.clips[0].sourceEnd).toBe(10)
    expect(totalDuration(doc)).toBe(10)
  })

  it('splits a clip at the playhead', () => {
    const doc = docWithClip()
    const split = splitAtPlayhead(doc, 4, FPS)
    const track = split.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    expect(track.clips).toHaveLength(2)
    const [left, right] = track.clips.sort((a, b) => a.timelineStart - b.timelineStart)
    expect(left.timelineStart).toBe(0)
    expect(clipDuration(left)).toBeCloseTo(4, 2)
    expect(right.timelineStart).toBeCloseTo(4, 2)
    expect(clipDuration(right)).toBeCloseTo(6, 2)
    expect(totalDuration(split)).toBeCloseTo(10, 2)
  })

  it('no-ops split at clip edge', () => {
    const doc = docWithClip()
    expect(splitAtPlayhead(doc, 0, FPS)).toEqual(doc)
    expect(splitAtPlayhead(doc, 10, FPS)).toEqual(doc)
  })

  it('trims clip end and ripples following clips', () => {
    let doc = docWithClip({ sourceEnd: 5, timelineStart: 0 })
    doc = addClipFromSource(doc, mockAsset(), 5)
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const second = track.clips.find((c) => c.timelineStart === 5)!
    track.clips = [
      track.clips.find((c) => c.timelineStart === 0)!,
      { ...second, timelineStart: 5 },
    ]

    const firstId = track.clips[0].id
    const trimmed = trimClip(doc, firstId, 'end', 3, 10, FPS)
    const after = trimmed.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const first = after.clips.find((c) => c.id === firstId)!
    const rest = after.clips.find((c) => c.id !== firstId)!
    expect(clipDuration(first)).toBeCloseTo(3, 1)
    expect(rest.timelineStart).toBeCloseTo(3, 1)
  })

  it('deletes a clip and ripples the timeline', () => {
    let doc = docWithClip({ sourceEnd: 4, timelineStart: 0 })
    doc = addClipFromSource(doc, mockAsset({ duration: 6 }), 4)
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    expect(track.clips).toHaveLength(2)

    const firstId = track.clips.find((c) => c.timelineStart === 0)!.id
    const deleted = deleteClip(doc, firstId)
    const afterTrack = deleted.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    expect(afterTrack.clips).toHaveLength(1)
    expect(afterTrack.clips[0].timelineStart).toBe(0)
    expect(totalDuration(deleted)).toBeCloseTo(6, 2)
  })

  it('reorders clips by drag and repacks with no gaps', () => {
    let doc = docWithClip({ sourceEnd: 3, timelineStart: 0 })
    doc = addClipFromSource(doc, mockAsset({ duration: 3 }), 3)
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const [first, second] = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
    const reordered = reorderClipByDrag(doc, second.id, -1)
    const after = reordered.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const sorted = [...after.clips].sort((a, b) => a.timelineStart - b.timelineStart)
    expect(sorted).toHaveLength(2)
    let cursor = 0
    for (const clip of sorted) {
      expect(clip.timelineStart).toBeCloseTo(cursor, 5)
      cursor += clipDuration(clip)
    }
    expect(sorted[0].id).toBe(second.id)
    expect(totalDuration(reordered)).toBeCloseTo(6, 1)
    void first
    void second
  })
})
