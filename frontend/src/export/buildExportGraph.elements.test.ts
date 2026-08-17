import { describe, expect, it } from 'vitest'

import { createEmptyProject, addClipFromSource } from '../timeline/operations'
import type { MediaAsset, ProjectDocument, TimelineClip } from '../types/project'
import { MAIN_VIDEO_TRACK_ID } from '../types/project'
import { buildExportGraph, classifyExportAsset } from './buildExportGraph'

const FPS = 30

function mockAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: overrides.id ?? 'source-1',
    file: overrides.file ?? new File([], 'test.mp4', { type: 'video/mp4' }),
    objectUrl: 'blob:test',
    duration: 10,
    fps: FPS,
    width: 1920,
    height: 1080,
    hasAudio: true,
    ...overrides,
  }
}

function docWithElements(effects: TimelineClip['effects']): ProjectDocument {
  let doc = createEmptyProject()
  doc = addClipFromSource(doc, mockAsset(), 0)
  const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
  track.clips[0] = {
    ...track.clips[0]!,
    effects,
  }
  return doc
}

function buildFromDoc(doc: ProjectDocument, elementInputStart = 1) {
  const mediaStore = new Map<string, MediaAsset>()
  const videoTrack = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
  const videoClips = [...videoTrack.clips].sort((a, b) => a.timelineStart - b.timelineStart)
  for (const clip of videoClips) {
    mediaStore.set(clip.sourceId, mockAsset({ id: clip.sourceId }))
  }

  const inputIndexByVideoClipId = new Map(videoClips.map((clip, index) => [clip.id, index]))
  const inputIndexByTtsClipId = new Map<string, number>()
  const inputIndexByElementId = new Map<string, number>()
  const elements = videoClips[0]?.effects.filter((effect) => effect.type === 'element') ?? []
  elements.forEach((element, index) => {
    inputIndexByElementId.set(element.id, elementInputStart + index)
  })

  const sourceIds = [...new Set(videoClips.map((clip) => clip.sourceId))]
  const mediaKindBySource = new Map(
    sourceIds.map((id) => [id, classifyExportAsset(mediaStore.get(id)!)]),
  )
  const audioStreamBySource = new Map(sourceIds.map((id) => [id, true]))

  return buildExportGraph({
    doc,
    clips: videoClips,
    ttsClips: [],
    inputIndexByVideoClipId,
    inputIndexByTtsClipId,
    inputIndexByElementId,
    mediaStore,
    mediaKindBySource,
    audioStreamBySource,
    fpsBySource: new Map(),
  })
}

describe('buildExportGraph elements', () => {
  it('chains overlay filters for elements in z-order with timing', () => {
    const doc = docWithElements([
      {
        type: 'element',
        id: 'el-low',
        kind: 'shape',
        shape: 'rect',
        rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        z: 0,
        startOffset: 1,
        endOffset: 4,
        opacity: 1,
        fill: '#000',
        stroke: '#fff',
        strokeWidth: 2,
      },
      {
        type: 'element',
        id: 'el-high',
        kind: 'text',
        rect: { x: 0.5, y: 0.5, width: 0.3, height: 0.15 },
        z: 1,
        startOffset: 2,
        endOffset: 5,
        opacity: 0.9,
        text: 'Hi',
        fontScale: 0.05,
        fontFamily: 'sans-serif',
        fontWeight: 600,
        color: '#fff',
        align: 'center',
        backgroundColor: null,
      },
    ])

    const graph = buildFromDoc(doc)

    expect(graph.filterComplex).toContain('[1:v]scale=')
    expect(graph.filterComplex).toContain("enable='between(t,1,4)'")
    expect(graph.filterComplex).toContain("enable='between(t,2,5)'")
    expect(graph.filterComplex).toContain('[el0_0][els0_1]overlay=')
    expect(graph.filterComplex.indexOf('[el0_0]')).toBeLessThan(
      graph.filterComplex.indexOf('[el0_1]'),
    )
  })
})
