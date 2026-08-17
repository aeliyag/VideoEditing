/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MediaAsset, ProjectDocument } from '../types/project'
import { MAIN_AUDIO_TRACK_ID, MAIN_VIDEO_TRACK_ID } from '../types/project'
import {
  addAudioClipFromSource,
  addClipFromSource,
  createEmptyProject,
} from '../timeline/operations'
import { PlaybackController } from './PlaybackController'

function mockAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'source-1',
    file: new File([], 'test.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:test',
    duration: 10,
    fps: 30,
    width: 640,
    height: 360,
    hasAudio: true,
    ...overrides,
  }
}

function mockAudioAsset(): MediaAsset {
  return mockAsset({
    id: 'audio-1',
    file: new File([], 'narration.mp3', { type: 'audio/mpeg' }),
    objectUrl: 'blob:audio-1',
    hasAudio: true,
  })
}

function docWithVideoClip(): ProjectDocument {
  return addClipFromSource(createEmptyProject(), mockAsset())
}

function docWithAudioClip(): ProjectDocument {
  return addAudioClipFromSource(createEmptyProject(), mockAudioAsset())
}

/** Media element that defers seeked until the next microtask (simulates async browser seek). */
function createDeferredSeekMedia(
  tagName: 'audio' | 'video',
): HTMLAudioElement | HTMLVideoElement {
  const el = document.createElement(tagName)
  let internalTime = 0
  let paused = true
  let readyState = 2

  Object.defineProperty(el, 'currentTime', {
    get: () => internalTime,
    set: (value: number) => {
      internalTime = value
      queueMicrotask(() => {
        el.dispatchEvent(new Event('seeked'))
      })
    },
    configurable: true,
  })

  Object.defineProperty(el, 'paused', {
    get: () => paused,
    configurable: true,
  })

  Object.defineProperty(el, 'readyState', {
    get: () => readyState,
    configurable: true,
  })

  Object.defineProperty(el, 'duration', {
    get: () => 10,
    configurable: true,
  })

  el.play = vi.fn(async () => {
    paused = false
  })
  el.pause = vi.fn(() => {
    paused = true
  })

  el.addEventListener('loadedmetadata', () => {
    readyState = 2
  })

  // Setting src triggers loadedmetadata on the next tick.
  const srcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'src',
  )
  Object.defineProperty(el, 'src', {
    get: () => srcDescriptor?.get?.call(el) ?? '',
    set: (value: string) => {
      srcDescriptor?.set?.call(el, value)
      queueMicrotask(() => {
        el.dispatchEvent(new Event('loadedmetadata'))
      })
    },
    configurable: true,
  })

  return el as HTMLAudioElement | HTMLVideoElement
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('PlaybackController seek-then-play', () => {
  let controller: PlaybackController
  let rafCallback: FrameRequestCallback | null

  beforeEach(() => {
    controller = new PlaybackController()
    rafCallback = null
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCallback = cb
        return 1
      }),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    controller.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('plays audio from the seek position after scrubbing to timeline start', async () => {
    const doc = docWithAudioClip()
    const asset = mockAudioAsset()
    const mediaStore = new Map([[asset.id, asset]])
    const audio = createDeferredSeekMedia('audio') as HTMLAudioElement

    controller.setProject(doc, mediaStore)
    controller.setAudioElement(audio)

    // Simulate playback to 5s then pause.
    controller.seek(5)
    await flushMicrotasks()
    controller.play()
    await flushMicrotasks()
    controller.pause()

    expect(audio.currentTime).toBe(5)

    // Scrub to start while paused, then play again.
    controller.seek(0)
    await flushMicrotasks()
    controller.play()
    await flushMicrotasks()

    expect(audio.currentTime).toBe(0)
    expect(audio.play).toHaveBeenCalled()
  })

  it('plays video from the seek position after scrubbing to timeline start', async () => {
    const doc = docWithVideoClip()
    const asset = mockAsset()
    const mediaStore = new Map([[asset.id, asset]])
    const video = createDeferredSeekMedia('video') as HTMLVideoElement

    controller.setProject(doc, mediaStore)
    controller.setVideoElement(video)

    controller.seek(5)
    await flushMicrotasks()
    controller.play()
    await flushMicrotasks()
    controller.pause()

    expect(video.currentTime).toBe(5)

    controller.seek(0)
    await flushMicrotasks()
    controller.play()
    await flushMicrotasks()

    expect(video.currentTime).toBe(0)
    expect(video.play).toHaveBeenCalled()
  })

  it('does not resume drifted audio during playback without seeking first', async () => {
    const doc = docWithAudioClip()
    const asset = mockAudioAsset()
    const mediaStore = new Map([[asset.id, asset]])
    const audio = createDeferredSeekMedia('audio') as HTMLAudioElement

    controller.setProject(doc, mediaStore)
    controller.setAudioElement(audio)

    // Start at 5s.
    controller.seek(5)
    await flushMicrotasks()

    // Force stale currentTime (seek not yet applied) and start playback.
    Object.defineProperty(audio, 'currentTime', {
      get: () => 5,
      set: (value: number) => {
        Object.defineProperty(audio, 'currentTime', {
          get: () => value,
          set: (v: number) => {
            Object.defineProperty(audio, 'currentTime', {
              get: () => v,
              configurable: true,
            })
          },
          configurable: true,
        })
        queueMicrotask(() => {
          audio.dispatchEvent(new Event('seeked'))
        })
      },
      configurable: true,
    })

    const playCallsBefore = vi.mocked(audio.play).mock.calls.length
    controller.seek(0)
    // Do not flush — simulate play starting before seeked completes.
    controller.play()

    // Allow sync + seeked to finish.
    await flushMicrotasks()
    await flushMicrotasks()

    expect(audio.currentTime).toBe(0)
    expect(audio.play).toHaveBeenCalled()
    expect(vi.mocked(audio.play).mock.calls.length).toBeGreaterThan(playCallsBefore)
  })

  it('ignores stale sync when a newer seek arrives before play starts', async () => {
    const doc = docWithAudioClip()
    const asset = mockAudioAsset()
    const mediaStore = new Map([[asset.id, asset]])
    const audio = createDeferredSeekMedia('audio') as HTMLAudioElement

    controller.setProject(doc, mediaStore)
    controller.setAudioElement(audio)

    controller.seek(5)
    controller.seek(0)
    await flushMicrotasks()
    controller.play()
    await flushMicrotasks()

    expect(audio.currentTime).toBe(0)
  })

  it('does not yank playhead forward from stale video time after backward seek', async () => {
    const doc = docWithVideoClip()
    const asset = mockAsset()
    const mediaStore = new Map([[asset.id, asset]])
    const video = createDeferredSeekMedia('video') as HTMLVideoElement

    controller.setProject(doc, mediaStore)
    controller.setVideoElement(video)

    controller.seek(5)
    await flushMicrotasks()
    controller.play()
    await flushMicrotasks()

    // Stale decoded time while playhead was moved to 0.
    Object.defineProperty(video, 'currentTime', {
      get: () => 5,
      configurable: true,
    })

    controller.pause()
    controller.seek(0)
    await flushMicrotasks()

    expect(controller.getTimelineTime()).toBe(0)
  })

  it('keeps the playhead on the video clock when decoded time lags wall-clock', async () => {
    const doc = docWithVideoClip()
    const asset = mockAsset()
    const mediaStore = new Map([[asset.id, asset]])
    const video = createDeferredSeekMedia('video') as HTMLVideoElement

    controller.setProject(doc, mediaStore)
    controller.setVideoElement(video)
    controller.seek(0)
    await flushMicrotasks()

    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    controller.play()
    await vi.waitFor(() => {
      expect(rafCallback).not.toBeNull()
    })
    expect(video.paused).toBe(false)

    Object.defineProperty(video, 'currentTime', {
      get: () => 0.08,
      configurable: true,
    })
    nowSpy.mockReturnValue(1_500)
    rafCallback!(1_500)

    expect(controller.getTimelineTime()).toBeCloseTo(0.08, 2)
  })

  it('keeps the playhead on the audio clock when there is no video', async () => {
    const doc = docWithAudioClip()
    const asset = mockAudioAsset()
    const mediaStore = new Map([[asset.id, asset]])
    const audio = createDeferredSeekMedia('audio') as HTMLAudioElement

    controller.setProject(doc, mediaStore)
    controller.setAudioElement(audio)
    controller.seek(0)
    await flushMicrotasks()

    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    controller.play()
    await vi.waitFor(() => {
      expect(rafCallback).not.toBeNull()
    })

    Object.defineProperty(audio, 'currentTime', {
      get: () => 0.12,
      configurable: true,
    })
    nowSpy.mockReturnValue(1_600)
    rafCallback!(1_600)

    expect(controller.getTimelineTime()).toBeCloseTo(0.12, 2)
  })

  it('does not start video until the audio seek has finished', async () => {
    const videoAsset = mockAsset()
    const audioAsset = mockAudioAsset()
    let doc = addClipFromSource(createEmptyProject(), videoAsset)
    doc = addAudioClipFromSource(doc, audioAsset)
    const mediaStore = new Map([
      [videoAsset.id, videoAsset],
      [audioAsset.id, audioAsset],
    ])

    const video = createDeferredSeekMedia('video') as HTMLVideoElement
    const audio = createDeferredSeekMedia('audio') as HTMLAudioElement

    let reportedTime = 0
    let holdSeeked = false
    let pendingSeeked: (() => void) | null = null
    Object.defineProperty(audio, 'currentTime', {
      get: () => reportedTime,
      set: (value: number) => {
        const apply = () => {
          reportedTime = value
          audio.dispatchEvent(new Event('seeked'))
        }
        if (holdSeeked) {
          pendingSeeked = apply
        } else {
          queueMicrotask(apply)
        }
      },
      configurable: true,
    })

    controller.setProject(doc, mediaStore)
    controller.setVideoElement(video)
    controller.setAudioElement(audio)
    await flushMicrotasks()

    holdSeeked = true
    controller.seek(1)
    controller.play()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(video.play).not.toHaveBeenCalled()
    expect(audio.play).not.toHaveBeenCalled()
    expect(rafCallback).toBeNull()

    pendingSeeked?.()
    await vi.waitFor(() => {
      expect(rafCallback).not.toBeNull()
    })

    expect(video.play).toHaveBeenCalled()
    expect(audio.play).toHaveBeenCalled()
  })
})
