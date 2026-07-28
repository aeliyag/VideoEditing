import { v4 as uuidv4 } from 'uuid'

import type { FrameRect, ProjectDocument, RedBoxEffect } from '../types/project'
import { isRedBoxEffect, MAIN_VIDEO_TRACK_ID } from '../types/project'
import { clipDuration, getVideoTrack } from '../timeline/helpers'

/** Default length for a newly created red-box annotation (seconds). */
export const DEFAULT_RED_BOX_DURATION = 15

function clampAnnotationRect(rect: FrameRect): FrameRect {
  const width = Math.max(0.02, Math.min(1, rect.width))
  const height = Math.max(0.02, Math.min(1, rect.height))
  return {
    x: Math.max(0, Math.min(1 - width, rect.x)),
    y: Math.max(0, Math.min(1 - height, rect.y)),
    width,
    height,
  }
}

export function setClipRedBox(
  doc: ProjectDocument,
  clipId: string,
  rect: FrameRect,
  timelinePlayhead?: number,
): ProjectDocument {
  const track = getVideoTrack(doc)
  const clip = track?.clips.find((candidate) => candidate.id === clipId)
  if (!clip) {
    return doc
  }
  const existing = clip.effects.find(isRedBoxEffect)
  const duration = clipDuration(clip)
  let startOffset = existing?.startOffset ?? 0
  let endOffset = existing?.endOffset ?? Math.min(DEFAULT_RED_BOX_DURATION, duration)

  if (!existing) {
    // New boxes begin at the playhead (within the clip) and last up to 15s.
    const local =
      timelinePlayhead === undefined
        ? 0
        : Math.max(0, Math.min(duration, timelinePlayhead - clip.timelineStart))
    startOffset = local
    endOffset = Math.min(duration, local + DEFAULT_RED_BOX_DURATION)
    if (endOffset - startOffset < 0.05) {
      startOffset = Math.max(0, duration - Math.min(DEFAULT_RED_BOX_DURATION, duration))
      endOffset = duration
    }
  }

  const redBox: RedBoxEffect = {
    type: 'red-box',
    id: existing?.id ?? uuidv4(),
    rect: clampAnnotationRect(rect),
    strokeWidth: 4,
    startOffset,
    endOffset,
  }
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
                    effects: [
                      ...clip.effects.filter((effect) => !isRedBoxEffect(effect)),
                      redBox,
                    ],
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
                            startOffset: Math.min(offset, effect.endOffset - 0.05),
                          }
                        : {
                            ...effect,
                            endOffset: Math.max(offset, effect.startOffset + 0.05),
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

export function removeClipRedBox(
  doc: ProjectDocument,
  clipId: string,
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
                      (effect) => !isRedBoxEffect(effect),
                    ),
                  }
                : clip,
            ),
          }
        : track,
    ),
  }
}
