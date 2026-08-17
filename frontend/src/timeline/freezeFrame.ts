import { v4 as uuidv4 } from 'uuid'

import type {
  Effect,
  MaterialEntry,
  ProjectDocument,
  TimelineClip,
} from '../types/project'
import { isCameraEffect, isElementEffect, isRedBoxEffect, MAIN_VIDEO_TRACK_ID } from '../types/project'
import {
  clipAtTime,
  clipDuration,
  clipTimelineEnd,
  getVideoTrack,
  minClipDuration,
  snapToFrame,
  timelineToSourceTime,
} from './helpers'

export const DEFAULT_FREEZE_FRAME_DURATION = 2

export interface FreezeFrameInsertResult {
  document: ProjectDocument
  freezeClipId: string
  material: MaterialEntry
}

function sortClipsByTimeline(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
}

function copyEffectsForFreezeClip(
  clip: TimelineClip,
  playhead: number,
  freezeDuration: number,
): Effect[] {
  const localOffset = playhead - clip.timelineStart
  const next: Effect[] = []
  for (const effect of clip.effects) {
    if (isCameraEffect(effect)) {
      continue
    }
    if (isRedBoxEffect(effect)) {
      if (localOffset < effect.startOffset || localOffset >= effect.endOffset) {
        continue
      }
      next.push({
        ...effect,
        id: uuidv4(),
        startOffset: 0,
        endOffset: Math.min(effect.endOffset - localOffset, freezeDuration),
      })
      continue
    }
    if (isElementEffect(effect)) {
      if (localOffset < effect.startOffset || localOffset >= effect.endOffset) {
        continue
      }
      next.push({
        ...effect,
        id: uuidv4(),
        startOffset: 0,
        endOffset: Math.min(effect.endOffset - localOffset, freezeDuration),
      })
      continue
    }
    next.push({ ...effect })
  }
  return next
}

function makeFreezeClip(
  assetId: string,
  timelineStart: number,
  duration: number,
  effects: Effect[],
  clipId: string,
): TimelineClip {
  return {
    id: clipId,
    sourceId: assetId,
    sourceStart: 0,
    sourceEnd: duration,
    timelineStart,
    effects,
  }
}

function shiftClipsFromTime(
  clips: TimelineClip[],
  fromTime: number,
  delta: number,
  excludeIds: ReadonlySet<string> = new Set(),
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

function applyRippleToDocument(
  doc: ProjectDocument,
  videoClips: TimelineClip[],
  rippleFrom: number,
  rippleDelta: number,
  excludeIds: ReadonlySet<string>,
): ProjectDocument {
  return {
    ...doc,
    tracks: doc.tracks.map((track) => {
      if (track.id === MAIN_VIDEO_TRACK_ID && track.kind === 'video') {
        return { ...track, clips: videoClips }
      }
      return {
        ...track,
        clips: shiftClipsFromTime(track.clips, rippleFrom, rippleDelta, excludeIds),
      }
    }),
  }
}

/** Source timestamp at playhead for a video clip (frame-snapped). */
export function sourceTimeAtPlayhead(
  clip: TimelineClip,
  playhead: number,
  fps: number,
): number {
  return snapToFrame(timelineToSourceTime(clip, playhead), fps > 0 ? fps : 30)
}

export function isVideoClipAtPlayhead(
  doc: ProjectDocument,
  playhead: number,
  materialKindBySourceId: ReadonlyMap<string, MaterialEntry['kind']>,
): boolean {
  const clip = clipAtTime(doc, playhead)
  if (!clip) {
    return false
  }
  const kind = materialKindBySourceId.get(clip.sourceId)
  if (kind === 'video') {
    return true
  }
  if (kind === 'image' || kind === 'audio') {
    return false
  }
  return clipDuration(clip) > 0
}

export function insertFreezeFrameAtPlayhead(
  doc: ProjectDocument,
  playhead: number,
  fps: number,
  freezeAssetId: string,
  freezeDuration = DEFAULT_FREEZE_FRAME_DURATION,
  materialName: string,
): FreezeFrameInsertResult | null {
  const track = getVideoTrack(doc)
  if (!track) {
    return null
  }

  const clip = clipAtTime(doc, playhead)
  if (!clip) {
    return null
  }

  const snapFps = fps > 0 ? fps : 30
  const epsilon = minClipDuration(snapFps) / 2
  const clipStart = clip.timelineStart
  const clipEnd = clipTimelineEnd(clip)
  const atStart = playhead <= clipStart + epsilon
  const atEnd = playhead >= clipEnd - epsilon

  const freezeClipId = uuidv4()
  const freezeEffects = copyEffectsForFreezeClip(clip, playhead, freezeDuration)

  let videoClips: TimelineClip[]
  let rippleFrom: number
  const excludeIds = new Set<string>()

  if (atStart) {
    const freeze = makeFreezeClip(
      freezeAssetId,
      clipStart,
      freezeDuration,
      freezeEffects,
      freezeClipId,
    )
    const shiftedClip: TimelineClip = {
      ...clip,
      timelineStart: clipStart + freezeDuration,
    }
    excludeIds.add(freezeClipId)
    excludeIds.add(shiftedClip.id)

    videoClips = sortClipsByTimeline(
      track.clips.flatMap((c) => {
        if (c.id === clip.id) {
          return [freeze, shiftedClip]
        }
        if (c.timelineStart >= clipEnd - 1e-9) {
          return [{ ...c, timelineStart: c.timelineStart + freezeDuration }]
        }
        return [c]
      }),
    )
    rippleFrom = clipStart
  } else if (atEnd) {
    const freeze = makeFreezeClip(
      freezeAssetId,
      clipEnd,
      freezeDuration,
      freezeEffects,
      freezeClipId,
    )
    excludeIds.add(freezeClipId)
    videoClips = sortClipsByTimeline([...track.clips, freeze])
    rippleFrom = clipEnd
  } else {
    const splitSourceTime = sourceTimeAtPlayhead(clip, playhead, snapFps)
    const leftId = uuidv4()
    const rightId = uuidv4()
    const left: TimelineClip = {
      ...clip,
      id: leftId,
      sourceEnd: splitSourceTime,
    }
    const right: TimelineClip = {
      ...clip,
      id: rightId,
      sourceStart: splitSourceTime,
      timelineStart: playhead + freezeDuration,
    }
    const freeze = makeFreezeClip(
      freezeAssetId,
      playhead,
      freezeDuration,
      freezeEffects,
      freezeClipId,
    )
    excludeIds.add(leftId)
    excludeIds.add(freezeClipId)
    excludeIds.add(rightId)

    videoClips = sortClipsByTimeline(
      track.clips.flatMap((c) => {
        if (c.id === clip.id) {
          return [left, freeze, right]
        }
        if (c.timelineStart >= clipEnd - 1e-9) {
          return [{ ...c, timelineStart: c.timelineStart + freezeDuration }]
        }
        return [c]
      }),
    )
    rippleFrom = playhead
  }

  const nextDocument = applyRippleToDocument(
    doc,
    videoClips,
    rippleFrom,
    freezeDuration,
    excludeIds,
  )

  const material: MaterialEntry = {
    id: freezeAssetId,
    name: materialName,
    kind: 'image',
    origin: 'freeze-frame',
    addedAt: Date.now(),
  }

  return {
    document: {
      ...nextDocument,
      materials: [material, ...(nextDocument.materials ?? [])],
    },
    freezeClipId,
    material,
  }
}
