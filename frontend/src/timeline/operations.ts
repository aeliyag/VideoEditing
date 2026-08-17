import { v4 as uuidv4 } from 'uuid'

import type { MediaAsset, ProjectDocument, TimelineClip } from '../types/project'
import { MAIN_AUDIO_TRACK_ID, MAIN_VIDEO_TRACK_ID } from '../types/project'
import {
  clipDuration,
  clipTimelineEnd,
  getAudioTrack,
  getVideoTrack,
  isAudioClipId,
  minClipDuration,
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
      {
        id: MAIN_AUDIO_TRACK_ID,
        kind: 'audio',
        clips: [],
      },
    ],
    frameBank: [],
    materials: [],
  }
}

/** Ensures audio track and materials array exist when opening older saved projects. */
export function ensureProjectTracks(doc: ProjectDocument): ProjectDocument {
  const materials = doc.materials ?? []
  const hasAudio = doc.tracks.some(
    (t) => t.id === MAIN_AUDIO_TRACK_ID && t.kind === 'audio',
  )
  if (hasAudio) {
    return materials === doc.materials ? doc : { ...doc, materials }
  }
  return {
    ...doc,
    materials,
    tracks: [
      ...doc.tracks,
      {
        id: MAIN_AUDIO_TRACK_ID,
        kind: 'audio',
        clips: [],
      },
    ],
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

export function addVideoClipFromMaterial(
  doc: ProjectDocument,
  asset: MediaAsset,
  timelineStart: number,
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
    timelineStart: Math.max(0, timelineStart),
    effects: [],
  }

  return updateVideoTrack(doc, [...track.clips, clip])
}

export function addAudioClipFromSource(
  doc: ProjectDocument,
  asset: MediaAsset,
  timelineStart = 0,
): ProjectDocument {
  const track = getAudioTrack(doc)
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

  return updateAudioTrack(doc, [...track.clips, clip])
}

export function detachAudioFromClip(
  doc: ProjectDocument,
  clipId: string,
): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip || clip.muteVideoAudio) {
    return doc
  }

  const audioClip: TimelineClip = {
    id: uuidv4(),
    sourceId: clip.sourceId,
    sourceStart: clip.sourceStart,
    sourceEnd: clip.sourceEnd,
    timelineStart: clip.timelineStart,
    effects: [],
  }

  const audioTrack = getAudioTrack(doc)
  const nextAudioClips = audioTrack ? [...audioTrack.clips, audioClip] : [audioClip]
  const withAudio = updateAudioTrack(doc, nextAudioClips)
  return updateVideoTrack(
    withAudio,
    track.clips.map((c) => (c.id === clipId ? { ...c, muteVideoAudio: true } : c)),
  )
}

function updateAudioTrack(doc: ProjectDocument, clips: TimelineClip[]): ProjectDocument {
  return {
    ...doc,
    tracks: doc.tracks.map((t) =>
      t.id === MAIN_AUDIO_TRACK_ID ? { ...t, clips } : t,
    ),
  }
}

function updateVideoTrack(doc: ProjectDocument, clips: TimelineClip[]): ProjectDocument {
  return {
    ...doc,
    tracks: doc.tracks.map((t) =>
      t.id === MAIN_VIDEO_TRACK_ID ? { ...t, clips } : t,
    ),
  }
}

function isStillImageClip(doc: ProjectDocument, clip: TimelineClip): boolean {
  return Boolean(doc.materials?.some((m) => m.id === clip.sourceId && m.kind === 'image'))
}

function rippleClipsFromTime(
  clips: TimelineClip[],
  fromTime: number,
  delta: number,
  excludeIds: ReadonlySet<string>,
): TimelineClip[] {
  return clips.map((clip) => {
    if (excludeIds.has(clip.id)) {
      return clip
    }
    if (clip.timelineStart >= fromTime - 1e-9) {
      return { ...clip, timelineStart: clip.timelineStart + delta }
    }
    return clip
  })
}

export function splitAtPlayhead(
  doc: ProjectDocument,
  playhead: number,
  fps: number,
  preferredClipId?: string | null,
): ProjectDocument {
  if (preferredClipId && isAudioClipId(doc, preferredClipId)) {
    const split = splitAudioClipAtPlayhead(doc, playhead, fps, preferredClipId)
    if (split !== doc) {
      return split
    }
  }
  const videoSplit = splitVideoAtPlayhead(doc, playhead, fps)
  if (videoSplit !== doc) {
    return videoSplit
  }
  const track = getAudioTrack(doc)
  if (!track) {
    return doc
  }
  const epsilon = minClipDuration(fps > 0 ? fps : 30) / 2
  const clip = sortedClips(track).find((c) => {
    const start = c.timelineStart
    const end = clipTimelineEnd(c)
    return playhead > start + epsilon && playhead < end - epsilon
  })
  if (clip) {
    return splitAudioClipAtPlayhead(doc, playhead, fps, clip.id)
  }
  return doc
}

function splitAudioClipAtPlayhead(
  doc: ProjectDocument,
  playhead: number,
  fps: number,
  clipId: string,
): ProjectDocument {
  const track = getAudioTrack(doc)
  if (!track) {
    return doc
  }
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) {
    return doc
  }
  const epsilon = minClipDuration(fps > 0 ? fps : 30) / 2
  const start = clip.timelineStart
  const end = clipTimelineEnd(clip)
  if (playhead <= start + epsilon || playhead >= end - epsilon) {
    return doc
  }
  const splitSourceTime = snapToFrame(
    clip.sourceStart + (playhead - clip.timelineStart),
    fps > 0 ? fps : 30,
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
  const nextClips = track.clips.filter((c) => c.id !== clip.id).concat([left, right])
  return updateAudioTrack(doc, nextClips.sort((a, b) => a.timelineStart - b.timelineStart))
}

function splitVideoAtPlayhead(
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

export function moveAudioClip(
  doc: ProjectDocument,
  clipId: string,
  timelineStart: number,
): ProjectDocument {
  const track = getAudioTrack(doc)
  if (!track) {
    return doc
  }
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) {
    return doc
  }
  const nextStart = Math.max(0, timelineStart)
  return updateAudioTrack(
    doc,
    track.clips.map((c) =>
      c.id === clipId ? { ...c, timelineStart: nextStart } : c,
    ),
  )
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
  if (isAudioClipId(doc, clipId)) {
    return trimAudioClip(doc, clipId, side, edgeTimelineTime, mediaDuration, fps)
  }
  return trimVideoClip(doc, clipId, side, edgeTimelineTime, mediaDuration, fps)
}

function trimAudioClip(
  doc: ProjectDocument,
  clipId: string,
  side: TrimSide,
  edgeTimelineTime: number,
  mediaDuration: number,
  fps: number,
): ProjectDocument {
  const track = getAudioTrack(doc)
  if (!track) {
    return doc
  }
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) {
    return doc
  }
  const snapFps = fps > 0 ? fps : 30
  const minDur = minClipDuration(snapFps)

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
      snapFps,
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
    return updateAudioTrack(
      doc,
      track.clips.map((c) => (c.id === clipId ? trimmed : c)),
    )
  }

  const newEnd = Math.max(
    clip.timelineStart + minDur,
    Math.min(edgeTimelineTime, clipTimelineEnd(clip)),
  )
  const newDuration = newEnd - clip.timelineStart
  const newSourceEnd = snapToFrame(clip.sourceStart + newDuration, snapFps)
  if (newSourceEnd <= clip.sourceStart + minDur) {
    return doc
  }
  const trimmed: TimelineClip = {
    ...clip,
    sourceEnd: Math.min(newSourceEnd, mediaDuration),
  }
  return updateAudioTrack(
    doc,
    track.clips.map((c) => (c.id === clipId ? trimmed : c)),
  )
}

function trimVideoClip(
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

  const still = isStillImageClip(doc, clip)
  const currentEnd = clipTimelineEnd(clip)
  const maxEnd = still ? Number.POSITIVE_INFINITY : currentEnd
  const newEnd = Math.max(clip.timelineStart + minDur, Math.min(edgeTimelineTime, maxEnd))
  const newDuration = newEnd - clip.timelineStart
  const oldDuration = clipDuration(clip)
  if (!still && newDuration >= oldDuration - 1e-9) {
    return doc
  }

  const newSourceEnd = snapToFrame(clip.sourceStart + newDuration, fps)
  if (newSourceEnd <= clip.sourceStart + minDur) {
    return doc
  }

  const nextSourceEnd = still ? newSourceEnd : Math.min(newSourceEnd, mediaDuration)
  if (Math.abs(nextSourceEnd - clip.sourceEnd) < 1e-9) {
    return doc
  }

  const trimmed: TimelineClip = {
    ...clip,
    sourceEnd: nextSourceEnd,
  }

  const trimmedDuration = clipDuration(trimmed)
  const rippleDelta = trimmedDuration - oldDuration
  if (Math.abs(rippleDelta) < 1e-9) {
    return updateVideoTrack(
      doc,
      track.clips.map((c) => (c.id === clipId ? trimmed : c)),
    )
  }

  if (still) {
    const excludeIds = new Set([clipId])
    return {
      ...doc,
      tracks: doc.tracks.map((t) => ({
        ...t,
        clips: rippleClipsFromTime(
          t.clips.map((c) => (c.id === clipId ? trimmed : c)),
          currentEnd,
          rippleDelta,
          excludeIds,
        ),
      })),
    }
  }

  const nextClips = track.clips.map((c) => {
    if (c.id === clipId) {
      return trimmed
    }
    if (c.timelineStart > clip.timelineStart) {
      return { ...c, timelineStart: c.timelineStart + rippleDelta }
    }
    return c
  })

  return updateVideoTrack(doc, nextClips)
}

export function deleteClip(doc: ProjectDocument, clipId: string): ProjectDocument {
  const track = getVideoTrack(doc)
  if (track?.clips.some((c) => c.id === clipId)) {
    const nextClips = track.clips.filter((c) => c.id !== clipId)
    return updateVideoTrack(doc, repackClips(nextClips))
  }
  const audioTrack = doc.tracks.find(
    (t) => t.id === MAIN_AUDIO_TRACK_ID && t.kind === 'audio',
  )
  if (audioTrack?.clips.some((c) => c.id === clipId)) {
    const nextClips = audioTrack.clips.filter((c) => c.id !== clipId)
    return updateAudioTrack(doc, nextClips)
  }
  return doc
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

/** Stretch or clamp clips that use a replaced source whose duration changed. */
export function retargetClipsToNewDuration(
  doc: ProjectDocument,
  sourceId: string,
  previousDuration: number,
  nextDuration: number,
): ProjectDocument {
  if (nextDuration <= 0) {
    return doc
  }

  return {
    ...doc,
    tracks: doc.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        if (clip.sourceId !== sourceId) {
          return clip
        }
        const usedFullSource =
          clip.sourceStart <= 1e-3 &&
          Math.abs(clip.sourceEnd - previousDuration) <= 0.08
        if (usedFullSource) {
          return { ...clip, sourceStart: 0, sourceEnd: nextDuration }
        }
        const sourceStart = Math.min(clip.sourceStart, Math.max(0, nextDuration - 0.04))
        const sourceEnd = Math.max(
          sourceStart + 0.04,
          Math.min(clip.sourceEnd, nextDuration),
        )
        return { ...clip, sourceStart, sourceEnd }
      }),
    })),
  }
}
