import { clampCameraRect } from '../camera/frames'
import {
  clampRedBoxRect,
  DEFAULT_RED_BOX_STROKE_WIDTH,
} from '../camera/redBoxOps'
import type {
  Effect,
  MediaStore,
  ProjectDocument,
  TimelineClip,
} from '../types/project'
import {
  isCameraEffect,
  isRedBoxEffect,
} from '../types/project'
import { ensureProjectTracks } from './operations'

function sourceDimensionsForFrame(
  doc: ProjectDocument,
  mediaStore: MediaStore,
  frameId: string,
): { width: number; height: number } {
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      const camera = clip.effects.find(isCameraEffect)
      if (!camera) {
        continue
      }
      if (camera.startFrameId !== frameId && camera.endFrameId !== frameId) {
        continue
      }
      const asset = mediaStore.get(clip.sourceId)
      if (asset && asset.width > 0 && asset.height > 0) {
        return { width: asset.width, height: asset.height }
      }
    }
  }
  return { width: 1920, height: 1080 }
}

function normalizeCameraEffect(
  effect: Effect,
  doc: ProjectDocument,
): Effect | null {
  if (!isCameraEffect(effect)) {
    return effect
  }

  const frameIds = new Set(doc.frameBank.map((frame) => frame.id))
  const startFrameId =
    effect.startFrameId && frameIds.has(effect.startFrameId)
      ? effect.startFrameId
      : null
  const endFrameId =
    effect.endFrameId && frameIds.has(effect.endFrameId) ? effect.endFrameId : null

  if (!startFrameId && !endFrameId) {
    return null
  }

  return {
    ...effect,
    startFrameId,
    endFrameId,
  }
}

function normalizeClipEffects(
  clip: TimelineClip,
  doc: ProjectDocument,
): TimelineClip {
  const effects: Effect[] = []
  for (const effect of clip.effects) {
    if (isRedBoxEffect(effect)) {
      effects.push({
        ...effect,
        strokeWidth: effect.strokeWidth ?? DEFAULT_RED_BOX_STROKE_WIDTH,
        rect: clampRedBoxRect(effect.rect),
      })
      continue
    }
    const camera = normalizeCameraEffect(effect, doc)
    if (camera) {
      effects.push(camera)
    }
  }
  return { ...clip, effects }
}

/** Normalize saved project JSON and effects after loading from storage. */
export function migrateLoadedProject(
  doc: ProjectDocument,
  mediaStore: MediaStore,
): ProjectDocument {
  let migrated = ensureProjectTracks(doc)
  const frameBank = migrated.frameBank ?? []

  migrated = {
    ...migrated,
    frameBank: frameBank.map((frame) => {
      const { width, height } = sourceDimensionsForFrame(migrated, mediaStore, frame.id)
      return {
        ...frame,
        rect: clampCameraRect(frame.rect, width, height),
      }
    }),
    tracks: migrated.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => normalizeClipEffects(clip, migrated)),
    })),
  }

  return migrated
}
