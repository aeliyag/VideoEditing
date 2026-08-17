import { describe, expect, it } from 'vitest'

import type { MediaAsset, ProjectDocument, TimelineClip } from '../types/project'
import { isElementEffect, MAIN_AUDIO_TRACK_ID, MAIN_VIDEO_TRACK_ID } from '../types/project'
import {
  clipDuration,
  clipTimelineEnd,
  totalDuration,
} from './helpers'
import {
  addAudioClipFromSource,
  addClipFromSource,
  createEmptyProject,
} from './operations'
import {
  DEFAULT_FREEZE_FRAME_DURATION,
  insertFreezeFrameAtPlayhead,
  isVideoClipAtPlayhead,
  sourceTimeAtPlayhead,
} from './freezeFrame'
import {
  createInitialState,
  projectReducer,
} from '../state/projectReducer'

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

function mockImageAsset(id = 'freeze-asset'): MediaAsset {
  return {
    id,
    file: new File([], 'freeze.png', { type: 'image/png' }),
    objectUrl: 'blob:freeze',
    duration: 5,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: false,
  }
}

function docWithClip(clip: Partial<TimelineClip> = {}): ProjectDocument {
  let doc = createEmptyProject()
  doc = addClipFromSource(doc, mockAsset())
  const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
  const base = track.clips[0]
  track.clips[0] = { ...base, ...clip }
  doc = {
    ...doc,
    materials: [
      {
        id: 'source-1',
        name: 'test.mp4',
        kind: 'video',
        origin: 'upload',
        addedAt: 1,
      },
    ],
  }
  return doc
}

function materialKindMap(doc: ProjectDocument): Map<string, 'video' | 'audio' | 'image'> {
  return new Map((doc.materials ?? []).map((m) => [m.id, m.kind]))
}

describe('sourceTimeAtPlayhead', () => {
  it('maps trimmed clip playhead to source time', () => {
    const clip: TimelineClip = {
      id: 'c1',
      sourceId: 'source-1',
      sourceStart: 2,
      sourceEnd: 8,
      timelineStart: 1,
      effects: [],
    }
    expect(sourceTimeAtPlayhead(clip, 4, FPS)).toBeCloseTo(5, 2)
  })
})

describe('isVideoClipAtPlayhead', () => {
  it('returns false for image clips', () => {
    let doc = docWithClip()
    doc = {
      ...doc,
      materials: [{ id: 'source-1', name: 'still.png', kind: 'image', origin: 'upload', addedAt: 1 }],
    }
    expect(isVideoClipAtPlayhead(doc, 2, materialKindMap(doc))).toBe(false)
  })

  it('returns true for video clips', () => {
    const doc = docWithClip()
    expect(isVideoClipAtPlayhead(doc, 2, materialKindMap(doc))).toBe(true)
  })
})

describe('insertFreezeFrameAtPlayhead', () => {
  it('splits video and inserts a 2-second still in the middle', () => {
    const doc = docWithClip()
    const result = insertFreezeFrameAtPlayhead(
      doc,
      4,
      FPS,
      'freeze-asset',
      DEFAULT_FREEZE_FRAME_DURATION,
      'freeze.png',
    )
    expect(result).not.toBeNull()
    const track = result!.document.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    expect(track.clips).toHaveLength(3)

    const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
    const [left, freeze, right] = sorted
    expect(clipDuration(left)).toBeCloseTo(4, 2)
    expect(left.sourceEnd).toBeCloseTo(4, 2)
    expect(freeze.sourceId).toBe('freeze-asset')
    expect(clipDuration(freeze)).toBe(2)
    expect(freeze.timelineStart).toBeCloseTo(4, 2)
    expect(right.sourceStart).toBeCloseTo(4, 2)
    expect(right.timelineStart).toBeCloseTo(6, 2)
    expect(totalDuration(result!.document)).toBeCloseTo(12, 2)
    expect(result!.freezeClipId).toBe(freeze.id)
  })

  it('ripples later clips on the video track', () => {
    let doc = docWithClip({ sourceEnd: 5 })
    doc = addClipFromSource(doc, mockAsset({ id: 'source-2', duration: 3 }), 5)
    doc = {
      ...doc,
      materials: [
        ...(doc.materials ?? []),
        { id: 'source-2', name: 'b.mp4', kind: 'video', origin: 'upload', addedAt: 2 },
      ],
    }
    const result = insertFreezeFrameAtPlayhead(doc, 2, FPS, 'freeze-asset', 2, 'f.png')
    const track = result!.document.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const last = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart).at(-1)!
    expect(last.timelineStart).toBeCloseTo(7, 2)
    expect(totalDuration(result!.document)).toBeCloseTo(10, 2)
  })

  it('ripples audio clips starting at or after the playhead', () => {
    let doc = docWithClip()
    doc = addAudioClipFromSource(doc, mockAsset({ id: 'audio-1', duration: 4, hasAudio: true }), 3)
    const result = insertFreezeFrameAtPlayhead(doc, 2, FPS, 'freeze-asset', 2, 'f.png')
    const audio = result!.document.tracks.find((t) => t.id === MAIN_AUDIO_TRACK_ID)!
    const clip = audio.clips[0]
    expect(clip.timelineStart).toBeCloseTo(5, 2)
  })

  it('inserts at clip start without a zero-duration left segment', () => {
    const doc = docWithClip()
    const result = insertFreezeFrameAtPlayhead(doc, 0, FPS, 'freeze-asset', 2, 'f.png')
    const track = result!.document.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    expect(track.clips).toHaveLength(2)
    const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
    expect(clipDuration(sorted[0])).toBe(2)
    expect(sorted[1].timelineStart).toBe(2)
    expect(sorted[1].sourceStart).toBe(0)
  })

  it('inserts at clip end without a zero-duration right segment', () => {
    const doc = docWithClip()
    const result = insertFreezeFrameAtPlayhead(doc, 10, FPS, 'freeze-asset', 2, 'f.png')
    const track = result!.document.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    expect(track.clips).toHaveLength(2)
    const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
    expect(clipDuration(sorted[0])).toBeCloseTo(10, 2)
    expect(sorted[1].timelineStart).toBeCloseTo(10, 2)
    expect(clipDuration(sorted[1])).toBe(2)
    expect(totalDuration(result!.document)).toBeCloseTo(12, 2)
  })

  it('preserves source continuity across split segments', () => {
    const doc = docWithClip({ sourceStart: 1, sourceEnd: 9, timelineStart: 0 })
    const playhead = 5
    const result = insertFreezeFrameAtPlayhead(doc, playhead, FPS, 'freeze-asset', 2, 'f.png')
    const track = result!.document.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
    const left = sorted[0]
    const right = sorted[2]
    expect(left.sourceEnd).toBeCloseTo(right.sourceStart, 3)
    expect(sourceTimeAtPlayhead(left, playhead, FPS)).toBeCloseTo(right.sourceStart, 3)
  })

  it('adds freeze-frame material entry', () => {
    const doc = docWithClip()
    const result = insertFreezeFrameAtPlayhead(doc, 3, FPS, 'freeze-asset', 2, 'frame.png')
    const material = result!.document.materials.find((m) => m.id === 'freeze-asset')
    expect(material?.kind).toBe('image')
    expect(material?.origin).toBe('freeze-frame')
  })

  it('carries visible elements onto the freeze clip with re-based offsets', () => {
    let doc = docWithClip({ sourceEnd: 10 })
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    track.clips[0] = {
      ...track.clips[0]!,
      effects: [
        {
          type: 'element',
          id: 'el-1',
          kind: 'text',
          rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.15 },
          z: 0,
          startOffset: 1,
          endOffset: 6,
          opacity: 1,
          text: 'Label',
          fontScale: 0.05,
          fontFamily: 'sans-serif',
          fontWeight: 600,
          color: '#fff',
          align: 'center',
          backgroundColor: null,
        },
      ],
    }

    const result = insertFreezeFrameAtPlayhead(doc, 3, FPS, 'freeze-asset', 2, 'frame.png')
    const freeze = result!.document.tracks
      .find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
      .clips.find((clip) => clip.sourceId === 'freeze-asset')
    const element = freeze?.effects.find(isElementEffect)
    expect(element?.startOffset).toBe(0)
    expect(element?.endOffset).toBe(2)
    expect(element?.kind === 'text' && element.text).toBe('Label')
    expect(element?.id).not.toBe('el-1')
  })
})

describe('FREEZE_FRAME_AT_PLAYHEAD reducer', () => {
  it('selects the inserted freeze clip', () => {
    let state = createInitialState()
    state = projectReducer(state, {
      type: 'ADD_MATERIAL',
      asset: mockAsset(),
      name: 'clip.mp4',
      kind: 'video',
      origin: 'upload',
      addToTimelineAtPlayhead: 0,
    })
    state = projectReducer(state, { type: 'SET_PLAYHEAD', time: 3 })
    state = projectReducer(state, {
      type: 'FREEZE_FRAME_AT_PLAYHEAD',
      playhead: 3,
      assetId: mockImageAsset().id,
      materialName: 'freeze.png',
      fps: FPS,
    })
    const selected = state.ui.selectedClipId
    const track = state.document.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const freeze = track.clips.find((c) => c.sourceId === mockImageAsset().id)
    expect(selected).toBe(freeze?.id)
  })

  it('inserts at the playhead passed in the action, not the current UI playhead', () => {
    let state = createInitialState()
    state = projectReducer(state, {
      type: 'ADD_MATERIAL',
      asset: mockAsset(),
      name: 'clip.mp4',
      kind: 'video',
      origin: 'upload',
      addToTimelineAtPlayhead: 0,
    })
    state = projectReducer(state, { type: 'SET_PLAYHEAD', time: 8 })
    state = projectReducer(state, {
      type: 'FREEZE_FRAME_AT_PLAYHEAD',
      playhead: 3,
      assetId: mockImageAsset().id,
      materialName: 'freeze.png',
      fps: FPS,
    })
    const track = state.document.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const freeze = track.clips.find((c) => c.sourceId === mockImageAsset().id)
    expect(freeze?.timelineStart).toBeCloseTo(3, 2)
    expect(state.ui.playhead).toBeCloseTo(3, 2)
  })
})

describe('freeze frame edge: trimmed clip', () => {
  it('uses timeline trimming when computing split source time', () => {
    const doc = docWithClip({ sourceStart: 3, sourceEnd: 13, timelineStart: 2 })
    const playhead = 7
    const result = insertFreezeFrameAtPlayhead(doc, playhead, FPS, 'freeze-asset', 2, 'f.png')
    const track = result!.document.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const left = track.clips.find((c) => c.timelineStart === 2)!
    const right = track.clips.find((c) => c.timelineStart === 9)!
    expect(left.sourceEnd).toBeCloseTo(8, 2)
    expect(right.sourceStart).toBeCloseTo(8, 2)
    expect(clipTimelineEnd(left)).toBeCloseTo(7, 2)
  })
})
