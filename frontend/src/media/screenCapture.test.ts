import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mixAudioTracks,
  pickRecorderMimeType,
  recordingFileName,
} from './screenCapture'

describe('pickRecorderMimeType', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: vi.fn(() => false),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('prefers vp9 when supported', () => {
    vi.mocked(MediaRecorder.isTypeSupported).mockImplementation(
      (type: string) => type === 'video/webm;codecs=vp9,opus',
    )
    expect(pickRecorderMimeType()).toBe('video/webm;codecs=vp9,opus')
  })

  it('falls back to plain webm', () => {
    vi.mocked(MediaRecorder.isTypeSupported).mockReturnValue(false)
    expect(pickRecorderMimeType()).toBe('video/webm')
  })
})

describe('recordingFileName', () => {
  it('uses akool-recording prefix and webm extension', () => {
    expect(recordingFileName(1234567890)).toBe('akool-recording-1234567890.webm')
  })
})

describe('mixAudioTracks', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'MediaStream',
      vi.fn(function MediaStream(tracks: MediaStreamTrack[] = []) {
        return {
          tracks,
          getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
          getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
        }
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns display stream unchanged when mic is null', async () => {
    const displayStream = {
      getVideoTracks: () => [],
      getAudioTracks: () => [],
    } as unknown as MediaStream
    const result = await mixAudioTracks(displayStream, null)
    expect(result).toBe(displayStream)
  })

  it('mixes display and mic audio via AudioContext', async () => {
    const connect = vi.fn()
    const createMediaStreamSource = vi.fn(() => ({ connect }))
    const mixedTrack = { kind: 'audio' } as MediaStreamTrack
    const createMediaStreamDestination = vi.fn(() => ({
      stream: { getAudioTracks: () => [mixedTrack] },
    }))

    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => ({
        createMediaStreamSource,
        createMediaStreamDestination,
      })),
    )

    const videoTrack = { kind: 'video' } as MediaStreamTrack
    const displayAudioTrack = { kind: 'audio' } as MediaStreamTrack
    const micTrack = { kind: 'audio' } as MediaStreamTrack

    const displayStream = {
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [displayAudioTrack],
    } as unknown as MediaStream

    const micStream = {
      getAudioTracks: () => [micTrack],
    } as unknown as MediaStream

    const result = await mixAudioTracks(displayStream, micStream)

    expect(createMediaStreamSource).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(result.getVideoTracks()).toEqual([videoTrack])
    expect(result.getAudioTracks()).toEqual([mixedTrack])
  })
})
