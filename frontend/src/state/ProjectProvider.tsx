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

import { exportProjectToMp4 } from '../export/ExportEngine'
import { probeMediaFile, revokeMediaAsset } from '../media/probe'
import { playbackController } from '../playback/PlaybackController'
import type { MediaAsset, MediaStore } from '../types/project'
import { getVideoTrack, sortedClips, totalDuration } from '../timeline/helpers'
import {
  deleteProjectVersion,
  listSavedProjects,
  loadProjectVersion,
  saveProjectVersion,
  type SavedProjectMeta,
} from '../storage/projectLibrary'
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
  importVideo: (file: File) => Promise<void>
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

  const openEffectEditor = useCallback((mode: Exclude<EffectEditorMode, null>) => {
    playbackController.pause()
    setEffectEditorMode(mode)
  }, [])

  const closeEffectEditor = useCallback(() => {
    setEffectEditorMode(null)
  }, [])

  const primaryAsset = useMemo(() => {
    const track = getVideoTrack(state.document)
    const first = track ? sortedClips(track)[0] : undefined
    if (!first) {
      return undefined
    }
    return mediaStore.get(first.sourceId)
  }, [state.document, mediaStore])

  const primaryFps = primaryAsset?.fps ?? 30

  const refreshSavedProjects = useCallback(async () => {
    const list = await listSavedProjects()
    setSavedProjects(list)
  }, [])

  useEffect(() => {
    void refreshSavedProjects()
  }, [refreshSavedProjects])

  useEffect(() => {
    playbackController.setProject(state.document, mediaStore)
  }, [state.document, mediaStore])

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

  const importVideo = useCallback(async (file: File) => {
    clearMediaStore(mediaStoreRef.current)
    const asset = await probeMediaFile(file)
    setMediaStore(new Map([[asset.id, asset]]))
    dispatch({ type: 'IMPORT_MEDIA', asset })
    setLibraryMessage('')
  }, [])

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
      const meta = await saveProjectVersion({
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
      const meta = await saveProjectVersion({
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
      mediaStore,
      refreshSavedProjects,
      state.document,
      state.ui.playhead,
      state.ui.selectedClipId,
    ],
  )

  const loadSavedProject = useCallback(
    async (id: string) => {
      const loaded = await loadProjectVersion(id)
      if (!loaded) {
        setLibraryMessage('Could not open that saved timeline.')
        return
      }
      playbackController.pause()
      clearMediaStore(mediaStoreRef.current)
      setMediaStore(loaded.mediaStore)
      dispatch({
        type: 'LOAD_PROJECT',
        document: loaded.document,
        playhead: loaded.playhead,
        selectedClipId: loaded.selectedClipId,
      })
      setActiveSaveId(id)
      setProjectName(loaded.name)
      setLibraryMessage(`Opened “${loaded.name}”`)
      await refreshSavedProjects()
    },
    [refreshSavedProjects],
  )

  const deleteSavedProject = useCallback(
    async (id: string) => {
      await deleteProjectVersion(id)
      if (activeSaveId === id) {
        setActiveSaveId(null)
      }
      setLibraryMessage('Deleted saved timeline.')
      await refreshSavedProjects()
    },
    [activeSaveId, refreshSavedProjects],
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
      importVideo,
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
      importVideo,
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
