import { describe, expect, it } from 'vitest'

import type { MediaAsset } from '../types/project'
import { createInitialState } from './projectReducer'
import {
  createHistoryStacks,
  pushHistory,
  redoHistory,
  restoreAssetsFromSnapshot,
  snapshotEditor,
  undoHistory,
} from './history'
import {
  DEFAULT_FREEZE_FRAME_DURATION,
  insertFreezeFrameAtPlayhead,
} from '../timeline/freezeFrame'
import { addClipFromSource, createEmptyProject } from '../timeline/operations'
import type { MediaStore } from '../types/project'

function mockAsset(id: string): MediaAsset {
  return {
    id,
    file: new File([], `${id}.mp4`),
    objectUrl: `blob:${id}`,
    duration: 10,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
  }
}

describe('editor history', () => {
  it('supports one-step undo and redo for freeze frame snapshots', () => {
    let doc = addClipFromSource(createEmptyProject(), mockAsset('video-1'))
    doc = {
      ...doc,
      materials: [{ id: 'video-1', name: 'v.mp4', kind: 'video', origin: 'upload', addedAt: 1 }],
    }
    const beforeState = {
      ...createInitialState(),
      document: doc,
      ui: { playhead: 4, selectedClipId: doc.tracks[0]!.clips[0]!.id, isPlaying: false },
    }
    const mediaStore: MediaStore = new Map([['video-1', mockAsset('video-1')]])
    const freezeAsset = mockAsset('freeze-1')
    freezeAsset.file = new File([], 'freeze.png', { type: 'image/png' })

    const inserted = insertFreezeFrameAtPlayhead(
      doc,
      4,
      30,
      'freeze-1',
      DEFAULT_FREEZE_FRAME_DURATION,
      'freeze.png',
    )!
    const afterState = {
      ...beforeState,
      document: inserted.document,
      ui: { ...beforeState.ui, selectedClipId: inserted.freezeClipId },
    }
    const afterStore: MediaStore = new Map([
      ...mediaStore,
      ['freeze-1', freezeAsset],
    ])

    let stacks = createHistoryStacks()
    stacks = pushHistory(stacks, snapshotEditor(beforeState, mediaStore))

    const undoResult = undoHistory(stacks, snapshotEditor(afterState, afterStore))
    expect(undoResult.snapshot?.state.document.tracks[0]?.clips).toHaveLength(1)
    expect(undoResult.snapshot?.mediaStore.has('freeze-1')).toBe(false)

    const restored = restoreAssetsFromSnapshot(afterStore, undoResult.snapshot!.mediaStore)
    expect(restored.has('freeze-1')).toBe(false)
    expect(restored.has('video-1')).toBe(true)

    const redoResult = redoHistory(
      undoResult.stacks,
      snapshotEditor(undoResult.snapshot!.state, undoResult.snapshot!.mediaStore),
    )
    expect(redoResult.snapshot?.state.document.tracks[0]?.clips).toHaveLength(3)
    expect(redoResult.snapshot?.mediaStore.has('freeze-1')).toBe(true)
  })
})

describe('saved project material shape', () => {
  it('includes generated freeze-frame asset in document materials', () => {
    let doc = addClipFromSource(createEmptyProject(), mockAsset('video-1'))
    doc = {
      ...doc,
      materials: [{ id: 'video-1', name: 'v.mp4', kind: 'video', origin: 'upload', addedAt: 1 }],
    }
    const result = insertFreezeFrameAtPlayhead(doc, 2, 30, 'freeze-1', 2, 'cap.png')
    const material = result!.document.materials.find((m) => m.id === 'freeze-1')
    expect(material).toMatchObject({
      id: 'freeze-1',
      kind: 'image',
      origin: 'freeze-frame',
      name: 'cap.png',
    })
  })
})
