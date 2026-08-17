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
  /** Saved when origin is TTS so the narration can be regenerated with a new voice. */
  tts?: TtsGeneration
}

export interface TtsGeneration {
  prompt: string
  voiceId: string
  rate: string
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

export type ElementKind = 'image' | 'text' | 'shape'

interface ElementEffectBase {
  type: 'element'
  id: string
  /** Normalized against the owning clip's source frame. */
  rect: FrameRect
  /** Layer order among the clip's elements; higher draws on top. */
  z: number
  /** Seconds relative to the owning clip. */
  startOffset: number
  endOffset: number
  opacity: number
}

export interface ImageElementEffect extends ElementEffectBase {
  kind: 'image'
  /** MaterialEntry / MediaAsset id. */
  sourceId: string
}

export interface TextElementEffect extends ElementEffectBase {
  kind: 'text'
  text: string
  /** Font size as a fraction of frame height, so it is resolution independent. */
  fontScale: number
  fontFamily: string
  fontWeight: number
  color: string
  align: 'left' | 'center' | 'right'
  backgroundColor: string | null
}

export interface ShapeElementEffect extends ElementEffectBase {
  kind: 'shape'
  shape: 'rect' | 'ellipse'
  fill: string | null
  stroke: string | null
  strokeWidth: number
}

export type ElementEffect = ImageElementEffect | TextElementEffect | ShapeElementEffect

export type Effect =
  | CameraEffect
  | RedBoxEffect
  | ElementEffect
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
  selectedRedBoxEffectId: string | null
  selectedElementId: string | null
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

export function isElementEffect(effect: Effect): effect is ElementEffect {
  return effect.type === 'element'
}
