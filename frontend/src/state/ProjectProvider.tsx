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
import { importDebug } from '../debug/importDebug'
import { probeMediaFile, revokeMediaAsset } from '../media/probe'
import { inferMaterialKind, probeFileAsMaterial } from '../media/materialHelpers'
import { playbackController } from '../playback/PlaybackController'
import type { MaterialKind, MaterialOrigin, MediaAsset, MediaStore } from '../types/project'
import { getVideoTrack, sortedClips, totalDuration } from '../timeline/helpers'
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

export type EffectEditorMode = 'camera' | 'red-box' | null

interface ProjectContextValue {
  state: ProjectState
  dispatch: React.Dispatch<ProjectAction>
  mediaStore: MediaStore
  importFiles: (files: FileList | File[]) => Promise<void>
  importRecordingFile: (
    file: File,
    options?: { addToTimeline?: boolean; name?: string },
  ) => Promise<MediaAsset>
  addMaterialAsset: (params: {
    file: File
    name?: string
    kind: MaterialKind
    origin: MaterialOrigin
    addFirstVideoToTimeline?: boolean
  }) => Promise<MediaAsset>
  addMaterialToTimeline: (materialId: string, track: 'video' | 'audio') => void
  removeMaterial: (materialId: string) => void
  detachAudioFromSelected: () => void
  addTtsAudio: (blob: Blob, fileName: string, timelineStart: number) => Promise<void>
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
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

function clearMediaStore(store: MediaStore): void {
  for (const asset of store.values()) {
    revokeMediaAsset(asset)
  }
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [state, dispatch] = useReducer(projectReducer, undefined, createInitialState)
  const [mediaStore, setMediaStore] = useState<MediaStore>(() => new Map())
  const [exportProgress, setExportProgress] = useState(0)
  const [exportMessage, setExportMessage] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [projectName, setProjectName] = useState('Untitled timeline')
  const [activeSaveId, setActiveSaveId] = useState<string | null>(null)
  const [savedProjects, setSavedProjects] = useState<SavedProjectMeta[]>([])
  const [libraryMessage, setLibraryMessage] = useState('')
  const [effectEditorMode, setEffectEditorMode] = useState<EffectEditorMode>(null)
  const mediaStoreRef = useRef(mediaStore)
  mediaStoreRef.current = mediaStore
  const stateRef = useRef(state)
  stateRef.current = state

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

  const refreshSavedProjects = useCallback(async () => {
    const list = await listSavedProjects(userId)
    setSavedProjects(list)
  }, [userId])

  useEffect(() => {
    void refreshSavedProjects()
  }, [refreshSavedProjects])

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

  const registerMaterialInStore = useCallback((asset: MediaAsset) => {
    importDebug('registerMaterialInStore', {
      assetId: asset.id,
      fileName: asset.file.name,
      duration: asset.duration,
      storeSizeBefore: mediaStoreRef.current.size,
    })
    const next = new Map(mediaStoreRef.current)
    next.set(asset.id, asset)
    mediaStoreRef.current = next
    flushSync(() => {
      setMediaStore(next)
    })
    importDebug('registerMaterialInStore done', { storeSizeAfter: next.size })
  }, [])

  const addMaterialAsset = useCallback(
    async (params: {
      file: File
      name?: string
      kind: MaterialKind
      origin: MaterialOrigin
      addFirstVideoToTimeline?: boolean
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
      options?: { addToTimeline?: boolean; name?: string },
    ): Promise<MediaAsset> => {
      setLibraryMessage('Importing recording…')
      try {
        const { asset, kind } = await probeFileAsMaterial(file)
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
    async (blob: Blob, fileName: string, timelineStart: number) => {
      const file = new File([blob], fileName, { type: blob.type || 'audio/mpeg' })
      const asset = await probeMediaFile(file)
      setMediaStore((prev) => {
        const next = new Map(prev)
        next.set(asset.id, asset)
        return next
      })
      dispatch({ type: 'ADD_TTS_CLIP', asset, timelineStart })
      setLibraryMessage('Added TTS clip to timeline.')
    },
    [],
  )

  const generateTtsAndAdd = useCallback(
    async (params: { inputText: string; voiceId: string; rate: string }) => {
      const blob = await generateAkoolTts({
        inputText: params.inputText,
        voiceId: params.voiceId,
        rate: params.rate,
      })
      const timelineStart = state.ui.playhead
      const safeName = `tts_${Date.now()}.mp3`
      await addTtsAudio(blob, safeName, timelineStart)
    },
    [addTtsAudio, state.ui.playhead],
  )

  const exportVideo = useCallback(async () => {
    setIsExporting(true)
    setExportProgress(0)
    setExportMessage('Starting export…')
    try {
      const blob = await exportProjectToMp4(state.document, mediaStore, (ratio, message) => {
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
  }, [state.document, mediaStore, projectName])

  const saveCurrentProject = useCallback(
    async (name?: string) => {
      const resolvedName = (name ?? projectName).trim() || 'Untitled timeline'
      const meta = await saveProjectVersion(userId, {
        id: activeSaveId ?? undefined,
        name: resolvedName,
        document: state.document,
        mediaStore,
        playhead: state.ui.playhead,
        selectedClipId: state.ui.selectedClipId,
      })
      setActiveSaveId(meta.id)
      setProjectName(meta.name)
      setLibraryMessage(`Saved “${meta.name}”`)
      await refreshSavedProjects()
    },
    [
      userId,
      activeSaveId,
      mediaStore,
      projectName,
      refreshSavedProjects,
      state.document,
      state.ui.playhead,
      state.ui.selectedClipId,
    ],
  )

  const saveProjectAs = useCallback(
    async (name: string) => {
      const meta = await saveProjectVersion(userId, {
        name,
        document: state.document,
        mediaStore,
        playhead: state.ui.playhead,
        selectedClipId: state.ui.selectedClipId,
      })
      setActiveSaveId(meta.id)
      setProjectName(meta.name)
      setLibraryMessage(`Saved new version “${meta.name}”`)
      await refreshSavedProjects()
    },
    [
      userId,
      mediaStore,
      refreshSavedProjects,
      state.document,
      state.ui.playhead,
      state.ui.selectedClipId,
    ],
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
      setMediaStore(loaded.mediaStore)

      let document = loaded.document
      if (!document.materials?.length) {
        const materials = Array.from(loaded.mediaStore.values()).map((asset) => ({
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
      setActiveSaveId(id)
      setProjectName(loaded.name)
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
    dispatch({ type: 'RESET_PROJECT' })
    setActiveSaveId(null)
    setProjectName('Untitled timeline')
    setLibraryMessage('Started a new timeline.')
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
      generateTtsAndAdd,
      exportVideo,
      exportProgress,
      exportMessage,
      isExporting,
      primaryFps,
      primaryAsset,
      projectName,
      setProjectName,
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
