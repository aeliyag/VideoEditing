import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import {
  getCameraEffect,
  getClipCameraRectAtTimelineTime,
  resolveFrameRect,
  FULL_FRAME_RECT,
  CAMERA_ASPECT,
  clampCameraRect,
  clampFreeRect,
  cropRectToPreviewLayout,
} from '../camera/frames'
import { clipAtTime, findClipById, mediaRectInContainer } from '../timeline/helpers'
import { playbackController } from '../playback/PlaybackController'
import {
  isImagePreviewClip,
  materialForClip,
  resolvePreviewObjectUrl,
  shouldApplyCameraPreview,
} from '../preview/resolvePreviewMedia'
import { EditableRect, rectToPixel } from './EditableRect'
import { ElementsLayer } from './ElementsLayer'
import { useProject } from '../state/ProjectProvider'
import type { FrameRect, RedBoxEffect } from '../types/project'
import { isRedBoxEffect } from '../types/project'

type CameraSlot = 'start' | 'end'

const DEFAULT_RED_BOX_DRAFT: FrameRect = {
  x: 0.25,
  y: 0.25,
  width: 0.35,
  height: 0.25,
}

function redBoxVisibleAtOffset(effect: RedBoxEffect, offset: number): boolean {
  return offset >= effect.startOffset && offset <= effect.endOffset
}

export function PreviewPlayer() {
  const {
    state,
    dispatch,
    primaryAsset,
    mediaStore,
    effectEditorMode: editorMode,
    openEffectEditor,
    closeEffectEditor,
    recordUndoSnapshot,
  } = useProject()
  const audioRef = useRef<HTMLAudioElement>(null)
  const setVideoNode = useCallback((node: HTMLVideoElement | null) => {
    playbackController.setVideoElement(node)
  }, [])
  const stageRef = useRef<HTMLDivElement>(null)
  const [cameraSlot, setCameraSlot] = useState<CameraSlot>('start')
  const [startDraft, setStartDraft] = useState<{ rect: FrameRect; name: string }>({
    rect: FULL_FRAME_RECT,
    name: 'Start frame',
  })
  const [endDraft, setEndDraft] = useState<{ rect: FrameRect; name: string } | null>(
    null,
  )
  const [includeEnd, setIncludeEnd] = useState(false)
  const [redBoxDraft, setRedBoxDraft] = useState<FrameRect>(DEFAULT_RED_BOX_DRAFT)
  const [displayRect, setDisplayRect] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [activeClipDisplayRect, setActiveClipDisplayRect] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  })
  const [saveNotice, setSaveNotice] = useState('')

  const sourceWidth = primaryAsset?.width || 1920
  const sourceHeight = primaryAsset?.height || 1080

  const selectedClip = state.ui.selectedClipId
    ? findClipById(state.document, state.ui.selectedClipId)
    : undefined

  const activeClip =
    clipAtTime(state.document, state.ui.playhead) ?? selectedClip ?? undefined

  const activeAsset = activeClip
    ? mediaStore.get(activeClip.sourceId)
    : undefined

  const isImagePreview = Boolean(
    activeClip && activeAsset && isImagePreviewClip(state.document, activeClip, activeAsset),
  )

  const previewUrl = useMemo(() => {
    if (!activeAsset) {
      return ''
    }
    return resolvePreviewObjectUrl(activeAsset)
  }, [activeAsset, mediaStore])

  const openEditor = (mode: 'camera' | 'red-box') => {
    const target =
      selectedClip ?? clipAtTime(state.document, state.ui.playhead)
    if (!target) {
      return
    }
    if (target.id !== state.ui.selectedClipId) {
      dispatch({ type: 'SELECT_CLIP', clipId: target.id })
    }
    setSaveNotice('')
    if (mode === 'red-box') {
      const clipOffset = state.ui.playhead - target.timelineStart
      const atPlayhead = target.effects
        .filter(isRedBoxEffect)
        .find((effect) => redBoxVisibleAtOffset(effect, clipOffset))
      dispatch({
        type: 'SELECT_RED_BOX',
        clipId: target.id,
        effectId: atPlayhead?.id ?? null,
      })
      setRedBoxDraft(atPlayhead?.rect ?? DEFAULT_RED_BOX_DRAFT)
    }
    openEffectEditor(mode)
  }

  useEffect(() => {
    playbackController.setAudioElement(audioRef.current)
    return () => playbackController.setAudioElement(null)
  }, [])

  useEffect(() => {
    if (!selectedClip) {
      setStartDraft({ rect: FULL_FRAME_RECT, name: 'Start frame' })
      setEndDraft(null)
      setIncludeEnd(false)
      return
    }
    const camera = getCameraEffect(selectedClip)
    const startRect = resolveFrameRect(
      state.document,
      camera?.startFrameId ?? null,
      sourceWidth,
      sourceHeight,
    )
    const startPreset = state.document.frameBank.find(
      (f) => f.id === camera?.startFrameId,
    )
    setStartDraft({
      rect: startRect,
      name: startPreset?.name ?? 'Start frame',
    })
    if (camera?.endFrameId) {
      const endPreset = state.document.frameBank.find((f) => f.id === camera.endFrameId)
      setEndDraft({
        rect: resolveFrameRect(
          state.document,
          camera.endFrameId,
          sourceWidth,
          sourceHeight,
        ),
        name: endPreset?.name ?? 'End frame',
      })
      setIncludeEnd(true)
    } else {
      setEndDraft(null)
      setIncludeEnd(false)
    }
    setCameraSlot('start')
  }, [selectedClip?.id, editorMode, sourceWidth, sourceHeight])

  useEffect(() => {
    if (editorMode !== 'red-box' || !selectedClip || !state.ui.selectedRedBoxEffectId) {
      return
    }
    const selected = selectedClip.effects
      .filter(isRedBoxEffect)
      .find((effect) => effect.id === state.ui.selectedRedBoxEffectId)
    if (selected) {
      setRedBoxDraft(selected.rect)
    }
  }, [editorMode, selectedClip, state.ui.selectedRedBoxEffectId])

  const activeClipSourceWidth = activeAsset?.width || sourceWidth
  const activeClipSourceHeight = activeAsset?.height || sourceHeight

  const updateDisplayRect = useCallback(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    setDisplayRect(
      mediaRectInContainer(
        stage.clientWidth,
        stage.clientHeight,
        sourceWidth,
        sourceHeight,
      ),
    )
    setActiveClipDisplayRect(
      mediaRectInContainer(
        stage.clientWidth,
        stage.clientHeight,
        activeClipSourceWidth,
        activeClipSourceHeight,
      ),
    )
  }, [sourceWidth, sourceHeight, activeClipSourceWidth, activeClipSourceHeight])

  useEffect(() => {
    updateDisplayRect()
    const stage = stageRef.current
    if (!stage) {
      return
    }
    const observer = new ResizeObserver(() => updateDisplayRect())
    observer.observe(stage)
    window.addEventListener('resize', updateDisplayRect)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateDisplayRect)
    }
  }, [updateDisplayRect, primaryAsset?.id, editorMode, activeAsset?.id])

  useEffect(() => {
    if (!activeClip) {
      return
    }
    const material = materialForClip(state.document, activeClip)
    console.table({
      activeClipId: activeClip.id,
      materialId: activeClip.sourceId,
      materialType: material?.kind,
      materialOrigin: material?.origin,
      hasBlob: Boolean(activeAsset?.file),
      resolvedUrl: previewUrl,
    })
  }, [
    activeClip?.id,
    activeClip?.sourceId,
    activeAsset?.id,
    activeAsset?.file,
    previewUrl,
    state.document.materials,
  ])

  const applyCameraPreview = Boolean(
    activeClip &&
      activeAsset &&
      shouldApplyCameraPreview(state.document, activeClip, activeAsset),
  )

  const videoMuted = Boolean(activeClip?.muteVideoAudio)

  const activeDraftRect =
    cameraSlot === 'end' && endDraft ? endDraft.rect : startDraft.rect

  const setActiveDraftRect = (rect: FrameRect) => {
    if (cameraSlot === 'end') {
      setEndDraft((prev) => ({
        rect,
        name: prev?.name ?? 'End frame',
      }))
      setIncludeEnd(true)
    } else {
      setStartDraft((prev) => ({ ...prev, rect }))
    }
  }

  const previewRect =
    editorMode === 'camera' && selectedClip && !state.ui.isPlaying
      ? FULL_FRAME_RECT
      : activeClip && applyCameraPreview
        ? getClipCameraRectAtTimelineTime(
            state.document,
            activeClip,
            state.ui.playhead,
            sourceWidth,
            sourceHeight,
          )
        : FULL_FRAME_RECT

  const previewMediaLayout = cropRectToPreviewLayout(previewRect)

  const activeClipOffset = activeClip
    ? state.ui.playhead - activeClip.timelineStart
    : 0
  const previewClip =
    editorMode === 'red-box' && selectedClip ? selectedClip : activeClip
  const previewClipOffset = previewClip
    ? editorMode === 'red-box'
      ? state.ui.playhead - previewClip.timelineStart
      : activeClipOffset
    : 0
  const visibleSavedRedBoxes =
    previewClip?.effects.filter(isRedBoxEffect).filter((effect) =>
      redBoxVisibleAtOffset(effect, previewClipOffset),
    ) ?? []
  const editingRedBox = Boolean(
    editorMode === 'red-box' && selectedClip && !state.ui.isPlaying,
  )
  const otherVisibleRedBoxes = editingRedBox
    ? visibleSavedRedBoxes.filter(
        (effect) => effect.id !== state.ui.selectedRedBoxEffectId,
      )
    : visibleSavedRedBoxes
  const selectedRedBoxCount =
    selectedClip?.effects.filter(isRedBoxEffect).length ?? 0

  const renderStaticRedBox = (rect: FrameRect, key: string) => {
    const pixel = rectToPixel(
      rect,
      displayRect,
      undefined,
      sourceWidth,
      sourceHeight,
    )
    return (
      <div
        key={key}
        className="red-box-overlay"
        style={{
          left: pixel.x,
          top: pixel.y,
          width: pixel.width,
          height: pixel.height,
        }}
      />
    )
  }

  const aspect =
    primaryAsset && primaryAsset.width > 0 && primaryAsset.height > 0
      ? primaryAsset.width / primaryAsset.height
      : 16 / 9

  const stageStyle = {
    aspectRatio: `${primaryAsset?.width ?? 16} / ${primaryAsset?.height ?? 9}`,
    ['--preview-aspect' as string]: String(aspect),
  } as CSSProperties

  const saveCamera = () => {
    if (!selectedClip) {
      return
    }
    dispatch({
      type: 'SAVE_CLIP_CAMERA',
      clipId: selectedClip.id,
      start: {
        rect: clampCameraRect(startDraft.rect, sourceWidth, sourceHeight),
        name: startDraft.name.trim() || 'Start frame',
      },
      end:
        includeEnd && endDraft
          ? {
              rect: clampCameraRect(endDraft.rect, sourceWidth, sourceHeight),
              name: endDraft.name.trim() || 'End frame',
            }
          : null,
      sourceWidth,
      sourceHeight,
    })
    setSaveNotice(
      includeEnd && endDraft
        ? 'Saved Ken Burns (start → end). Close to preview.'
        : 'Saved static crop. Close to preview.',
    )
  }

  return (
    <>
      <audio ref={audioRef} className="hidden" preload="auto" />
      <div className="preview-tool-buttons">
        <button
          type="button"
          className="btn"
          disabled={!activeClip}
          onClick={() => openEditor('camera')}
        >
          Camera crop
        </button>
        <button
          type="button"
          className="btn"
          disabled={!activeClip}
          onClick={() => openEditor('red-box')}
        >
          Red-box annotation
        </button>
      </div>
      <section
        className={`preview-section ${editorMode ? 'effect-editor-open' : ''}`}
      >
        {editorMode && (
          <button
            type="button"
            className="btn effect-editor-close"
            onClick={() => closeEffectEditor()}
          >
            Done
          </button>
        )}
        <div className="preview-panel">
          {primaryAsset ? (
            <div
              ref={stageRef}
              className="preview-stage"
              style={stageStyle}
            >
              {isImagePreview && previewUrl ? (
                <img
                  key={`${activeClip?.id}:${previewUrl}`}
                  src={previewUrl}
                  className="preview-video preview-image"
                  alt=""
                  style={{
                    ...previewMediaLayout,
                  }}
                  onLoad={(event) => {
                    const img = event.currentTarget
                    console.log('[preview img] loaded', {
                      complete: img.complete,
                      naturalWidth: img.naturalWidth,
                      naturalHeight: img.naturalHeight,
                      src: img.currentSrc,
                    })
                  }}
                  onError={(event) => {
                    console.error('[preview img] error', {
                      src: event.currentTarget.currentSrc,
                      materialId: activeClip?.sourceId,
                    })
                  }}
                />
              ) : (
                <video
                  ref={setVideoNode}
                  className="preview-video"
                  style={{
                    ...previewMediaLayout,
                  }}
                  playsInline
                  muted={videoMuted}
                  controls={false}
                />
              )}
              {selectedClip &&
                editorMode === 'camera' &&
                !state.ui.isPlaying &&
                displayRect.width > 0 && (
                  <EditableRect
                    rect={activeDraftRect}
                    display={displayRect}
                    className="crop-overlay"
                    onChange={setActiveDraftRect}
                    pixelAspect={CAMERA_ASPECT}
                    sourceWidth={sourceWidth}
                    sourceHeight={sourceHeight}
                  />
                )}
              {otherVisibleRedBoxes.map((effect) =>
                renderStaticRedBox(effect.rect, effect.id),
              )}
              {editingRedBox && displayRect.width > 0 && (
                <EditableRect
                  rect={redBoxDraft}
                  display={displayRect}
                  className="red-box-overlay red-box-editing"
                  onChange={setRedBoxDraft}
                  sourceWidth={sourceWidth}
                  sourceHeight={sourceHeight}
                />
              )}
              {activeClip && activeClipDisplayRect.width > 0 && (
                <ElementsLayer
                  clip={activeClip}
                  clipOffset={activeClipOffset}
                  displayRect={activeClipDisplayRect}
                  sourceWidth={activeClipSourceWidth}
                  sourceHeight={activeClipSourceHeight}
                />
              )}
            </div>
          ) : (
            <div className="preview-placeholder">
              Import a video to begin editing
            </div>
          )}
        </div>

        {editorMode && selectedClip && primaryAsset && (
          <aside className="crop-panel">
            <h2 className="crop-panel-title">
              {editorMode === 'camera' ? 'Crop / Ken Burns' : 'Red-box annotation'}
            </h2>
            {editorMode === 'camera' ? (
              <>
                <p className="crop-panel-hint">
                  Camera crop is locked to 16:9. Position the start frame, optionally
                  an end frame for Ken Burns, then Save.
                </p>
                <div className="effect-tabs">
                  <button
                    type="button"
                    className={`btn btn-small ${cameraSlot === 'start' ? 'btn-primary' : ''}`}
                    onClick={() => setCameraSlot('start')}
                  >
                    Start frame
                  </button>
                  <button
                    type="button"
                    className={`btn btn-small ${cameraSlot === 'end' ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setCameraSlot('end')
                      if (!endDraft) {
                        setEndDraft({
                          rect: { ...startDraft.rect },
                          name: 'End frame',
                        })
                      }
                      setIncludeEnd(true)
                    }}
                  >
                    End frame (optional)
                  </button>
                </div>

                <label className="frame-name-label">
                  {cameraSlot === 'start' ? 'Start frame name' : 'End frame name'}
                  <input
                    className="frame-bank-name"
                    value={
                      cameraSlot === 'start'
                        ? startDraft.name
                        : (endDraft?.name ?? 'End frame')
                    }
                    onChange={(e) => {
                      const name = e.target.value
                      if (cameraSlot === 'start') {
                        setStartDraft((prev) => ({ ...prev, name }))
                      } else {
                        setEndDraft((prev) => ({
                          rect: prev?.rect ?? startDraft.rect,
                          name,
                        }))
                        setIncludeEnd(true)
                      }
                    }}
                  />
                </label>

                {includeEnd && (
                  <label className="frame-include-end">
                    <input
                      type="checkbox"
                      checked={includeEnd}
                      onChange={(e) => {
                        setIncludeEnd(e.target.checked)
                        if (!e.target.checked) {
                          setCameraSlot('start')
                        } else if (!endDraft) {
                          setEndDraft({
                            rect: { ...startDraft.rect },
                            name: 'End frame',
                          })
                        }
                      }}
                    />
                    Animate to end frame (Ken Burns)
                  </label>
                )}

                <div className="crop-panel-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={saveCamera}
                  >
                    Save to clip
                  </button>
                  {includeEnd && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setIncludeEnd(false)
                        setEndDraft(null)
                        setCameraSlot('start')
                      }}
                    >
                      Clear end
                    </button>
                  )}
                </div>
                {saveNotice && <p className="crop-panel-hint">{saveNotice}</p>}

                <h3 className="frame-bank-title">Frame bank</h3>
                {state.document.frameBank.length === 0 ? (
                  <p className="crop-panel-hint">
                    Saved frames appear here after you press Save.
                  </p>
                ) : (
                  <ul className="frame-bank-list">
                    {state.document.frameBank.map((frame) => (
                      <li key={frame.id} className="frame-bank-item">
                        <span className="frame-bank-name-static">{frame.name}</span>
                        <div className="frame-bank-buttons">
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => {
                              setStartDraft({
                                rect: frame.rect,
                                name: frame.name,
                              })
                              setCameraSlot('start')
                              dispatch({
                                type: 'APPLY_FRAME_TO_CLIP_START',
                                clipId: selectedClip.id,
                                frameId: frame.id,
                              })
                            }}
                          >
                            Use as start
                          </button>
                          <button
                            type="button"
                            className="btn btn-small"
                            onClick={() => {
                              setEndDraft({
                                rect: frame.rect,
                                name: frame.name,
                              })
                              setIncludeEnd(true)
                              setCameraSlot('end')
                              dispatch({
                                type: 'APPLY_FRAME_TO_CLIP_END',
                                clipId: selectedClip.id,
                                frameId: frame.id,
                              })
                            }}
                          >
                            Use as end
                          </button>
                          <button
                            type="button"
                            className="btn btn-small btn-danger"
                            onClick={() =>
                              dispatch({ type: 'DELETE_FRAME', frameId: frame.id })
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <p className="crop-panel-hint">
                  Drag freely for any rectangle. Hold Shift while resizing to snap
                  to a square, or use Make square. Save adds a new box; select an
                  overlay on the timeline to edit an existing one.
                  {selectedRedBoxCount > 0
                    ? ` This clip has ${selectedRedBoxCount} red box${selectedRedBoxCount === 1 ? '' : 'es'}.`
                    : ''}
                </p>
                <div className="crop-panel-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      dispatch({
                        type: 'SELECT_RED_BOX',
                        clipId: selectedClip.id,
                        effectId: null,
                      })
                      setRedBoxDraft(DEFAULT_RED_BOX_DRAFT)
                    }}
                  >
                    New box
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const size = Math.min(redBoxDraft.width, redBoxDraft.height)
                      setRedBoxDraft(
                        clampFreeRect({
                          ...redBoxDraft,
                          width: size,
                          height: size,
                        }),
                      )
                    }}
                  >
                    Make square
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      recordUndoSnapshot()
                      if (state.ui.selectedRedBoxEffectId) {
                        dispatch({
                          type: 'UPDATE_CLIP_RED_BOX',
                          clipId: selectedClip.id,
                          effectId: state.ui.selectedRedBoxEffectId,
                          rect: redBoxDraft,
                        })
                        setSaveNotice('Updated red box.')
                      } else {
                        dispatch({
                          type: 'ADD_CLIP_RED_BOX',
                          clipId: selectedClip.id,
                          rect: redBoxDraft,
                          timelinePlayhead: state.ui.playhead,
                        })
                        setSaveNotice('Saved red box to timeline.')
                      }
                    }}
                  >
                    {state.ui.selectedRedBoxEffectId ? 'Update red box' : 'Save red box'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!state.ui.selectedRedBoxEffectId}
                    onClick={() => {
                      if (!state.ui.selectedRedBoxEffectId) {
                        return
                      }
                      recordUndoSnapshot()
                      dispatch({
                        type: 'REMOVE_CLIP_RED_BOX',
                        clipId: selectedClip.id,
                        effectId: state.ui.selectedRedBoxEffectId,
                      })
                      dispatch({
                        type: 'SELECT_RED_BOX',
                        clipId: selectedClip.id,
                        effectId: null,
                      })
                      setRedBoxDraft(DEFAULT_RED_BOX_DRAFT)
                    }}
                  >
                    Remove
                  </button>
                </div>
                {saveNotice && <p className="crop-panel-hint">{saveNotice}</p>}
              </>
            )}
          </aside>
        )}
      </section>
    </>
  )
}
