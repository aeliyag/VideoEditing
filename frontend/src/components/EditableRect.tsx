import type { ReactNode } from 'react'

import { clampCameraRect, clampFreeRect } from '../camera/frames'
import { clampOutputFrameRect, mapOutputFrameRectToPixel } from '../camera/overlayCoords'
import type { FrameRect } from '../types/project'

export function pixelRectToNormalized(
  px: { x: number; y: number; width: number; height: number },
  display: { x: number; y: number; width: number; height: number },
  pixelAspect: number | undefined,
  sourceWidth: number,
  sourceHeight: number,
  forceSquare = false,
  outputFrameSpace = false,
): FrameRect {
  const raw = {
    x: (px.x - display.x) / display.width,
    y: (px.y - display.y) / display.height,
    width: px.width / display.width,
    height: px.height / display.height,
  }
  if (outputFrameSpace) {
    if (forceSquare) {
      const size = Math.max(0.02, Math.min(raw.width, raw.height))
      return clampOutputFrameRect({ ...raw, width: size, height: size })
    }
    return clampOutputFrameRect(raw)
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

export function rectToPixel(
  rect: FrameRect,
  display: { x: number; y: number; width: number; height: number },
  pixelAspect: number | undefined,
  sourceWidth: number,
  sourceHeight: number,
  outputFrameSpace = false,
): { x: number; y: number; width: number; height: number } {
  if (outputFrameSpace) {
    return mapOutputFrameRectToPixel(clampOutputFrameRect(rect), display)
  }
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

interface EditableRectProps {
  rect: FrameRect
  display: { x: number; y: number; width: number; height: number }
  className: string
  onChange: (rect: FrameRect) => void
  /** Pixel aspect width/height. Camera uses 16/9; omit for free-form. */
  pixelAspect?: number
  sourceWidth?: number
  sourceHeight?: number
  /** When true, rect is normalized against the post-camera output frame. */
  outputFrameSpace?: boolean
  selected?: boolean
  onSelect?: () => void
  onDragStart?: () => void
  children?: ReactNode
}

export function EditableRect({
  rect,
  display,
  className,
  onChange,
  pixelAspect,
  sourceWidth = 1920,
  sourceHeight = 1080,
  outputFrameSpace = false,
  selected = false,
  onSelect,
  onDragStart,
  children,
}: EditableRectProps) {
  const px = rectToPixel(
    rect,
    display,
    pixelAspect,
    sourceWidth,
    sourceHeight,
    outputFrameSpace,
  )

  const startDrag = (event: React.PointerEvent) => {
    event.stopPropagation()
    onSelect?.()
    onDragStart?.()
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
          false,
          outputFrameSpace,
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
      onDragStart?.()
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

        const nextRect = pixelRectToNormalized(
          { x, y, width, height },
          display,
          aspect === 1 && !pixelAspect ? undefined : pixelAspect,
          sourceWidth,
          sourceHeight,
          aspect === 1 && !pixelAspect,
          outputFrameSpace,
        )

        onChange(nextRect)
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
      className={`${className}${selected ? ' element-overlay-selected' : ''}`}
      style={{ left: px.x, top: px.y, width: px.width, height: px.height }}
      onPointerDown={startDrag}
    >
      {children}
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
