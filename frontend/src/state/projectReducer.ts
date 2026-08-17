import type {
  ProjectDocument,
  EditorUiState,
  MediaAsset,
  FrameRect,
  MaterialEntry,
  MaterialKind,
  MaterialOrigin,
  TtsGeneration,
  ElementEffect,
} from '../types/project'
import { isElementEffect } from '../types/project'
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
  retargetClipsToNewDuration,
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
  addClipRedBox,
  moveClipRedBox,
  removeClipRedBox,
  trimClipRedBox,
  updateClipRedBox,
} from '../camera/redBoxOps'
import {
  addClipElement,
  removeClipElement,
  reorderClipElement,
  trimClipElement,
  updateClipElement,
} from '../elements/elementOps'

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
      tts?: TtsGeneration
    }
  | { type: 'ADD_MATERIAL_TO_TIMELINE'; asset: MediaAsset; track: 'video' | 'audio'; timelineStart: number }
  | { type: 'REMOVE_MATERIAL'; materialId: string }
  | { type: 'DETACH_AUDIO'; clipId: string }
  | { type: 'ADD_TTS_CLIP'; asset: MediaAsset; timelineStart: number; tts?: TtsGeneration }
  | {
      type: 'REPLACE_TTS_MATERIAL'
      materialId: string
      previousDuration: number
      nextDuration: number
      tts: TtsGeneration
    }
  | { type: 'SET_PLAYHEAD'; time: number }
  | { type: 'SELECT_CLIP'; clipId: string | null }
  | { type: 'SELECT_RED_BOX'; clipId: string; effectId: string | null }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'SPLIT_AT_PLAYHEAD'; fps: number }
  | {
      type: 'FREEZE_FRAME_AT_PLAYHEAD'
      playhead: number
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
  | { type: 'ADD_CLIP_RED_BOX'; clipId: string; rect: FrameRect; timelinePlayhead?: number }
  | { type: 'UPDATE_CLIP_RED_BOX'; clipId: string; effectId: string; rect: FrameRect }
  | { type: 'REMOVE_CLIP_RED_BOX'; clipId: string; effectId: string }
  | { type: 'TRIM_RED_BOX'; clipId: string; effectId: string; side: 'start' | 'end'; timelineTime: number }
  | { type: 'MOVE_RED_BOX'; clipId: string; effectId: string; timelineStart: number }
  | {
      type: 'ADD_CLIP_ELEMENT'
      clipId: string
      element: Omit<ElementEffect, 'type' | 'id' | 'z' | 'startOffset' | 'endOffset'>
      timelinePlayhead?: number
    }
  | {
      type: 'UPDATE_CLIP_ELEMENT'
      clipId: string
      elementId: string
      patch: Partial<Omit<ElementEffect, 'type' | 'id'>>
    }
  | { type: 'REMOVE_CLIP_ELEMENT'; clipId: string; elementId: string }
  | {
      type: 'TRIM_CLIP_ELEMENT'
      clipId: string
      elementId: string
      side: 'start' | 'end'
      timelineTime: number
    }
  | {
      type: 'REORDER_CLIP_ELEMENT'
      clipId: string
      elementId: string
      direction: 'forward' | 'backward'
    }
  | { type: 'SELECT_ELEMENT'; clipId: string; elementId: string | null }
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
      selectedRedBoxEffectId: null,
      selectedElementId: null,
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
          selectedRedBoxEffectId: null,
          selectedElementId: null,
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
          selectedRedBoxEffectId: null,
          selectedElementId: null,
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
        tts: action.tts,
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
        t.clips.some(
          (c) =>
            c.sourceId === action.materialId ||
            c.effects.some(
              (e) =>
                isElementEffect(e) && e.kind === 'image' && e.sourceId === action.materialId,
            ),
        ),
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
        tts: action.tts,
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

    case 'REPLACE_TTS_MATERIAL': {
      const materials = (state.document.materials ?? []).map((material) =>
        material.id === action.materialId
          ? { ...material, tts: action.tts }
          : material,
      )
      const document = retargetClipsToNewDuration(
        { ...state.document, materials },
        action.materialId,
        action.previousDuration,
        action.nextDuration,
      )
      return {
        ...state,
        document,
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
        ui: {
          ...state.ui,
          selectedClipId: action.clipId,
          selectedRedBoxEffectId: null,
          selectedElementId: null,
        },
      }

    case 'SELECT_RED_BOX':
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedClipId: action.clipId,
          selectedRedBoxEffectId: action.effectId,
          selectedElementId: null,
        },
      }

    case 'SELECT_ELEMENT':
      return {
        ...state,
        ui: {
          ...state.ui,
          selectedClipId: action.clipId,
          selectedRedBoxEffectId: null,
          selectedElementId: action.elementId,
        },
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
        action.playhead,
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
          playhead: clampPlayhead(action.playhead, result.document),
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
          selectedRedBoxEffectId: null,
          selectedElementId: null,
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

    case 'ADD_CLIP_RED_BOX': {
      const result = addClipRedBox(
        state.document,
        action.clipId,
        action.rect,
        action.timelinePlayhead,
      )
      if (!result) {
        return state
      }
      return {
        document: result.document,
        ui: {
          ...state.ui,
          selectedClipId: action.clipId,
          selectedRedBoxEffectId: result.effectId,
        },
      }
    }

    case 'UPDATE_CLIP_RED_BOX': {
      const document = updateClipRedBox(
        state.document,
        action.clipId,
        action.effectId,
        action.rect,
      )
      return { ...state, document }
    }

    case 'REMOVE_CLIP_RED_BOX': {
      const document = removeClipRedBox(state.document, action.clipId, action.effectId)
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

    case 'MOVE_RED_BOX': {
      const document = moveClipRedBox(
        state.document,
        action.clipId,
        action.effectId,
        action.timelineStart,
      )
      return { ...state, document }
    }

    case 'ADD_CLIP_ELEMENT': {
      const result = addClipElement(
        state.document,
        action.clipId,
        action.element,
        action.timelinePlayhead,
      )
      if (!result) {
        return state
      }
      return {
        document: result.document,
        ui: {
          ...state.ui,
          selectedClipId: action.clipId,
          selectedElementId: result.effectId,
          selectedRedBoxEffectId: null,
        },
      }
    }

    case 'UPDATE_CLIP_ELEMENT': {
      const document = updateClipElement(
        state.document,
        action.clipId,
        action.elementId,
        action.patch,
      )
      return { ...state, document }
    }

    case 'REMOVE_CLIP_ELEMENT': {
      const document = removeClipElement(state.document, action.clipId, action.elementId)
      return {
        ...state,
        document,
        ui: {
          ...state.ui,
          selectedElementId:
            state.ui.selectedElementId === action.elementId
              ? null
              : state.ui.selectedElementId,
        },
      }
    }

    case 'TRIM_CLIP_ELEMENT': {
      const document = trimClipElement(
        state.document,
        action.clipId,
        action.elementId,
        action.side,
        action.timelineTime,
      )
      return { ...state, document }
    }

    case 'REORDER_CLIP_ELEMENT': {
      const document = reorderClipElement(
        state.document,
        action.clipId,
        action.elementId,
        action.direction,
      )
      return { ...state, document }
    }

    default:
      return state
  }
}
