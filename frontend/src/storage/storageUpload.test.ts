import { beforeEach, describe, expect, it, vi } from 'vitest'

const upload = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload,
      }),
    },
  },
}))

import { uploadProjectMedia } from './storageUpload'

function mockImageEncoding() {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({
      width: 1,
      height: 1,
      close: vi.fn(),
    })),
  )
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: vi.fn(),
      }),
      toBlob: (callback: (blob: Blob | null) => void) => {
        callback(new Blob(['jpeg'], { type: 'image/jpeg' }))
      },
    }),
  })
}

describe('uploadProjectMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('uploads png with native content type and path', async () => {
    upload.mockResolvedValueOnce({ error: null })
    const file = new File(['png'], 'frame.png', { type: 'image/png' })

    const result = await uploadProjectMedia('user/project/frame.png', file)

    expect(result.storagePath).toBe('user/project/frame.png')
    expect(upload).toHaveBeenCalledWith('user/project/frame.png', file, {
      upsert: true,
      contentType: 'image/png',
    })
  })

  it('retries with a matching storage extension when png is rejected', async () => {
    mockImageEncoding()
    upload
      .mockResolvedValueOnce({
        error: { message: 'mime type image/png is not supported' },
      })
      .mockResolvedValueOnce({ error: null })

    const file = new File(['png'], 'frame.png', { type: 'image/png' })
    const result = await uploadProjectMedia('user/project/frame.png', file)

    expect(result.storagePath).toBe('user/project/frame.jpg')
    expect(upload.mock.calls[1]?.[0]).toBe('user/project/frame.jpg')
    expect(upload.mock.calls[1]?.[2]).toEqual({
      upsert: true,
      contentType: 'image/jpeg',
    })
  })

  it('uses video/mp4 path fallback for images', async () => {
    mockImageEncoding()
    upload
      .mockResolvedValueOnce({
        error: { message: 'mime type image/png is not supported' },
      })
      .mockResolvedValueOnce({
        error: { message: 'mime type image/jpeg is not supported' },
      })
      .mockResolvedValueOnce({ error: null })

    const file = new File(['png'], 'frame.png', { type: 'image/png' })
    const result = await uploadProjectMedia('user/project/frame.png', file)

    expect(result.storagePath).toBe('user/project/frame.mp4')
    expect(upload.mock.calls[2]?.[0]).toBe('user/project/frame.mp4')
  })
})
