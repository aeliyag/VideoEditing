import type { ProjectDocument } from '../types/project'
import type { MediaStore } from '../types/project'
import {
  clipAtTime,
  clipTimelineEnd,
  clampPlayhead,
  timelineToSourceTime,
  totalDuration,
} from '../timeline/helpers'

export type PlaybackListener = (timelineTime: number, isPlaying: boolean) => void

export class PlaybackController {
  private video: HTMLVideoElement | null = null
  private document: ProjectDocument | null = null
  private mediaStore: MediaStore = new Map()
  private timelineTime = 0
  private playing = false
  private rafId: number | null = null
  private lastWallTime = 0
  private activeSourceId: string | null = null
  private activeClipId: string | null = null
  private listeners = new Set<PlaybackListener>()

  setVideoElement(video: HTMLVideoElement | null): void {
    this.video = video
    if (video && this.document) {
      void this.syncVideoToTimeline(this.timelineTime, true)
    }
  }

  setProject(document: ProjectDocument, mediaStore: MediaStore): void {
    this.document = document
    this.mediaStore = mediaStore
    this.timelineTime = clampPlayhead(this.timelineTime, document)
    if (this.video) {
      void this.syncVideoToTimeline(this.timelineTime, true)
    }
    this.emit()
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener)
    listener(this.timelineTime, this.playing)
    return () => this.listeners.delete(listener)
  }

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
    void this.syncVideoToTimeline(this.timelineTime, true)
    this.emit()
  }

  play(): void {
    if (!this.document || totalDuration(this.document) <= 0) {
      return
    }
    if (this.timelineTime >= totalDuration(this.document)) {
      this.timelineTime = 0
      void this.syncVideoToTimeline(this.timelineTime, true)
    }
    this.playing = true
    this.lastWallTime = performance.now()
    void this.syncVideoToTimeline(this.timelineTime, true).then(() => {
      if (this.playing) {
        void this.video?.play()
      }
    })
    this.startLoop()
    this.emit()
  }

  pause(): void {
    this.playing = false
    this.stopLoop()
    this.video?.pause()
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
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.timelineTime, this.playing)
    }
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
      const activeClip = clipAtTime(this.document, this.timelineTime)
      let next = this.timelineTime + delta
      if (activeClip && this.video && !this.video.paused) {
        const decodedTimelineTime =
          activeClip.timelineStart +
          (this.video.currentTime - activeClip.sourceStart)
        if (
          decodedTimelineTime >= activeClip.timelineStart &&
          decodedTimelineTime <= clipTimelineEnd(activeClip) + 0.05
        ) {
          // The decoded media clock is authoritative, so the playhead cannot
          // drift away from the frame currently shown in the preview.
          next = Math.max(this.timelineTime, decodedTimelineTime)
        }
      }
      if (next >= max) {
        next = max
        this.timelineTime = next
        void this.syncVideoToTimeline(next, false)
        this.pause()
        this.emit()
        return
      }
      this.timelineTime = next
      void this.syncVideoToTimeline(next, false)
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

  private async syncVideoToTimeline(
    timelineTime: number,
    forceSeek: boolean,
  ): Promise<void> {
    const video = this.video
    const doc = this.document
    if (!video || !doc) {
      return
    }

    const clip = clipAtTime(doc, timelineTime)
    if (!clip) {
      video.pause()
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
      await new Promise<void>((resolve) => {
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded)
          resolve()
        }
        video.addEventListener('loadedmetadata', onLoaded)
      })
    }

    const sourceTime = timelineToSourceTime(clip, timelineTime)
    if (forceSeek || clipChanged || Math.abs(video.currentTime - sourceTime) > 0.2) {
      video.currentTime = sourceTime
    }
    if (this.playing && video.paused) {
      void video.play()
    }
  }
}

export const playbackController = new PlaybackController()
