import type { ProjectDocument, EditorUiState, MediaAsset, FrameRect } from '../types/project'
import {
  addClipFromSource,
  addAudioClipFromSource,
  createEmptyProject,
  deleteClip,
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
import { clampPlayhead, totalDuration } from '../timeline/helpers'
import {
  removeClipRedBox,
  setClipRedBox,
  trimClipRedBox,
} from '../camera/redBoxOps'

export type ProjectAction =
  | { type: 'IMPORT_MEDIA'; asset: MediaAsset }
  | { type: 'ADD_TTS_CLIP'; asset: MediaAsset; timelineStart: number }
  | { type: 'SET_PLAYHEAD'; time: number }
  | { type: 'SELECT_CLIP'; clipId: string | null }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'SPLIT_AT_PLAYHEAD'; fps: number }
  | { type: 'DELETE_SELECTED' }
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
      return {
        document,
        ui: {
          playhead: 0,
          selectedClipId: document.tracks[0]?.clips[0]?.id ?? null,
          isPlaying: false,
        },
      }
    }

    case 'ADD_TTS_CLIP': {
      const withTracks = ensureProjectTracks(state.document)
      const document = addAudioClipFromSource(
        withTracks,
        action.asset,
        action.timelineStart,
      )
      const audioTrack = document.tracks.find((t) => t.kind === 'audio')
      const newClip = audioTrack?.clips[audioTrack.clips.length - 1]
      return {
        document,
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

    case 'DELETE_SELECTED': {
      if (!state.ui.selectedClipId) {
        return state
      }
      const document = deleteClip(state.document, state.ui.selectedClipId)
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
