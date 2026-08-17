import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'

import { useProject } from '../state/ProjectProvider'
import { getVideoTrack, getAudioTrack, sortedClips, totalDuration } from '../timeline/helpers'
import { playbackController } from '../playback/PlaybackController'
import { TimelineClipBlock } from './TimelineClip'
import { AudioTimelineClip } from './AudioTimelineClip'
import { AnnotationTimelineItem } from './AnnotationTimelineItem'
import { ElementTimelineItem } from './ElementTimelineItem'
import { isElementEffect, isRedBoxEffect } from '../types/project'

const PX_PER_SECOND = 80
/** Empty space after the last clip so freeze frames / stills can be dragged longer. */
const TIMELINE_END_PAD_SECONDS = 8

export function Timeline() {
  const { state, dispatch, primaryFps, primaryAsset, mediaStore, openEffectEditor } =
    useProject()
  const trackRef = useRef<HTMLDivElement>(null)
  const [draggingPlayhead, setDraggingPlayhead] = useState(false)

  const track = getVideoTrack(state.document)
  const audioTrack = getAudioTrack(state.document)
  const clips = track ? sortedClips(track) : []
  const audioClips = audioTrack ? sortedClips(audioTrack) : []
  const duration = totalDuration(state.document)
  const width = Math.max((duration + TIMELINE_END_PAD_SECONDS) * PX_PER_SECOND, 400)

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el) {
        return 0
      }
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left + el.scrollLeft
      return Math.max(0, Math.min(x / PX_PER_SECOND, duration))
    },
    [duration],
  )

  const onTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return
    }
    const time = timeFromClientX(event.clientX)
    playbackController.pause()
    playbackController.seek(time)
    dispatch({ type: 'SET_PLAYHEAD', time })
    dispatch({ type: 'SELECT_CLIP', clipId: null })
  }

  const onPlayheadPointerDown = (event: React.PointerEvent) => {
    event.stopPropagation()
    setDraggingPlayhead(true)
    playbackController.pause()
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onPlayheadPointerMove = (event: React.PointerEvent) => {
    if (!draggingPlayhead) {
      return
    }
    const time = timeFromClientX(event.clientX)
    playbackController.seek(time)
    dispatch({ type: 'SET_PLAYHEAD', time })
  }

  const onPlayheadPointerUp = (event: React.PointerEvent) => {
    setDraggingPlayhead(false)
    ;(event.target as HTMLElement).releasePointerCapture(event.pointerId)
  }

  const playheadLeft = state.ui.playhead * PX_PER_SECOND

  const rulerMarks = useMemo(() => {
    const marks: number[] = []
    const rulerEnd = duration + TIMELINE_END_PAD_SECONDS
    const step = duration > 60 ? 10 : duration > 20 ? 5 : 1
    for (let t = 0; t <= rulerEnd; t += step) {
      marks.push(t)
    }
    return marks
  }, [duration])

  const timelineElements = clips.flatMap((clip) =>
    [...clip.effects]
      .filter(isElementEffect)
      .sort((a, b) => a.z - b.z)
      .map((effect) => ({ clip, effect })),
  )
  const extraElementRows = Math.max(0, timelineElements.length - 1)

  if (!track || clips.length === 0) {
    return (
      <section className="timeline-panel">
        <p className="timeline-empty">
          Import a video via the Materials panel or toolbar — it will appear here automatically.
        </p>
      </section>
    )
  }

  const hasAudioLane = audioClips.length > 0
  const trackStyle = {
    width,
    ['--extra-element-rows' as string]: String(extraElementRows),
  } as CSSProperties

  return (
    <section className="timeline-panel">
      <div className="timeline-ruler" style={{ width }}>
        {rulerMarks.map((t) => (
          <span key={t} className="ruler-mark" style={{ left: t * PX_PER_SECOND }}>
            {t}s
          </span>
        ))}
      </div>
      <div
        ref={trackRef}
        className={`timeline-track${hasAudioLane ? ' timeline-track-with-audio' : ''}${
          timelineElements.length > 0 ? ' timeline-track-with-elements' : ''
        }`}
        style={trackStyle}
        onPointerDown={onTrackPointerDown}
      >
        {clips.map((clip) => {
          const asset = mediaStore.get(clip.sourceId)
          return (
            <TimelineClipBlock
              key={clip.id}
              clip={clip}
              pxPerSecond={PX_PER_SECOND}
              selected={state.ui.selectedClipId === clip.id}
              mediaDuration={asset?.duration ?? primaryAsset?.duration ?? 0}
              fps={asset?.fps ?? primaryFps}
              onSelect={() => dispatch({ type: 'SELECT_CLIP', clipId: clip.id })}
              onDelete={() => dispatch({ type: 'DELETE_CLIP', clipId: clip.id })}
              onTrim={(side, edgeTimelineTime) =>
                dispatch({
                  type: 'TRIM_CLIP',
                  clipId: clip.id,
                  side,
                  edgeTimelineTime,
                  mediaDuration: asset?.duration ?? primaryAsset?.duration ?? 0,
                  fps: asset?.fps ?? primaryFps,
                })
              }
              onReorder={(provisionalTimelineStart) =>
                dispatch({
                  type: 'REORDER_CLIP',
                  clipId: clip.id,
                  provisionalTimelineStart,
                })
              }
            />
          )
        })}
        <div className="annotation-row-label">Overlays</div>
        {clips.flatMap((clip) =>
          clip.effects.filter(isRedBoxEffect).map((effect) => (
            <AnnotationTimelineItem
              key={effect.id}
              clip={clip}
              effect={effect}
              pxPerSecond={PX_PER_SECOND}
              selected={state.ui.selectedRedBoxEffectId === effect.id}
              onSelect={() =>
                dispatch({ type: 'SELECT_RED_BOX', clipId: clip.id, effectId: effect.id })
              }
              onOpen={() => {
                dispatch({ type: 'SELECT_RED_BOX', clipId: clip.id, effectId: effect.id })
                openEffectEditor('red-box')
              }}
              onTrim={(side, timelineTime) =>
                dispatch({
                  type: 'TRIM_RED_BOX',
                  clipId: clip.id,
                  effectId: effect.id,
                  side,
                  timelineTime,
                })
              }
              onMove={(timelineStart) =>
                dispatch({
                  type: 'MOVE_RED_BOX',
                  clipId: clip.id,
                  effectId: effect.id,
                  timelineStart,
                })
              }
            />
          )),
        )}
        <div className="annotation-row-label elements-row-label">Elements</div>
        {timelineElements.map(({ clip, effect }, rowIndex) => (
            <ElementTimelineItem
              key={effect.id}
              clip={clip}
              effect={effect}
              pxPerSecond={PX_PER_SECOND}
              rowIndex={rowIndex}
              selected={state.ui.selectedElementId === effect.id}
              onSelect={() => {
                dispatch({ type: 'SELECT_ELEMENT', clipId: clip.id, elementId: effect.id })
              }}
              onTrim={(side, timelineTime) =>
                dispatch({
                  type: 'TRIM_CLIP_ELEMENT',
                  clipId: clip.id,
                  elementId: effect.id,
                  side,
                  timelineTime,
                })
              }
            />
        ))}
        {hasAudioLane && <div className="annotation-row-label audio-row-label">Audio</div>}
        {audioClips.map((clip) => {
          const asset = mediaStore.get(clip.sourceId)
          return (
            <AudioTimelineClip
              key={clip.id}
              clip={clip}
              pxPerSecond={PX_PER_SECOND}
              selected={state.ui.selectedClipId === clip.id}
              mediaDuration={asset?.duration ?? 0}
              fps={asset?.fps && asset.fps > 0 ? asset.fps : 30}
              onSelect={() => dispatch({ type: 'SELECT_CLIP', clipId: clip.id })}
              onDelete={() => dispatch({ type: 'DELETE_CLIP', clipId: clip.id })}
              onTrim={(side, edgeTimelineTime) =>
                dispatch({
                  type: 'TRIM_CLIP',
                  clipId: clip.id,
                  side,
                  edgeTimelineTime,
                  mediaDuration: asset?.duration ?? 0,
                  fps: asset?.fps && asset.fps > 0 ? asset.fps : 30,
                })
              }
              onMove={(timelineStart) =>
                dispatch({
                  type: 'MOVE_AUDIO_CLIP',
                  clipId: clip.id,
                  timelineStart,
                })
              }
            />
          )
        })}
        <div
          className="playhead"
          style={{ left: playheadLeft }}
          onPointerDown={onPlayheadPointerDown}
          onPointerMove={onPlayheadPointerMove}
          onPointerUp={onPlayheadPointerUp}
          role="slider"
          aria-valuenow={state.ui.playhead}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-label="Playhead"
        />
      </div>
      <p className="timeline-hint">
        Click to seek · select a clip · Delete/Backspace removes · drag to reorder · drag trim
        handles to shorten or extend clips · drag a red box to re-time it, double-click to edit ·
        Cmd/Ctrl+Z to undo
      </p>
    </section>
  )
}

export { PX_PER_SECOND }
