import { useMemo, useRef, useState } from 'react'

import { ELEMENT_FONT_OPTIONS } from '../elements/elementStyle'
import { clipElements } from './ElementsLayer'
import { useProject } from '../state/ProjectProvider'
import type { ElementEffect, TextElementEffect } from '../types/project'
import { isElementEffect } from '../types/project'
import { findClipById } from '../timeline/helpers'

const DEFAULT_ELEMENT_RECT = {
  x: 0.3,
  y: 0.3,
  width: 0.35,
  height: 0.2,
}

function defaultTextElement(): Omit<
  ElementEffect,
  'id' | 'z' | 'startOffset' | 'endOffset' | 'type'
> {
  return {
    kind: 'text',
    rect: { ...DEFAULT_ELEMENT_RECT },
    opacity: 1,
    text: 'Your text',
    fontScale: 0.05,
    fontFamily: ELEMENT_FONT_OPTIONS[0],
    fontWeight: 600,
    color: '#ffffff',
    align: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  }
}

function defaultShapeElement(shape: 'rect' | 'ellipse'): Omit<
  ElementEffect,
  'id' | 'z' | 'startOffset' | 'endOffset' | 'type'
> {
  return {
    kind: 'shape',
    shape,
    rect: { ...DEFAULT_ELEMENT_RECT, height: 0.18 },
    opacity: 0.85,
    fill: shape === 'rect' ? 'rgba(59,130,246,0.55)' : 'rgba(236,72,153,0.45)',
    stroke: '#ffffff',
    strokeWidth: 3,
  }
}

function elementSummary(element: ElementEffect): string {
  if (element.kind === 'text') {
    return element.text.slice(0, 32) || 'Text'
  }
  if (element.kind === 'image') {
    return 'Image'
  }
  return element.shape === 'ellipse' ? 'Ellipse' : 'Rectangle'
}

export function ElementsPanel() {
  const {
    state,
    dispatch,
    importFiles,
    recordUndoSnapshot,
    elementsPanelOpen,
    setElementsPanelOpen,
  } = useProject()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imagePickerOpen, setImagePickerOpen] = useState(false)

  const selectedClip = state.ui.selectedClipId
    ? findClipById(state.document, state.ui.selectedClipId)
    : undefined

  const clipElementsList = useMemo(() => {
    if (!selectedClip) {
      return []
    }
    return clipElements(selectedClip).sort((a, b) => b.z - a.z)
  }, [selectedClip])

  const selectedElement = useMemo(() => {
    if (!selectedClip || !state.ui.selectedElementId) {
      return undefined
    }
    return selectedClip.effects.find(
      (effect): effect is ElementEffect =>
        isElementEffect(effect) && effect.id === state.ui.selectedElementId,
    )
  }, [selectedClip, state.ui.selectedElementId])

  const imageMaterials = (state.document.materials ?? []).filter((m) => m.kind === 'image')

  const addElement = (
    element: Omit<ElementEffect, 'id' | 'z' | 'startOffset' | 'endOffset' | 'type'>,
  ) => {
    if (!selectedClip) {
      return
    }
    recordUndoSnapshot()
    dispatch({
      type: 'ADD_CLIP_ELEMENT',
      clipId: selectedClip.id,
      element,
      timelinePlayhead: state.ui.playhead,
    })
  }

  const updateSelected = (patch: Partial<Omit<ElementEffect, 'type' | 'id'>>) => {
    if (!selectedClip || !selectedElement) {
      return
    }
    dispatch({
      type: 'UPDATE_CLIP_ELEMENT',
      clipId: selectedClip.id,
      elementId: selectedElement.id,
      patch,
    })
  }

  return (
    <aside className="elements-panel">
      <div className="elements-panel-header">
        <h2 className="materials-title">Elements</h2>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => setElementsPanelOpen(!elementsPanelOpen)}
        >
          {elementsPanelOpen ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {!elementsPanelOpen ? (
        <p className="elements-panel-hint">Expand to add overlays on the selected clip.</p>
      ) : !selectedClip ? (
        <p className="elements-panel-hint">Select a clip to add elements.</p>
      ) : (
        <>
          <div className="elements-add-row">
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={() => addElement(defaultTextElement())}
            >
              Text
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => addElement(defaultShapeElement('rect'))}
            >
              Rectangle
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => addElement(defaultShapeElement('ellipse'))}
            >
              Ellipse
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setImagePickerOpen((open) => !open)}
            >
              Image…
            </button>
          </div>

          {imagePickerOpen && (
            <div className="elements-image-picker">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const files = event.target.files
                  if (files?.length) {
                    void importFiles(files)
                  }
                  event.target.value = ''
                }}
              />
              {imageMaterials.length === 0 ? (
                <p className="elements-panel-hint">No images in materials yet.</p>
              ) : (
                <ul className="elements-image-list">
                  {imageMaterials.map((material) => (
                    <li key={material.id}>
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => {
                          addElement({
                            kind: 'image',
                            sourceId: material.id,
                            rect: { x: 0.25, y: 0.25, width: 0.4, height: 0.35 },
                            opacity: 1,
                          })
                          setImagePickerOpen(false)
                        }}
                      >
                        {material.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ul className="elements-list">
            {clipElementsList.map((element) => (
              <li
                key={element.id}
                className={`elements-list-item${
                  state.ui.selectedElementId === element.id ? ' elements-list-item-selected' : ''
                }`}
              >
                <button
                  type="button"
                  className="elements-list-select"
                  onClick={() =>
                    dispatch({
                      type: 'SELECT_ELEMENT',
                      clipId: selectedClip.id,
                      elementId: element.id,
                    })
                  }
                >
                  {elementSummary(element)}
                </button>
                <div className="elements-list-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    title="Bring forward"
                    onClick={() => {
                      recordUndoSnapshot()
                      dispatch({
                        type: 'REORDER_CLIP_ELEMENT',
                        clipId: selectedClip.id,
                        elementId: element.id,
                        direction: 'forward',
                      })
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    title="Send backward"
                    onClick={() => {
                      recordUndoSnapshot()
                      dispatch({
                        type: 'REORDER_CLIP_ELEMENT',
                        clipId: selectedClip.id,
                        elementId: element.id,
                        direction: 'backward',
                      })
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    onClick={() => {
                      recordUndoSnapshot()
                      dispatch({
                        type: 'REMOVE_CLIP_ELEMENT',
                        clipId: selectedClip.id,
                        elementId: element.id,
                      })
                    }}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {selectedElement && (
            <div className="elements-inspector">
              <h3 className="elements-inspector-title">Properties</h3>
              {selectedElement.kind === 'text' && (
                <p className="elements-panel-hint">
                  Edit the text below, or click the overlay on the preview to move and resize it.
                </p>
              )}
              <label className="elements-field">
                Opacity
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={selectedElement.opacity}
                  onChange={(event) =>
                    updateSelected({ opacity: Number(event.target.value) })
                  }
                />
              </label>

              {selectedElement.kind === 'text' && (
                <>
                  <label className="elements-field">
                    Text
                    <textarea
                      rows={3}
                      value={selectedElement.text}
                      onChange={(event) => updateSelected({ text: event.target.value })}
                    />
                  </label>
                  <label className="elements-field">
                    Font size
                    <input
                      type="range"
                      min={0.02}
                      max={0.12}
                      step={0.005}
                      value={selectedElement.fontScale}
                      onChange={(event) =>
                        updateSelected({ fontScale: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="elements-field">
                    Font
                    <select
                      value={selectedElement.fontFamily}
                      onChange={(event) => updateSelected({ fontFamily: event.target.value })}
                    >
                      {ELEMENT_FONT_OPTIONS.map((font) => (
                        <option key={font} value={font}>
                          {font.split(',')[0]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="elements-field">
                    Color
                    <input
                      type="color"
                      value={selectedElement.color}
                      onChange={(event) => updateSelected({ color: event.target.value })}
                    />
                  </label>
                  <label className="elements-field">
                    Background
                    <input
                      type="color"
                      value={selectedElement.backgroundColor ?? '#000000'}
                      onChange={(event) =>
                        updateSelected({ backgroundColor: event.target.value })
                      }
                    />
                  </label>
                  <label className="elements-field">
                    Align
                    <select
                      value={selectedElement.align}
                      onChange={(event) =>
                        updateSelected({
                          align: event.target.value as TextElementEffect['align'],
                        })
                      }
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                </>
              )}

              {selectedElement.kind === 'shape' && (
                <>
                  <label className="elements-field">
                    Fill
                    <input
                      type="color"
                      value={selectedElement.fill ?? '#3b82f6'}
                      onChange={(event) => updateSelected({ fill: event.target.value })}
                    />
                  </label>
                  <label className="elements-field">
                    Stroke
                    <input
                      type="color"
                      value={selectedElement.stroke ?? '#ffffff'}
                      onChange={(event) => updateSelected({ stroke: event.target.value })}
                    />
                  </label>
                  <label className="elements-field">
                    Stroke width
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={selectedElement.strokeWidth}
                      onChange={(event) =>
                        updateSelected({ strokeWidth: Number(event.target.value) })
                      }
                    />
                  </label>
                </>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  )
}
