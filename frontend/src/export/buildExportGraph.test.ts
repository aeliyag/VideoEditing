import { describe, expect, it } from 'vitest'

import {
  createEmptyProject,
  addClipFromSource,
  addAudioClipFromSource,
  addVideoClipFromMaterial,
} from '../timeline/operations'
import type { MediaAsset, ProjectDocument, TimelineClip } from '../types/project'
import { MAIN_AUDIO_TRACK_ID, MAIN_VIDEO_TRACK_ID } from '../types/project'
import {
  buildExportGraph,
  clampBoxDimension,
  classifyExportAsset,
  clipUsesSourceAudio,
  formatFfmpegError,
  parseAudioStreamFromLogs,
  parseVideoFpsFromLogs,
  resolveExportCanvas,
  stageFileNameForAsset,
} from './buildExportGraph'

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

function docWithClip(clip: Partial<TimelineClip> = {}, asset = mockAsset()): ProjectDocument {
  let doc = createEmptyProject()
  doc = addClipFromSource(doc, asset)
  const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
  const base = track.clips[0]
  track.clips[0] = { ...base, ...clip }
  return doc
}

function buildFromDoc(
  doc: ProjectDocument,
  options: {
    audioStreamBySource?: Record<string, boolean>
    fpsBySource?: Record<string, number>
    extraAssets?: MediaAsset[]
  } = {},
) {
  const mediaStore = new Map<string, MediaAsset>()
  const videoTrack = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
  const audioTrack = doc.tracks.find((t) => t.id === MAIN_AUDIO_TRACK_ID)

  for (const clip of videoTrack.clips) {
    const asset = options.extraAssets?.find((a) => a.id === clip.sourceId) ?? mockAsset({ id: clip.sourceId })
    mediaStore.set(clip.sourceId, asset)
  }

  const ttsClips = audioTrack ? [...audioTrack.clips].sort((a, b) => a.timelineStart - b.timelineStart) : []
  for (const clip of ttsClips) {
    if (!mediaStore.has(clip.sourceId)) {
      mediaStore.set(
        clip.sourceId,
        mockAsset({
          id: clip.sourceId,
          file: new File([], 'tts.mp3', { type: 'audio/mpeg' }),
          fps: 0,
          width: 0,
          height: 0,
          hasAudio: true,
        }),
      )
    }
  }

  const sourceIds = [...new Set([...videoTrack.clips, ...ttsClips].map((c) => c.sourceId))]
  const inputIndexBySource = new Map(sourceIds.map((id, index) => [id, index]))
  const mediaKindBySource = new Map(
    sourceIds.map((id) => [id, classifyExportAsset(mediaStore.get(id)!)]),
  )
  const audioStreamBySource = new Map(
    sourceIds.map((id) => [id, options.audioStreamBySource?.[id] ?? true]),
  )
  const fpsBySource = new Map(
    Object.entries(options.fpsBySource ?? {}),
  )

  return buildExportGraph({
    doc,
    clips: [...videoTrack.clips].sort((a, b) => a.timelineStart - b.timelineStart),
    ttsClips,
    inputIndexBySource,
    mediaStore,
    mediaKindBySource,
    audioStreamBySource,
    fpsBySource,
  })
}

describe('buildExportGraph', () => {
  it('omits audio when staged video has no audio stream and no TTS', () => {
    const doc = docWithClip()
    const graph = buildFromDoc(doc, { audioStreamBySource: { 'source-1': false } })

    expect(graph.filterComplex).not.toContain('[0:a]atrim')
    expect(graph.filterComplex).not.toContain('anullsrc')
    expect(graph.filterComplex).toContain('concat=n=1:v=1:a=0')
    expect(graph.mapAudio).toBe(false)
  })

  it('uses atrim when staged video has an audio stream', () => {
    const doc = docWithClip()
    const graph = buildFromDoc(doc, { audioStreamBySource: { 'source-1': true } })

    expect(graph.filterComplex).toContain('[0:a]atrim')
    expect(graph.filterComplex).toContain('concat=n=1:v=1:a=1')
    expect(graph.mapAudio).toBe(true)
  })

  it('drops muted clip audio from export when no TTS bed is needed', () => {
    const doc = docWithClip({ muteVideoAudio: true })
    const graph = buildFromDoc(doc, { audioStreamBySource: { 'source-1': true } })

    expect(graph.filterComplex).not.toContain('[0:a]atrim')
    expect(graph.filterComplex).not.toContain('anullsrc')
    expect(graph.filterComplex).toContain('concat=n=1:v=1:a=0')
  })

  it('pads silent clips with anullsrc when TTS requires an audio bed', () => {
    let doc = docWithClip({}, mockAsset({ id: 'video-1', hasAudio: false }))
    const ttsAsset = mockAsset({
      id: 'tts-1',
      file: new File([], 'tts.mp3', { type: 'audio/mpeg' }),
      fps: 0,
      width: 0,
      height: 0,
      duration: 3,
      hasAudio: true,
    })
    doc = addAudioClipFromSource(doc, ttsAsset, 0)
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    track.clips[0] = { ...track.clips[0], sourceId: 'video-1' }

    const graph = buildFromDoc(doc, {
      audioStreamBySource: { 'video-1': false, 'tts-1': true },
      extraAssets: [mockAsset({ id: 'video-1', hasAudio: false }), ttsAsset],
    })

    expect(graph.filterComplex).toContain('anullsrc=r=44100:cl=stereo')
    expect(graph.filterComplex).not.toContain('[0:a]atrim')
    expect(graph.filterComplex).toContain('amix=inputs=2')
  })

  it('builds image still filters with loop/trim and no source audio', () => {
    const imageAsset = mockAsset({
      id: 'image-1',
      file: new File([], 'still.png', { type: 'image/png' }),
      fps: 30,
      hasAudio: false,
    })
    const doc = docWithClip({}, imageAsset)
    const graph = buildFromDoc(doc, {
      audioStreamBySource: { 'image-1': false },
      extraAssets: [imageAsset],
    })

    expect(graph.filterComplex).toContain('loop=loop=-1:size=1:start=0')
    expect(graph.filterComplex).toContain('trim=duration=10')
    expect(graph.filterComplex).not.toContain('[0:a]atrim')
  })

  it('mixes TTS over concat audio bed', () => {
    let doc = docWithClip({}, mockAsset({ id: 'video-1' }))
    const ttsAsset = mockAsset({
      id: 'tts-1',
      file: new File([], 'tts.mp3', { type: 'audio/mpeg' }),
      fps: 0,
      width: 0,
      height: 0,
      duration: 3,
      hasAudio: true,
    })
    doc = addAudioClipFromSource(doc, ttsAsset, 2)
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    track.clips[0] = { ...track.clips[0], sourceId: 'video-1' }

    const graph = buildFromDoc(doc, {
      audioStreamBySource: { 'video-1': true, 'tts-1': true },
      extraAssets: [mockAsset({ id: 'video-1' }), ttsAsset],
    })

    expect(graph.filterComplex).toContain('amix=inputs=2')
    expect(graph.filterComplex).toContain('[tts0]')
    expect(graph.useTtsMix).toBe(true)
    expect(graph.mapAudio).toBe(true)
  })

  it('clamps red-box dimensions to at least 1px', () => {
    const doc = docWithClip({
      effects: [
        {
          type: 'red-box',
          id: 'rb1',
          rect: { x: 0.1, y: 0.1, width: 0.0001, height: 0.0001 },
          strokeWidth: 4,
          startOffset: 0,
          endOffset: 5,
        },
      ],
    })
    const graph = buildFromDoc(doc, { audioStreamBySource: { 'source-1': false } })

    expect(graph.filterComplex).toContain('drawbox=x=192:y=108:w=1:h=1')
  })

  it('stages files with their real extensions', () => {
    expect(
      stageFileNameForAsset(
        0,
        mockAsset({ file: new File([], 'clip.mov', { type: 'video/quicktime' }) }),
      ),
    ).toBe('input_0.mov')
    expect(
      stageFileNameForAsset(
        1,
        mockAsset({
          file: new File([], 'still.webp', { type: 'image/webp' }),
          hasAudio: false,
        }),
      ),
    ).toBe('input_1.webp')
  })

  it('normalizes mixed-resolution clips to a shared canvas before concat', () => {
    const hdAsset = mockAsset({ id: 'hd', width: 1920, height: 1080 })
    const sdAsset = mockAsset({
      id: 'sd',
      width: 1280,
      height: 720,
      file: new File([], 'small.mp4', { type: 'video/mp4' }),
    })

    let doc = createEmptyProject()
    doc = addVideoClipFromMaterial(doc, hdAsset, 0)
    doc = addVideoClipFromMaterial(doc, sdAsset, 10)

    const canvas = resolveExportCanvas(
      doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips,
      new Map([
        ['hd', hdAsset],
        ['sd', sdAsset],
      ]),
    )
    expect(canvas).toEqual({ width: 1920, height: 1080 })

    const graph = buildFromDoc(doc, {
      audioStreamBySource: { hd: false, sd: false },
      extraAssets: [hdAsset, sdAsset],
    })

    expect(graph.filterComplex).toContain('scale=1920:1080:force_original_aspect_ratio=decrease')
    expect(graph.filterComplex).toContain('pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black')
    expect(graph.filterComplex).toContain('[vn0]')
    expect(graph.filterComplex).toContain('[vn1]')
  })

  it('resamples source audio to 44100 stereo before concat', () => {
    const doc = docWithClip()
    const graph = buildFromDoc(doc, { audioStreamBySource: { 'source-1': true } })

    expect(graph.filterComplex).toContain('aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo')
    expect(graph.filterComplex).toContain('[0:a]atrim')
  })

  it('resamples TTS audio before amix', () => {
    let doc = docWithClip({}, mockAsset({ id: 'video-1', hasAudio: false }))
    const ttsAsset = mockAsset({
      id: 'tts-1',
      file: new File([], 'tts.mp3', { type: 'audio/mpeg' }),
      fps: 0,
      width: 0,
      height: 0,
      duration: 3,
      hasAudio: true,
    })
    doc = addAudioClipFromSource(doc, ttsAsset, 0)
    const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    track.clips[0] = { ...track.clips[0], sourceId: 'video-1' }

    const graph = buildFromDoc(doc, {
      audioStreamBySource: { 'video-1': false, 'tts-1': true },
      extraAssets: [mockAsset({ id: 'video-1', hasAudio: false }), ttsAsset],
    })

    expect(graph.filterComplex).toContain('adelay=')
    expect(graph.filterComplex).toContain('aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo')
    expect(graph.filterComplex).toContain('amix=inputs=2')
  })

  it('uses probed fps in trim filters for non-30fps sources', () => {
    const doc = docWithClip()
    const graph = buildFromDoc(doc, {
      audioStreamBySource: { 'source-1': false },
      fpsBySource: { 'source-1': 24000 / 1001 },
    })

    expect(graph.filterComplex).toContain('setpts=PTS-STARTPTS,fps=23.976,format=yuv420p')
    expect(graph.filterComplex).toContain('format=yuv420p,fps=30')
  })
})

describe('export helpers', () => {
  it('detects audio streams from ffmpeg probe logs', () => {
    expect(parseAudioStreamFromLogs(['Input #0, mov,mp4', '  Stream #0:1: Audio: aac'])).toBe(true)
    expect(parseAudioStreamFromLogs(['Input #0, png', '  Stream #0:0: Video: png'])).toBe(false)
  })

  it('detects video fps from ffmpeg probe logs', () => {
    expect(
      parseVideoFpsFromLogs([
        'Input #0, mov,mp4',
        '  Stream #0:0: Video: h264, yuv420p, 1920x1080, 24000/1001 fps, 24000/1001 tbr',
      ]),
    ).toBeCloseTo(24000 / 1001, 3)
    expect(
      parseVideoFpsFromLogs(['  Stream #0:0: Video: h264, yuv420p, 1920x1080, 24 fps, 24 tbr']),
    ).toBe(24)
    expect(parseVideoFpsFromLogs(['Input #0, png', '  Stream #0:0: Video: png'])).toBeNull()
  })

  it('formats ffmpeg errors with recent log lines', () => {
    const message = formatFfmpegError(1, [
      'Input #0',
      'Stream map matches no streams',
      'Error while filtering',
    ])
    expect(message).toContain('exit code 1')
    expect(message).toContain('Stream map matches no streams')
  })

  it('classifies image assets for export', () => {
    const asset = mockAsset({
      file: new File([], 'frame.png', { type: 'image/png' }),
      hasAudio: false,
    })
    expect(classifyExportAsset(asset)).toBe('image')
    expect(clipUsesSourceAudio(
      { id: 'c', sourceId: asset.id, sourceStart: 0, sourceEnd: 5, timelineStart: 0, effects: [] },
      asset,
      'image',
      new Map([[asset.id, false]]),
    )).toBe(false)
  })

  it('clamps box dimensions', () => {
    expect(clampBoxDimension(0)).toBe(1)
    expect(clampBoxDimension(0.4)).toBe(1)
    expect(clampBoxDimension(12.6)).toBe(13)
  })
})
