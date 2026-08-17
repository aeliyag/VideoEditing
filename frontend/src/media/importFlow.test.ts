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

  it('stores TTS prompt metadata on the material', () => {
    const asset = fakeVideoAsset('tts-1')
    let state = createInitialState()
    state = projectReducer(state, {
      type: 'ADD_TTS_CLIP',
      asset: { ...asset, duration: 3, hasAudio: true, width: 0, height: 0, fps: 0 },
      timelineStart: 0,
      tts: { prompt: 'Hello there', voiceId: 'voice-a', rate: '100%' },
    })
    expect(state.document.materials[0]?.tts).toEqual({
      prompt: 'Hello there',
      voiceId: 'voice-a',
      rate: '100%',
    })
  })

  it('updates saved TTS prompt when replacing the voice', () => {
    const asset = fakeVideoAsset('tts-1')
    let state = createInitialState()
    state = projectReducer(state, {
      type: 'ADD_TTS_CLIP',
      asset: { ...asset, duration: 3, hasAudio: true, width: 0, height: 0, fps: 0 },
      timelineStart: 0,
      tts: { prompt: 'Hello there', voiceId: 'voice-a', rate: '100%' },
    })
    state = projectReducer(state, {
      type: 'REPLACE_TTS_MATERIAL',
      materialId: 'tts-1',
      previousDuration: 3,
      nextDuration: 4,
      tts: { prompt: 'Hello there', voiceId: 'voice-b', rate: '90%' },
    })
    expect(state.document.materials[0]?.tts?.voiceId).toBe('voice-b')
    const audioClip = state.document.tracks.find((t) => t.kind === 'audio')?.clips[0]
    expect(audioClip?.sourceEnd).toBe(4)
  })
})

describe('probeMediaFile', () => {
  it.skip('requires browser', () => {})
})

export { inferMaterialKind, probeMediaFile }
