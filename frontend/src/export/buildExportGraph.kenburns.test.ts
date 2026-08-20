import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { saveClipCamera } from '../camera/frameBankOps'
import { createEmptyProject, addClipFromSource } from '../timeline/operations'
import { MAIN_VIDEO_TRACK_ID } from '../types/project'
import {
  DEFAULT_KEN_BURNS_OPTIONS,
  EXPORT_FPS,
  type KenBurnsRenderOptions,
  buildAspectCorrectKenBurnsFilterChain,
  buildCameraZoompanExpressions,
  buildExportGraph,
  buildKenBurnsFilterChain,
  buildPadded169KenBurnsFilterChain,
  classifyExportAsset,
  clampBoxDimension,
  computeCameraLastFrame,
  evalCameraRectAtFrame,
  measureZoompanCoordinateStalls,
  resolveAspectCorrectIntermediateSize,
  resolveClipFrameDimensions,
  resolvePadded169Layout,
  transformRectToPadded169Space,
} from './buildExportGraph'
import { assignClipCameraStart } from '../camera/frameBankOps'

const FULL = { x: 0, y: 0, width: 1, height: 1 }
const CENTER_HALF = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
/** ~29 px over 17.2 s at 1080p — matches real slow Ken Burns exports. */
const VERY_SLOW_PAN_START = { x: 0, y: 0, width: 0.45, height: 0.45 }
const VERY_SLOW_PAN_END = { x: 0.015, y: 0.015, width: 0.45, height: 0.45 }
const VERY_SLOW_PAN_DURATION = 17.2

function ffmpegAvailable(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function evenDim(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function buildKenBurnsGraph(
  start: typeof FULL,
  end: typeof FULL,
  duration: number,
  width: number,
  height: number,
  options: KenBurnsRenderOptions,
  loop = false,
): string {
  const pan = buildCameraZoompanExpressions(start, end, duration, options.renderFps)
  const outW = evenDim(width)
  const outH = evenDim(height)
  const input = loop
    ? `[0:v]loop=loop=-1:size=1:start=0,trim=duration=${duration},setpts=PTS-STARTPTS,fps=${options.outputFps},format=yuv420p[vin];`
    : `[0:v]trim=duration=${duration},setpts=PTS-STARTPTS,fps=${options.outputFps},format=yuv420p[vin];`
  const chain = buildKenBurnsFilterChain('vin', 'outv', pan, outW, outH, options)
  return `${input}${chain}`
}

function buildAspectCorrectGraph(
  start: typeof FULL,
  end: typeof FULL,
  duration: number,
  width: number,
  height: number,
  options: KenBurnsRenderOptions,
  loop = false,
): string {
  const outW = evenDim(width)
  const outH = evenDim(height)
  const layout = resolvePadded169Layout(outW, outH)
  const paddedStart = transformRectToPadded169Space(start, layout, outW, outH)
  const paddedEnd = transformRectToPadded169Space(end, layout, outW, outH)
  const pan = buildCameraZoompanExpressions(paddedStart, paddedEnd, duration, options.renderFps)
  const input = loop
    ? `[0:v]loop=loop=-1:size=1:start=0,trim=duration=${duration},setpts=PTS-STARTPTS,fps=${options.outputFps},format=yuv420p[vin];`
    : `[0:v]trim=duration=${duration},setpts=PTS-STARTPTS,fps=${options.outputFps},format=yuv420p[vin];`
  const chain = buildPadded169KenBurnsFilterChain('vin', 'outv', pan, outW, outH, layout, options)
  return `${input}${chain}`
}

function readFrameRgb(path: string, width: number, height: number): Buffer {
  const rawPath = `${path}.rgb`
  execSync(
    `ffmpeg -y -loglevel error -i "${path}" -frames:v 1 -f rawvideo -pix_fmt rgb24 "${rawPath}"`,
    { stdio: 'pipe' },
  )
  return readFileSync(rawPath)
}

function countBluePixels(buffer: Buffer): number {
  let count = 0
  for (let i = 0; i < buffer.length; i += 3) {
    if (buffer[i + 2]! > 200 && buffer[i]! < 50 && buffer[i + 1]! < 50) {
      count++
    }
  }
  return count
}

function countRedPixels(buffer: Buffer): number {
  let count = 0
  for (let i = 0; i < buffer.length; i += 3) {
    if (buffer[i]! > 200 && buffer[i + 1]! < 50 && buffer[i + 2]! < 50) {
      count++
    }
  }
  return count
}

function createStaticGridImage(path: string, width: number, height: number): void {
  execSync(
    `ffmpeg -y -f lavfi -i "color=c=white:s=${width}x${height},` +
      `drawgrid=width=32:height=32:thickness=2:color=black" ` +
      `-frames:v 1 -pix_fmt yuv420p "${path}"`,
    { stdio: 'pipe' },
  )
}

function renderFramePng(
  inputPath: string,
  filterComplex: string,
  frameIndex: number,
  outputPath: string,
): void {
  const withSelect = filterComplex.replace(
    /\[outv\]$/,
    `,select=eq(n\\,${frameIndex})[outv]`,
  )
  execSync(
    `ffmpeg -y -i "${inputPath}" -filter_complex "${withSelect}" -map "[outv]" -vframes 1 "${outputPath}"`,
    { stdio: 'pipe' },
  )
}

function hashFile(path: string): string {
  return createHash('md5').update(readFileSync(path)).digest('hex')
}

export interface PanSmoothnessMetrics {
  /** Consecutive output frames with near-zero pixel change (zoompan hold). */
  identicalPairs: number
  meanAbsDelta: number
  maxAbsDelta: number
  frameCount: number
}

/** Lower identicalPairs and maxAbsDelta indicate less zoompan stepping on static patterns. */
export function measurePanSmoothness(
  inputPath: string,
  filterComplex: string,
  width: number,
  height: number,
  maxFrames?: number,
): PanSmoothnessMetrics {
  const outW = evenDim(width)
  const outH = evenDim(height)
  const frameBytes = outW * outH * 3
  const frameLimit = maxFrames != null ? `-frames:v ${maxFrames} ` : ''
  const raw = execSync(
    `ffmpeg -y -i "${inputPath}" -filter_complex "${filterComplex}" -map "[outv]" ` +
      `${frameLimit}-f rawvideo -pix_fmt rgb24 -`,
    { stdio: 'pipe', maxBuffer: frameBytes * 600 },
  )

  const frameCount = Math.floor(raw.length / frameBytes)
  if (frameCount < 2) {
    return { identicalPairs: frameCount, meanAbsDelta: 0, maxAbsDelta: 0, frameCount }
  }

  let identicalPairs = 0
  let sumDelta = 0
  let maxAbsDelta = 0
  const identicalThreshold = 0.01

  for (let i = 1; i < frameCount; i++) {
    const prev = raw.subarray((i - 1) * frameBytes, i * frameBytes)
    const curr = raw.subarray(i * frameBytes, (i + 1) * frameBytes)
    let absDelta = 0
    for (let p = 0; p < frameBytes; p++) {
      absDelta += Math.abs(curr[p]! - prev[p]!)
    }
    const meanDelta = absDelta / frameBytes
    if (meanDelta < identicalThreshold) {
      identicalPairs++
    }
    sumDelta += meanDelta
    maxAbsDelta = Math.max(maxAbsDelta, meanDelta)
  }

  return {
    identicalPairs,
    meanAbsDelta: sumDelta / (frameCount - 1),
    maxAbsDelta,
    frameCount,
  }
}

function createStaticGridVideo(path: string, duration: number, width = 1920, height = 1080): void {
  execSync(
    `ffmpeg -y -f lavfi -i "color=c=white:s=${width}x${height}:duration=${duration},` +
      `drawgrid=width=32:height=32:thickness=2:color=black" ` +
      `-c:v libx264 -preset ultrafast -pix_fmt yuv420p "${path}"`,
    { stdio: 'pipe' },
  )
}

function kenBurnsCoordinateStalls(
  start: typeof FULL,
  end: typeof FULL,
  duration: number,
  width: number,
  height: number,
  options: KenBurnsRenderOptions,
) {
  const outW = evenDim(width)
  const outH = evenDim(height)
  return measureZoompanCoordinateStalls(
    start,
    end,
    duration,
    evenDim(outW * options.workingScale),
    evenDim(outH * options.workingScale),
    options.renderFps,
    options.outputFps,
  )
}

const testVideo = join(process.cwd(), '..', 'filter-test.mp4')
const sampleDuration = 1.9
const canRender = ffmpegAvailable() && existsSync(testVideo)

const VARIANTS = {
  A: { workingScale: 1, renderFps: 30, outputFps: EXPORT_FPS },
  B: { workingScale: 2, renderFps: 30, outputFps: EXPORT_FPS },
  C: { workingScale: 2, renderFps: 60, outputFps: EXPORT_FPS },
} satisfies Record<string, KenBurnsRenderOptions>

describe('Ken Burns zoompan expressions', () => {
  it('uses on and render fps for lastFrame on a 10-second clip', () => {
    const pan = buildCameraZoompanExpressions(FULL, CENTER_HALF, 10, 30)
    expect(pan.lastFrame).toBe(299)
    expect(computeCameraLastFrame(10, 30)).toBe(299)
    expect(pan.ease).toContain('on/299')
    expect(pan.zoom).toContain('(1/(')
    expect(pan.x).toContain('iw*(')
    expect(pan.y).toContain('ih*(')
  })

  it('uses 60fps render cadence when requested', () => {
    const pan = buildCameraZoompanExpressions(FULL, CENTER_HALF, 10, 60)
    expect(pan.lastFrame).toBe(599)
    expect(pan.ease).toContain('on/599')
  })

  it('animates zoom from full frame to center half', () => {
    const start = evalCameraRectAtFrame(FULL, CENTER_HALF, 10, 0)
    const mid = evalCameraRectAtFrame(FULL, CENTER_HALF, 10, 150)
    const end = evalCameraRectAtFrame(FULL, CENTER_HALF, 10, 299)

    expect(start.width).toBeCloseTo(1, 5)
    expect(end.width).toBeCloseTo(0.5, 5)
    expect(mid.width).toBeGreaterThan(end.width)
    expect(mid.width).toBeLessThan(start.width)
  })

  it('pans without zoom when start/end dimensions match', () => {
    const panStart = { x: 0, y: 0, width: 0.5, height: 0.5 }
    const panEnd = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    const start = evalCameraRectAtFrame(panStart, panEnd, 5, 0)
    const end = evalCameraRectAtFrame(panStart, panEnd, 5, computeCameraLastFrame(5))

    expect(start.width).toBeCloseTo(end.width, 5)
    expect(start.height).toBeCloseTo(end.height, 5)
    expect(end.x).toBeGreaterThan(start.x)
    expect(end.y).toBeGreaterThan(start.y)
  })

  it('reports fewer integer stalls at 2x working resolution on a very slow pan', () => {
    const stalls1x = kenBurnsCoordinateStalls(
      VERY_SLOW_PAN_START,
      VERY_SLOW_PAN_END,
      VERY_SLOW_PAN_DURATION,
      1920,
      1080,
      VARIANTS.A,
    )
    const stalls2x = kenBurnsCoordinateStalls(
      VERY_SLOW_PAN_START,
      VERY_SLOW_PAN_END,
      VERY_SLOW_PAN_DURATION,
      1920,
      1080,
      VARIANTS.B,
    )

    expect(stalls1x.outputFrames).toBe(516)
    expect(stalls2x.outputFrames).toBe(516)
    expect(stalls2x.stallFrames).toBeLessThan(stalls1x.stallFrames)
    expect(stalls2x.maxJumpPx).toBeLessThanOrEqual(stalls1x.maxJumpPx + 1)
  })
})

describe('Ken Burns filter chain', () => {
  it('upscales 2x before zoompan and downscales with lanczos', () => {
    const pan = buildCameraZoompanExpressions(FULL, CENTER_HALF, 10)
    const chain = buildKenBurnsFilterChain('vt0', 'v0', pan, 1920, 1080, VARIANTS.B)
    expect(chain).toContain('scale=3840:2160:flags=bicubic')
    expect(chain).toContain('zoompan=')
    expect(chain).toContain('d=1:s=3840x2160:fps=30')
    expect(chain).toContain('scale=1920:1080:flags=lanczos')
    expect(chain).toContain('iw*(')
    expect(chain).toContain('ih*(')
  })

  it('builds export graph with 2x Ken Burns pipeline', () => {
    let doc = addClipFromSource(createEmptyProject(), {
      id: 'source-1',
      file: new File([], 'test.mp4', { type: 'video/mp4' }),
      objectUrl: 'blob:test',
      duration: 10,
      fps: 30,
      width: 1920,
      height: 1080,
      hasAudio: true,
    })
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0].id
    doc = saveClipCamera(
      doc,
      clipId,
      { rect: FULL, name: 'Start' },
      { rect: CENTER_HALF, name: 'End' },
    )

    const asset = {
      id: 'source-1',
      file: new File([], 'test.mp4'),
      objectUrl: 'blob:test',
      duration: 10,
      fps: 30,
      width: 1920,
      height: 1080,
      hasAudio: true,
    }
    const mediaStore = new Map([['source-1', asset]])
    const videoTrack = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const clip = videoTrack.clips[0]!
    const graph = buildExportGraph({
      doc,
      clips: videoTrack.clips,
      ttsClips: [],
      inputIndexByVideoClipId: new Map([[clip.id, 0]]),
      inputIndexByTtsClipId: new Map(),
      mediaStore,
      mediaKindBySource: new Map([['source-1', classifyExportAsset(asset)]]),
      audioStreamBySource: new Map([['source-1', false]]),
      fpsBySource: new Map([['source-1', 24]]),
    })

    const cameraFilter = graph.filterParts.find((part) => part.includes('zoompan='))!
    expect(cameraFilter).toContain('scale=3840:2160')
    expect(cameraFilter).toContain('flags=lanczos')
    expect(cameraFilter).toContain('on/299')
    expect(DEFAULT_KEN_BURNS_OPTIONS.workingScale).toBe(2)
  })
})

describe.skipIf(!canRender)('Ken Burns ffmpeg render', () => {
  it('zoom export changes visibly from first to middle to last frame', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kenburns-'))
    try {
      const filter = buildKenBurnsGraph(FULL, CENTER_HALF, sampleDuration, 1920, 1080, VARIANTS.B)
      const last = computeCameraLastFrame(sampleDuration, 30)
      const f0 = join(dir, 'f0.png')
      const fMid = join(dir, 'fMid.png')
      const fLast = join(dir, 'fLast.png')
      renderFramePng(testVideo, filter, 0, f0)
      renderFramePng(testVideo, filter, Math.floor(last / 2), fMid)
      renderFramePng(testVideo, filter, last, fLast)

      expect(hashFile(f0)).not.toBe(hashFile(fLast))
      expect(hashFile(fMid)).not.toBe(hashFile(f0))
      expect(hashFile(fMid)).not.toBe(hashFile(fLast))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('produces about 300 frames for a 10-second clip at 30fps output', () => {
    const duration = 10
    const dir = mkdtempSync(join(tmpdir(), 'kenburns-'))
    const out = join(dir, 'out.mp4')
    try {
      const filter = buildKenBurnsGraph(FULL, CENTER_HALF, duration, 1920, 1080, VARIANTS.B, true)
      execSync(
        `ffmpeg -y -i "${testVideo}" -filter_complex "${filter}" -map "[outv]" ` +
          `-t ${duration} -c:v libx264 -preset ultrafast "${out}"`,
        { stdio: 'pipe' },
      )
      const probe = execSync(
        `ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames,duration -of csv=p=0 "${out}"`,
      )
        .toString()
        .trim()
      const [probedDuration, frames] = probe.split(',').map((v) => Number(v))
      expect(frames).toBeGreaterThanOrEqual(290)
      expect(frames).toBeLessThanOrEqual(310)
      expect(probedDuration).toBeCloseTo(duration, 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps portrait output dimensions without stretching the frame size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kenburns-'))
    const out = join(dir, 'portrait.mp4')
    try {
      const filter = buildKenBurnsGraph(FULL, CENTER_HALF, sampleDuration, 1080, 1920, VARIANTS.B)
      execSync(
        `ffmpeg -y -i "${testVideo}" -filter_complex "${filter}" -map "[outv]" ` +
          `-t ${sampleDuration} -c:v libx264 -preset ultrafast "${out}"`,
        { stdio: 'pipe' },
      )
      const probe = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${out}"`,
      )
        .toString()
        .trim()
      expect(probe).toBe('1080,1920')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('slow diagonal pan on a static grid moves more continuously with 2x supersampling', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kenburns-'))
    const grid = join(dir, 'grid.mp4')
    try {
      createStaticGridVideo(grid, VERY_SLOW_PAN_DURATION)
      const filter1x = buildKenBurnsGraph(
        VERY_SLOW_PAN_START,
        VERY_SLOW_PAN_END,
        VERY_SLOW_PAN_DURATION,
        1920,
        1080,
        VARIANTS.A,
      )
      const filter2x = buildKenBurnsGraph(
        VERY_SLOW_PAN_START,
        VERY_SLOW_PAN_END,
        VERY_SLOW_PAN_DURATION,
        1920,
        1080,
        VARIANTS.B,
      )
      const m1 = measurePanSmoothness(grid, filter1x, 1920, 1080)
      const m2 = measurePanSmoothness(grid, filter2x, 1920, 1080)

      expect(m1.frameCount).toBeGreaterThan(500)
      expect(m2.frameCount).toBe(m1.frameCount)
      expect(m2.identicalPairs).toBeLessThan(m1.identicalPairs)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it('compares Ken Burns variants A/B/C on grid pan smoothness', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kenburns-'))
    const grid = join(dir, 'grid.mp4')
    try {
      createStaticGridVideo(grid, VERY_SLOW_PAN_DURATION)
      const coordinate = Object.fromEntries(
        Object.entries(VARIANTS).map(([name, options]) => [
          name,
          kenBurnsCoordinateStalls(
            VERY_SLOW_PAN_START,
            VERY_SLOW_PAN_END,
            VERY_SLOW_PAN_DURATION,
            1920,
            1080,
            options,
          ),
        ]),
      ) as Record<'A' | 'B' | 'C', ReturnType<typeof measureZoompanCoordinateStalls>>

      const renderStart = Date.now()
      const rendered = Object.fromEntries(
        Object.entries(VARIANTS).map(([name, options]) => {
          const filter = buildKenBurnsGraph(
            VERY_SLOW_PAN_START,
            VERY_SLOW_PAN_END,
            VERY_SLOW_PAN_DURATION,
            1920,
            1080,
            options,
          )
          const t0 = Date.now()
          const metrics = measurePanSmoothness(grid, filter, 1920, 1080, 120)
          return [name, { ...metrics, renderMs: Date.now() - t0 }]
        }),
      ) as Record<
        'A' | 'B' | 'C',
        PanSmoothnessMetrics & { renderMs: number }
      >
      const totalRenderMs = Date.now() - renderStart

      const report = {
        coordinateStalls: coordinate,
        renderedSample: rendered,
        totalRenderMs,
        recommendation:
          'B (30fps/2x): fewer zoompan stalls than A at ~2x cost; C adds marginal smoothness at ~3.5x cost.',
      }
      writeFileSync(join(dir, 'kenburns-variant-report.json'), JSON.stringify(report, null, 2))

      expect(coordinate.B.stallFrames).toBeLessThan(coordinate.A.stallFrames)
      expect(coordinate.C.stallFrames).toBeLessThanOrEqual(coordinate.B.stallFrames)
      expect(rendered.B.renderMs).toBeGreaterThan(0)
      expect(rendered.C.renderMs).toBeGreaterThan(rendered.B.renderMs)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

const WIDE_WIDTH = 3456
const WIDE_HEIGHT = 2234
/** Saved-project failure case: top-left, near-full static crop on non-16:9 image. */
const TOP_LEFT_WIDE = { x: 0, y: 0, width: 1, height: 0.87 }

describe.skipIf(!ffmpegAvailable())('Aspect-correct Ken Burns ffmpeg render', () => {
  it('renders static top-left near-full crop on non-16:9 image without filter errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aspect-correct-'))
    const image = join(dir, 'wide.png')
    const out = join(dir, 'out.mp4')
    try {
      createStaticGridImage(image, WIDE_WIDTH, WIDE_HEIGHT)
      const filter = buildAspectCorrectGraph(
        TOP_LEFT_WIDE,
        TOP_LEFT_WIDE,
        sampleDuration,
        WIDE_WIDTH,
        WIDE_HEIGHT,
        VARIANTS.B,
        true,
      )
      execSync(
        `ffmpeg -y -loop 1 -i "${image}" -filter_complex "${filter}" -map "[outv]" ` +
          `-t ${sampleDuration} -c:v libx264 -preset ultrafast "${out}"`,
        { stdio: 'pipe' },
      )
      const probe = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${out}"`,
      )
        .toString()
        .trim()
      expect(probe).toBe(`${evenDim(WIDE_WIDTH)},${evenDim(WIDE_HEIGHT)}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders odd source dimensions without crop bounds errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aspect-correct-'))
    const image = join(dir, 'odd.png')
    const out = join(dir, 'out.mp4')
    try {
      createStaticGridImage(image, 1921, 1081)
      const filter = buildAspectCorrectGraph(
        { x: 0, y: 0, width: 0.9, height: 0.55 },
        { x: 0, y: 0, width: 0.9, height: 0.55 },
        sampleDuration,
        1921,
        1081,
        VARIANTS.B,
        true,
      )
      execSync(
        `ffmpeg -y -loop 1 -i "${image}" -filter_complex "${filter}" -map "[outv]" ` +
          `-t ${sampleDuration} -c:v libx264 -preset ultrafast "${out}"`,
        { stdio: 'pipe' },
      )
      const probe = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${out}"`,
      )
        .toString()
        .trim()
      expect(probe).toBe(`${evenDim(1921)},${evenDim(1081)}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('crops the bottom of a wide image for a static near-full top crop', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aspect-correct-'))
    const image = join(dir, 'wide.png')
    const cropped = join(dir, 'cropped.png')
    try {
      execSync(
        `ffmpeg -y -f lavfi -i "color=c=0xff0000:s=${WIDE_WIDTH}x${Math.round(WIDE_HEIGHT * 0.87)}[top];` +
          `color=c=0x0000ff:s=${WIDE_WIDTH}x${WIDE_HEIGHT - Math.round(WIDE_HEIGHT * 0.87)}[bottom];` +
          `[top][bottom]vstack=inputs=2" -frames:v 1 -pix_fmt yuv420p "${image}"`,
        { stdio: 'pipe' },
      )
      const filter = buildAspectCorrectGraph(
        TOP_LEFT_WIDE,
        TOP_LEFT_WIDE,
        sampleDuration,
        WIDE_WIDTH,
        WIDE_HEIGHT,
        VARIANTS.B,
        true,
      )
      renderFramePng(image, filter, 0, cropped)
      const outW = evenDim(WIDE_WIDTH)
      const outH = evenDim(WIDE_HEIGHT)
      const frame = readFrameRgb(cropped, outW, outH)
      expect(countRedPixels(frame)).toBeGreaterThan(outW * outH * 0.5)
      expect(countBluePixels(frame)).toBeLessThan(outW * outH * 0.01)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders non-16:9 camera crop followed by drawbox with aligned pixels', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aspect-correct-'))
    const image = join(dir, 'wide.png')
    const out = join(dir, 'out.mp4')
    try {
      createStaticGridImage(image, WIDE_WIDTH, WIDE_HEIGHT)
      const layout = resolvePadded169Layout(evenDim(WIDE_WIDTH), evenDim(WIDE_HEIGHT))
      const paddedStart = transformRectToPadded169Space(
        TOP_LEFT_WIDE,
        layout,
        evenDim(WIDE_WIDTH),
        evenDim(WIDE_HEIGHT),
      )
      const pan = buildCameraZoompanExpressions(paddedStart, paddedStart, sampleDuration)
      const frameSize = resolveClipFrameDimensions({
        id: 'img',
        file: new File([], 'wide.png'),
        objectUrl: '',
        duration: 10,
        fps: 0,
        width: WIDE_WIDTH,
        height: WIDE_HEIGHT,
        hasAudio: false,
      })
      const rbX = Math.round(0.2 * frameSize.width)
      const rbY = Math.round(0.3 * frameSize.height)
      const rbW = clampBoxDimension(0.25 * frameSize.width)
      const rbH = clampBoxDimension(0.2 * frameSize.height)
      const camera = buildPadded169KenBurnsFilterChain(
        'vin',
        'vcam',
        pan,
        evenDim(WIDE_WIDTH),
        evenDim(WIDE_HEIGHT),
        layout,
        VARIANTS.B,
      )
      const filter =
        `[0:v]loop=loop=-1:size=1:start=0,trim=duration=${sampleDuration},setpts=PTS-STARTPTS,fps=30,format=yuv420p[vin];` +
        `${camera};` +
        `[vcam]drawbox=x=${rbX}:y=${rbY}:w=${rbW}:h=${rbH}:color=red@1:t=4[outv]`
      expect(filter).toContain('pad=')
      execSync(
        `ffmpeg -y -loop 1 -i "${image}" -filter_complex "${filter}" -map "[outv]" ` +
          `-t ${sampleDuration} -c:v libx264 -preset ultrafast "${out}"`,
        { stdio: 'pipe' },
      )
      const png = join(dir, 'frame.png')
      renderFramePng(image, filter, 0, png)
      const frame = readFrameRgb(png, evenDim(WIDE_WIDTH), evenDim(WIDE_HEIGHT))
      let redCount = 0
      for (let i = 0; i < frame.length; i += 3) {
        if (frame[i]! > 180 && frame[i + 1]! < 80 && frame[i + 2]! < 80) {
          redCount++
        }
      }
      expect(redCount).toBeGreaterThan(100)
      expect(existsSync(out)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('animated non-16:9 crop reaches a different final frame than the start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aspect-correct-'))
    const image = join(dir, 'wide.png')
    try {
      createStaticGridImage(image, WIDE_WIDTH, WIDE_HEIGHT)
      const endRect = { x: 0.05, y: 0.05, width: 0.7, height: 0.45 }
      const filter = buildAspectCorrectGraph(
        TOP_LEFT_WIDE,
        endRect,
        sampleDuration,
        WIDE_WIDTH,
        WIDE_HEIGHT,
        VARIANTS.B,
        true,
      )
      const last = computeCameraLastFrame(sampleDuration, 30)
      const f0 = join(dir, 'f0.png')
      const fLast = join(dir, 'fLast.png')
      renderFramePng(image, filter, 0, f0)
      renderFramePng(image, filter, last, fLast)
      expect(hashFile(f0)).not.toBe(hashFile(fLast))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('builds export graph with aspect-correct intermediate for wide image clip', () => {
    let doc = addClipFromSource(createEmptyProject(), {
      id: 'wide-img',
      file: new File([], 'screenshot.png', { type: 'image/png' }),
      objectUrl: 'blob:test',
      duration: 10,
      fps: 0,
      width: WIDE_WIDTH,
      height: WIDE_HEIGHT,
      hasAudio: false,
    })
    const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0].id
    doc = assignClipCameraStart(
      doc,
      clipId,
      TOP_LEFT_WIDE,
      'Crop',
      WIDE_WIDTH,
      WIDE_HEIGHT,
    )
    const asset = {
      id: 'wide-img',
      file: new File([], 'screenshot.png', { type: 'image/png' }),
      objectUrl: 'blob:test',
      duration: 10,
      fps: 0,
      width: WIDE_WIDTH,
      height: WIDE_HEIGHT,
      hasAudio: false,
    }
    const videoTrack = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
    const clip = videoTrack.clips[0]!
    const graph = buildExportGraph({
      doc,
      clips: videoTrack.clips,
      ttsClips: [],
      inputIndexByVideoClipId: new Map([[clip.id, 0]]),
      inputIndexByTtsClipId: new Map(),
      mediaStore: new Map([['wide-img', asset]]),
      mediaKindBySource: new Map([['wide-img', classifyExportAsset(asset)]]),
      audioStreamBySource: new Map([['wide-img', false]]),
      fpsBySource: new Map(),
    })
    const cameraFilter = graph.filterParts.find((part) => part.includes('zoompan='))!
    expect(cameraFilter).toContain('pad=')
    expect(cameraFilter).not.toMatch(/crop=\d/)
  })

  it('renders export graph when stored dims differ from probed file dims', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stale-meta-'))
    const image = join(dir, 'wide.png')
    const out = join(dir, 'out.mp4')
    try {
      createStaticGridImage(image, WIDE_WIDTH, WIDE_HEIGHT)
      const staleAsset = {
        id: 'wide-stale',
        file: new File([], 'wide.png', { type: 'image/png' }),
        objectUrl: 'blob:test',
        duration: 10,
        fps: 0,
        width: 1920,
        height: 1080,
        hasAudio: false,
      }
      let doc = addClipFromSource(createEmptyProject(), staleAsset)
      const clipId = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!.clips[0].id
      doc = assignClipCameraStart(doc, clipId, TOP_LEFT_WIDE, 'Crop', 1920, 1080)
      const track = doc.tracks.find((t) => t.id === MAIN_VIDEO_TRACK_ID)!
      track.clips[0] = {
        ...track.clips[0]!,
        effects: [
          ...track.clips[0]!.effects,
          {
            type: 'red-box',
            id: 'rb1',
            rect: { x: 0.2, y: 0.3, width: 0.25, height: 0.2 },
            strokeWidth: 4,
            startOffset: 0,
            endOffset: 5,
          },
        ],
      }
      const clip = track.clips[0]!
      const graph = buildExportGraph({
        doc,
        clips: track.clips,
        ttsClips: [],
        inputIndexByVideoClipId: new Map([[clip.id, 0]]),
        inputIndexByTtsClipId: new Map(),
        mediaStore: new Map([['wide-stale', staleAsset]]),
        mediaKindBySource: new Map([['wide-stale', classifyExportAsset(staleAsset)]]),
        audioStreamBySource: new Map([['wide-stale', false]]),
        fpsBySource: new Map(),
        dimensionsBySource: new Map([
          ['wide-stale', { width: WIDE_WIDTH, height: WIDE_HEIGHT }],
        ]),
      })
      execSync(
        `ffmpeg -y -loop 1 -i "${image}" -filter_complex "${graph.filterComplex}" -map "[outv]" ` +
          `-t ${sampleDuration} -c:v libx264 -preset ultrafast "${out}"`,
        { stdio: 'pipe' },
      )
      expect(existsSync(out)).toBe(true)
      const probe = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${out}"`,
      )
        .toString()
        .trim()
      expect(probe).toBe(`${evenDim(WIDE_WIDTH)},${evenDim(WIDE_HEIGHT)}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
