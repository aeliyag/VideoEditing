import {
  getCameraEffect,
  resolveFrameRect,
} from '../camera/frames'
import { clipDuration, totalDuration } from '../timeline/helpers'
import type { MediaAsset, MediaStore, ProjectDocument, TimelineClip } from '../types/project'
import { isRedBoxEffect } from '../types/project'

export type ExportMediaKind = 'audio' | 'video' | 'image'

export const EXPORT_FPS = 30
export const EXPORT_AUDIO_RATE = 44100

/** Spatial upsample factor before zoompan to reduce integer-pixel stepping. */
export const KEN_BURNS_WORKING_SCALE = 2
/** Internal Ken Burns cadence; output is still normalized to EXPORT_FPS. */
export const KEN_BURNS_RENDER_FPS = 30

export interface KenBurnsRenderOptions {
  workingScale: number
  renderFps: number
  outputFps: number
}

export const DEFAULT_KEN_BURNS_OPTIONS: KenBurnsRenderOptions = {
  workingScale: KEN_BURNS_WORKING_SCALE,
  renderFps: KEN_BURNS_RENDER_FPS,
  outputFps: EXPORT_FPS,
}

export interface ExportCanvas {
  width: number
  height: number
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

export function resolveExportCanvas(
  clips: TimelineClip[],
  mediaStore: MediaStore,
): ExportCanvas {
  let maxWidth = 0
  let maxHeight = 0

  for (const clip of clips) {
    const asset = mediaStore.get(clip.sourceId)
    if (!asset || asset.width <= 0 || asset.height <= 0) {
      continue
    }
    maxWidth = Math.max(maxWidth, asset.width)
    maxHeight = Math.max(maxHeight, asset.height)
  }

  return {
    width: evenDimension(maxWidth || 1920),
    height: evenDimension(maxHeight || 1080),
  }
}

export function buildVideoNormalizeFilter(
  inputLabel: string,
  outputLabel: string,
  canvas: ExportCanvas,
): string {
  const { width, height } = canvas
  return (
    `[${inputLabel}]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
    `format=yuv420p,fps=${EXPORT_FPS}[${outputLabel}]`
  )
}

export function buildAudioNormalizeSuffix(): string {
  return `aresample=${EXPORT_AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`
}

export function isAudioOnlyAsset(asset: { width: number; height: number }): boolean {
  return asset.width === 0 && asset.height === 0
}

export function isImageAsset(
  file: File,
  asset: { width: number; height: number; hasAudio: boolean; fps: number },
): boolean {
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
    return true
  }
  return asset.fps === 0 && !asset.hasAudio && asset.width > 0 && asset.height > 0
}

export function classifyExportAsset(asset: MediaAsset): ExportMediaKind {
  if (isAudioOnlyAsset(asset)) {
    return 'audio'
  }
  if (isImageAsset(asset.file, asset)) {
    return 'image'
  }
  return 'video'
}

function extensionFromFile(file: File, kind: ExportMediaKind): string {
  const match = file.name.match(/\.([a-z0-9]+)$/i)
  if (match?.[1]) {
    return `.${match[1].toLowerCase()}`
  }
  if (file.type.startsWith('audio/')) {
    return '.mp3'
  }
  if (file.type.startsWith('image/')) {
    return '.png'
  }
  if (kind === 'audio') {
    return '.mp3'
  }
  if (kind === 'image') {
    return '.png'
  }
  return '.mp4'
}

export function stageFileNameForAsset(index: number, asset: MediaAsset): string {
  const kind = classifyExportAsset(asset)
  const ext = extensionFromFile(asset.file, kind)
  return `input_${index}${ext}`
}

export function clampBoxDimension(value: number): number {
  return Math.max(1, Math.round(value))
}

export function formatFpsForFilter(fps: number): string {
  const rounded = Math.round(fps * 1000) / 1000
  return String(rounded)
}

export function parseFpsToken(token: string): number | null {
  if (token.includes('/')) {
    const [num, den] = token.split('/').map(Number)
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0 && num > 0) {
      return num / den
    }
    return null
  }
  const value = Number(token)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function parseVideoFpsFromLogs(logs: readonly string[]): number | null {
  for (const line of logs) {
    if (!/\bVideo:/i.test(line)) {
      continue
    }
    const match = line.match(/([\d.]+(?:\/\d+)?)\s*fps/i)
    if (match) {
      const fps = parseFpsToken(match[1]!)
      if (fps != null) {
        return fps
      }
    }
  }
  return null
}

export function resolveClipExportFps(
  sourceId: string,
  kind: ExportMediaKind,
  asset: MediaAsset,
  fpsBySource: ReadonlyMap<string, number>,
): number {
  if (kind === 'image') {
    return EXPORT_FPS
  }
  const probed = fpsBySource.get(sourceId)
  if (probed != null && probed > 0) {
    return probed
  }
  if (asset.fps > 0) {
    return asset.fps
  }
  return EXPORT_FPS
}

function formatNorm(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000
  return String(rounded)
}

export function computeCameraLastFrame(duration: number, fps = EXPORT_FPS): number {
  return Math.max(1, Math.round(duration * fps) - 1)
}

export function buildCameraZoompanExpressions(
  start: { x: number; y: number; width: number; height: number },
  end: { x: number; y: number; width: number; height: number },
  duration: number,
  renderFps = KEN_BURNS_RENDER_FPS,
): { zoom: string; x: string; y: string; lastFrame: number; ease: string } {
  const lastFrame = computeCameraLastFrame(duration, renderFps)
  const progress = `(on/${lastFrame})`
  const ease = `(${progress}*${progress}*(3-2*${progress}))`
  const lerp = (from: number, to: number) =>
    `(${formatNorm(from)}+(${formatNorm(to)}-${formatNorm(from)})*${ease})`
  const rectX = lerp(start.x, end.x)
  const rectY = lerp(start.y, end.y)
  const rectW = lerp(start.width, end.width)
  return {
    lastFrame,
    ease,
    zoom: `(1/(${rectW}))`,
    x: `(iw*(${rectX}))`,
    y: `(ih*(${rectY}))`,
  }
}

/** Integer zoompan x/y stalls (mirrors ffmpeg zoompan rounding in working space). */
export function measureZoompanCoordinateStalls(
  start: { x: number; y: number; width: number; height: number },
  end: { x: number; y: number; width: number; height: number },
  duration: number,
  workingW: number,
  workingH: number,
  renderFps: number,
  outputFps = renderFps,
): { stallFrames: number; outputFrames: number; maxJumpPx: number } {
  const lastFrame = computeCameraLastFrame(duration, renderFps)
  const frameStep = renderFps / outputFps
  let stallFrames = 0
  let outputFrames = 0
  let maxJumpPx = 0
  let prevX = -1
  let prevY = -1

  for (let on = 0; on <= lastFrame; on += frameStep) {
    const frame = Math.min(lastFrame, Math.round(on))
    const rect = evalCameraRectAtFrame(start, end, duration, frame, renderFps)
    const x = Math.round(workingW * rect.x)
    const y = Math.round(workingH * rect.y)
    if (outputFrames > 0) {
      const jump = Math.hypot(x - prevX, y - prevY)
      maxJumpPx = Math.max(maxJumpPx, jump)
      if (x === prevX && y === prevY) {
        stallFrames++
      }
    }
    prevX = x
    prevY = y
    outputFrames++
  }

  return { stallFrames, outputFrames, maxJumpPx }
}

/** Evaluate the animated rect at a zoompan output frame (mirrors ffmpeg expressions). */
export function evalCameraRectAtFrame(
  start: { x: number; y: number; width: number; height: number },
  end: { x: number; y: number; width: number; height: number },
  duration: number,
  frame: number,
  renderFps = KEN_BURNS_RENDER_FPS,
): { x: number; y: number; width: number; height: number } {
  const lastFrame = computeCameraLastFrame(duration, renderFps)
  const on = Math.max(0, Math.min(lastFrame, frame))
  const p = on / lastFrame
  const ease = p * p * (3 - 2 * p)
  return {
    x: start.x + (end.x - start.x) * ease,
    y: start.y + (end.y - start.y) * ease,
    width: start.width + (end.width - start.width) * ease,
    height: start.height + (end.height - start.height) * ease,
  }
}

export function buildKenBurnsFilterChain(
  inputLabel: string,
  outLabel: string,
  pan: { zoom: string; x: string; y: string },
  outW: number,
  outH: number,
  options: KenBurnsRenderOptions = DEFAULT_KEN_BURNS_OPTIONS,
): string {
  const workingW = evenDimension(outW * options.workingScale)
  const workingH = evenDimension(outH * options.workingScale)
  const renderFps = formatFpsForFilter(options.renderFps)
  const outputFps = formatFpsForFilter(options.outputFps)

  const parts = [
    `[${inputLabel}]setsar=1`,
    `scale=${workingW}:${workingH}:flags=bicubic`,
    `fps=${renderFps}`,
    `zoompan=z='${pan.zoom}':x='${pan.x}':y='${pan.y}':d=1:s=${workingW}x${workingH}:fps=${renderFps}`,
    `scale=${outW}:${outH}:flags=lanczos`,
  ]

  if (options.renderFps !== options.outputFps) {
    parts.push(`fps=${outputFps}`)
  }

  parts.push(`setpts=N/(${outputFps}*TB)`, `format=yuv420p[${outLabel}]`)
  return parts.join(',')
}

function buildCameraFilter(
  doc: ProjectDocument,
  clip: TimelineClip,
  inputLabel: string,
  outLabel: string,
  sourceWidth: number,
  sourceHeight: number,
): string {
  const camera = getCameraEffect(clip)!
  const start = resolveFrameRect(doc, camera.startFrameId, sourceWidth, sourceHeight)
  const end = resolveFrameRect(
    doc,
    camera.endFrameId ?? camera.startFrameId,
    sourceWidth,
    sourceHeight,
  )
  const d = clipDuration(clip)
  if (d <= 0) {
    return `[${inputLabel}]null[${outLabel}]`
  }

  const pan = buildCameraZoompanExpressions(start, end, d, DEFAULT_KEN_BURNS_OPTIONS.renderFps)
  const outW = evenDimension(sourceWidth)
  const outH = evenDimension(sourceHeight)

  return buildKenBurnsFilterChain(inputLabel, outLabel, pan, outW, outH, DEFAULT_KEN_BURNS_OPTIONS)
}

function buildVideoTrimFilter(
  inputIndex: number,
  clip: TimelineClip,
  trimLabel: string,
  kind: ExportMediaKind,
  clipFps: number,
): string {
  const fpsLabel = formatFpsForFilter(clipFps)
  if (kind === 'image') {
    const duration = Math.max(clipDuration(clip), 0.04)
    return (
      `[${inputIndex}:v]loop=loop=-1:size=1:start=0,` +
      `trim=duration=${duration},setpts=PTS-STARTPTS,fps=${fpsLabel},format=yuv420p[${trimLabel}]`
    )
  }

  const start = clip.sourceStart
  const end = clip.sourceEnd
  return `[${inputIndex}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=${fpsLabel},format=yuv420p[${trimLabel}]`
}

export function clipUsesSourceAudio(
  clip: TimelineClip,
  asset: MediaAsset,
  kind: ExportMediaKind,
  audioStreamBySource: ReadonlyMap<string, boolean>,
): boolean {
  if (kind === 'image' || clip.muteVideoAudio) {
    return false
  }
  if (!asset.hasAudio) {
    return false
  }
  return audioStreamBySource.get(clip.sourceId) === true
}

export interface BuildExportGraphArgs {
  doc: ProjectDocument
  clips: TimelineClip[]
  ttsClips: TimelineClip[]
  inputIndexBySource: ReadonlyMap<string, number>
  mediaStore: MediaStore
  mediaKindBySource: ReadonlyMap<string, ExportMediaKind>
  audioStreamBySource: ReadonlyMap<string, boolean>
  fpsBySource: ReadonlyMap<string, number>
}

export interface ExportGraphResult {
  filterParts: string[]
  filterComplex: string
  mapAudio: boolean
  useTtsMix: boolean
}

export function buildExportGraph(args: BuildExportGraphArgs): ExportGraphResult {
  const {
    doc,
    clips,
    ttsClips,
    inputIndexBySource,
    mediaStore,
    mediaKindBySource,
    audioStreamBySource,
    fpsBySource,
  } = args

  const exportLength = totalDuration(doc)
  const exportCanvas = resolveExportCanvas(clips, mediaStore)
  const filterParts: string[] = []
  const concatInputs: string[] = []
  const audioNormalize = buildAudioNormalizeSuffix()

  const clipUsesSource = clips.map((clip) => {
    const asset = mediaStore.get(clip.sourceId)!
    const kind = mediaKindBySource.get(clip.sourceId) ?? 'video'
    return clipUsesSourceAudio(clip, asset, kind, audioStreamBySource)
  })

  const concatWithAudio = ttsClips.length > 0 || clipUsesSource.some(Boolean)

  clips.forEach((clip, index) => {
    const inputIndex = inputIndexBySource.get(clip.sourceId)!
    const asset = mediaStore.get(clip.sourceId)!
    const kind = mediaKindBySource.get(clip.sourceId) ?? classifyExportAsset(asset)
    const clipFps = resolveClipExportFps(clip.sourceId, kind, asset, fpsBySource)
    const trimLabel = `vt${index}`

    filterParts.push(buildVideoTrimFilter(inputIndex, clip, trimLabel, kind, clipFps))

    const camera = getCameraEffect(clip)
    let vOut = trimLabel
    if (camera && (camera.startFrameId || camera.endFrameId)) {
      const vLabel = `v${index}`
      filterParts.push(
        buildCameraFilter(doc, clip, trimLabel, vLabel, asset.width, asset.height),
      )
      vOut = vLabel
    }

    const redBox = clip.effects.find(isRedBoxEffect)
    if (redBox) {
      const annotationLabel = `va${index}`
      const x = Math.round(redBox.rect.x * asset.width)
      const y = Math.round(redBox.rect.y * asset.height)
      const width = clampBoxDimension(redBox.rect.width * asset.width)
      const height = clampBoxDimension(redBox.rect.height * asset.height)
      const annotationStart = redBox.startOffset ?? 0
      const annotationEnd = redBox.endOffset ?? clipDuration(clip)
      filterParts.push(
        `[${vOut}]drawbox=x=${x}:y=${y}:w=${width}:h=${height}:` +
          `color=red@1:t=${redBox.strokeWidth}:` +
          `enable='between(t,${annotationStart},${annotationEnd})'[${annotationLabel}]`,
      )
      vOut = annotationLabel
    }

    const normalizedLabel = `vn${index}`
    filterParts.push(buildVideoNormalizeFilter(vOut, normalizedLabel, exportCanvas))
    concatInputs.push(`[${normalizedLabel}]`)

    if (concatWithAudio) {
      const aLabel = `a${index}`
      const duration = Math.max(clipDuration(clip), 0.04)
      if (clipUsesSource[index]) {
        const start = clip.sourceStart
        const end = clip.sourceEnd
        filterParts.push(
          `[${inputIndex}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,${audioNormalize}[${aLabel}]`,
        )
      } else {
        filterParts.push(
          `anullsrc=r=${EXPORT_AUDIO_RATE}:cl=stereo:d=${duration}[${aLabel}]`,
        )
      }
      concatInputs.push(`[${aLabel}]`)
    }
  })

  const n = clips.length
  if (concatWithAudio) {
    filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=1[outv][outa]`)
  } else {
    filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=0[outv]`)
  }

  const useTtsMix = ttsClips.length > 0
  if (useTtsMix) {
    const mixInputs: string[] = []
    if (concatWithAudio) {
      mixInputs.push('[outa]')
    } else {
      filterParts.push(
        `anullsrc=r=${EXPORT_AUDIO_RATE}:cl=stereo:d=${Math.max(exportLength, 0.01)}[silentbed]`,
      )
      mixInputs.push('[silentbed]')
    }

    ttsClips.forEach((clip, index) => {
      const inputIndex = inputIndexBySource.get(clip.sourceId)!
      const delayMs = Math.max(0, Math.round(clip.timelineStart * 1000))
      const label = `tts${index}`
      filterParts.push(
        `[${inputIndex}:a]atrim=start=${clip.sourceStart}:end=${clip.sourceEnd},` +
          `asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},${audioNormalize}[${label}]`,
      )
      mixInputs.push(`[${label}]`)
    })

    filterParts.push(
      `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0[aout]`,
    )
  }

  const filterComplex = filterParts.join(';')
  const mapAudio = useTtsMix || concatWithAudio

  return {
    filterParts,
    filterComplex,
    mapAudio,
    useTtsMix,
  }
}

export function formatFfmpegError(exitCode: number, logs: string[]): string {
  const meaningful = logs.filter((line) =>
    /error|invalid|no such|matches no streams|failed|cannot find/i.test(line),
  )
  const tail = (meaningful.length > 0 ? meaningful : logs).slice(-8).join(' | ')
  if (tail) {
    return `FFmpeg could not render this project (exit code ${exitCode}): ${tail}`
  }
  return `FFmpeg could not render this project (exit code ${exitCode}).`
}

export function parseAudioStreamFromLogs(logs: readonly string[]): boolean {
  return logs.some((line) => /\bAudio:/i.test(line))
}
