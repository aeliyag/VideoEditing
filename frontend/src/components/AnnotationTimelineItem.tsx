import { useState } from 'react'

import type { RedBoxEffect, TimelineClip } from '../types/project'
import { playbackController } from '../playback/PlaybackController'

interface Props {
  clip: TimelineClip
  effect: RedBoxEffect
  pxPerSecond: number
  onTrim: (side: 'start' | 'end', timelineTime: number) => void
}

export function AnnotationTimelineItem({
  clip,
  effect,
  pxPerSecond,
  onTrim,
}: Props) {
  const [trimming, setTrimming] = useState<'start' | 'end' | null>(null)
  const left = (clip.timelineStart + effect.startOffset) * pxPerSecond
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

  return (
    <div className="annotation-timeline-item" style={{ left, width }}>
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
