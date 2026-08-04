import type {
  ProjectDocument,
  EditorUiState,
  MediaAsset,
  FrameRect,
  MaterialEntry,
  MaterialKind,
  MaterialOrigin,
} from '../types/project'
import {
  addClipFromSource,
  addAudioClipFromSource,
  addVideoClipFromMaterial,
  createEmptyProject,
  deleteClip,
  detachAudioFromClip,
  ensureProjectTracks,
  moveAudioClip,
  reorderClipByDrag,
  splitAtPlayhead,
  trimClip,
} from '../timeline/operations'
import {
  applyBankFrameToClipEnd,
  applyBankFrameToClipStart,
  deleteFramePreset,
  renameFramePreset,
  saveClipCamera,
} from '../camera/frameBankOps'
import {
  DEFAULT_FREEZE_FRAME_DURATION,
  insertFreezeFrameAtPlayhead,
} from '../timeline/freezeFrame'
import { clampPlayhead, findClipById, resolveDeleteClipId, totalDuration } from '../timeline/helpers'
import {
  removeClipRedBox,
  setClipRedBox,
  trimClipRedBox,
} from '../camera/redBoxOps'

export type ProjectAction =
  | { type: 'IMPORT_MEDIA'; asset: MediaAsset }
  | {
      type: 'ADD_MATERIAL'
      asset: MediaAsset
      name: string
      kind: MaterialKind
      origin: MaterialOrigin
      /** @deprecated use addToTimelineAtPlayhead */
      addFirstVideoToTimeline?: boolean
      /** When set, video/audio materials are placed on the timeline at this time. */
      addToTimelineAtPlayhead?: number
    }
  | { type: 'ADD_MATERIAL_TO_TIMELINE'; asset: MediaAsset; track: 'video' | 'audio'; timelineStart: number }
  | { type: 'REMOVE_MATERIAL'; materialId: string }
  | { type: 'DETACH_AUDIO'; clipId: string }
  | { type: 'ADD_TTS_CLIP'; asset: MediaAsset; timelineStart: number }
  | { type: 'SET_PLAYHEAD'; time: number }
  | { type: 'SELECT_CLIP'; clipId: string | null }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'SPLIT_AT_PLAYHEAD'; fps: number }
  | {
      type: 'FREEZE_FRAME_AT_PLAYHEAD'
      assetId: string
      materialName: string
      fps: number
      freezeDuration?: number
    }
  | { type: 'DELETE_SELECTED' }
  | { type: 'DELETE_CLIP'; clipId: string }
  | { type: 'TRIM_CLIP'; clipId: string; side: 'start' | 'end'; edgeTimelineTime: number; mediaDuration: number; fps: number }
  | { type: 'REORDER_CLIP'; clipId: string; provisionalTimelineStart: number }
  | { type: 'MOVE_AUDIO_CLIP'; clipId: string; timelineStart: number }
  | {
      type: 'SAVE_CLIP_CAMERA'
      clipId: string
      start: { rect: FrameRect; name: string }
      end?: { rect: FrameRect; name: string } | null
      sourceWidth: number
      sourceHeight: number
    }
  | { type: 'APPLY_FRAME_TO_CLIP_START'; clipId: string; frameId: string }
  | { type: 'APPLY_FRAME_TO_CLIP_END'; clipId: string; frameId: string }
  | { type: 'RENAME_FRAME'; frameId: string; name: string }
  | { type: 'DELETE_FRAME'; frameId: string }
  | { type: 'SET_CLIP_RED_BOX'; clipId: string; rect: FrameRect; timelinePlayhead?: number }
  | { type: 'REMOVE_CLIP_RED_BOX'; clipId: string }
  | { type: 'TRIM_RED_BOX'; clipId: string; effectId: string; side: 'start' | 'end'; timelineTime: number }
  | {
      type: 'LOAD_PROJECT'
      document: ProjectDocument
      playhead: number
      selectedClipId: string | null
    }
  | { type: 'RESET_PROJECT' }

export interface ProjectState {
  document: ProjectDocument
  ui: EditorUiState
}

export function createInitialState(): ProjectState {
  return {
    document: createEmptyProject(),
    ui: {
      playhead: 0,
      selectedClipId: null,
      isPlaying: false,
    },
  }
}

export function projectReducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case 'RESET_PROJECT':
      return createInitialState()

    case 'LOAD_PROJECT':
      return {
        document: ensureProjectTracks(action.document),
        ui: {
          playhead: action.playhead,
          selectedClipId: action.selectedClipId,
          isPlaying: false,
        },
      }

    case 'IMPORT_MEDIA': {
      const document = addClipFromSource(createEmptyProject(), action.asset, 0)
      const entry: MaterialEntry = {
        id: action.asset.id,
        name: action.asset.file.name,
        kind: 'video',
        origin: 'upload',
        addedAt: Date.now(),
      }
      return {
        document: { ...document, materials: [entry] },
        ui: {
          playhead: 0,
          selectedClipId: document.tracks[0]?.clips[0]?.id ?? null,
          isPlaying: false,
        },
      }
    }

    case 'ADD_MATERIAL': {
      const entry: MaterialEntry = {
        id: action.asset.id,
        name: action.name,
        kind: action.kind,
        origin: action.origin,
        addedAt: Date.now(),
      }
      let document = ensureProjectTracks(state.document)
      const materials = document.materials ?? []
      const existing = materials.some((m) => m.id === entry.id)
      if (!existing) {
        document = {
          ...document,
          materials: [entry, ...materials],
        }
      }
      const videoTrack = document.tracks.find((t) => t.kind === 'video')
      const timelineEmpty = (videoTrack?.clips.length ?? 0) === 0
      const shouldAddFirstVideo =
        action.addFirstVideoToTimeline &&
        action.kind === 'video' &&
        timelineEmpty
      if (shouldAddFirstVideo) {
        document = addClipFromSource(document, action.asset, 0)
      }

      const playhead =
        action.addToTimelineAtPlayhead ?? state.ui.playhead
      const shouldAddAtPlayhead =
        action.addToTimelineAtPlayhead !== undefined &&
        (action.kind === 'video' || action.kind === 'audio')
      if (shouldAddAtPlayhead && action.kind === 'video') {
        document = addVideoClipFromMaterial(document, action.asset, playhead)
      } else if (shouldAddAtPlayhead && action.kind === 'audio') {
        document = addAudioClipFromSource(document, action.asset, playhead)
      }

      const addedClip =
        shouldAddAtPlayhead || shouldAddFirstVideo
          ? document.tracks
              .flatMap((t) => t.clips)
              .find((c) => c.sourceId === action.asset.id)
          : undefined

      return {
        document,
        ui: {
          ...state.ui,
          selectedClipId: addedClip?.id ?? state.ui.selectedClipId,
        },
      }
    }

    case 'ADD_MATERIAL_TO_TIMELINE': {
      const materials = state.document.materials ?? []
      const material = materials.find((m) => m.id === action.asset.id)
      if (!material) {
        return state
      }
      let document = ensureProjectTracks(state.document)
      if (action.track === 'video' && material.kind !== 'audio') {
        document = addVideoClipFromMaterial(document, action.asset, action.timelineStart)
        const videoTrack = document.tracks.find((t) => t.kind === 'video')
        const newClip = videoTrack?.clips.at(-1)
        return {
          document,
          ui: { ...state.ui, selectedClipId: newClip?.id ?? state.ui.selectedClipId },
        }
      }
      if (action.track === 'audio' && (material.kind === 'audio' || material.kind === 'video')) {
        document = addAudioClipFromSource(document, action.asset, action.timelineStart)
        const audioTrack = document.tracks.find((t) => t.kind === 'audio')
        const newClip = audioTrack?.clips.at(-1)
        return {
          document,
          ui: { ...state.ui, selectedClipId: newClip?.id ?? state.ui.selectedClipId },
        }
      }
      return state
    }

    case 'REMOVE_MATERIAL': {
      const inUse = state.document.tracks.some((t) =>
        t.clips.some((c) => c.sourceId === action.materialId),
      )
      if (inUse) {
        return state
      }
      return {
        ...state,
        document: {
          ...state.document,
          materials: (state.document.materials ?? []).filter(
            (m) => m.id !== action.materialId,
          ),
        },
      }
    }

    case 'DETACH_AUDIO': {
      return {
        ...state,
        document: detachAudioFromClip(state.document, action.clipId),
      }
    }

    case 'ADD_TTS_CLIP': {
      const withTracks = ensureProjectTracks(state.document)
      const document = addAudioClipFromSource(
        withTracks,
        action.asset,
        action.timelineStart,
      )
      const entry: MaterialEntry = {
        id: action.asset.id,
        name: action.asset.file.name,
        kind: 'audio',
        origin: 'tts',
        addedAt: Date.now(),
      }
      const materials = document.materials.some((m) => m.id === entry.id)
        ? document.materials
        : [entry, ...document.materials]
      const audioTrack = document.tracks.find((t) => t.kind === 'audio')
      const newClip = audioTrack?.clips[audioTrack.clips.length - 1]
      return {
        document: { ...document, materials },
        ui: {
          ...state.ui,
          selectedClipId: newClip?.id ?? state.ui.selectedClipId,
        },
      }
    }

    case 'SET_PLAYHEAD':
      return {
        ...state,
        ui: {
          ...state.ui,
          playhead: clampPlayhead(action.time, state.document),
        },
      }

    case 'SELECT_CLIP':
      return {
        ...state,
        ui: { ...state.ui, selectedClipId: action.clipId },
      }

    case 'SET_PLAYING':
      return {
        ...state,
        ui: { ...state.ui, isPlaying: action.isPlaying },
      }

    case 'SPLIT_AT_PLAYHEAD': {
      const document = splitAtPlayhead(
        state.document,
        state.ui.playhead,
        action.fps,
        state.ui.selectedClipId,
      )
      return {
        document,
        ui: {
          ...state.ui,
          playhead: clampPlayhead(state.ui.playhead, document),
        },
      }
    }

    case 'FREEZE_FRAME_AT_PLAYHEAD': {
      const result = insertFreezeFrameAtPlayhead(
        state.document,
        state.ui.playhead,
        action.fps,
        action.assetId,
        action.freezeDuration ?? DEFAULT_FREEZE_FRAME_DURATION,
        action.materialName,
      )
      if (!result) {
        return state
      }
      return {
        document: result.document,
        ui: {
          ...state.ui,
          selectedClipId: result.freezeClipId,
          playhead: clampPlayhead(state.ui.playhead, result.document),
        },
      }
    }

    case 'DELETE_SELECTED':
    case 'DELETE_CLIP': {
      const clipId =
        action.type === 'DELETE_CLIP'
          ? action.clipId
          : resolveDeleteClipId(
              state.document,
              state.ui.playhead,
              state.ui.selectedClipId,
            )
      if (!clipId || !findClipById(state.document, clipId)) {
        return state
      }
      const document = deleteClip(state.document, clipId)
      const max = totalDuration(document)
      return {
        document,
        ui: {
          ...state.ui,
          selectedClipId: null,
          playhead: clampPlayhead(state.ui.playhead, document),
          isPlaying: max > 0 ? state.ui.isPlaying : false,
        },
      }
    }

    case 'TRIM_CLIP': {
      const document = trimClip(
        state.document,
        action.clipId,
        action.side,
        action.edgeTimelineTime,
        action.mediaDuration,
        action.fps,
      )
      return {
        document,
        ui: {
          ...state.ui,
          playhead: clampPlayhead(state.ui.playhead, document),
        },
      }
    }

    case 'REORDER_CLIP': {
      const document = reorderClipByDrag(
        state.document,
        action.clipId,
        action.provisionalTimelineStart,
      )
      return {
        document,
        ui: {
          ...state.ui,
          playhead: clampPlayhead(state.ui.playhead, document),
        },
      }
    }

    case 'MOVE_AUDIO_CLIP': {
      const document = moveAudioClip(
        state.document,
        action.clipId,
        action.timelineStart,
      )
      return {
        document,
        ui: {
          ...state.ui,
          playhead: clampPlayhead(state.ui.playhead, document),
        },
      }
    }

    case 'SAVE_CLIP_CAMERA': {
      const document = saveClipCamera(
        state.document,
        action.clipId,
        action.start,
        action.end,
        action.sourceWidth,
        action.sourceHeight,
      )
      return { ...state, document }
    }

    case 'APPLY_FRAME_TO_CLIP_START': {
      const document = applyBankFrameToClipStart(
        state.document,
        action.clipId,
        action.frameId,
      )
      return { ...state, document }
    }

    case 'APPLY_FRAME_TO_CLIP_END': {
      const document = applyBankFrameToClipEnd(state.document, action.clipId, action.frameId)
      return { ...state, document }
    }

    case 'RENAME_FRAME': {
      const document = renameFramePreset(state.document, action.frameId, action.name)
      return { ...state, document }
    }

    case 'DELETE_FRAME': {
      const document = deleteFramePreset(state.document, action.frameId)
      return { ...state, document }
    }

    case 'SET_CLIP_RED_BOX': {
      const document = setClipRedBox(
        state.document,
        action.clipId,
        action.rect,
        action.timelinePlayhead,
      )
      return { ...state, document }
    }

    case 'REMOVE_CLIP_RED_BOX': {
      const document = removeClipRedBox(state.document, action.clipId)
      return { ...state, document }
    }

    case 'TRIM_RED_BOX': {
      const document = trimClipRedBox(
        state.document,
        action.clipId,
        action.effectId,
        action.side,
        action.timelineTime,
      )
      return { ...state, document }
    }

    default:
      return state
  }
}
