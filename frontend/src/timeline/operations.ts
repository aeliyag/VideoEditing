import { v4 as uuidv4 } from 'uuid'

import type { MediaAsset, ProjectDocument, TimelineClip } from '../types/project'
import { MAIN_VIDEO_TRACK_ID } from '../types/project'
import {
  clipDuration,
  clipTimelineEnd,
  getVideoTrack,
  sortedClips,
  snapToFrame,
} from './helpers'

export function createEmptyProject(): ProjectDocument {
  return {
    id: uuidv4(),
    tracks: [
      {
        id: MAIN_VIDEO_TRACK_ID,
        kind: 'video',
        clips: [],
      },
    ],
    frameBank: [],
  }
}

export function addClipFromSource(
  doc: ProjectDocument,
  asset: MediaAsset,
  timelineStart = 0,
): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }

  const clip: TimelineClip = {
    id: uuidv4(),
    sourceId: asset.id,
    sourceStart: 0,
    sourceEnd: asset.duration,
    timelineStart,
    effects: [],
  }

  return updateVideoTrack(doc, [...track.clips, clip])
}

function updateVideoTrack(doc: ProjectDocument, clips: TimelineClip[]): ProjectDocument {
  return {
    ...doc,
    tracks: doc.tracks.map((t) =>
      t.id === MAIN_VIDEO_TRACK_ID ? { ...t, clips } : t,
    ),
  }
}

function minClipDuration(fps: number): number {
  return fps > 0 ? 1 / fps : 1 / 30
}

export function splitAtPlayhead(
  doc: ProjectDocument,
  playhead: number,
  fps: number,
): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }

  const epsilon = minClipDuration(fps) / 2
  const clip = sortedClips(track).find((c) => {
    const start = c.timelineStart
    const end = clipTimelineEnd(c)
    return playhead > start + epsilon && playhead < end - epsilon
  })

  if (!clip) {
    return doc
  }

  const splitSourceTime = snapToFrame(
    clip.sourceStart + (playhead - clip.timelineStart),
    fps,
  )
  const left: TimelineClip = {
    ...clip,
    id: uuidv4(),
    sourceEnd: splitSourceTime,
  }
  const right: TimelineClip = {
    ...clip,
    id: uuidv4(),
    sourceStart: splitSourceTime,
    timelineStart: playhead,
  }

  const nextClips = track.clips
    .filter((c) => c.id !== clip.id)
    .concat([left, right])

  return updateVideoTrack(doc, repackClips(nextClips))
}

export type TrimSide = 'start' | 'end'

export function trimClip(
  doc: ProjectDocument,
  clipId: string,
  side: TrimSide,
  edgeTimelineTime: number,
  mediaDuration: number,
  fps: number,
): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }

  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) {
    return doc
  }

  const minDur = minClipDuration(fps)

  if (side === 'start') {
    const maxStart = clipTimelineEnd(clip) - minDur
    const newTimelineStart = Math.max(
      clip.timelineStart,
      Math.min(edgeTimelineTime, maxStart),
    )
    const delta = newTimelineStart - clip.timelineStart
    if (delta <= 0) {
      return doc
    }

    const newSourceStart = snapToFrame(
      Math.min(clip.sourceStart + delta, clip.sourceEnd - minDur),
      fps,
    )
    const actualDelta = newSourceStart - clip.sourceStart
    if (actualDelta <= 0) {
      return doc
    }

    const trimmed: TimelineClip = {
      ...clip,
      timelineStart: clip.timelineStart + actualDelta,
      sourceStart: Math.min(newSourceStart, mediaDuration),
    }

    return updateVideoTrack(
      doc,
      track.clips.map((c) => (c.id === clipId ? trimmed : c)),
    )
  }

  const newEnd = Math.max(
    clip.timelineStart + minDur,
    Math.min(edgeTimelineTime, clipTimelineEnd(clip)),
  )
  const newDuration = newEnd - clip.timelineStart
  const oldDuration = clipDuration(clip)
  const delta = oldDuration - newDuration
  if (delta <= 0) {
    return doc
  }

  const newSourceEnd = snapToFrame(clip.sourceStart + newDuration, fps)
  if (newSourceEnd <= clip.sourceStart + minDur) {
    return doc
  }

  const trimmed: TimelineClip = {
    ...clip,
    sourceEnd: Math.min(newSourceEnd, mediaDuration),
  }

  const trimmedDuration = clipDuration(trimmed)
  const rippleBy = oldDuration - trimmedDuration
  if (rippleBy <= 0) {
    return updateVideoTrack(
      doc,
      track.clips.map((c) => (c.id === clipId ? trimmed : c)),
    )
  }

  const nextClips = track.clips.map((c) => {
    if (c.id === clipId) {
      return trimmed
    }
    if (c.timelineStart > clip.timelineStart) {
      return { ...c, timelineStart: c.timelineStart - rippleBy }
    }
    return c
  })

  return updateVideoTrack(doc, nextClips)
}

export function deleteClip(doc: ProjectDocument, clipId: string): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }

  const nextClips = track.clips.filter((c) => c.id !== clipId)
  return updateVideoTrack(doc, repackClips(nextClips))
}

/** Drag reorder: set provisional start, sort by clip midpoint, then repack. */
export function reorderClipByDrag(
  doc: ProjectDocument,
  clipId: string,
  provisionalTimelineStart: number,
): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) {
    return doc
  }
  const sorted = [...track.clips].sort((a, b) => {
    const startA = a.id === clipId ? provisionalTimelineStart : a.timelineStart
    const startB = b.id === clipId ? provisionalTimelineStart : b.timelineStart
    const midA = startA + clipDuration(a) / 2
    const midB = startB + clipDuration(b) / 2
    return midA - midB
  })
  return updateVideoTrack(doc, packClipsInOrder(sorted))
}

export function repackVideoTrack(doc: ProjectDocument): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }
  return updateVideoTrack(doc, repackClips(track.clips))
}

function repackClips(clips: TimelineClip[]): TimelineClip[] {
  const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
  return packClipsInOrder(sorted)
}

function packClipsInOrder(clips: TimelineClip[]): TimelineClip[] {
  let cursor = 0
  return clips.map((clip) => {
    const packed = { ...clip, timelineStart: cursor }
    cursor += clipDuration(clip)
    return packed
  })
}
