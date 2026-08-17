import { useState } from 'react'

import type { ElementEffect, TimelineClip } from '../types/project'
import { playbackController } from '../playback/PlaybackController'

const ELEMENT_TIMELINE_ROW_HEIGHT = 28
const ELEMENT_TIMELINE_FIRST_ROW_TOP = 142

interface Props {
  clip: TimelineClip
  effect: ElementEffect
  pxPerSecond: number
  rowIndex: number
  selected?: boolean
  onSelect?: () => void
  onTrim: (side: 'start' | 'end', timelineTime: number) => void
}

function elementTimelineLabel(effect: ElementEffect): string {
  if (effect.kind === 'text') {
    return effect.text.slice(0, 16) || 'Text'
  }
  if (effect.kind === 'image') {
    return 'Image'
  }
  return effect.shape === 'ellipse' ? 'Ellipse' : 'Shape'
}

export function ElementTimelineItem({
  clip,
  effect,
  pxPerSecond,
  rowIndex,
  selected = false,
  onSelect,
  onTrim,
}: Props) {
  const [trimming, setTrimming] = useState<'start' | 'end' | null>(null)
  const left = (clip.timelineStart + effect.startOffset) * pxPerSecond
  const width = Math.max(4, (effect.endOffset - effect.startOffset) * pxPerSecond)

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

  return (
    <div
      className={`element-timeline-item${selected ? ' element-timeline-item-selected' : ''}`}
      style={{
        left,
        width,
        top: ELEMENT_TIMELINE_FIRST_ROW_TOP + rowIndex * ELEMENT_TIMELINE_ROW_HEIGHT,
      }}
      onClick={() => onSelect?.()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect?.()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span>{elementTimelineLabel(effect)}</span>
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
