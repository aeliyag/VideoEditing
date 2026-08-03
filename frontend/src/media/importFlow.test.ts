import { describe, expect, it } from 'vitest'

import { probeMediaFile } from './probe'
import { inferMaterialKind } from './materialHelpers'
import { createInitialState, projectReducer } from '../state/projectReducer'
import type { MediaAsset } from '../types/project'

function fakeVideoAsset(id = 'asset-1'): MediaAsset {
  return {
    id,
    file: new File([''], 'clip.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:test',
    duration: 5,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
  }
}

describe('import flow reducer', () => {
  it('adds material and places video on timeline atomically', () => {
    const asset = fakeVideoAsset()
    let state = createInitialState()

    state = projectReducer(state, {
      type: 'ADD_MATERIAL',
      asset,
      name: 'clip.mp4',
      kind: 'video',
      origin: 'upload',
      addToTimelineAtPlayhead: 0,
    })

    expect(state.document.materials).toHaveLength(1)
    const videoClips = state.document.tracks.find((t) => t.kind === 'video')?.clips ?? []
    expect(videoClips).toHaveLength(1)
    expect(videoClips[0]?.sourceId).toBe(asset.id)
  })

  it('addFirstVideoToTimeline still works for empty timeline', () => {
    const asset = fakeVideoAsset('v2')
    let state = createInitialState()

    state = projectReducer(state, {
      type: 'ADD_MATERIAL',
      asset,
      name: 'clip.mp4',
      kind: 'video',
      origin: 'upload',
      addFirstVideoToTimeline: true,
    })

    const videoClips = state.document.tracks.find((t) => t.kind === 'video')?.clips ?? []
    expect(videoClips).toHaveLength(1)
  })
})

describe('probeMediaFile', () => {
  it.skip('requires browser', () => {})
})

export { inferMaterialKind, probeMediaFile }
