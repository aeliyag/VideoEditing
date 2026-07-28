import type { ProjectDocument, TimelineClip, Track } from '../types/project'
import { MAIN_VIDEO_TRACK_ID } from '../types/project'

export function clipDuration(clip: TimelineClip): number {
  return Math.max(0, clip.sourceEnd - clip.sourceStart)
}

export function clipTimelineEnd(clip: TimelineClip): number {
  return clip.timelineStart + clipDuration(clip)
}

export function getVideoTrack(doc: ProjectDocument): Track | undefined {
  return doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID && t.kind === 'video')
}

export function sortedClips(track: Track): TimelineClip[] {
  return [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)
}

export function totalDuration(doc: ProjectDocument): number {
  const track = getVideoTrack(doc)
  if (!track || track.clips.length === 0) {
    return 0
  }
  let maxEnd = 0
  for (const clip of track.clips) {
    maxEnd = Math.max(maxEnd, clipTimelineEnd(clip))
  }
  return maxEnd
}

export function findClipById(doc: ProjectDocument, clipId: string): TimelineClip | undefined {
  const track = getVideoTrack(doc)
  return track?.clips.find((c) => c.id === clipId)
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
