import { useRef } from 'react'

import { EditableRect, rectToPixel } from './EditableRect'
import { visibleElementsAtOffset } from '../elements/elementOps'
import { elementPreviewStyle } from '../elements/rasterizeElement'
import { resolvePreviewObjectUrl } from '../preview/resolvePreviewMedia'
import { useProject } from '../state/ProjectProvider'
import type { ElementEffect, FrameRect, TextElementEffect, TimelineClip } from '../types/project'
import { isElementEffect } from '../types/project'

interface Props {
  clip: TimelineClip
  clipOffset: number
  displayRect: { x: number; y: number; width: number; height: number }
  sourceWidth: number
  sourceHeight: number
}

function ElementContent({
  element,
  frameHeight,
}: {
  element: ElementEffect
  frameHeight: number
}) {
  const { mediaStore } = useProject()

  if (element.kind === 'image') {
    const asset = mediaStore.get(element.sourceId)
    const url = asset ? resolvePreviewObjectUrl(asset) : ''
    return (
      <img
        className="element-overlay-image"
        src={url}
        alt=""
        style={elementPreviewStyle(element, frameHeight)}
      />
    )
  }

  if (element.kind === 'text') {
    return (
      <div className="element-overlay-text" style={elementPreviewStyle(element, frameHeight)}>
        {element.text}
      </div>
    )
  }

  return <div className="element-overlay-shape" style={elementPreviewStyle(element, frameHeight)} />
}

export function ElementsLayer({
  clip,
  clipOffset,
  displayRect,
  sourceWidth,
  sourceHeight,
}: Props) {
  const { state, dispatch, elementsPanelOpen, recordUndoSnapshot } = useProject()
  const resizeStartRef = useRef<{ element: TextElementEffect; height: number } | null>(null)

  const visible = visibleElementsAtOffset(clip, clipOffset)
  const editable = elementsPanelOpen

  const handleRectChange = (element: ElementEffect, nextRect: FrameRect) => {
    const patch: Partial<ElementEffect> = { rect: nextRect }
    if (element.kind === 'text' && resizeStartRef.current?.element.id === element.id) {
      const { height, element: startElement } = resizeStartRef.current
      if (height > 0) {
        const scale = nextRect.height / height
        patch.fontScale = Math.max(0.01, startElement.fontScale * scale)
      }
    }
    dispatch({
      type: 'UPDATE_CLIP_ELEMENT',
      clipId: clip.id,
      elementId: element.id,
      patch,
    })
  }

  return (
    <>
      {visible.map((element) => {
        const selected = state.ui.selectedElementId === element.id
        const pixel = rectToPixel(
          element.rect,
          displayRect,
          undefined,
          sourceWidth,
          sourceHeight,
        )

        if (!editable) {
          return (
            <div
              key={element.id}
              className="element-overlay element-overlay-static"
              style={{
                left: pixel.x,
                top: pixel.y,
                width: pixel.width,
                height: pixel.height,
                opacity: element.opacity,
              }}
            >
              <ElementContent element={element} frameHeight={sourceHeight} />
            </div>
          )
        }

        return (
          <EditableRect
            key={element.id}
            rect={element.rect}
            display={displayRect}
            className="element-overlay element-overlay-editing"
            selected={selected}
            onSelect={() =>
              dispatch({ type: 'SELECT_ELEMENT', clipId: clip.id, elementId: element.id })
            }
            onDragStart={() => {
              recordUndoSnapshot()
              if (element.kind === 'text') {
                resizeStartRef.current = {
                  element,
                  height: element.rect.height,
                }
              } else {
                resizeStartRef.current = null
              }
            }}
            onChange={(nextRect) => handleRectChange(element, nextRect)}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
          >
            <ElementContent element={element} frameHeight={sourceHeight} />
          </EditableRect>
        )
      })}
    </>
  )
}

export function clipElements(clip: TimelineClip) {
  return clip.effects.filter(isElementEffect)
}
