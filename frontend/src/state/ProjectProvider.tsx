import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'

import { exportProjectToMp4 } from '../export/ExportEngine'
import { generateAkoolTts } from '../akool/client'
import { getClipCameraRectAtTimelineTime } from '../camera/frames'
import { collectAllElements } from '../elements/elementOps'
import { importDebug } from '../debug/importDebug'
import {
  captureVideoFrameToFile,
  createCaptureVideoElement,
  FrameCaptureError,
  loadCaptureVideoSource,
} from '../media/captureFrame'
import { probeMediaFile, reprobeMediaStore, revokeMediaAsset } from '../media/probe'
import { inferMaterialKind, probeFileAsMaterial } from '../media/materialHelpers'
import { playbackController } from '../playback/PlaybackController'
import type { MaterialKind, MaterialOrigin, MediaAsset, MediaStore, TtsGeneration } from '../types/project'
import { clipAtTime, getVideoTrack, sortedClips, totalDuration } from '../timeline/helpers'
import { migrateLoadedProject } from '../timeline/migrateProject'
import {
  isVideoClipAtPlayhead,
  sourceTimeAtPlayhead,
} from '../timeline/freezeFrame'
import {
  deleteProjectVersion,
  listSavedProjects,
  loadProjectVersion,
  saveProjectVersion,
  type SavedProjectMeta,
} from '../storage/projectStorage'
import { useAuth } from './AuthProvider'
import {
  createInitialState,
  projectReducer,
  type ProjectAction,
  type ProjectState,
} from './projectReducer'
import {
  createHistoryStacks,
  pushHistory,
  redoHistory,
  restoreAssetsFromSnapshot,
  snapshotEditor,
  undoHistory,
  type HistoryStacks,
} from './history'

export type EffectEditorMode = 'camera' | 'red-box' | null

interface ProjectContextValue {
  state: ProjectState
  dispatch: React.Dispatch<ProjectAction>
  mediaStore: MediaStore
  importFiles: (files: FileList | File[]) => Promise<void>
  importRecordingFile: (
    file: File,
    options?: { addToTimeline?: boolean; name?: string; durationHint?: number },
  ) => Promise<MediaAsset>
  addMaterialAsset: (params: {
    file: File
    name?: string
    kind: MaterialKind
    origin: MaterialOrigin
    addFirstVideoToTimeline?: boolean
    tts?: TtsGeneration
  }) => Promise<MediaAsset>
  addMaterialToTimeline: (materialId: string, track: 'video' | 'audio') => void
  removeMaterial: (materialId: string) => void
  detachAudioFromSelected: () => void
  addTtsAudio: (
    blob: Blob,
    fileName: string,
    timelineStart: number,
    tts?: TtsGeneration,
  ) => Promise<void>
  replaceTtsAudio: (
    materialId: string,
    blob: Blob,
    tts: TtsGeneration,
  ) => Promise<void>
  beginTtsEdit: (materialId: string) => void
  clearTtsEdit: () => void
  ttsEdit: { materialId: string; tts: TtsGeneration } | null
  generateTtsAndAdd: (params: {
    inputText: string
    voiceId: string
    rate: string
  }) => Promise<void>
  exportVideo: () => Promise<void>
  exportProgress: number
  exportMessage: string
  isExporting: boolean
  primaryFps: number
  primaryAsset: MediaAsset | undefined
  projectName: string
  setProjectName: (name: string) => void
  activeSaveId: string | null
  savedProjects: SavedProjectMeta[]
  refreshSavedProjects: () => Promise<void>
  saveCurrentProject: (name?: string) => Promise<void>
  saveProjectAs: (name: string) => Promise<void>
  loadSavedProject: (id: string) => Promise<void>
  deleteSavedProject: (id: string) => Promise<void>
  newProject: () => void
  libraryMessage: string
  effectEditorMode: EffectEditorMode
  openEffectEditor: (mode: Exclude<EffectEditorMode, null>) => void
  closeEffectEditor: () => void
  canFreezeFrame: boolean
  freezeFrameAtPlayhead: () => Promise<void>
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  recordUndoSnapshot: () => void
  elementsPanelOpen: boolean
  setElementsPanelOpen: (open: boolean) => void
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

function clearMediaStore(store: MediaStore): void {
  for (const asset of store.values()) {
    revokeMediaAsset(asset)
  }
}

function shouldMarkDirty(action: ProjectAction): boolean {
  switch (action.type) {
    case 'SET_PLAYHEAD':
    case 'SET_PLAYING':
    case 'SELECT_CLIP':
    case 'SELECT_RED_BOX':
    case 'SELECT_ELEMENT':
      return false
    default:
      return true
  }
}

function formatSaveError(err: unknown): string {
  return err instanceof Error ? err.message : 'Save failed.'
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const stateRef = useRef<ProjectState>(createInitialState())
  const setIsDirtyRef = useRef<(dirty: boolean) => void>(() => {})
  const reducerWithRef = useCallback((state: ProjectState, action: ProjectAction): ProjectState => {
    const next = projectReducer(state, action)
    stateRef.current = next
    if (action.type === 'LOAD_PROJECT' || action.type === 'RESET_PROJECT') {
      setIsDirtyRef.current(false)
    } else if (shouldMarkDirty(action)) {
      setIsDirtyRef.current(true)
    }
    return next
  }, [])
  const [state, dispatch] = useReducer(reducerWithRef, undefined, createInitialState)
  const [mediaStore, setMediaStore] = useState<MediaStore>(() => new Map())
  const [exportProgress, setExportProgress] = useState(0)
  const [exportMessage, setExportMessage] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [projectName, setProjectName] = useState('Untitled timeline')
  const [activeSaveId, setActiveSaveId] = useState<string | null>(null)
  const [savedProjects, setSavedProjects] = useState<SavedProjectMeta[]>([])
  const [libraryMessage, setLibraryMessage] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  setIsDirtyRef.current = setIsDirty
  const [effectEditorMode, setEffectEditorMode] = useState<EffectEditorMode>(null)
  const [elementsPanelOpen, setElementsPanelOpen] = useState(true)
  const [ttsEdit, setTtsEdit] = useState<{ materialId: string; tts: TtsGeneration } | null>(
    null,
  )
  const mediaStoreRef = useRef(mediaStore)
  mediaStoreRef.current = mediaStore
  const forceUploadMediaIdsRef = useRef(new Set<string>())
  const historyRef = useRef<HistoryStacks>(createHistoryStacks())
  const captureVideoRef = useRef<HTMLVideoElement | null>(null)
  const freezeInProgressRef = useRef(false)
  const [historyTick, setHistoryTick] = useState(0)

  const openEffectEditor = useCallback((mode: Exclude<EffectEditorMode, null>) => {
    playbackController.pause()
    setEffectEditorMode(mode)
  }, [])

  const closeEffectEditor = useCallback(() => {
    setEffectEditorMode(null)
  }, [])

  const primaryAsset = useMemo(() => {
    const track = getVideoTrack(state.document)
    if (!track) {
      return undefined
    }
    const atPlayhead = sortedClips(track).find(
      (clip) =>
        state.ui.playhead >= clip.timelineStart &&
        state.ui.playhead < clip.timelineStart + (clip.sourceEnd - clip.sourceStart),
    )
    const candidates = atPlayhead ? [atPlayhead] : sortedClips(track)
    for (const clip of candidates) {
      const asset = mediaStore.get(clip.sourceId)
      if (asset) {
        return asset
      }
    }
    return undefined
  }, [state.document, state.ui.playhead, mediaStore])

  const primaryFps = primaryAsset?.fps ?? 30
  const videoClipCount = getVideoTrack(state.document)?.clips.length ?? 0

  const materialKindBySourceId = useMemo(() => {
    const map = new Map<string, MaterialKind>()
    for (const material of state.document.materials ?? []) {
      map.set(material.id, material.kind)
    }
    return map
  }, [state.document.materials])

  const canFreezeFrame = useMemo(
    () =>
      isVideoClipAtPlayhead(
        state.document,
        state.ui.playhead,
        materialKindBySourceId,
      ) && Boolean(mediaStore.get(clipAtTime(state.document, state.ui.playhead)?.sourceId ?? '')),
    [state.document, state.ui.playhead, materialKindBySourceId, mediaStore],
  )

  const canUndo = historyRef.current.past.length > 0
  const canRedo = historyRef.current.future.length > 0
  void historyTick

  const pushUndoSnapshot = useCallback(() => {
    historyRef.current = pushHistory(
      historyRef.current,
      snapshotEditor(stateRef.current, mediaStoreRef.current),
    )
    setHistoryTick((n) => n + 1)
  }, [])

  const undo = useCallback(() => {
    const current = snapshotEditor(stateRef.current, mediaStoreRef.current)
    const { stacks, snapshot } = undoHistory(historyRef.current, current)
    historyRef.current = stacks
    if (!snapshot) {
      return
    }
    playbackController.pause()
    const nextStore = restoreAssetsFromSnapshot(
      mediaStoreRef.current,
      snapshot.mediaStore,
    )
    mediaStoreRef.current = nextStore
    setMediaStore(nextStore)
    dispatch({
      type: 'LOAD_PROJECT',
      document: snapshot.state.document,
      playhead: snapshot.state.ui.playhead,
      selectedClipId: snapshot.state.ui.selectedClipId,
    })
    setLibraryMessage('Undid last action.')
    setHistoryTick((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    const current = snapshotEditor(stateRef.current, mediaStoreRef.current)
    const { stacks, snapshot } = redoHistory(historyRef.current, current)
    historyRef.current = stacks
    if (!snapshot) {
      return
    }
    playbackController.pause()
    const nextStore = restoreAssetsFromSnapshot(
      mediaStoreRef.current,
      snapshot.mediaStore,
    )
    mediaStoreRef.current = nextStore
    setMediaStore(nextStore)
    dispatch({
      type: 'LOAD_PROJECT',
      document: snapshot.state.document,
      playhead: snapshot.state.ui.playhead,
      selectedClipId: snapshot.state.ui.selectedClipId,
    })
    setLibraryMessage('Redid last action.')
    setHistoryTick((n) => n + 1)
  }, [])

  const registerMaterialInStore = useCallback((asset: MediaAsset) => {
    importDebug('registerMaterialInStore', {
      assetId: asset.id,
      fileName: asset.file.name,
      duration: asset.duration,
      storeSizeBefore: mediaStoreRef.current.size,
    })
    if (mediaStoreRef.current.has(asset.id)) {
      forceUploadMediaIdsRef.current.add(asset.id)
    }
    const next = new Map(mediaStoreRef.current)
    next.set(asset.id, asset)
    mediaStoreRef.current = next
    flushSync(() => {
      setMediaStore(next)
    })
    importDebug('registerMaterialInStore done', { storeSizeAfter: next.size })
  }, [])

  const freezeFrameAtPlayhead = useCallback(async () => {
    if (freezeInProgressRef.current) {
      return
    }
    const currentState = stateRef.current
    const playhead = currentState.ui.playhead
    const clip = clipAtTime(currentState.document, playhead)
    if (!clip) {
      setLibraryMessage('Move the playhead over a video clip to create a freeze frame.')
      return
    }
    if (
      !isVideoClipAtPlayhead(
        currentState.document,
        playhead,
        materialKindBySourceId,
      )
    ) {
      setLibraryMessage('Freeze frame works on video clips only.')
      return
    }
    const sourceAsset = mediaStoreRef.current.get(clip.sourceId)
    if (!sourceAsset) {
      setLibraryMessage('Source media is unavailable — re-import the video.')
      return
    }

    freezeInProgressRef.current = true
    setLibraryMessage('Capturing freeze frame…')
    pushUndoSnapshot()

    try {
      if (!captureVideoRef.current) {
        captureVideoRef.current = createCaptureVideoElement()
      }
      const captureVideo = captureVideoRef.current
      await loadCaptureVideoSource(captureVideo, sourceAsset.objectUrl)

      const cropRect = getClipCameraRectAtTimelineTime(
        currentState.document,
        clip,
        playhead,
        sourceAsset.width,
        sourceAsset.height,
      )
      const sourceTime = sourceTimeAtPlayhead(clip, playhead, sourceAsset.fps || 30)
      const baseName = sourceAsset.file.name.replace(/\.[^.]+$/, '') || 'video'
      const fileName = `${baseName}_freeze_${Math.round(sourceTime * 1000)}ms.png`
      const frameFile = await captureVideoFrameToFile(
        captureVideo,
        sourceTime,
        fileName,
        { cropRect },
      )
      const asset = await probeMediaFile(frameFile)
      registerMaterialInStore(asset)
      dispatch({
        type: 'FREEZE_FRAME_AT_PLAYHEAD',
        playhead,
        assetId: asset.id,
        materialName: fileName,
        fps: sourceAsset.fps || 30,
      })
      const inserted = getVideoTrack(stateRef.current.document)?.clips.some(
        (candidate) => candidate.sourceId === asset.id,
      )
      if (!inserted) {
        if (historyRef.current.past.length > 0) {
          historyRef.current = {
            ...historyRef.current,
            past: historyRef.current.past.slice(0, -1),
          }
          setHistoryTick((n) => n + 1)
        }
        setLibraryMessage('Could not insert freeze frame at the playhead.')
        return
      }
      playbackController.pause()
      playbackController.seek(playhead)
      setLibraryMessage('Inserted 2s freeze frame at playhead.')
    } catch (err) {
      if (historyRef.current.past.length > 0) {
        historyRef.current = {
          ...historyRef.current,
          past: historyRef.current.past.slice(0, -1),
        }
        setHistoryTick((n) => n + 1)
      }
      const message =
        err instanceof FrameCaptureError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not capture freeze frame.'
      setLibraryMessage(`Freeze frame failed: ${message}`)
    } finally {
      freezeInProgressRef.current = false
    }
  }, [materialKindBySourceId, pushUndoSnapshot, registerMaterialInStore])

  const refreshSavedProjects = useCallback(async () => {
    const list = await listSavedProjects(userId)
    setSavedProjects(list)
  }, [userId])

  useEffect(() => {
    return () => {
      captureVideoRef.current?.remove()
      captureVideoRef.current = null
    }
  }, [])

  useEffect(() => {
    void refreshSavedProjects()
  }, [refreshSavedProjects])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty) {
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    importDebug('ProjectProvider mounted — filter console with [import]')
  }, [])

  useEffect(() => {
    playbackController.setProject(state.document, mediaStoreRef.current)
  }, [state.document, mediaStore])

  useEffect(() => {
    const materials = state.document.materials ?? []
    const videoClips = getVideoTrack(state.document)?.clips.length ?? 0
    importDebug('store snapshot', {
      materialsCount: materials.length,
      materialNames: materials.map((m) => m.name),
      mediaStoreSize: mediaStore.size,
      videoClips,
      libraryMessage,
    })
  }, [state.document.materials, mediaStore.size, videoClipCount, libraryMessage])

  useEffect(() => {
    const unsub = playbackController.subscribe((time, playing) => {
      dispatch({ type: 'SET_PLAYHEAD', time })
      dispatch({ type: 'SET_PLAYING', isPlaying: playing })
    })
    return unsub
  }, [])

  useEffect(() => {
    return () => {
      clearMediaStore(mediaStoreRef.current)
      playbackController.destroy()
    }
  }, [])

  const addMaterialAsset = useCallback(
    async (params: {
      file: File
      name?: string
      kind: MaterialKind
      origin: MaterialOrigin
      addFirstVideoToTimeline?: boolean
      tts?: TtsGeneration
    }) => {
      const { asset, kind } = await probeFileAsMaterial(params.file)
      const resolvedKind = params.kind ?? kind
      registerMaterialInStore(asset)
      dispatch({
        type: 'ADD_MATERIAL',
        asset,
        name: params.name ?? params.file.name,
        kind: resolvedKind,
        origin: params.origin,
        addFirstVideoToTimeline: params.addFirstVideoToTimeline,
        tts: params.tts,
      })
      return asset
    },
    [registerMaterialInStore],
  )

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      importDebug('importFiles called', {
        count: list.length,
        files: list.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      })
      if (list.length === 0) {
        importDebug('importFiles: empty list, aborting')
        return
      }
      setLibraryMessage('Importing…')
      try {
        let addedClips = 0
        for (const file of list) {
          importDebug('probing file…', { name: file.name, type: file.type, size: file.size })
          const { asset, kind } = await probeFileAsMaterial(file)
          importDebug('probe done', {
            assetId: asset.id,
            kind,
            duration: asset.duration,
            width: asset.width,
            height: asset.height,
          })
          registerMaterialInStore(asset)
          const addToTimelineAtPlayhead =
            kind === 'video' || kind === 'audio'
              ? stateRef.current.ui.playhead
              : undefined
          importDebug('dispatch ADD_MATERIAL', {
            assetId: asset.id,
            kind,
            addToTimelineAtPlayhead,
            materialsBefore: stateRef.current.document.materials?.length ?? 0,
          })
          dispatch({
            type: 'ADD_MATERIAL',
            asset,
            name: file.name,
            kind,
            origin: 'upload',
            addToTimelineAtPlayhead,
          })
          if (addToTimelineAtPlayhead !== undefined) {
            addedClips += 1
          }
        }
        const msg =
          addedClips > 0
            ? `Added ${list.length} file(s) to materials and placed ${addedClips} on the timeline.`
            : `Added ${list.length} file(s) to materials.`
        importDebug('importFiles success', {
          message: msg,
          note: 'React state updates on next render — see "store snapshot" log',
        })
        setLibraryMessage(msg)
      } catch (err) {
        importDebug('importFiles FAILED', {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
        setLibraryMessage(
          err instanceof Error ? `Import failed: ${err.message}` : 'Import failed.',
        )
      }
    },
    [registerMaterialInStore],
  )

  const importRecordingFile = useCallback(
    async (
      file: File,
      options?: { addToTimeline?: boolean; name?: string; durationHint?: number },
    ): Promise<MediaAsset> => {
      setLibraryMessage('Importing recording…')
      try {
        const { asset, kind } = await probeFileAsMaterial(file, {
          durationHint: options?.durationHint,
        })
        registerMaterialInStore(asset)
        const addToTimeline = options?.addToTimeline ?? false
        const addToTimelineAtPlayhead =
          addToTimeline && (kind === 'video' || kind === 'audio')
            ? stateRef.current.ui.playhead
            : undefined
        dispatch({
          type: 'ADD_MATERIAL',
          asset,
          name: options?.name ?? file.name,
          kind,
          origin: 'akool-record',
          addToTimelineAtPlayhead,
        })
        const msg = addToTimelineAtPlayhead !== undefined
          ? 'Recording added to materials and timeline.'
          : 'Recording added to materials.'
        setLibraryMessage(msg)
        return asset
      } catch (err) {
        setLibraryMessage(
          err instanceof Error ? `Import failed: ${err.message}` : 'Import failed.',
        )
        throw err
      }
    },
    [registerMaterialInStore],
  )

  const addMaterialToTimeline = useCallback(
    (materialId: string, track: 'video' | 'audio') => {
      const asset = mediaStoreRef.current.get(materialId)
      if (!asset) {
        setLibraryMessage('Material not found.')
        return
      }
      dispatch({
        type: 'ADD_MATERIAL_TO_TIMELINE',
        asset,
        track,
        timelineStart: state.ui.playhead,
      })
      setLibraryMessage('Added material to timeline at playhead.')
    },
    [state.ui.playhead],
  )

  const removeMaterial = useCallback((materialId: string) => {
    const inUse = state.document.tracks.some((t) =>
      t.clips.some((c) => c.sourceId === materialId),
    )
    if (inUse) {
      setLibraryMessage('Cannot remove — material is used on the timeline.')
      return
    }
    const asset = mediaStoreRef.current.get(materialId)
    if (asset) {
      revokeMediaAsset(asset)
      setMediaStore((prev) => {
        const next = new Map(prev)
        next.delete(materialId)
        return next
      })
    }
    dispatch({ type: 'REMOVE_MATERIAL', materialId })
    setLibraryMessage('Removed from materials.')
  }, [state.document.tracks])

  const detachAudioFromSelected = useCallback(() => {
    const clipId = state.ui.selectedClipId
    if (!clipId) {
      setLibraryMessage('Select a video clip to detach audio.')
      return
    }
    dispatch({ type: 'DETACH_AUDIO', clipId })
    setLibraryMessage('Detached audio to the audio track.')
  }, [state.ui.selectedClipId])

  const addTtsAudio = useCallback(
    async (blob: Blob, fileName: string, timelineStart: number, tts?: TtsGeneration) => {
      const file = new File([blob], fileName, { type: blob.type || 'audio/mpeg' })
      const asset = await probeMediaFile(file)
      registerMaterialInStore(asset)
      dispatch({ type: 'ADD_TTS_CLIP', asset, timelineStart, tts })
      setLibraryMessage('Added TTS clip to timeline.')
    },
    [registerMaterialInStore],
  )

  const replaceTtsAudio = useCallback(
    async (materialId: string, blob: Blob, tts: TtsGeneration) => {
      const previous = mediaStoreRef.current.get(materialId)
      const file = new File([blob], previous?.file.name ?? `tts_${Date.now()}.mp3`, {
        type: blob.type || 'audio/mpeg',
      })
      const probed = await probeMediaFile(file)
      const asset: MediaAsset = { ...probed, id: materialId }
      if (previous) {
        revokeMediaAsset(previous)
      }
      registerMaterialInStore(asset)
      dispatch({
        type: 'REPLACE_TTS_MATERIAL',
        materialId,
        previousDuration: previous?.duration ?? probed.duration,
        nextDuration: probed.duration,
        tts,
      })
      setLibraryMessage('Updated TTS audio with the new voice.')
    },
    [registerMaterialInStore],
  )

  const beginTtsEdit = useCallback((materialId: string) => {
    const material = stateRef.current.document.materials?.find((m) => m.id === materialId)
    if (!material || material.origin !== 'tts') {
      setLibraryMessage('Only generated speech can be modified.')
      return
    }
    setTtsEdit({
      materialId,
      tts: material.tts ?? { prompt: '', voiceId: '', rate: '100%' },
    })
  }, [])

  const clearTtsEdit = useCallback(() => {
    setTtsEdit(null)
  }, [])

  const generateTtsAndAdd = useCallback(
    async (params: { inputText: string; voiceId: string; rate: string }) => {
      const blob = await generateAkoolTts({
        inputText: params.inputText,
        voiceId: params.voiceId,
        rate: params.rate,
      })
      const timelineStart = state.ui.playhead
      const safeName = `tts_${Date.now()}.mp3`
      await addTtsAudio(blob, safeName, timelineStart, {
        prompt: params.inputText,
        voiceId: params.voiceId,
        rate: params.rate,
      })
    },
    [addTtsAudio, state.ui.playhead],
  )

  const exportVideo = useCallback(async () => {
    setIsExporting(true)
    setExportProgress(0)
    setExportMessage('Starting export…')
    try {
      const blob = await exportProjectToMp4(
        stateRef.current.document,
        mediaStoreRef.current,
        (ratio, message) => {
        setExportProgress(ratio)
        setExportMessage(message)
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${projectName.replace(/[^\w\-]+/g, '_') || 'edited'}_output.mp4`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportMessage(
        err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.',
      )
    } finally {
      setIsExporting(false)
    }
  }, [projectName])

  const saveCurrentProject = useCallback(
    async (name?: string) => {
      const resolvedName = (name ?? projectName).trim() || 'Untitled timeline'
      try {
        const meta = await saveProjectVersion(userId, {
          id: activeSaveId ?? undefined,
          name: resolvedName,
          document: stateRef.current.document,
          mediaStore: mediaStoreRef.current,
          playhead: stateRef.current.ui.playhead,
          selectedClipId: stateRef.current.ui.selectedClipId,
          forceUploadMediaIds: forceUploadMediaIdsRef.current,
        })
        forceUploadMediaIdsRef.current.clear()
        setActiveSaveId(meta.id)
        setProjectName(meta.name)
        setIsDirty(false)
        const elementCount = collectAllElements(stateRef.current.document).length
        const elementSuffix =
          elementCount > 0
            ? ` (${elementCount} element${elementCount === 1 ? '' : 's'})`
            : ''
        setLibraryMessage(`Saved “${meta.name}”${elementSuffix}`)
        await refreshSavedProjects()
      } catch (err) {
        setLibraryMessage(`Save failed: ${formatSaveError(err)}`)
        throw err
      }
    },
    [
      userId,
      activeSaveId,
      projectName,
      refreshSavedProjects,
    ],
  )

  const saveProjectAs = useCallback(
    async (name: string) => {
      try {
        const meta = await saveProjectVersion(userId, {
          name,
          document: stateRef.current.document,
          mediaStore: mediaStoreRef.current,
          playhead: stateRef.current.ui.playhead,
          selectedClipId: stateRef.current.ui.selectedClipId,
          forceUploadMediaIds: forceUploadMediaIdsRef.current,
        })
        forceUploadMediaIdsRef.current.clear()
        setActiveSaveId(meta.id)
        setProjectName(meta.name)
        setIsDirty(false)
        const elementCount = collectAllElements(stateRef.current.document).length
        const elementSuffix =
          elementCount > 0
            ? ` (${elementCount} element${elementCount === 1 ? '' : 's'})`
            : ''
        setLibraryMessage(`Saved new version “${meta.name}”${elementSuffix}`)
        await refreshSavedProjects()
      } catch (err) {
        setLibraryMessage(`Save failed: ${formatSaveError(err)}`)
        throw err
      }
    },
    [userId, refreshSavedProjects],
  )

  const loadSavedProject = useCallback(
    async (id: string) => {
      const loaded = await loadProjectVersion(userId, id)
      if (!loaded) {
        setLibraryMessage('Could not open that saved timeline.')
        return
      }
      playbackController.pause()
      clearMediaStore(mediaStoreRef.current)
      const reprobedMediaStore = await reprobeMediaStore(loaded.mediaStore)
      setMediaStore(reprobedMediaStore)
      historyRef.current = createHistoryStacks()
      setHistoryTick((n) => n + 1)

      let document = migrateLoadedProject(loaded.document, reprobedMediaStore)
      if (!document.materials?.length) {
        const materials = Array.from(reprobedMediaStore.values()).map((asset) => ({
          id: asset.id,
          name: asset.file.name,
          kind: inferMaterialKind(asset.file, asset),
          origin: 'upload' as const,
          addedAt: Date.now(),
        }))
        document = { ...document, materials }
      }

      dispatch({
        type: 'LOAD_PROJECT',
        document,
        playhead: loaded.playhead,
        selectedClipId: loaded.selectedClipId,
      })
      playbackController.seek(loaded.playhead)
      setActiveSaveId(id)
      setProjectName(loaded.name)
      forceUploadMediaIdsRef.current.clear()
      setIsDirty(false)
      setLibraryMessage(`Opened “${loaded.name}”`)
      await refreshSavedProjects()
    },
    [refreshSavedProjects, userId],
  )

  const deleteSavedProject = useCallback(
    async (id: string) => {
      await deleteProjectVersion(userId, id)
      if (activeSaveId === id) {
        setActiveSaveId(null)
      }
      setLibraryMessage('Deleted saved timeline.')
      await refreshSavedProjects()
    },
    [activeSaveId, refreshSavedProjects, userId],
  )

  const newProject = useCallback(() => {
    playbackController.pause()
    clearMediaStore(mediaStoreRef.current)
    setMediaStore(new Map())
    historyRef.current = createHistoryStacks()
    setHistoryTick((n) => n + 1)
    dispatch({ type: 'RESET_PROJECT' })
    setActiveSaveId(null)
    setProjectName('Untitled timeline')
    forceUploadMediaIdsRef.current.clear()
    setIsDirty(false)
    setLibraryMessage('Started a new timeline.')
  }, [])

  const updateProjectName = useCallback((name: string) => {
    setProjectName(name)
    setIsDirty(true)
  }, [])

  const value = useMemo(
    (): ProjectContextValue => ({
      state,
      dispatch,
      mediaStore,
      importFiles,
      importRecordingFile,
      addMaterialAsset,
      addMaterialToTimeline,
      removeMaterial,
      detachAudioFromSelected,
      addTtsAudio,
      replaceTtsAudio,
      beginTtsEdit,
      clearTtsEdit,
      ttsEdit,
      generateTtsAndAdd,
      exportVideo,
      exportProgress,
      exportMessage,
      isExporting,
      primaryFps,
      primaryAsset,
      projectName,
      setProjectName: updateProjectName,
      activeSaveId,
      savedProjects,
      refreshSavedProjects,
      saveCurrentProject,
      saveProjectAs,
      loadSavedProject,
      deleteSavedProject,
      newProject,
      libraryMessage,
      effectEditorMode,
      openEffectEditor,
      closeEffectEditor,
      canFreezeFrame,
      freezeFrameAtPlayhead,
      undo,
      redo,
      canUndo,
      canRedo,
      recordUndoSnapshot: pushUndoSnapshot,
      elementsPanelOpen,
      setElementsPanelOpen,
    }),
    [
      state,
      mediaStore,
      importFiles,
      importRecordingFile,
      addMaterialAsset,
      addMaterialToTimeline,
      removeMaterial,
      detachAudioFromSelected,
      addTtsAudio,
      replaceTtsAudio,
      beginTtsEdit,
      clearTtsEdit,
      ttsEdit,
      generateTtsAndAdd,
      exportVideo,
      exportProgress,
      exportMessage,
      isExporting,
      primaryFps,
      primaryAsset,
      projectName,
      activeSaveId,
      savedProjects,
      refreshSavedProjects,
      saveCurrentProject,
      saveProjectAs,
      loadSavedProject,
      deleteSavedProject,
      newProject,
      libraryMessage,
      effectEditorMode,
      openEffectEditor,
      closeEffectEditor,
      canFreezeFrame,
      freezeFrameAtPlayhead,
      undo,
      redo,
      canUndo,
      canRedo,
      pushUndoSnapshot,
      elementsPanelOpen,
    ],
  )

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext)
  if (!ctx) {
    throw new Error('useProject must be used within ProjectProvider')
  }
  return ctx
}

export function useTimelineDuration(): number {
  const { state } = useProject()
  return totalDuration(state.document)
}
