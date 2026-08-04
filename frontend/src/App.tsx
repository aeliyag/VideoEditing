import { useEffect } from 'react'

import { AuthLoadingSplash, AuthPage } from './components/AuthPage'
import { MaterialsPanel } from './components/MaterialsPanel'
import { PreviewPlayer } from './components/PreviewPlayer'
import { Timeline } from './components/Timeline'
import { Toolbar } from './components/Toolbar'
import { isTypingTarget } from './keyboard/shortcuts'
import { clipAtTime } from './timeline/helpers'
import { playbackController } from './playback/PlaybackController'
import { AuthProvider, useAuth } from './state/AuthProvider'
import { ProjectProvider, useProject } from './state/ProjectProvider'

function EditorLayout() {
  const {
    state,
    dispatch,
    primaryFps,
    openEffectEditor,
    canFreezeFrame,
    freezeFrameAtPlayhead,
  } = useProject()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return
      }

      if (event.repeat) {
        const key = event.key.toLowerCase()
        if (key === 'f') {
          return
        }
      }

      const key = event.key.toLowerCase()

      if (event.code === 'Space' || key === ' ') {
        event.preventDefault()
        playbackController.togglePlay()
        return
      }

      if (key === 'c') {
        event.preventDefault()
        dispatch({ type: 'SPLIT_AT_PLAYHEAD', fps: primaryFps })
        return
      }

      if (key === 'f') {
        if (!canFreezeFrame) {
          return
        }
        event.preventDefault()
        void freezeFrameAtPlayhead()
        return
      }

      if (key === 'delete' || key === 'backspace') {
        event.preventDefault()
        dispatch({ type: 'DELETE_SELECTED' })
        return
      }

      if (key === 'b') {
        event.preventDefault()
        const clip =
          (state.ui.selectedClipId
            ? state.document.tracks
                .flatMap((t) => t.clips)
                .find((c) => c.id === state.ui.selectedClipId)
            : undefined) ?? clipAtTime(state.document, state.ui.playhead)
        if (!clip) {
          return
        }
        if (clip.id !== state.ui.selectedClipId) {
          dispatch({ type: 'SELECT_CLIP', clipId: clip.id })
        }
        openEffectEditor('red-box')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    canFreezeFrame,
    dispatch,
    freezeFrameAtPlayhead,
    openEffectEditor,
    primaryFps,
    state.document,
    state.ui.playhead,
    state.ui.selectedClipId,
  ])

  return (
    <div className="editor-app">
      <h1 className="editor-title">Video Timeline Editor</h1>
      <div className="editor-body">
        <MaterialsPanel />
        <div className="editor-main">
          <Toolbar />
          <PreviewPlayer />
          <Timeline />
        </div>
      </div>
    </div>
  )
}

function AuthenticatedApp() {
  const { session, loading } = useAuth()

  if (loading) {
    return <AuthLoadingSplash />
  }

  if (!session) {
    return <AuthPage />
  }

  return (
    <ProjectProvider>
      <EditorLayout />
    </ProjectProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  )
}
