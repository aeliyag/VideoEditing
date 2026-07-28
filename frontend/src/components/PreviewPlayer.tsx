import { useCallback, useEffect, useRef, useState } from 'react'

import {
  getCameraEffect,
  getClipCameraRectAtTimelineTime,
  resolveFrameRect,
  FULL_FRAME_RECT,
  CAMERA_ASPECT,
  clampCameraRect,
  clampFreeRect,
  cropRectToVideoTransform,
} from '../camera/frames'
import { clipAtTime, findClipById } from '../timeline/helpers'
import { playbackController } from '../playback/PlaybackController'
import { useProject } from '../state/ProjectProvider'
import type { FrameRect } from '../types/project'
import { isRedBoxEffect } from '../types/project'

type CameraSlot = 'start' | 'end'

interface EditableRectProps {
  rect: FrameRect
  display: { x: number; y: number; width: number; height: number }
  className: string
  onChange: (rect: FrameRect) => void
  /** Pixel aspect width/height. Camera uses 16/9; omit for free-form (red box). */
  pixelAspect?: number
  sourceWidth?: number
  sourceHeight?: number
}

function EditableRect({
  rect,
  display,
  className,
  onChange,
  pixelAspect,
  sourceWidth = 1920,
  sourceHeight = 1080,
}: EditableRectProps) {
  const px = rectToPixel(rect, display, pixelAspect, sourceWidth, sourceHeight)

  const startDrag = (event: React.PointerEvent) => {
    const startX = event.clientX
    const startY = event.clientY
    const startRect = { ...px }
    const onMove = (e: PointerEvent) => {
      onChange(
        pixelRectToNormalized(
          {
            ...startRect,
            x: startRect.x + e.clientX - startX,
            y: startRect.y + e.clientY - startY,
          },
          display,
          pixelAspect,
          sourceWidth,
          sourceHeight,
        ),
      )
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startResize =
    (corner: 'nw' | 'ne' | 'sw' | 'se') => (event: React.PointerEvent) => {
      event.stopPropagation()
      const startX = event.clientX
      const startY = event.clientY
      const startRect = { ...px }
      const lockSquare = !pixelAspect && event.shiftKey
      const aspect = pixelAspect ?? (lockSquare ? 1 : undefined)
      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        let x = startRect.x
        let y = startRect.y
        let width = startRect.width
        let height = startRect.height

        if (aspect) {
          const delta =
            corner === 'se'
              ? Math.max(dx, dy * aspect)
              : corner === 'nw'
                ? Math.max(-dx, -dy * aspect)
                : corner === 'ne'
                  ? Math.max(dx, -dy * aspect)
                  : Math.max(-dx, dy * aspect)
          width = Math.max(20, startRect.width + delta)
          height = width / aspect
          if (corner === 'nw' || corner === 'sw') {
            x = startRect.x + startRect.width - width
          }
          if (corner === 'nw' || corner === 'ne') {
            y = startRect.y + startRect.height - height
          }
        } else {
          if (corner === 'nw' || corner === 'sw') {
            x = startRect.x + dx
            width = startRect.width - dx
          } else {
            width = startRect.width + dx
          }
          if (corner === 'nw' || corner === 'ne') {
            y = startRect.y + dy
            height = startRect.height - dy
          } else {
            height = startRect.height + dy
          }
          width = Math.max(20, width)
          height = Math.max(20, height)
        }

        onChange(
          pixelRectToNormalized(
            { x, y, width, height },
            display,
            aspect === 1 && !pixelAspect ? undefined : pixelAspect,
            sourceWidth,
            sourceHeight,
            aspect === 1 && !pixelAspect,
          ),
        )
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

  return (
    <div
      className={className}
      style={{ left: px.x, top: px.y, width: px.width, height: px.height }}
      onPointerDown={startDrag}
    >
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <div
          key={corner}
          className={`crop-resize-handle crop-resize-${corner}`}
          onPointerDown={startResize(corner)}
        />
      ))}
    </div>
  )
}

function pixelRectToNormalized(
  px: { x: number; y: number; width: number; height: number },
  display: { x: number; y: number; width: number; height: number },
  pixelAspect: number | undefined,
  sourceWidth: number,
  sourceHeight: number,
  forceSquare = false,
): FrameRect {
  const raw = {
    x: (px.x - display.x) / display.width,
    y: (px.y - display.y) / display.height,
    width: px.width / display.width,
    height: px.height / display.height,
  }
  if (pixelAspect) {
    return clampCameraRect(raw, sourceWidth, sourceHeight, pixelAspect)
  }
  if (forceSquare) {
    const size = Math.max(0.02, Math.min(raw.width, raw.height))
    return clampFreeRect({ ...raw, width: size, height: size })
  }
  return clampFreeRect(raw)
}

function rectToPixel(
  rect: FrameRect,
  display: { x: number; y: number; width: number; height: number },
  pixelAspect: number | undefined,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number; width: number; height: number } {
  const r = pixelAspect
    ? clampCameraRect(rect, sourceWidth, sourceHeight, pixelAspect)
    : clampFreeRect(rect)
  return {
    x: display.x + r.x * display.width,
    y: display.y + r.y * display.height,
    width: r.width * display.width,
    height: r.height * display.height,
  }
}

export function PreviewPlayer() {
  const {
    state,
    dispatch,
    primaryAsset,
    effectEditorMode: editorMode,
    openEffectEditor,
    closeEffectEditor,
  } = useProject()
  const videoRef = useRef<HTMLVideoElement>(null)
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
  const [redBoxDraft, setRedBoxDraft] = useState<FrameRect>({
    x: 0.25,
    y: 0.25,
    width: 0.35,
    height: 0.25,
  })
  const [displayRect, setDisplayRect] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [saveNotice, setSaveNotice] = useState('')

  const sourceWidth = primaryAsset?.width || 1920
  const sourceHeight = primaryAsset?.height || 1080

  const selectedClip = state.ui.selectedClipId
    ? findClipById(state.document, state.ui.selectedClipId)
    : undefined

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
    openEffectEditor(mode)
  }

  useEffect(() => {
    playbackController.setVideoElement(videoRef.current)
    return () => playbackController.setVideoElement(null)
  }, [primaryAsset?.id])

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
    const redBox = selectedClip.effects.find(isRedBoxEffect)
    if (redBox) {
      setRedBoxDraft(redBox.rect)
    }
  }, [selectedClip?.id, editorMode, sourceWidth, sourceHeight])

  const updateDisplayRect = useCallback(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    // Video uses object-fit: fill and fills the stage, so crop coords map 1:1.
    setDisplayRect({
      x: 0,
      y: 0,
      width: stage.clientWidth,
      height: stage.clientHeight,
    })
  }, [])

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
  }, [updateDisplayRect, primaryAsset?.id, editorMode])

  const activeClip =
    clipAtTime(state.document, state.ui.playhead) ?? selectedClip ?? undefined

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
      : activeClip
        ? getClipCameraRectAtTimelineTime(
            state.document,
            activeClip,
            state.ui.playhead,
            sourceWidth,
            sourceHeight,
          )
        : FULL_FRAME_RECT

  const savedRedBox = activeClip?.effects.find(isRedBoxEffect)
  const activeClipOffset = activeClip
    ? state.ui.playhead - activeClip.timelineStart
    : 0
  const savedRedBoxVisible =
    savedRedBox &&
    activeClipOffset >= (savedRedBox.startOffset ?? 0) &&
    activeClipOffset <=
      (savedRedBox.endOffset ??
        activeClip!.sourceEnd - activeClip!.sourceStart)
  const visibleRedBox =
    editorMode === 'red-box' && selectedClip && !state.ui.isPlaying
      ? redBoxDraft
      : savedRedBoxVisible
        ? savedRedBox.rect
        : undefined

  const aspect =
    primaryAsset && primaryAsset.width > 0
      ? `${primaryAsset.width} / ${primaryAsset.height}`
      : '16 / 9'

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
              style={{ aspectRatio: aspect }}
            >
              <video
                ref={videoRef}
                className="preview-video"
                style={{
                  transform: cropRectToVideoTransform(previewRect),
                  transformOrigin: '0 0',
                }}
                playsInline
                muted={false}
                controls={false}
              />
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
              {visibleRedBox && displayRect.width > 0 &&
                (editorMode === 'red-box' && selectedClip && !state.ui.isPlaying ? (
                  <EditableRect
                    rect={visibleRedBox}
                    display={displayRect}
                    className="red-box-overlay red-box-editing"
                    onChange={setRedBoxDraft}
                    sourceWidth={sourceWidth}
                    sourceHeight={sourceHeight}
                  />
                ) : (
                  <div
                    className="red-box-overlay"
                    style={{
                      left: rectToPixel(
                        visibleRedBox,
                        displayRect,
                        undefined,
                        sourceWidth,
                        sourceHeight,
                      ).x,
                      top: rectToPixel(
                        visibleRedBox,
                        displayRect,
                        undefined,
                        sourceWidth,
                        sourceHeight,
                      ).y,
                      width: rectToPixel(
                        visibleRedBox,
                        displayRect,
                        undefined,
                        sourceWidth,
                        sourceHeight,
                      ).width,
                      height: rectToPixel(
                        visibleRedBox,
                        displayRect,
                        undefined,
                        sourceWidth,
                        sourceHeight,
                      ).height,
                    }}
                  />
                ))}
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
                  to a square, or use Make square.
                </p>
                <div className="crop-panel-actions">
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
                    onClick={() =>
                      dispatch({
                        type: 'SET_CLIP_RED_BOX',
                        clipId: selectedClip.id,
                        rect: redBoxDraft,
                        timelinePlayhead: state.ui.playhead,
                      })
                    }
                  >
                    Save red box
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() =>
                      dispatch({
                        type: 'REMOVE_CLIP_RED_BOX',
                        clipId: selectedClip.id,
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </>
            )}
          </aside>
        )}
      </section>
    </>
  )
}
