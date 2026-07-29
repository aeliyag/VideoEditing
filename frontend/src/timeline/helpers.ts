import type { ProjectDocument, TimelineClip, Track } from '../types/project'
import { MAIN_AUDIO_TRACK_ID, MAIN_VIDEO_TRACK_ID } from '../types/project'

export function clipDuration(clip: TimelineClip): number {
  return Math.max(0, clip.sourceEnd - clip.sourceStart)
}

export function clipTimelineEnd(clip: TimelineClip): number {
  return clip.timelineStart + clipDuration(clip)
}

export function getVideoTrack(doc: ProjectDocument): Track | undefined {
  return doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID && t.kind === 'video')
}

export function getAudioTrack(doc: ProjectDocument): Track | undefined {
  return doc.tracks.find((t) => t.id === MAIN_AUDIO_TRACK_ID && t.kind === 'audio')
}

function trackMaxEnd(track: Track | undefined): number {
  if (!track || track.clips.length === 0) {
    return 0
  }
  let maxEnd = 0
  for (const clip of track.clips) {
    maxEnd = Math.max(maxEnd, clipTimelineEnd(clip))
  }
  return maxEnd
}

export function totalDuration(doc: ProjectDocument): number {
  return Math.max(trackMaxEnd(getVideoTrack(doc)), trackMaxEnd(getAudioTrack(doc)))
}

export function sortedClips(track: Track): TimelineClip[] {
  return [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
}

export function findClipById(doc: ProjectDocument, clipId: string): TimelineClip | undefined {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) {
      return clip
    }
  }
  return undefined
}

export function isAudioClipId(doc: ProjectDocument, clipId: string): boolean {
  const track = getAudioTrack(doc)
  return Boolean(track?.clips.some((c) => c.id === clipId))
}

/** Pixel rect of source media letterboxed inside a container. */
export function mediaRectInContainer(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight }
  }
  const sourceAspect = sourceWidth / sourceHeight
  const containerAspect = containerWidth / containerHeight
  if (sourceAspect > containerAspect) {
    const width = containerWidth
    const height = containerWidth / sourceAspect
    return { x: 0, y: (containerHeight - height) / 2, width, height }
  }
  const height = containerHeight
  const width = containerHeight * sourceAspect
  return { x: (containerWidth - width) / 2, y: 0, width, height }
}

/** Clip active at timeline time (half-open interval [start, end)). */
export function clipAtTime(
  doc: ProjectDocument,
  timelineTime: number,
): TimelineClip | undefined {
  const track = getVideoTrack(doc)
  if (!track) {
    return undefined
  }
  for (const clip of sortedClips(track)) {
    const start = clip.timelineStart
    const end = clipTimelineEnd(clip)
    if (timelineTime >= start && timelineTime < end) {
      return clip
    }
  }
  if (timelineTime === totalDuration(doc) && track.clips.length > 0) {
    const clips = sortedClips(track)
    return clips[clips.length - 1]
  }
  return undefined
}

/** Clip on the audio track active at timeline time (half-open [start, end)). */
export function audioClipAtTime(
  doc: ProjectDocument,
  timelineTime: number,
): TimelineClip | undefined {
  const track = getAudioTrack(doc)
  if (!track) {
    return undefined
  }
  for (const clip of sortedClips(track)) {
    const start = clip.timelineStart
    const end = clipTimelineEnd(clip)
    if (timelineTime >= start && timelineTime < end) {
      return clip
    }
  }
  return undefined
}

export function timelineToSourceTime(clip: TimelineClip, timelineTime: number): number {
  const offset = timelineTime - clip.timelineStart
  return clip.sourceStart + offset
}

export function snapToFrame(time: number, fps: number): number {
  if (fps <= 0) {
    return time
  }
  const frame = Math.round(time * fps)
  return frame / fps
}

export function clampPlayhead(time: number, doc: ProjectDocument): number {
  const max = totalDuration(doc)
  return Math.max(0, Math.min(time, max))
}
