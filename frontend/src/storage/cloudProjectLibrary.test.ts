import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEmptyProject, addClipFromSource } from '../timeline/operations'
import type { MediaAsset, ProjectDocument } from '../types/project'
import { isElementEffect, MAIN_VIDEO_TRACK_ID } from '../types/project'

const upsertProject = vi.fn()
const upsertMedia = vi.fn()
const uploadStorage = vi.fn()
const selectExistingMedia = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'projects') {
        return {
          upsert: upsertProject,
          select: vi.fn(),
          delete: vi.fn(),
          eq: vi.fn(),
        }
      }
      if (table === 'project_media') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => selectExistingMedia(),
            }),
          }),
          upsert: upsertMedia,
          delete: vi.fn(),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
    storage: {
      from: () => ({
        upload: uploadStorage,
        remove: vi.fn(),
        download: vi.fn(),
      }),
    },
  },
}))

import { saveProjectVersion } from './cloudProjectLibrary'

function mockAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: overrides.id ?? 'source-1',
    file: overrides.file ?? new File(['video-bytes'], 'clip.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:test',
    duration: 10,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
    ...overrides,
  }
}

function docWithTextElement(): ProjectDocument {
  let doc = createEmptyProject()
  doc = addClipFromSource(doc, mockAsset(), 0)
  const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
  track.clips[0] = {
    ...track.clips[0]!,
    effects: [
      {
        type: 'element',
        id: 'el-text-1',
        kind: 'text',
        rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.2 },
        z: 0,
        startOffset: 0,
        endOffset: 5,
        opacity: 1,
        text: 'Overlay label',
        fontScale: 0.05,
        fontFamily: 'sans-serif',
        fontWeight: 600,
        color: '#ffffff',
        align: 'center',
        backgroundColor: null,
      },
    ],
  }
  return doc
}

describe('saveProjectVersion elements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertProject.mockResolvedValue({ error: null })
    upsertMedia.mockResolvedValue({ error: null })
    uploadStorage.mockResolvedValue({ error: null })
    selectExistingMedia.mockResolvedValue({ data: [], error: null })
  })

  it('persists element effects in the project document before uploading media', async () => {
    const document = docWithTextElement()
    const asset = mockAsset()
    const mediaStore = new Map([[asset.id, asset]])

    await saveProjectVersion('user-1', {
      id: 'project-1',
      name: 'With elements',
      document,
      mediaStore,
      playhead: 1.5,
      selectedClipId: document.tracks[0]!.clips[0]!.id,
    })

    expect(upsertProject).toHaveBeenCalledBefore(uploadStorage)
    const projectPayload = upsertProject.mock.calls[0]![0]
    const savedClip = projectPayload.document.tracks
      .find((t: { id: string }) => t.id === MAIN_VIDEO_TRACK_ID)!
      .clips[0]
    const element = savedClip.effects.find(isElementEffect)
    expect(element?.kind === 'text' && element.text).toBe('Overlay label')
  })

  it('skips storage upload for media ids already stored on the project', async () => {
    const document = docWithTextElement()
    const asset = mockAsset()
    const mediaStore = new Map([[asset.id, asset]])
    selectExistingMedia.mockResolvedValue({
      data: [{ id: asset.id, storage_path: 'user-1/project-1/source-1.mp4' }],
      error: null,
    })

    await saveProjectVersion('user-1', {
      id: 'project-1',
      name: 'Re-save',
      document,
      mediaStore,
      playhead: 0,
      selectedClipId: null,
    })

    expect(uploadStorage).not.toHaveBeenCalled()
    expect(upsertMedia).toHaveBeenCalled()
  })

  it('re-uploads media when forceUploadMediaIds includes an existing id', async () => {
    const document = docWithTextElement()
    const asset = mockAsset()
    const mediaStore = new Map([[asset.id, asset]])
    selectExistingMedia.mockResolvedValue({
      data: [{ id: asset.id, storage_path: 'user-1/project-1/source-1.mp4' }],
      error: null,
    })

    await saveProjectVersion('user-1', {
      id: 'project-1',
      name: 'Re-save',
      document,
      mediaStore,
      playhead: 0,
      selectedClipId: null,
      forceUploadMediaIds: new Set([asset.id]),
    })

    expect(uploadStorage).toHaveBeenCalledTimes(1)
  })

  it('surfaces project upsert errors', async () => {
    upsertProject.mockResolvedValue({ error: { message: 'RLS denied' } })
    const document = docWithTextElement()

    await expect(
      saveProjectVersion('user-1', {
        name: 'Fail',
        document,
        mediaStore: new Map(),
        playhead: 0,
        selectedClipId: null,
      }),
    ).rejects.toThrow('RLS denied')
  })
})
