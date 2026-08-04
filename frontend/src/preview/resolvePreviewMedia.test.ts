import { describe, expect, it } from 'vitest'

import type { MediaAsset, ProjectDocument, TimelineClip } from '../types/project'
import {
  isImagePreviewClip,
  materialForClip,
  resolvePreviewObjectUrl,
  shouldApplyCameraPreview,
} from './resolvePreviewMedia'

const uploadedPngMaterial = {
  id: 'png-1',
  name: 'photo.png',
  kind: 'image' as const,
  origin: 'upload' as const,
  addedAt: 1,
}

const freezeFrameMaterial = {
  id: 'freeze-1',
  name: 'clip_freeze_1000ms.png',
  kind: 'image' as const,
  origin: 'freeze-frame' as const,
  addedAt: 2,
}

function imageAsset(id: string, fileName: string): MediaAsset {
  const file = new File([new Uint8Array([137, 80, 78, 71])], fileName, {
    type: 'image/png',
  })
  return {
    id,
    file,
    objectUrl: `blob:${id}`,
    duration: 5,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: false,
  }
}

function docWithMaterials(
  materials: ProjectDocument['materials'],
  clip: TimelineClip,
): ProjectDocument {
  return {
    id: 'doc',
    tracks: [
      {
        id: 'track-video-main',
        kind: 'video',
        clips: [clip],
      },
    ],
    frameBank: [],
    materials,
  }
}

describe('resolvePreviewMedia', () => {
  it('classifies uploaded PNG and freeze-frame materials identically for preview', () => {
    const uploadedClip: TimelineClip = {
      id: 'clip-uploaded',
      sourceId: 'png-1',
      sourceStart: 0,
      sourceEnd: 5,
      timelineStart: 0,
      effects: [],
    }
    const freezeClip: TimelineClip = {
      id: 'clip-freeze',
      sourceId: 'freeze-1',
      sourceStart: 0,
      sourceEnd: 2,
      timelineStart: 4,
      effects: [],
    }

    const uploadedDoc = docWithMaterials([uploadedPngMaterial], uploadedClip)
    const freezeDoc = docWithMaterials([freezeFrameMaterial], freezeClip)

    const uploadedAsset = imageAsset('png-1', 'photo.png')
    const freezeAsset = imageAsset('freeze-1', 'clip_freeze_1000ms.png')

    expect(isImagePreviewClip(uploadedDoc, uploadedClip, uploadedAsset)).toBe(true)
    expect(isImagePreviewClip(freezeDoc, freezeClip, freezeAsset)).toBe(true)
    expect(materialForClip(freezeDoc, freezeClip)?.origin).toBe('freeze-frame')
    expect(materialForClip(uploadedDoc, uploadedClip)?.origin).toBe('upload')
  })

  it('resolves preview URLs from blob objectUrl for both material types', () => {
    const asset = imageAsset('freeze-1', 'clip_freeze_1000ms.png')
    expect(resolvePreviewObjectUrl(asset)).toBe('blob:freeze-1')
  })

  it('recreates object URLs from File after reload-style URL loss', () => {
    const asset = imageAsset('freeze-1', 'clip_freeze_1000ms.png')
    const reloaded = { ...asset, objectUrl: '' }
    const resolved = resolvePreviewObjectUrl(reloaded)
    expect(resolved.startsWith('blob:')).toBe(true)
  })

  it('skips camera preview for freeze-frame and uploaded image clips', () => {
    const clip: TimelineClip = {
      id: 'clip-freeze',
      sourceId: 'freeze-1',
      sourceStart: 0,
      sourceEnd: 2,
      timelineStart: 0,
      effects: [{ type: 'camera', startFrameId: null, endFrameId: null }],
    }
    const doc = docWithMaterials([freezeFrameMaterial], clip)
    const asset = imageAsset('freeze-1', 'clip_freeze_1000ms.png')
    expect(shouldApplyCameraPreview(doc, clip, asset)).toBe(false)
  })
})

describe('preview mismatch diagnosis', () => {
  it('documents the prior bug: both PNG types share blob storage, not material.url', () => {
    const asset = imageAsset('freeze-1', 'clip_freeze_1000ms.png')
    expect('url' in asset).toBe(false)
    expect(asset.objectUrl.startsWith('blob:')).toBe(true)
    expect(asset.file.type).toBe('image/png')
  })
})
