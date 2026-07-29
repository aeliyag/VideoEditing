import { useRef, useState } from 'react'

import { playbackController } from '../playback/PlaybackController'
import { TtsPanel } from './TtsPanel'
import { useProject } from '../state/ProjectProvider'
import { getVideoTrack, sortedClips } from '../timeline/helpers'

function formatSavedDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    state,
    dispatch,
    importVideo,
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
  } = useProject()

  const [libraryOpen, setLibraryOpen] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)

  const track = getVideoTrack(state.document)
  const hasClips = (track?.clips.length ?? 0) > 0

  const onImportClick = () => fileInputRef.current?.click()

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      await importVideo(file)
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
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={onFileChange}
      />
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
        <button type="button" className="btn" onClick={onImportClick}>
          Import
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
          disabled={!state.ui.selectedClipId}
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
      <TtsPanel />
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
