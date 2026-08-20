import type { ProjectDocument } from '../types/project'
import type { MediaStore } from '../types/project'
import type { TimelineClip } from '../types/project'
import { isImageAsset } from '../export/buildExportGraph'
import {
  audioClipAtTime,
  clipAtTime,
  clipTimelineEnd,
  clampPlayhead,
  timelineToSourceTime,
  totalDuration,
} from '../timeline/helpers'

export type PlaybackListener = (timelineTime: number, isPlaying: boolean) => void

const MEDIA_SEEK_TIMEOUT_MS = 2000
const AUDIO_DRIFT_THRESHOLD = 0.35
const VIDEO_DRIFT_THRESHOLD = 0.2
/** Ignore decoded media time if it disagrees with wall-clock by more than this (stale after seek). */
const MEDIA_CLOCK_STALE_THRESHOLD = 1

function audioClipSyncKey(clip: TimelineClip): string {
  return `${clip.id}:${clip.timelineStart}:${clip.sourceStart}:${clip.sourceEnd}`
}

function waitForMediaEvent(
  media: HTMLMediaElement,
  eventName: 'seeked' | 'loadedmetadata',
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup()
      resolve()
    }, timeoutMs)

    const onEvent = () => {
      cleanup()
      resolve()
    }

    const cleanup = () => {
      window.clearTimeout(timer)
      media.removeEventListener(eventName, onEvent)
    }

    media.addEventListener(eventName, onEvent, { once: true })
  })
}

async function seekMediaToTime(
  media: HTMLMediaElement,
  sourceTime: number,
): Promise<void> {
  const duration = Number.isFinite(media.duration) ? media.duration : undefined
  const clamped =
    duration != null && duration > 0
      ? Math.max(0, Math.min(sourceTime, Math.max(0, duration - 1e-4)))
      : Math.max(0, sourceTime)

  if (Math.abs(media.currentTime - clamped) < 1e-4 && media.readyState >= 2) {
    return
  }

  const seekPromise = waitForMediaEvent(media, 'seeked', MEDIA_SEEK_TIMEOUT_MS)
  media.currentTime = clamped
  await seekPromise
}

export class PlaybackController {
  private video: HTMLVideoElement | null = null
  private audio: HTMLAudioElement | null = null
  private document: ProjectDocument | null = null
  private mediaStore: MediaStore = new Map()
  private timelineTime = 0
  private playing = false
  private rafId: number | null = null
  private lastWallTime = 0
  private activeSourceId: string | null = null
  private activeClipId: string | null = null
  private activeAudioSourceId: string | null = null
  private activeAudioSyncKey: string | null = null
  private syncGeneration = 0

  setVideoElement(video: HTMLVideoElement | null): void {
    this.video = video
    if (video && this.document) {
      void this.syncVideoToTimeline(this.timelineTime, true)
    }
  }

  setAudioElement(audio: HTMLAudioElement | null): void {
    this.audio = audio
    if (audio && this.document) {
      void this.syncAudioToTimeline(this.timelineTime, true)
    }
  }

  setProject(document: ProjectDocument, mediaStore: MediaStore): void {
    this.document = document
    this.mediaStore = mediaStore
    this.timelineTime = clampPlayhead(this.timelineTime, document)
    this.activeAudioSyncKey = null
    if (this.video) {
      void this.syncVideoToTimeline(this.timelineTime, true)
    }
    if (this.audio) {
      void this.syncAudioToTimeline(this.timelineTime, true)
    }
    this.emit()
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener)
    listener(this.timelineTime, this.playing)
    return () => this.listeners.delete(listener)
  }

  private listeners = new Set<PlaybackListener>()

  getTimelineTime(): number {
    return this.timelineTime
  }

  getIsPlaying(): boolean {
    return this.playing
  }

  seek(timelineTime: number): void {
    if (!this.document) {
      return
    }
    this.timelineTime = clampPlayhead(timelineTime, this.document)
    this.syncGeneration++
    const generation = this.syncGeneration
    void this.syncVideoToTimeline(this.timelineTime, true, generation)
    void this.syncAudioToTimeline(this.timelineTime, true, generation)
    this.emit()
  }

  play(): void {
    if (!this.document || totalDuration(this.document) <= 0) {
      return
    }
    this.playing = true
    this.syncGeneration++
    const generation = this.syncGeneration
    void this.startPlaybackAfterSync(generation)
    this.emit()
  }

  pause(): void {
    this.playing = false
    this.syncGeneration++
    this.stopLoop()
    this.video?.pause()
    this.audio?.pause()
    this.emit()
  }

  togglePlay(): void {
    if (this.playing) {
      this.pause()
    } else {
      this.play()
    }
  }

  destroy(): void {
    this.pause()
    this.listeners.clear()
    this.video = null
    this.audio = null
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.timelineTime, this.playing)
    }
  }

  private async startPlaybackAfterSync(generation: number): Promise<void> {
    const doc = this.document
    if (!doc || !this.playing || generation !== this.syncGeneration) {
      return
    }

    if (this.timelineTime >= totalDuration(doc)) {
      this.timelineTime = 0
    }

    await Promise.all([
      this.syncVideoToTimeline(this.timelineTime, true, generation),
      this.syncAudioToTimeline(this.timelineTime, true, generation),
    ])

    if (!this.playing || generation !== this.syncGeneration) {
      return
    }

    // Start A/V together only after both seeks finish, so the playhead does not
    // run on wall-clock while one element is already decoding.
    await this.playReadyMedia()

    if (!this.playing || generation !== this.syncGeneration) {
      return
    }

    this.lastWallTime = performance.now()
    this.startLoop()
  }

  private async playReadyMedia(): Promise<void> {
    const tasks: Promise<unknown>[] = []
    if (this.video && this.video.paused && this.activeSourceId) {
      tasks.push(this.video.play().catch(() => undefined))
    }
    if (this.audio && this.audio.paused && this.activeAudioSourceId) {
      tasks.push(this.audio.play().catch(() => undefined))
    }
    if (tasks.length > 0) {
      await Promise.all(tasks)
    }
  }

  /** Timeline time implied by the playing media clock, or null if it should not drive the playhead. */
  private readMediaTimelineTime(): number | null {
    const doc = this.document
    if (!doc) {
      return null
    }

    const videoClip = clipAtTime(doc, this.timelineTime)
    if (
      videoClip &&
      this.video &&
      !this.video.paused &&
      this.activeClipId === videoClip.id &&
      !this.isImageClip(videoClip)
    ) {
      const decoded =
        videoClip.timelineStart + (this.video.currentTime - videoClip.sourceStart)
      const end = clipTimelineEnd(videoClip)
      if (decoded >= videoClip.timelineStart - 0.05 && decoded <= end + 0.08) {
        return decoded
      }
    }

    const audioClip = audioClipAtTime(doc, this.timelineTime)
    if (
      audioClip &&
      this.audio &&
      !this.audio.paused &&
      this.activeAudioSyncKey === audioClipSyncKey(audioClip)
    ) {
      const decoded =
        audioClip.timelineStart + (this.audio.currentTime - audioClip.sourceStart)
      const end = clipTimelineEnd(audioClip)
      if (decoded >= audioClip.timelineStart - 0.05 && decoded <= end + 0.08) {
        return decoded
      }
    }

    return null
  }

  private startLoop(): void {
    if (this.rafId !== null) {
      return
    }
    const tick = (now: number) => {
      if (!this.playing || !this.document) {
        this.rafId = null
        return
      }
      const delta = (now - this.lastWallTime) / 1000
      this.lastWallTime = now
      const max = totalDuration(this.document)
      const prevTime = this.timelineTime
      const wallNext = prevTime + delta
      const mediaNext = this.readMediaTimelineTime()
      let next = wallNext
      if (
        mediaNext != null &&
        Math.abs(mediaNext - wallNext) <= MEDIA_CLOCK_STALE_THRESHOLD &&
        (mediaNext >= wallNext - 0.001 || mediaNext > prevTime + 0.001)
      ) {
        next = mediaNext
      }
      if (next >= max) {
        next = max
        this.timelineTime = next
        void this.syncVideoToTimeline(next, false)
        void this.syncAudioDuringPlayback(next)
        this.pause()
        this.emit()
        return
      }
      this.timelineTime = next
      void this.syncVideoToTimeline(next, false)
      void this.syncAudioDuringPlayback(next)
      this.emit()
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private isImageClip(clip: TimelineClip): boolean {
    const material = this.document?.materials?.find((m) => m.id === clip.sourceId)
    if (material?.kind === 'image') {
      return true
    }
    if (material?.kind === 'video' || material?.kind === 'audio') {
      return false
    }
    const asset = this.mediaStore.get(clip.sourceId)
    if (!asset) {
      return false
    }
    return isImageAsset(asset.file, asset)
  }

  private clearVideoElement(): void {
    const video = this.video
    if (!video) {
      return
    }
    video.pause()
    if (this.activeSourceId !== null) {
      video.removeAttribute('src')
      video.load()
      this.activeSourceId = null
    }
  }

  private async syncVideoToTimeline(
    timelineTime: number,
    forceSeek: boolean,
    generation?: number,
  ): Promise<void> {
    const video = this.video
    const doc = this.document
    if (!video || !doc) {
      return
    }

    const clip = clipAtTime(doc, timelineTime)
    if (!clip) {
      this.clearVideoElement()
      this.activeClipId = null
      return
    }

    if (this.isImageClip(clip)) {
      this.clearVideoElement()
      this.activeClipId = clip.id
      return
    }

    const asset = this.mediaStore.get(clip.sourceId)
    if (!asset) {
      return
    }

    const clipChanged = this.activeClipId !== clip.id
    this.activeClipId = clip.id

    if (this.activeSourceId !== clip.sourceId) {
      this.activeSourceId = clip.sourceId
      video.src = asset.objectUrl
      if (video.readyState < 1) {
        await waitForMediaEvent(video, 'loadedmetadata', MEDIA_SEEK_TIMEOUT_MS)
      }
      if (generation !== undefined && generation !== this.syncGeneration) {
        return
      }
    }

    const sourceTime = timelineToSourceTime(clip, timelineTime)
    const needsSeek =
      forceSeek ||
      clipChanged ||
      Math.abs(video.currentTime - sourceTime) > VIDEO_DRIFT_THRESHOLD

    if (needsSeek) {
      if (forceSeek) {
        await seekMediaToTime(video, sourceTime)
      } else {
        video.currentTime = sourceTime
      }
      if (generation !== undefined && generation !== this.syncGeneration) {
        return
      }
    }

    if (this.playing && this.rafId !== null && video.paused) {
      void video.play()
    }
  }

  /** Lightweight path while playing — avoid seeking HTMLAudio every frame. */
  private syncAudioDuringPlayback(timelineTime: number): void {
    const audio = this.audio
    const doc = this.document
    if (!audio || !doc || !this.playing) {
      return
    }

    const clip = audioClipAtTime(doc, timelineTime)
    if (!clip) {
      if (this.activeAudioSyncKey !== null) {
        audio.pause()
        this.activeAudioSyncKey = null
        this.activeAudioSourceId = null
      }
      return
    }

    const syncKey = audioClipSyncKey(clip)
    if (syncKey !== this.activeAudioSyncKey) {
      void this.syncAudioToTimeline(timelineTime, true)
      return
    }

    const clipEnd = clipTimelineEnd(clip)
    if (timelineTime >= clipEnd - 0.03 || audio.currentTime >= clip.sourceEnd - 0.03) {
      audio.pause()
      return
    }

    const sourceTime = timelineToSourceTime(clip, timelineTime)
    if (Math.abs(audio.currentTime - sourceTime) > AUDIO_DRIFT_THRESHOLD) {
      void this.syncAudioToTimeline(timelineTime, true)
      return
    }

    if (audio.paused) {
      void audio.play()
    }
  }

  private async syncAudioToTimeline(
    timelineTime: number,
    forceSeek: boolean,
    generation?: number,
  ): Promise<void> {
    const audio = this.audio
    const doc = this.document
    if (!audio || !doc) {
      return
    }

    const clip = audioClipAtTime(doc, timelineTime)
    if (!clip) {
      audio.pause()
      this.activeAudioSyncKey = null
      this.activeAudioSourceId = null
      return
    }

    const asset = this.mediaStore.get(clip.sourceId)
    if (!asset) {
      return
    }

    const syncKey = audioClipSyncKey(clip)
    const clipChanged = this.activeAudioSyncKey !== syncKey

    if (this.activeAudioSourceId !== clip.sourceId) {
      this.activeAudioSourceId = clip.sourceId
      audio.src = asset.objectUrl
      if (audio.readyState < 1) {
        await waitForMediaEvent(audio, 'loadedmetadata', MEDIA_SEEK_TIMEOUT_MS)
      }
      if (generation !== undefined && generation !== this.syncGeneration) {
        return
      }
    }

    const sourceTime = timelineToSourceTime(clip, timelineTime)
    const needsSeek =
      forceSeek ||
      clipChanged ||
      Math.abs(audio.currentTime - sourceTime) > AUDIO_DRIFT_THRESHOLD

    if (needsSeek) {
      if (forceSeek) {
        await seekMediaToTime(audio, sourceTime)
      } else {
        audio.currentTime = sourceTime
      }
      if (generation !== undefined && generation !== this.syncGeneration) {
        return
      }
    }

    this.activeAudioSyncKey = syncKey

    if (this.playing && this.rafId !== null && audio.paused) {
      void audio.play()
    }
  }
}

export const playbackController = new PlaybackController()
