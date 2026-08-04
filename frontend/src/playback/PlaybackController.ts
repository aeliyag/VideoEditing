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

function audioClipSyncKey(clip: TimelineClip): string {
  return `${clip.id}:${clip.timelineStart}:${clip.sourceStart}:${clip.sourceEnd}`
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
    void this.syncVideoToTimeline(this.timelineTime, true)
    void this.syncAudioToTimeline(this.timelineTime, true)
    this.emit()
  }

  play(): void {
    if (!this.document || totalDuration(this.document) <= 0) {
      return
    }
    if (this.timelineTime >= totalDuration(this.document)) {
      this.timelineTime = 0
      void this.syncVideoToTimeline(this.timelineTime, true)
      void this.syncAudioToTimeline(this.timelineTime, true)
    }
    this.playing = true
    this.lastWallTime = performance.now()
    void this.syncVideoToTimeline(this.timelineTime, true).then(() => {
      if (this.playing) {
        void this.video?.play()
      }
    })
    void this.syncAudioToTimeline(this.timelineTime, true).then(() => {
      if (this.playing) {
        void this.audio?.play()
      }
    })
    this.startLoop()
    this.emit()
  }

  pause(): void {
    this.playing = false
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
          next = Math.max(this.timelineTime, decodedTimelineTime)
        }
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

    if (audio.paused) {
      void audio.play()
    }
  }

  private async syncAudioToTimeline(
    timelineTime: number,
    forceSeek: boolean,
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
      await new Promise<void>((resolve) => {
        const onLoaded = () => {
          audio.removeEventListener('loadedmetadata', onLoaded)
          resolve()
        }
        audio.addEventListener('loadedmetadata', onLoaded)
      })
    }

    const sourceTime = timelineToSourceTime(clip, timelineTime)
    if (forceSeek || clipChanged) {
      audio.currentTime = sourceTime
    } else if (Math.abs(audio.currentTime - sourceTime) > 0.35) {
      // User scrubbed or the timeline jumped — one corrective seek only.
      audio.currentTime = sourceTime
    }

    this.activeAudioSyncKey = syncKey

    if (this.playing && audio.paused) {
      void audio.play()
    }
  }
}

export const playbackController = new PlaybackController()
