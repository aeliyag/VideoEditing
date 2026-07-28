import { useCallback, useMemo, useRef, useState } from 'react'

import { useProject } from '../state/ProjectProvider'
import { getVideoTrack, sortedClips, clipTimelineEnd } from '../timeline/helpers'
import { playbackController } from '../playback/PlaybackController'
import { TimelineClipBlock } from './TimelineClip'
import { AnnotationTimelineItem } from './AnnotationTimelineItem'
import { isRedBoxEffect } from '../types/project'

const PX_PER_SECOND = 80

export function Timeline() {
  const { state, dispatch, primaryFps, primaryAsset, mediaStore } = useProject()
  const trackRef = useRef<HTMLDivElement>(null)
  const [draggingPlayhead, setDraggingPlayhead] = useState(false)

  const track = getVideoTrack(state.document)
  const clips = track ? sortedClips(track) : []
  const duration = clips.reduce((max, c) => Math.max(max, clipTimelineEnd(c)), 0)
  const width = Math.max(duration * PX_PER_SECOND, 400)

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
    const step = duration > 60 ? 10 : duration > 20 ? 5 : 1
    for (let t = 0; t <= duration; t += step) {
      marks.push(t)
    }
    return marks
  }, [duration])

  if (!track || clips.length === 0) {
    return (
      <section className="timeline-panel">
        <p className="timeline-empty">Timeline appears after you import a video.</p>
      </section>
    )
  }

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
        className="timeline-track"
        style={{ width }}
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
              onTrim={(side, timelineTime) =>
                dispatch({
                  type: 'TRIM_RED_BOX',
                  clipId: clip.id,
                  effectId: effect.id,
                  side,
                  timelineTime,
                })
              }
            />
          )),
        )}
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
        Click to seek · drag clips to reorder · trim video and red-box bars by their edges
      </p>
    </section>
  )
}

export { PX_PER_SECOND }
