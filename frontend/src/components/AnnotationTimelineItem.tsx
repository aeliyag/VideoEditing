import { useRef, useState } from 'react'

import type { RedBoxEffect, TimelineClip } from '../types/project'
import { playbackController } from '../playback/PlaybackController'

/** Below this the press counts as a click, not a move, so double-clicks don't re-time the box. */
const DRAG_THRESHOLD_PX = 3

interface Props {
  clip: TimelineClip
  effect: RedBoxEffect
  pxPerSecond: number
  selected?: boolean
  onSelect?: () => void
  onOpen?: () => void
  onTrim: (side: 'start' | 'end', timelineTime: number) => void
  onMove?: (timelineStart: number) => void
}

export function AnnotationTimelineItem({
  clip,
  effect,
  pxPerSecond,
  selected = false,
  onSelect,
  onOpen,
  onTrim,
  onMove,
}: Props) {
  const [trimming, setTrimming] = useState<'start' | 'end' | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dragDeltaPx, setDragDeltaPx] = useState(0)
  const dragStartX = useRef(0)

  const baseLeft = (clip.timelineStart + effect.startOffset) * pxPerSecond
  const left = baseLeft + (dragging ? dragDeltaPx : 0)
  const width = Math.max(
    4,
    (effect.endOffset - effect.startOffset) * pxPerSecond,
  )

  const onPointerDown =
    (side: 'start' | 'end') => (event: React.PointerEvent) => {
      event.stopPropagation()
      playbackController.pause()
      setTrimming(side)
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!trimming) {
      return
    }
    const track = (event.currentTarget as HTMLElement).closest('.timeline-track')
    if (!track) {
      return
    }
    const rect = track.getBoundingClientRect()
    const timelineTime = Math.max(0, (event.clientX - rect.left) / pxPerSecond)
    onTrim(trimming, timelineTime)
  }

  const onPointerUp = (event: React.PointerEvent) => {
    setTrimming(null)
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  }

  const onBodyPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('.annotation-trim')) {
      return
    }
    event.stopPropagation()
    onSelect?.()
    setDragging(true)
    setDragDeltaPx(0)
    dragStartX.current = event.clientX
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
    const deltaPx = event.clientX - dragStartX.current
    setDragging(false)
    setDragDeltaPx(0)
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
    if (Math.abs(deltaPx) < DRAG_THRESHOLD_PX) {
      return
    }
    onMove?.(
      Math.max(
        0,
        clip.timelineStart + effect.startOffset + deltaPx / pxPerSecond,
      ),
    )
  }

  return (
    <div
      className={`annotation-timeline-item${selected ? ' annotation-timeline-item-selected' : ''}${
        dragging ? ' annotation-timeline-item-dragging' : ''
      }`}
      style={{ left, width }}
      onPointerDown={onBodyPointerDown}
      onPointerMove={onBodyPointerMove}
      onPointerUp={onBodyPointerUp}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onOpen?.()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen?.()
        }
      }}
      role="button"
      tabIndex={0}
      title="Drag to move · double-click to edit"
    >
      <span>Red box</span>
      <div
        className="annotation-trim annotation-trim-start"
        onPointerDown={onPointerDown('start')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div
        className="annotation-trim annotation-trim-end"
        onPointerDown={onPointerDown('end')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  )
}
