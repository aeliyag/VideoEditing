import { describe, expect, it } from 'vitest'

import {
  addClipElement,
  reorderClipElement,
  removeClipElement,
  trimClipElement,
  updateClipElement,
  visibleElementsAtOffset,
} from './elementOps'
import { createEmptyProject, addClipFromSource } from '../timeline/operations'
import type { MediaAsset, TimelineClip } from '../types/project'
import { isElementEffect, MAIN_VIDEO_TRACK_ID } from '../types/project'

function mockAsset(): MediaAsset {
  return {
    id: 'source-1',
    file: new File([], 'test.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:test',
    duration: 10,
    fps: 30,
    width: 1920,
    height: 1080,
    hasAudio: true,
  }
}

function docWithClip(clip: Partial<TimelineClip> = {}) {
  let doc = createEmptyProject()
  doc = addClipFromSource(doc, mockAsset(), 0)
  const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
  track.clips[0] = { ...track.clips[0]!, ...clip }
  return { doc, clipId: track.clips[0]!.id }
}

describe('elementOps', () => {
  it('adds an element with z ordering and default timing', () => {
    const { doc, clipId } = docWithClip({ sourceEnd: 10 })
    const result = addClipElement(
      doc,
      clipId,
      {
        kind: 'text',
        rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.2 },
        opacity: 1,
        text: 'Hello',
        fontScale: 0.05,
        fontFamily: 'sans-serif',
        fontWeight: 600,
        color: '#fff',
        align: 'center',
        backgroundColor: null,
      },
      2,
    )

    expect(result).not.toBeNull()
    const clip = result!.document.tracks[0]!.clips[0]!
    const element = clip.effects.find(isElementEffect)
    expect(element?.z).toBe(0)
    expect(element?.startOffset).toBe(2)
    expect(element?.endOffset).toBeGreaterThan(2)
  })

  it('assigns increasing z values for multiple elements', () => {
    const { doc, clipId } = docWithClip()
    const first = addClipElement(doc, clipId, {
      kind: 'shape',
      shape: 'rect',
      rect: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
      opacity: 1,
      fill: '#000',
      stroke: '#fff',
      strokeWidth: 2,
    })
    const second = addClipElement(first!.document, clipId, {
      kind: 'text',
      rect: { x: 0.3, y: 0.3, width: 0.3, height: 0.15 },
      opacity: 1,
      text: 'B',
      fontScale: 0.04,
      fontFamily: 'sans-serif',
      fontWeight: 400,
      color: '#fff',
      align: 'left',
      backgroundColor: null,
    })

    const elements = second!.document.tracks[0]!.clips[0]!.effects.filter(isElementEffect)
    expect(elements.map((element) => element.z)).toEqual([0, 1])
  })

  it('updates and removes elements', () => {
    const { doc, clipId } = docWithClip()
    const added = addClipElement(doc, clipId, {
      kind: 'text',
      rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.2 },
      opacity: 1,
      text: 'Hello',
      fontScale: 0.05,
      fontFamily: 'sans-serif',
      fontWeight: 600,
      color: '#fff',
      align: 'center',
      backgroundColor: null,
    })
    const elementId = added!.effectId

    const updated = updateClipElement(added!.document, clipId, elementId, {
      text: 'Updated',
      opacity: 0.5,
    })
    const element = updated.tracks[0]!.clips[0]!.effects.find(isElementEffect)
    expect(element?.kind === 'text' && element.text).toBe('Updated')
    expect(element?.opacity).toBe(0.5)

    const removed = removeClipElement(updated, clipId, elementId)
    expect(removed.tracks[0]!.clips[0]!.effects.filter(isElementEffect)).toHaveLength(0)
  })

  it('trims element offsets within clip bounds', () => {
    const { doc, clipId } = docWithClip({ timelineStart: 0, sourceEnd: 8 })
    const added = addClipElement(doc, clipId, {
      kind: 'shape',
      shape: 'ellipse',
      rect: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
      opacity: 1,
      fill: '#f00',
      stroke: null,
      strokeWidth: 0,
    })
    const elementId = added!.effectId
    const trimmed = trimClipElement(added!.document, clipId, elementId, 'end', 4)
    const element = trimmed.tracks[0]!.clips[0]!.effects.find(isElementEffect)
    expect(element?.endOffset).toBe(4)
  })

  it('reorders elements forward and backward', () => {
    const { doc, clipId } = docWithClip()
    const first = addClipElement(doc, clipId, {
      kind: 'text',
      rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      opacity: 1,
      text: 'A',
      fontScale: 0.04,
      fontFamily: 'sans-serif',
      fontWeight: 400,
      color: '#fff',
      align: 'left',
      backgroundColor: null,
    })
    const second = addClipElement(first!.document, clipId, {
      kind: 'text',
      rect: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
      opacity: 1,
      text: 'B',
      fontScale: 0.04,
      fontFamily: 'sans-serif',
      fontWeight: 400,
      color: '#fff',
      align: 'left',
      backgroundColor: null,
    })
    const firstId = first!.effectId
    const secondId = second!.effectId

    const forward = reorderClipElement(second!.document, clipId, firstId, 'forward')
    let elements = forward.tracks[0]!.clips[0]!.effects.filter(isElementEffect)
    expect(elements.find((element) => element.id === firstId)?.z).toBe(1)
    expect(elements.find((element) => element.id === secondId)?.z).toBe(0)

    const backward = reorderClipElement(forward, clipId, firstId, 'backward')
    elements = backward.tracks[0]!.clips[0]!.effects.filter(isElementEffect)
    expect(elements.find((element) => element.id === firstId)?.z).toBe(0)
  })

  it('filters visible elements by offset and z-order', () => {
    const { doc, clipId } = docWithClip({ sourceEnd: 10 })
    const first = addClipElement(doc, clipId, {
      kind: 'text',
      rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      opacity: 1,
      text: 'Early',
      fontScale: 0.04,
      fontFamily: 'sans-serif',
      fontWeight: 400,
      color: '#fff',
      align: 'left',
      backgroundColor: null,
    })!.document
    const second = addClipElement(first, clipId, {
      kind: 'text',
      rect: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
      opacity: 1,
      text: 'Late',
      fontScale: 0.04,
      fontFamily: 'sans-serif',
      fontWeight: 400,
      color: '#fff',
      align: 'left',
      backgroundColor: null,
    })!
    const secondId = second.effectId
    const updated = updateClipElement(second.document, clipId, secondId, {
      startOffset: 5,
      endOffset: 8,
    })

    const clip = updated.tracks[0]!.clips[0]!
    const visible = visibleElementsAtOffset(clip, 1)
    expect(visible).toHaveLength(1)
    expect(visible[0]?.kind === 'text' && visible[0].text).toBe('Early')
  })
})
