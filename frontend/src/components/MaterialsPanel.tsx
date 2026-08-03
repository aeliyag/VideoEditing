import { useEffect } from 'react'

import { importDebug } from '../debug/importDebug'
import { materialLabel } from '../media/materialHelpers'
import type { MaterialEntry } from '../types/project'
import { useProject } from '../state/ProjectProvider'

function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return '—'
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function MaterialThumb({ material }: { material: MaterialEntry }) {
  const { mediaStore } = useProject()
  const asset = mediaStore.get(material.id)
  if (!asset) {
    return <div className="material-thumb material-thumb-empty" />
  }

  if (material.kind === 'image') {
    return <img className="material-thumb" src={asset.objectUrl} alt="" />
  }

  if (material.kind === 'audio') {
    return <div className="material-thumb material-thumb-audio">♪</div>
  }

  return (
    <video
      className="material-thumb"
      src={asset.objectUrl}
      muted
      playsInline
      preload="metadata"
    />
  )
}

function MaterialRow({ material }: { material: MaterialEntry }) {
  const { mediaStore, addMaterialToTimeline, removeMaterial } = useProject()
  const asset = mediaStore.get(material.id)

  return (
    <li className="material-item">
      <MaterialThumb material={material} />
      <div className="material-item-body">
        <strong className="material-item-name" title={material.name}>
          {material.name}
        </strong>
        <p className="material-item-meta">
          {material.kind} · {materialLabel(material.origin)}
          {asset ? ` · ${formatDuration(asset.duration)}` : ''}
        </p>
        <div className="material-item-actions">
          {material.kind !== 'audio' && (
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={() => addMaterialToTimeline(material.id, 'video')}
            >
              + Video
            </button>
          )}
          {(material.kind === 'audio' || material.kind === 'video') && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => addMaterialToTimeline(material.id, 'audio')}
            >
              + Audio
            </button>
          )}
          <button
            type="button"
            className="btn btn-small btn-danger"
            onClick={() => removeMaterial(material.id)}
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  )
}

export function MaterialsPanel() {
  const { state, importFiles, libraryMessage } = useProject()
  const materials = state.document.materials ?? []

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    importDebug('MaterialsPanel onChange fired', {
      rawFileCount: event.target.files?.length ?? 0,
    })
    const list = Array.from(event.target.files ?? [])
    event.target.value = ''
    importDebug('MaterialsPanel files captured', {
      count: list.length,
      files: list.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    })
    if (list.length > 0) {
      await importFiles(list)
    } else {
      importDebug('MaterialsPanel: no files in list after capture (Safari input bug?)')
    }
  }

  useEffect(() => {
    importDebug('MaterialsPanel render', {
      materialsCount: materials.length,
      names: materials.map((m) => m.name),
      libraryMessage,
    })
  }, [materials, libraryMessage])

  return (
    <aside className="materials-panel">
      <div className="materials-panel-header">
        <h2 className="materials-panel-title">Materials</h2>
        <label className="btn btn-small btn-primary" htmlFor="materials-file-input">
          Import
        </label>
        <input
          id="materials-file-input"
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          className="sr-only-file"
          onChange={(e) => void onFileChange(e)}
        />
      </div>
      <p className="materials-panel-hint">
        Import multiple files — videos and audio are added to the timeline at the playhead
        automatically.
      </p>
      {libraryMessage && (
        <p
          className={`materials-import-status ${
            libraryMessage.startsWith('Import failed') ? 'materials-import-error' : ''
          }`}
        >
          {libraryMessage}
        </p>
      )}
      {materials.length === 0 ? (
        <p className="materials-panel-empty">No materials yet. Import or generate content.</p>
      ) : (
        <ul className="materials-list">
          {materials.map((material) => (
            <MaterialRow key={material.id} material={material} />
          ))}
        </ul>
      )}
    </aside>
  )
}
