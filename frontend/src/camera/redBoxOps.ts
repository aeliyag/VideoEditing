import { v4 as uuidv4 } from 'uuid'

import type { FrameRect, ProjectDocument, RedBoxEffect } from '../types/project'
import { isRedBoxEffect, MAIN_VIDEO_TRACK_ID } from '../types/project'
import { clipDuration, getVideoTrack, MIN_CLIP_DURATION } from '../timeline/helpers'

/** Default length for a newly created red-box annotation (seconds). */
export const DEFAULT_RED_BOX_DURATION = 5

export const DEFAULT_RED_BOX_STROKE_WIDTH = 4

export function clampRedBoxRect(rect: FrameRect): FrameRect {
  const width = Math.max(0.02, Math.min(1, rect.width))
  const height = Math.max(0.02, Math.min(1, rect.height))
  return {
    x: Math.max(0, Math.min(1 - width, rect.x)),
    y: Math.max(0, Math.min(1 - height, rect.y)),
    width,
    height,
  }
}

function computeNewRedBoxTiming(
  clip: { timelineStart: number; sourceStart: number; sourceEnd: number },
  timelinePlayhead: number | undefined,
): { startOffset: number; endOffset: number } {
  const duration = clipDuration(clip)
  const local =
    timelinePlayhead === undefined
      ? 0
      : Math.max(0, Math.min(duration, timelinePlayhead - clip.timelineStart))
  let startOffset = local
  let endOffset = Math.min(duration, local + DEFAULT_RED_BOX_DURATION)
  if (endOffset - startOffset < MIN_CLIP_DURATION) {
    startOffset = Math.max(0, duration - Math.min(DEFAULT_RED_BOX_DURATION, duration))
    endOffset = duration
  }
  return { startOffset, endOffset }
}

export function addClipRedBox(
  doc: ProjectDocument,
  clipId: string,
  rect: FrameRect,
  timelinePlayhead?: number,
): { document: ProjectDocument; effectId: string } | null {
  const track = getVideoTrack(doc)
  const clip = track?.clips.find((candidate) => candidate.id === clipId)
  if (!clip) {
    return null
  }

  const { startOffset, endOffset } = computeNewRedBoxTiming(clip, timelinePlayhead)
  const redBox: RedBoxEffect = {
    type: 'red-box',
    id: uuidv4(),
    rect: clampRedBoxRect(rect),
    strokeWidth: 4,
    startOffset,
    endOffset,
  }
  return {
    effectId: redBox.id,
    document: {
      ...doc,
      tracks: doc.tracks.map((track) =>
        track.id === MAIN_VIDEO_TRACK_ID
          ? {
              ...track,
              clips: track.clips.map((clip) =>
                clip.id === clipId
                  ? {
                      ...clip,
                      effects: [...clip.effects, redBox],
                    }
                  : clip,
              ),
            }
          : track,
      ),
    },
  }
}

export function updateClipRedBox(
  doc: ProjectDocument,
  clipId: string,
  effectId: string,
  rect: FrameRect,
): ProjectDocument {
  return {
    ...doc,
    tracks: doc.tracks.map((track) =>
      track.id === MAIN_VIDEO_TRACK_ID
        ? {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === clipId
                ? {
                    ...clip,
                    effects: clip.effects.map((effect) =>
                      isRedBoxEffect(effect) && effect.id === effectId
                        ? { ...effect, rect: clampRedBoxRect(rect) }
                        : effect,
                    ),
                  }
                : clip,
            ),
          }
        : track,
    ),
  }
}

export function trimClipRedBox(
  doc: ProjectDocument,
  clipId: string,
  effectId: string,
  side: 'start' | 'end',
  timelineTime: number,
): ProjectDocument {
  const track = getVideoTrack(doc)
  const clip = track?.clips.find((candidate) => candidate.id === clipId)
  if (!clip) {
    return doc
  }
  const duration = clipDuration(clip)
  const offset = Math.max(0, Math.min(duration, timelineTime - clip.timelineStart))
  return {
    ...doc,
    tracks: doc.tracks.map((candidateTrack) =>
      candidateTrack.id === MAIN_VIDEO_TRACK_ID
        ? {
            ...candidateTrack,
            clips: candidateTrack.clips.map((candidateClip) =>
              candidateClip.id === clipId
                ? {
                    ...candidateClip,
                    effects: candidateClip.effects.map((effect) => {
                      if (!isRedBoxEffect(effect) || effect.id !== effectId) {
                        return effect
                      }
                      return side === 'start'
                        ? {
                            ...effect,
                            startOffset: Math.min(offset, effect.endOffset - MIN_CLIP_DURATION),
                          }
                        : {
                            ...effect,
                            endOffset: Math.max(offset, effect.startOffset + MIN_CLIP_DURATION),
                          }
                    }),
                  }
                : candidateClip,
            ),
          }
        : candidateTrack,
    ),
  }
}

/** Shifts a red box along the timeline, preserving its duration and keeping it inside the clip. */
export function moveClipRedBox(
  doc: ProjectDocument,
  clipId: string,
  effectId: string,
  timelineStart: number,
): ProjectDocument {
  const track = getVideoTrack(doc)
  const clip = track?.clips.find((candidate) => candidate.id === clipId)
  if (!clip) {
    return doc
  }
  const duration = clipDuration(clip)
  return {
    ...doc,
    tracks: doc.tracks.map((candidateTrack) =>
      candidateTrack.id === MAIN_VIDEO_TRACK_ID
        ? {
            ...candidateTrack,
            clips: candidateTrack.clips.map((candidateClip) =>
              candidateClip.id === clipId
                ? {
                    ...candidateClip,
                    effects: candidateClip.effects.map((effect) => {
                      if (!isRedBoxEffect(effect) || effect.id !== effectId) {
                        return effect
                      }
                      const span = Math.min(effect.endOffset - effect.startOffset, duration)
                      const startOffset = Math.max(
                        0,
                        Math.min(duration - span, timelineStart - clip.timelineStart),
                      )
                      return { ...effect, startOffset, endOffset: startOffset + span }
                    }),
                  }
                : candidateClip,
            ),
          }
        : candidateTrack,
    ),
  }
}

export function removeClipRedBox(
  doc: ProjectDocument,
  clipId: string,
  effectId: string,
): ProjectDocument {
  return {
    ...doc,
    tracks: doc.tracks.map((track) =>
      track.id === MAIN_VIDEO_TRACK_ID
        ? {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === clipId
                ? {
                    ...clip,
                    effects: clip.effects.filter(
                      (effect) => !isRedBoxEffect(effect) || effect.id !== effectId,
                    ),
                  }
                : clip,
            ),
          }
        : track,
    ),
  }
}
