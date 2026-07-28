import { describe, expect, it } from 'vitest'

import {
  assignClipCameraStart,
  applyBankFrameToClipStart,
  saveClipCamera,
} from './frameBankOps'
import { getCameraEffect } from './frames'
import { addClipFromSource, createEmptyProject } from '../timeline/operations'
import type { MediaAsset } from '../types/project'
import { isCameraEffect } from '../types/project'
import { MAIN_VIDEO_TRACK_ID } from '../types/project'

function mockAsset(): MediaAsset {
  return {
    id: 'source-1',
    file: new File([], 'test.mp4'),
    objectUrl: 'blob:test',
    duration: 10,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
  }
}

describe('frame bank ops', () => {
  it('creates bank entry and assigns clip start', () => {
    let doc = addClipFromSource(createEmptyProject(), mockAsset())
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0].id
    doc = assignClipCameraStart(doc, clipId, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 })
    expect(doc.frameBank).toHaveLength(1)
    const clip = doc.tracks[0].clips[0]
    const camera = clip.effects.find(isCameraEffect)
    expect(camera?.startFrameId).toBe(doc.frameBank[0].id)
  })

  it('applies bank frame to another clip start', () => {
    let doc = addClipFromSource(createEmptyProject(), mockAsset())
    const clipA = doc.tracks[0].clips[0].id
    doc = assignClipCameraStart(doc, clipA, { x: 0.2, y: 0, width: 0.4, height: 0.4 })
    const frameId = doc.frameBank[0].id
    doc = addClipFromSource(doc, mockAsset(), 10)
    const clipB = doc.tracks[0].clips.find((c) => c.id !== clipA)!.id
    doc = applyBankFrameToClipStart(doc, clipB, frameId)
    const camera = doc.tracks[0].clips.find((c) => c.id === clipB)!.effects.find(isCameraEffect)
    expect(camera?.startFrameId).toBe(frameId)
  })

  it('saves named start and end frames onto a clip', () => {
    let doc = addClipFromSource(createEmptyProject(), mockAsset())
    const clipId = doc.tracks[0].clips[0].id
    doc = saveClipCamera(
      doc,
      clipId,
      { rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, name: 'Wide' },
      { rect: { x: 0.3, y: 0.3, width: 0.25, height: 0.25 }, name: 'Closeup' },
    )
    expect(doc.frameBank.map((f) => f.name)).toEqual(['Wide', 'Closeup'])
    const camera = getCameraEffect(doc.tracks[0].clips[0])
    expect(camera?.startFrameId).toBe(doc.frameBank[0].id)
    expect(camera?.endFrameId).toBe(doc.frameBank[1].id)
    expect(doc.frameBank[0].rect.width).toBeCloseTo(0.4, 2)
  })
})
