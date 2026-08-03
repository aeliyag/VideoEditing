import { useState } from 'react'

import { importDebug } from '../debug/importDebug'
import { playbackController } from '../playback/PlaybackController'
import { AkoolToolsPanel } from './AkoolToolsPanel'
import { useAuth } from '../state/AuthProvider'
import { useProject } from '../state/ProjectProvider'
import { getVideoTrack, isAudioClipId, resolveDeleteClipId, sortedClips } from '../timeline/helpers'

function formatSavedDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function Toolbar() {
  const { user, signOut } = useAuth()
  const {
    state,
    dispatch,
    exportVideo,
    isExporting,
    exportProgress,
    exportMessage,
    primaryFps,
    projectName,
    setProjectName,
    activeSaveId,
    savedProjects,
    saveCurrentProject,
    saveProjectAs,
    loadSavedProject,
    deleteSavedProject,
    newProject,
    libraryMessage,
    detachAudioFromSelected,
    mediaStore,
    importFiles,
  } = useProject()

  const [libraryOpen, setLibraryOpen] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)

  const track = getVideoTrack(state.document)
  const hasClips = (track?.clips.length ?? 0) > 0
  const selectedClip = state.ui.selectedClipId
    ? state.document.tracks.flatMap((t) => t.clips).find((c) => c.id === state.ui.selectedClipId)
    : undefined
  const selectedAsset = selectedClip ? mediaStore.get(selectedClip.sourceId) : undefined
  const canDetachAudio =
    selectedClip &&
    !isAudioClipId(state.document, selectedClip.id) &&
    selectedAsset?.hasAudio &&
    !selectedClip.muteVideoAudio
  const canDeleteClip = Boolean(
    resolveDeleteClipId(state.document, state.ui.playhead, state.ui.selectedClipId),
  )

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    importDebug('Toolbar onChange fired', {
      rawFileCount: event.target.files?.length ?? 0,
    })
    const list = Array.from(event.target.files ?? [])
    event.target.value = ''
    importDebug('Toolbar files captured', {
      count: list.length,
      files: list.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    })
    if (list.length > 0) {
      await importFiles(list)
    } else {
      importDebug('Toolbar: no files in list after capture')
    }
  }

  const onSave = async () => {
    setSaveBusy(true)
    try {
      await saveCurrentProject()
    } finally {
      setSaveBusy(false)
    }
  }

  const onSaveAs = async () => {
    const name = window.prompt('Name this timeline version', projectName)
    if (!name?.trim()) {
      return
    }
    setSaveBusy(true)
    try {
      await saveProjectAs(name.trim())
      setLibraryOpen(true)
    } finally {
      setSaveBusy(false)
    }
  }

  const onNew = () => {
    if (
      hasClips &&
      !window.confirm('Start a new timeline? Unsaved changes on this version will be lost.')
    ) {
      return
    }
    newProject()
  }

  return (
    <header className="toolbar">
      <div className="project-name-row">
        <label className="project-name-label">
          Timeline
          <input
            className="project-name-input"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Untitled timeline"
          />
        </label>
        {activeSaveId && <span className="project-save-badge">Saved version</span>}
        <div className="toolbar-user">
          <span className="toolbar-user-email">{user?.email}</span>
          <button type="button" className="btn btn-small" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
      <div className="toolbar-actions">
        <button type="button" className="btn" onClick={onNew}>
          New
        </button>
        <button type="button" className="btn" onClick={() => setLibraryOpen((v) => !v)}>
          {libraryOpen ? 'Hide library' : 'Open library'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={saveBusy}
          onClick={() => void onSave()}
        >
          {saveBusy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={saveBusy}
          onClick={() => void onSaveAs()}
        >
          Save as…
        </button>
        <label className="btn" htmlFor="toolbar-file-input">
          Import files
        </label>
        <input
          id="toolbar-file-input"
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          className="sr-only-file"
          onChange={(e) => void onFileChange(e)}
        />
        <button
          type="button"
          className="btn"
          disabled={!canDetachAudio}
          onClick={() => detachAudioFromSelected()}
        >
          Detach audio
        </button>
        <button
          type="button"
          className="btn"
          disabled={!hasClips}
          onClick={() => dispatch({ type: 'SPLIT_AT_PLAYHEAD', fps: primaryFps })}
        >
          Split
        </button>
        <button
          type="button"
          className="btn"
          disabled={!canDeleteClip}
          onClick={() => dispatch({ type: 'DELETE_SELECTED' })}
        >
          Delete
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!hasClips || isExporting}
          onClick={() => void exportVideo()}
        >
          {isExporting ? 'Exporting…' : 'Export'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!hasClips}
          onClick={() => playbackController.togglePlay()}
        >
          {state.ui.isPlaying ? 'Pause' : 'Play'}
        </button>
      </div>
      <AkoolToolsPanel />
      {(isExporting || exportMessage.startsWith('Export failed')) && (
        <div className="export-status">
          {isExporting && (
            <div className="export-bar">
              <div
                className="export-bar-fill"
                style={{ width: `${exportProgress * 100}%` }}
              />
            </div>
          )}
          <span>{exportMessage}</span>
        </div>
      )}
      {(libraryMessage || hasClips) && (
        <p className="toolbar-meta">
          {libraryMessage ? `${libraryMessage} · ` : ''}
          {hasClips && track
            ? `${sortedClips(track).length} clip(s) · playhead ${state.ui.playhead.toFixed(2)}s`
            : 'Empty timeline'}
        </p>
      )}
      {libraryOpen && (
        <div className="project-library">
          <h3 className="frame-bank-title">Saved timelines</h3>
          {savedProjects.length === 0 ? (
            <p className="crop-panel-hint">
              No saved versions yet. Use Save or Save as… to keep a timeline (video
              included).
            </p>
          ) : (
            <ul className="project-library-list">
              {savedProjects.map((project) => (
                <li
                  key={project.id}
                  className={`project-library-item ${
                    project.id === activeSaveId ? 'project-library-item-active' : ''
                  }`}
                >
                  <div>
                    <strong>{project.name}</strong>
                    <p className="crop-panel-hint">
                      {formatSavedDate(project.updatedAt)} · {project.clipCount} clip(s)
                      · {project.duration.toFixed(1)}s
                      {project.hasMedia ? '' : ' · no media'}
                    </p>
                  </div>
                  <div className="frame-bank-buttons">
                    <button
                      type="button"
                      className="btn btn-small btn-primary"
                      onClick={() => void loadSavedProject(project.id)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-danger"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete saved timeline “${project.name}”? This cannot be undone.`,
                          )
                        ) {
                          void deleteSavedProject(project.id)
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </header>
  )
}
