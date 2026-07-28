import { v4 as uuidv4 } from 'uuid'

import type {
  CameraEffect,
  FramePreset,
  FrameRect,
  ProjectDocument,
  TimelineClip,
} from '../types/project'
import { isCameraEffect } from '../types/project'
import { clampCameraRect } from './frames'
import { getVideoTrack } from '../timeline/helpers'
import { MAIN_VIDEO_TRACK_ID } from '../types/project'

function nextFrameName(doc: ProjectDocument): string {
  const n = doc.frameBank.length + 1
  return `Frame ${n}`
}

export function upsertFramePreset(
  doc: ProjectDocument,
  rect: FrameRect,
  existingId?: string,
  name?: string,
  sourceWidth = 1920,
  sourceHeight = 1080,
): { doc: ProjectDocument; frameId: string } {
  const clamped = clampCameraRect(rect, sourceWidth, sourceHeight)
  if (existingId) {
    const frameBank = doc.frameBank.map((f) =>
      f.id === existingId ? { ...f, rect: clamped, name: name ?? f.name } : f,
    )
    return { doc: { ...doc, frameBank }, frameId: existingId }
  }
  const frame: FramePreset = {
    id: uuidv4(),
    name: name ?? nextFrameName(doc),
    rect: clamped,
  }
  return { doc: { ...doc, frameBank: [...doc.frameBank, frame] }, frameId: frame.id }
}

function setClipCamera(clip: TimelineClip, camera: CameraEffect): TimelineClip {
  const without = clip.effects.filter((e) => !isCameraEffect(e))
  return { ...clip, effects: [...without, camera] }
}

function getOrCreateCamera(clip: TimelineClip): CameraEffect {
  const existing = clip.effects.find(isCameraEffect)
  return existing ?? { type: 'camera', startFrameId: null, endFrameId: null }
}

export function assignClipCameraStart(
  doc: ProjectDocument,
  clipId: string,
  rect: FrameRect,
  name?: string,
  sourceWidth = 1920,
  sourceHeight = 1080,
): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) {
    return doc
  }
  const camera = getOrCreateCamera(clip)
  // Always create a new bank entry when naming, so start/end stay independent.
  const { doc: withFrame, frameId } = upsertFramePreset(
    doc,
    rect,
    name ? undefined : (camera.startFrameId ?? undefined),
    name,
    sourceWidth,
    sourceHeight,
  )
  const updatedClip = setClipCamera(clip, { ...camera, startFrameId: frameId })
  return updateClip(withFrame, clipId, updatedClip)
}

export function assignClipCameraEnd(
  doc: ProjectDocument,
  clipId: string,
  rect: FrameRect,
  name?: string,
  sourceWidth = 1920,
  sourceHeight = 1080,
): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) {
    return doc
  }
  const camera = getOrCreateCamera(clip)
  const { doc: withFrame, frameId } = upsertFramePreset(
    doc,
    rect,
    name ? undefined : (camera.endFrameId ?? undefined),
    name,
    sourceWidth,
    sourceHeight,
  )
  const updatedClip = setClipCamera(clip, { ...camera, endFrameId: frameId })
  return updateClip(withFrame, clipId, updatedClip)
}

/** Save start (required) and optional end as named frame-bank entries on a clip. */
export function saveClipCamera(
  doc: ProjectDocument,
  clipId: string,
  start: { rect: FrameRect; name: string },
  end?: { rect: FrameRect; name: string } | null,
  sourceWidth = 1920,
  sourceHeight = 1080,
): ProjectDocument {
  let next = assignClipCameraStart(
    doc,
    clipId,
    start.rect,
    start.name.trim() || undefined,
    sourceWidth,
    sourceHeight,
  )
  if (end) {
    next = assignClipCameraEnd(
      next,
      clipId,
      end.rect,
      end.name.trim() || undefined,
      sourceWidth,
      sourceHeight,
    )
  } else {
    // Static crop: clear end so preview/export hold on the start frame.
    const track = getVideoTrack(next)
    const clip = track?.clips.find((c) => c.id === clipId)
    if (clip) {
      const camera = getOrCreateCamera(clip)
      next = updateClip(
        next,
        clipId,
        setClipCamera(clip, { ...camera, endFrameId: null }),
      )
    }
  }
  return next
}

export function applyBankFrameToClipStart(
  doc: ProjectDocument,
  clipId: string,
  frameId: string,
): ProjectDocument {
  const preset = doc.frameBank.find((f) => f.id === frameId)
  if (!preset) {
    return doc
  }
  return setClipCameraFrameRef(doc, clipId, 'start', frameId)
}

export function applyBankFrameToClipEnd(
  doc: ProjectDocument,
  clipId: string,
  frameId: string,
): ProjectDocument {
  const preset = doc.frameBank.find((f) => f.id === frameId)
  if (!preset) {
    return doc
  }
  return setClipCameraFrameRef(doc, clipId, 'end', frameId)
}

function setClipCameraFrameRef(
  doc: ProjectDocument,
  clipId: string,
  side: 'start' | 'end',
  frameId: string,
): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) {
    return doc
  }
  const camera = getOrCreateCamera(clip)
  const updated =
    side === 'start'
      ? { ...camera, startFrameId: frameId }
      : { ...camera, endFrameId: frameId }
  return updateClip(doc, clipId, setClipCamera(clip, updated))
}

export function renameFramePreset(
  doc: ProjectDocument,
  frameId: string,
  name: string,
): ProjectDocument {
  return {
    ...doc,
    frameBank: doc.frameBank.map((f) => (f.id === frameId ? { ...f, name } : f)),
  }
}

export function deleteFramePreset(doc: ProjectDocument, frameId: string): ProjectDocument {
  const frameBank = doc.frameBank.filter((f) => f.id !== frameId)
  const track = getVideoTrack(doc)
  if (!track) {
    return { ...doc, frameBank }
  }
  const clips = track.clips.map((clip) => {
    const camera = clip.effects.find(isCameraEffect)
    if (!camera) {
      return clip
    }
    let startFrameId = camera.startFrameId
    let endFrameId = camera.endFrameId
    if (startFrameId === frameId) {
      startFrameId = null
    }
    if (endFrameId === frameId) {
      endFrameId = null
    }
    if (startFrameId === camera.startFrameId && endFrameId === camera.endFrameId) {
      return clip
    }
    return setClipCamera(clip, { ...camera, startFrameId, endFrameId })
  })
  return {
    ...doc,
    frameBank,
    tracks: doc.tracks.map((t) =>
      t.id === MAIN_VIDEO_TRACK_ID ? { ...t, clips } : t,
    ),
  }
}

function updateClip(doc: ProjectDocument, clipId: string, clip: TimelineClip): ProjectDocument {
  const track = getVideoTrack(doc)
  if (!track) {
    return doc
  }
  return {
    ...doc,
    tracks: doc.tracks.map((t) =>
      t.id === MAIN_VIDEO_TRACK_ID
        ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? clip : c)) }
        : t,
    ),
  }
}
