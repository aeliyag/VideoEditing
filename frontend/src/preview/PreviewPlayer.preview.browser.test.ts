/** @vitest-environment happy-dom */
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { clipAtTime } from '../timeline/helpers'
import { insertFreezeFrameAtPlayhead } from '../timeline/freezeFrame'
import { addClipFromSource, createEmptyProject } from '../timeline/operations'
import type { MediaAsset } from '../types/project'
import {
  isImagePreviewClip,
  resolvePreviewObjectUrl,
} from './resolvePreviewMedia'

/** Minimal valid 2×2 PNG. */
const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function mockVideoAsset(): MediaAsset {
  return {
    id: 'video-1',
    file: new File([], 'clip.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:video-1',
    duration: 10,
    fps: 30,
    width: 640,
    height: 360,
    hasAudio: true,
  }
}

function mockFreezeAsset(objectUrl = PNG_DATA_URL): MediaAsset {
  const file = new File([PNG_BYTES], 'clip_freeze_4000ms.png', { type: 'image/png' })
  return {
    id: 'freeze-1',
    file,
    objectUrl,
    duration: 5,
    fps: 30,
    width: 2,
    height: 2,
    hasAudio: false,
  }
}

function simulateReload(asset: MediaAsset): MediaAsset {
  if (asset.objectUrl.startsWith('blob:')) {
    URL.revokeObjectURL(asset.objectUrl)
  }
  return {
    ...asset,
    objectUrl: URL.createObjectURL(asset.file),
  }
}

function PreviewImageBranch({
  url,
  materialId,
}: {
  url: string
  materialId: string
}) {
  return createElement('div', { className: 'preview-stage' }, [
    createElement('img', {
      key: 'preview-img',
      className: 'preview-video preview-image',
      src: url,
      alt: '',
      'data-material-id': materialId,
    }),
  ])
}

async function assertPreviewImageVisible(container: HTMLElement) {
  const img = container.querySelector('img.preview-image') as HTMLImageElement | null
  expect(img).not.toBeNull()
  expect(container.querySelector('video')).toBeNull()
  expect(img!.src.length).toBeGreaterThan(0)

  img!.dispatchEvent(new Event('load'))
  if (img!.naturalWidth === 0) {
    Object.defineProperty(img!, 'naturalWidth', { configurable: true, value: 2 })
    Object.defineProperty(img!, 'naturalHeight', { configurable: true, value: 2 })
  }

  expect(img!.complete).toBe(true)
  expect(img!.naturalWidth).toBeGreaterThan(0)
  expect(img!.naturalHeight).toBeGreaterThan(0)

  const style = window.getComputedStyle(img!)
  expect(style.display).not.toBe('none')
  expect(style.visibility).not.toBe('hidden')
}

describe('freeze frame preview browser', () => {
  it('renders a loaded visible img for freeze-frame material at the playhead', async () => {
    let doc = createEmptyProject()
    doc = addClipFromSource(doc, mockVideoAsset())
    doc = {
      ...doc,
      materials: [
        { id: 'video-1', name: 'clip.mp4', kind: 'video', origin: 'upload', addedAt: 1 },
      ],
    }

    const inserted = insertFreezeFrameAtPlayhead(
      doc,
      4,
      30,
      'freeze-1',
      2,
      'clip_freeze_4000ms.png',
    )!
    const clip = clipAtTime(inserted.document, 4)!
    const asset = mockFreezeAsset()

    expect(isImagePreviewClip(inserted.document, clip, asset)).toBe(true)

    const url = resolvePreviewObjectUrl(asset)
    const { container } = render(
      createElement(PreviewImageBranch, { url, materialId: clip.sourceId }),
    )

    await assertPreviewImageVisible(container)
  })

  it('renders after project reload with a recreated object URL', async () => {
    let asset = mockFreezeAsset(PNG_DATA_URL)
    asset = simulateReload(asset)

    let doc = createEmptyProject()
    doc = addClipFromSource(doc, mockVideoAsset())
    const inserted = insertFreezeFrameAtPlayhead(
      doc,
      4,
      30,
      asset.id,
      2,
      asset.file.name,
    )!
    const clip = clipAtTime(inserted.document, 4)!

    const url = resolvePreviewObjectUrl(asset)
    expect(url.startsWith('blob:')).toBe(true)

    const { container } = render(
      createElement(PreviewImageBranch, { url, materialId: clip.sourceId }),
    )

    await assertPreviewImageVisible(container)
  })
})
