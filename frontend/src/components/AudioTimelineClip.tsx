import { useRef, useState } from 'react'

import type { TimelineClip } from '../types/project'
import { clipDuration } from '../timeline/helpers'
import { playbackController } from '../playback/PlaybackController'

interface AudioTimelineClipProps {
  clip: TimelineClip
  pxPerSecond: number
  selected: boolean
  mediaDuration: number
  fps: number
  onSelect: () => void
  onDelete: () => void
  onTrim: (side: 'start' | 'end', edgeTimelineTime: number) => void
  onMove: (timelineStart: number) => void
}

export function AudioTimelineClip({
  clip,
  pxPerSecond,
  selected,
  onSelect,
  onDelete,
  onTrim,
  onMove,
}: AudioTimelineClipProps) {
  const [trimming, setTrimming] = useState<'start' | 'end' | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragStartX = useRef(0)
  const [dragDeltaPx, setDragDeltaPx] = useState(0)

  const baseLeft = clip.timelineStart * pxPerSecond
  const left = baseLeft + (dragging ? dragDeltaPx : 0)
  const width = Math.max(clipDuration(clip) * pxPerSecond, 4)

  const onTrimPointerDown = (side: 'start' | 'end') => (event: React.PointerEvent) => {
    event.stopPropagation()
    setTrimming(side)
    playbackController.pause()
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onTrimPointerMove = (event: React.PointerEvent) => {
    if (!trimming) {
      return
    }
    const track = (event.target as HTMLElement).closest('.timeline-track')
    if (!track) {
      return
    }
    const rect = track.getBoundingClientRect()
    const x = event.clientX - rect.left + track.scrollLeft
    const time = Math.max(0, x / pxPerSecond)
    onTrim(trimming, time)
  }

  const onTrimPointerUp = (event: React.PointerEvent) => {
    setTrimming(null)
    ;(event.target as HTMLElement).releasePointerCapture(event.pointerId)
  }

  const onBodyPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('.clip-delete-btn')) {
      return
    }
    if ((event.target as HTMLElement).classList.contains('trim-handle')) {
      return
    }
    event.stopPropagation()
    onSelect()
    setDragging(true)
    dragStartX.current = event.clientX
    setDragDeltaPx(0)
    playbackController.pause()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onBodyPointerMove = (event: React.PointerEvent) => {
    if (!dragging) {
      return
    }
    setDragDeltaPx(event.clientX - dragStartX.current)
  }

  const onBodyPointerUp = (event: React.PointerEvent) => {
    if (!dragging) {
      return
    }
    const deltaTime = (event.clientX - dragStartX.current) / pxPerSecond
    onMove(Math.max(0, clip.timelineStart + deltaTime))
    setDragging(false)
    setDragDeltaPx(0)
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  }

  return (
    <div
      className={`timeline-clip timeline-clip-audio ${selected ? 'timeline-clip-selected' : ''} ${dragging ? 'timeline-clip-dragging' : ''}`}
      style={{ left, width }}
      onPointerDown={onBodyPointerDown}
      onPointerMove={onBodyPointerMove}
      onPointerUp={onBodyPointerUp}
    >
      <span className="timeline-clip-label">Voice</span>
      {selected && (
        <button
          type="button"
          className="clip-delete-btn"
          title="Delete clip"
          aria-label="Delete clip"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          ×
        </button>
      )}
      <div
        className="trim-handle trim-handle-start"
        onPointerDown={onTrimPointerDown('start')}
        onPointerMove={onTrimPointerMove}
        onPointerUp={onTrimPointerUp}
      />
      <div
        className="trim-handle trim-handle-end"
        onPointerDown={onTrimPointerDown('end')}
        onPointerMove={onTrimPointerMove}
        onPointerUp={onTrimPointerUp}
      />
    </div>
  )
}
