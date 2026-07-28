import { useEffect } from 'react'

import { PreviewPlayer } from './components/PreviewPlayer'
import { Timeline } from './components/Timeline'
import { Toolbar } from './components/Toolbar'
import { clipAtTime } from './timeline/helpers'
import { playbackController } from './playback/PlaybackController'
import { ProjectProvider, useProject } from './state/ProjectProvider'

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  const tag = el?.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    Boolean(el?.isContentEditable)
  )
}

function EditorLayout() {
  const {
    state,
    dispatch,
    primaryFps,
    openEffectEditor,
  } = useProject()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return
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
    dispatch,
    openEffectEditor,
    primaryFps,
    state.document,
    state.ui.playhead,
    state.ui.selectedClipId,
  ])

  return (
    <div className="editor-app">
      <h1 className="editor-title">Video Timeline Editor</h1>
      <Toolbar />
      <PreviewPlayer />
      <Timeline />
    </div>
  )
}

export default function App() {
  return (
    <ProjectProvider>
      <EditorLayout />
    </ProjectProvider>
  )
}
