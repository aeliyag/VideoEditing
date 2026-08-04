export type MaterialKind = 'video' | 'audio' | 'image'
export type MaterialOrigin =
  | 'upload'
  | 'tts'
  | 'image-generate'
  | 'image-to-video'
  | 'akool-record'
  | 'freeze-frame'

export interface MaterialEntry {
  id: string
  name: string
  kind: MaterialKind
  origin: MaterialOrigin
  addedAt: number
}

export type TrackKind = 'video' | 'overlay' | 'audio' | 'camera'

/** Normalized crop rect in source space (0–1). */
export interface FrameRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FramePreset {
  id: string
  name: string
  rect: FrameRect
}

export interface CameraEffect {
  type: 'camera'
  startFrameId: string | null
  endFrameId: string | null
}

export interface RedBoxEffect {
  type: 'red-box'
  id: string
  /** Normalized against the final output frame. */
  rect: FrameRect
  strokeWidth: number
  /** Seconds relative to the owning clip. */
  startOffset: number
  endOffset: number
}

export type Effect =
  | CameraEffect
  | RedBoxEffect
  | { type: string; [key: string]: unknown }

export interface TimelineClip {
  id: string
  sourceId: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  effects: Effect[]
  /** When true, preview/export mutes embedded video audio (e.g. after detach). */
  muteVideoAudio?: boolean
}

export interface Track {
  id: string
  kind: TrackKind
  clips: TimelineClip[]
}

export interface ProjectDocument {
  id: string
  tracks: Track[]
  frameBank: FramePreset[]
  materials: MaterialEntry[]
}

export interface MediaAsset {
  id: string
  file: File
  objectUrl: string
  duration: number
  fps: number
  width: number
  height: number
  hasAudio: boolean
}

export type MediaStore = Map<string, MediaAsset>

export interface EditorUiState {
  playhead: number
  selectedClipId: string | null
  isPlaying: boolean
}

export const MAIN_VIDEO_TRACK_ID = 'track-video-main'
export const MAIN_AUDIO_TRACK_ID = 'track-audio-main'

export function isCameraEffect(effect: Effect): effect is CameraEffect {
  return effect.type === 'camera'
}

export function isRedBoxEffect(effect: Effect): effect is RedBoxEffect {
  return effect.type === 'red-box'
}
