import { v4 as uuidv4 } from 'uuid'

import type {
  ElementEffect,
  FrameRect,
  ProjectDocument,
  TimelineClip,
} from '../types/project'
import { isElementEffect, MAIN_VIDEO_TRACK_ID } from '../types/project'
import { clipDuration, getVideoTrack, MIN_CLIP_DURATION } from '../timeline/helpers'

/** Default length for a newly created element (seconds). */
export const DEFAULT_ELEMENT_DURATION = 15

function clampElementRect(rect: FrameRect): FrameRect {
  const width = Math.max(0.02, Math.min(1, rect.width))
  const height = Math.max(0.02, Math.min(1, rect.height))
  return {
    x: Math.max(0, Math.min(1 - width, rect.x)),
    y: Math.max(0, Math.min(1 - height, rect.y)),
    width,
    height,
  }
}

function computeNewElementTiming(
  clip: { timelineStart: number; sourceStart: number; sourceEnd: number },
  timelinePlayhead: number | undefined,
): { startOffset: number; endOffset: number } {
  const duration = clipDuration(clip)
  const local =
    timelinePlayhead === undefined
      ? 0
      : Math.max(0, Math.min(duration, timelinePlayhead - clip.timelineStart))
  let startOffset = local
  let endOffset = Math.min(duration, local + DEFAULT_ELEMENT_DURATION)
  if (endOffset - startOffset < MIN_CLIP_DURATION) {
    startOffset = Math.max(0, duration - Math.min(DEFAULT_ELEMENT_DURATION, duration))
    endOffset = duration
  }
  return { startOffset, endOffset }
}

function nextElementZ(clip: TimelineClip): number {
  const elements = clip.effects.filter(isElementEffect)
  if (elements.length === 0) {
    return 0
  }
  return Math.max(...elements.map((e) => e.z)) + 1
}

function normalizeElementZ(elements: ElementEffect[]): ElementEffect[] {
  const sorted = [...elements].sort((a, b) => a.z - b.z)
  return sorted.map((element, index) => ({ ...element, z: index }))
}

function mapClipElements(
  doc: ProjectDocument,
  clipId: string,
  mapFn: (elements: ElementEffect[]) => ElementEffect[],
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
                    effects: [
                      ...clip.effects.filter((e) => !isElementEffect(e)),
                      ...mapFn(clip.effects.filter(isElementEffect)),
                    ],
                  }
                : clip,
            ),
          }
        : track,
    ),
  }
}

export function elementVisibleAtOffset(element: ElementEffect, offset: number): boolean {
  return offset >= element.startOffset && offset <= element.endOffset
}

export function visibleElementsAtOffset(
  clip: TimelineClip,
  offset: number,
): ElementEffect[] {
  return clip.effects
    .filter(isElementEffect)
    .filter((element) => elementVisibleAtOffset(element, offset))
    .sort((a, b) => a.z - b.z)
}

export function addClipElement(
  doc: ProjectDocument,
  clipId: string,
  element: Omit<ElementEffect, 'type' | 'id' | 'z' | 'startOffset' | 'endOffset'>,
  timelinePlayhead?: number,
): { document: ProjectDocument; effectId: string } | null {
  const track = getVideoTrack(doc)
  const clip = track?.clips.find((candidate) => candidate.id === clipId)
  if (!clip) {
    return null
  }

  const { startOffset, endOffset } = computeNewElementTiming(clip, timelinePlayhead)
  const next: ElementEffect = {
    type: 'element',
    ...element,
    id: uuidv4(),
    z: nextElementZ(clip),
    startOffset,
    endOffset,
    rect: clampElementRect(element.rect),
  }

  return {
    effectId: next.id,
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
                      effects: [...clip.effects, next],
                    }
                  : clip,
              ),
            }
          : track,
      ),
    },
  }
}

export function updateClipElement(
  doc: ProjectDocument,
  clipId: string,
  elementId: string,
  patch: Partial<Omit<ElementEffect, 'type' | 'id'>>,
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
                    effects: clip.effects.map((effect) => {
                      if (!isElementEffect(effect) || effect.id !== elementId) {
                        return effect
                      }
                      const updated = { ...effect, ...patch }
                      if (patch.rect) {
                        updated.rect = clampElementRect(patch.rect)
                      }
                      return updated
                    }),
                  }
                : clip,
            ),
          }
        : track,
    ),
  }
}

export function removeClipElement(
  doc: ProjectDocument,
  clipId: string,
  elementId: string,
): ProjectDocument {
  const track = getVideoTrack(doc)
  const clip = track?.clips.find((candidate) => candidate.id === clipId)
  if (!clip) {
    return doc
  }
  const remaining = clip.effects
    .filter(isElementEffect)
    .filter((element) => element.id !== elementId)
  return mapClipElements(doc, clipId, () => normalizeElementZ(remaining))
}

export function trimClipElement(
  doc: ProjectDocument,
  clipId: string,
  elementId: string,
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
                      if (!isElementEffect(effect) || effect.id !== elementId) {
                        return effect
                      }
                      return side === 'start'
                        ? {
                            ...effect,
                            startOffset: Math.min(
                              offset,
                              effect.endOffset - MIN_CLIP_DURATION,
                            ),
                          }
                        : {
                            ...effect,
                            endOffset: Math.max(
                              offset,
                              effect.startOffset + MIN_CLIP_DURATION,
                            ),
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

export function reorderClipElement(
  doc: ProjectDocument,
  clipId: string,
  elementId: string,
  direction: 'forward' | 'backward',
): ProjectDocument {
  const track = getVideoTrack(doc)
  const clip = track?.clips.find((candidate) => candidate.id === clipId)
  if (!clip) {
    return doc
  }

  const elements = normalizeElementZ(clip.effects.filter(isElementEffect))
  const index = elements.findIndex((element) => element.id === elementId)
  if (index < 0) {
    return doc
  }

  const swapIndex = direction === 'forward' ? index + 1 : index - 1
  if (swapIndex < 0 || swapIndex >= elements.length) {
    return doc
  }

  const current = elements[index]!
  const target = elements[swapIndex]!
  const swapped = elements.map((element) => {
    if (element.id === current.id) {
      return { ...element, z: target.z }
    }
    if (element.id === target.id) {
      return { ...element, z: current.z }
    }
    return element
  })
  return mapClipElements(doc, clipId, () => normalizeElementZ(swapped))
}

export function collectAllElements(doc: ProjectDocument): ElementEffect[] {
  const track = getVideoTrack(doc)
  if (!track) {
    return []
  }
  return track.clips.flatMap((clip) => clip.effects.filter(isElementEffect))
}
