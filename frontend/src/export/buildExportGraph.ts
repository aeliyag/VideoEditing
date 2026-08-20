import {
  getCameraEffect,
  isFullFrameRect,
  resolveFrameRect,
} from '../camera/frames'
import { mapOutputFrameRectToDrawbox } from '../camera/overlayCoords'
import { DEFAULT_RED_BOX_STROKE_WIDTH } from '../camera/redBoxOps'
import { clipDuration, totalDuration } from '../timeline/helpers'
import type { FrameRect, MediaAsset, MediaStore, ProjectDocument, TimelineClip } from '../types/project'
import { isElementEffect, isRedBoxEffect } from '../types/project'

export interface ExportFrameDimensions {
  width: number
  height: number
}

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

export function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/** Even output size for a clip's video stream (post-camera / drawbox space). */
export function resolveClipFrameDimensions(
  asset: MediaAsset,
  override?: ExportFrameDimensions,
): ExportFrameDimensions {
  const width = override?.width ?? asset.width
  const height = override?.height ?? asset.height
  return {
    width: evenDimension(width),
    height: evenDimension(height),
  }
}

export function resolveAssetFrameDimensions(
  sourceId: string,
  asset: MediaAsset,
  dimensionsBySource?: ReadonlyMap<string, ExportFrameDimensions>,
): ExportFrameDimensions {
  return resolveClipFrameDimensions(asset, dimensionsBySource?.get(sourceId))
}

export function shouldApplyCameraFilter(
  doc: ProjectDocument,
  clip: TimelineClip,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  const camera = getCameraEffect(clip)
  if (!camera || (!camera.startFrameId && !camera.endFrameId)) {
    return false
  }
  const start = resolveFrameRect(doc, camera.startFrameId, sourceWidth, sourceHeight)
  const end = resolveFrameRect(
    doc,
    camera.endFrameId ?? camera.startFrameId,
    sourceWidth,
    sourceHeight,
  )
  return !(isFullFrameRect(start) && isFullFrameRect(end))
}

const UNIFORM_CROP_TOLERANCE = 0.001

/** True when normalized crop width ≈ height (16:9 sources); zoompan is valid. */
export function cameraRectsUseUniformZoompan(
  start: { width: number; height: number },
  end: { width: number; height: number },
): boolean {
  return (
    Math.abs(start.width - start.height) <= UNIFORM_CROP_TOLERANCE &&
    Math.abs(end.width - end.height) <= UNIFORM_CROP_TOLERANCE
  )
}

/** 16:9 zoompan canvas size for non-16:9 sources (independent X/Y final scale). */
export function resolveAspectCorrectIntermediateSize(
  workingScale: number,
): { width: number; height: number } {
  const height = evenDimension(1080 * workingScale)
  return {
    width: evenDimension(height * (16 / 9)),
    height,
  }
}

export interface Padded169Layout {
  canvasWidth: number
  canvasHeight: number
  padLeft: number
  padTop: number
}

/** Embed a source in a 16:9 canvas with pillarbox/letterbox padding. */
export function resolvePadded169Layout(
  sourceWidth: number,
  sourceHeight: number,
): Padded169Layout {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { canvasWidth: 1920, canvasHeight: 1080, padLeft: 0, padTop: 0 }
  }
  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = 16 / 9
  if (sourceAspect >= targetAspect) {
    const canvasWidth = sourceWidth
    const canvasHeight = evenDimension(Math.round((canvasWidth * 9) / 16))
    return {
      canvasWidth,
      canvasHeight,
      padLeft: 0,
      padTop: (canvasHeight - sourceHeight) / 2,
    }
  }
  const canvasHeight = sourceHeight
  const canvasWidth = evenDimension(Math.round((canvasHeight * 16) / 9))
  return {
    canvasWidth,
    canvasHeight,
    padLeft: (canvasWidth - sourceWidth) / 2,
    padTop: 0,
  }
}

/** Map source-normalized camera rects into padded 16:9 canvas coordinates. */
export function transformRectToPadded169Space(
  rect: FrameRect,
  layout: Padded169Layout,
  sourceWidth: number,
  sourceHeight: number,
): FrameRect {
  const pixelX = rect.x * sourceWidth + layout.padLeft
  const pixelY = rect.y * sourceHeight + layout.padTop
  const pixelW = rect.width * sourceWidth
  const pixelH = rect.height * sourceHeight
  return {
    x: pixelX / layout.canvasWidth,
    y: pixelY / layout.canvasHeight,
    width: pixelW / layout.canvasWidth,
    height: pixelH / layout.canvasHeight,
  }
}

export function resolveExportCanvas(
  clips: TimelineClip[],
  mediaStore: MediaStore,
  dimensionsBySource?: ReadonlyMap<string, ExportFrameDimensions>,
): ExportCanvas {
  let maxWidth = 0
  let maxHeight = 0

  for (const clip of clips) {
    const asset = mediaStore.get(clip.sourceId)
    if (!asset) {
      continue
    }
    const dims = resolveAssetFrameDimensions(clip.sourceId, asset, dimensionsBySource)
    if (dims.width <= 0 || dims.height <= 0) {
      continue
    }
    maxWidth = Math.max(maxWidth, dims.width)
    maxHeight = Math.max(maxHeight, dims.height)
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
  zoompanSize?: { width: number; height: number },
): string {
  const workingW = evenDimension(outW * options.workingScale)
  const workingH = evenDimension(outH * options.workingScale)
  const panW = zoompanSize?.width ?? workingW
  const panH = zoompanSize?.height ?? workingH
  const renderFps = formatFpsForFilter(options.renderFps)
  const outputFps = formatFpsForFilter(options.outputFps)

  const parts = [
    `[${inputLabel}]setsar=1`,
    `scale=${workingW}:${workingH}:flags=bicubic`,
    `fps=${renderFps}`,
    `zoompan=z='${pan.zoom}':x='${pan.x}':y='${pan.y}':d=1:s=${panW}x${panH}:fps=${renderFps}`,
    `scale=${outW}:${outH}:flags=lanczos`,
  ]

  if (options.renderFps !== options.outputFps) {
    parts.push(`fps=${outputFps}`)
  }

  parts.push(`setpts=N/(${outputFps}*TB)`, `format=yuv420p[${outLabel}]`)
  return parts.join(',')
}

/** Ken Burns via padded 16:9 canvas, then scale to clip frame (non-16:9 sources). */
export function buildPadded169KenBurnsFilterChain(
  inputLabel: string,
  outLabel: string,
  pan: { zoom: string; x: string; y: string },
  outW: number,
  outH: number,
  layout: Padded169Layout,
  options: KenBurnsRenderOptions = DEFAULT_KEN_BURNS_OPTIONS,
): string {
  const workingScale = options.workingScale
  const sourceWorkingW = evenDimension(outW * workingScale)
  const sourceWorkingH = evenDimension(outH * workingScale)
  const canvasWorkingW = evenDimension(layout.canvasWidth * workingScale)
  const canvasWorkingH = evenDimension(layout.canvasHeight * workingScale)
  const padLeft = Math.round(layout.padLeft * workingScale)
  const padTop = Math.round(layout.padTop * workingScale)
  const renderFps = formatFpsForFilter(options.renderFps)
  const outputFps = formatFpsForFilter(options.outputFps)

  const parts = [
    `[${inputLabel}]setsar=1`,
    `scale=${sourceWorkingW}:${sourceWorkingH}:flags=bicubic`,
    `pad=${canvasWorkingW}:${canvasWorkingH}:${padLeft}:${padTop}:color=black`,
    `fps=${renderFps}`,
    `zoompan=z='${pan.zoom}':x='${pan.x}':y='${pan.y}':d=1:s=${canvasWorkingW}x${canvasWorkingH}:fps=${renderFps}`,
    `scale=${outW}:${outH}:flags=lanczos`,
  ]

  if (options.renderFps !== options.outputFps) {
    parts.push(`fps=${outputFps}`)
  }

  parts.push(`setpts=N/(${outputFps}*TB)`, `format=yuv420p[${outLabel}]`)
  return parts.join(',')
}

/** @deprecated Use buildPadded169KenBurnsFilterChain — kept for existing tests. */
export function buildAspectCorrectKenBurnsFilterChain(
  inputLabel: string,
  outLabel: string,
  pan: { zoom: string; x: string; y: string },
  outW: number,
  outH: number,
  options: KenBurnsRenderOptions = DEFAULT_KEN_BURNS_OPTIONS,
): string {
  const intermediate = resolveAspectCorrectIntermediateSize(options.workingScale)
  return buildKenBurnsFilterChain(
    inputLabel,
    outLabel,
    pan,
    outW,
    outH,
    options,
    intermediate,
  )
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

  const outW = evenDimension(sourceWidth)
  const outH = evenDimension(sourceHeight)

  const layout = resolvePadded169Layout(outW, outH)
  const pan = buildCameraZoompanExpressions(start, end, d, DEFAULT_KEN_BURNS_OPTIONS.renderFps)
  if (cameraRectsUseUniformZoompan(start, end)) {
    return buildKenBurnsFilterChain(inputLabel, outLabel, pan, outW, outH, DEFAULT_KEN_BURNS_OPTIONS)
  }

  const paddedStart = transformRectToPadded169Space(start, layout, outW, outH)
  const paddedEnd = transformRectToPadded169Space(end, layout, outW, outH)
  const paddedPan = buildCameraZoompanExpressions(
    paddedStart,
    paddedEnd,
    d,
    DEFAULT_KEN_BURNS_OPTIONS.renderFps,
  )

  return buildPadded169KenBurnsFilterChain(
    inputLabel,
    outLabel,
    paddedPan,
    outW,
    outH,
    layout,
    DEFAULT_KEN_BURNS_OPTIONS,
  )
}

function buildVideoTrimFilter(
  videoInputLabel: string,
  clip: TimelineClip,
  trimLabel: string,
  kind: ExportMediaKind,
  clipFps: number,
): string {
  const fpsLabel = formatFpsForFilter(clipFps)
  if (kind === 'image') {
    const duration = Math.max(clipDuration(clip), 0.04)
    return (
      `[${videoInputLabel}]loop=loop=-1:size=1:start=0,` +
      `trim=duration=${duration},setpts=PTS-STARTPTS,fps=${fpsLabel},format=yuv420p[${trimLabel}]`
    )
  }

  const start = clip.sourceStart
  const end = clip.sourceEnd
  return `[${videoInputLabel}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=${fpsLabel},format=yuv420p[${trimLabel}]`
}

export function clipUsesSourceAudio(
  clip: TimelineClip,
  asset: MediaAsset,
  kind: ExportMediaKind,
  audioStreamBySource: ReadonlyMap<string, boolean>,
  inputIndex?: number,
  audioStreamByInputIndex?: ReadonlyMap<number, boolean>,
): boolean {
  if (kind !== 'video' || clip.muteVideoAudio) {
    return false
  }
  if (
    inputIndex != null &&
    audioStreamByInputIndex != null &&
    audioStreamByInputIndex.has(inputIndex)
  ) {
    return audioStreamByInputIndex.get(inputIndex) === true
  }
  return audioStreamBySource.get(clip.sourceId) === true
}

export function resolveExportMediaKind(
  sourceId: string,
  asset: MediaAsset,
  mediaKindBySource: ReadonlyMap<string, ExportMediaKind>,
): ExportMediaKind {
  return mediaKindBySource.get(sourceId) ?? classifyExportAsset(asset)
}

export interface BuildExportGraphArgs {
  doc: ProjectDocument
  clips: TimelineClip[]
  ttsClips: TimelineClip[]
  inputIndexByVideoClipId: ReadonlyMap<string, number>
  inputIndexByTtsClipId: ReadonlyMap<string, number>
  mediaStore: MediaStore
  mediaKindBySource: ReadonlyMap<string, ExportMediaKind>
  audioStreamBySource: ReadonlyMap<string, boolean>
  /** When set, only these input indices may use `[N:a]` (one ffmpeg `-i` each). */
  audioStreamByInputIndex?: ReadonlyMap<number, boolean>
  fpsBySource: ReadonlyMap<string, number>
  inputIndexByElementId?: ReadonlyMap<string, number>
  dimensionsBySource?: ReadonlyMap<string, ExportFrameDimensions>
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
    inputIndexByVideoClipId,
    inputIndexByTtsClipId,
    mediaStore,
    mediaKindBySource,
    audioStreamBySource,
    audioStreamByInputIndex,
    fpsBySource,
    inputIndexByElementId = new Map(),
    dimensionsBySource,
  } = args

  const exportLength = totalDuration(doc)
  const exportCanvas = resolveExportCanvas(clips, mediaStore, dimensionsBySource)
  const filterParts: string[] = []
  const concatInputs: string[] = []
  const audioNormalize = buildAudioNormalizeSuffix()

  const clipUsesSource = clips.map((clip) => {
    const asset = mediaStore.get(clip.sourceId)!
    const inputIndex = inputIndexByVideoClipId.get(clip.id)!
    const kind = resolveExportMediaKind(clip.sourceId, asset, mediaKindBySource)
    return clipUsesSourceAudio(
      clip,
      asset,
      kind,
      audioStreamBySource,
      inputIndex,
      audioStreamByInputIndex,
    )
  })

  const concatWithAudio = ttsClips.length > 0 || clipUsesSource.some(Boolean)

  clips.forEach((clip, index) => {
    const inputIndex = inputIndexByVideoClipId.get(clip.id)!
    const asset = mediaStore.get(clip.sourceId)!
    const kind = resolveExportMediaKind(clip.sourceId, asset, mediaKindBySource)
    const clipFps = resolveClipExportFps(clip.sourceId, kind, asset, fpsBySource)
    const trimLabel = `vt${index}`
    const videoInputLabel = `${inputIndex}:v`

    filterParts.push(buildVideoTrimFilter(videoInputLabel, clip, trimLabel, kind, clipFps))

    const frameDims = resolveAssetFrameDimensions(clip.sourceId, asset, dimensionsBySource)
    let vOut = trimLabel
    if (shouldApplyCameraFilter(doc, clip, frameDims.width, frameDims.height)) {
      const vLabel = `v${index}`
      filterParts.push(
        buildCameraFilter(doc, clip, trimLabel, vLabel, frameDims.width, frameDims.height),
      )
      vOut = vLabel
    }

    const frameSize = resolveClipFrameDimensions(asset, dimensionsBySource?.get(clip.sourceId))
    const redBoxes = clip.effects.filter(isRedBoxEffect)
    redBoxes.forEach((redBox, boxIndex) => {
      const annotationLabel = `va${index}_${boxIndex}`
      const drawbox = mapOutputFrameRectToDrawbox(redBox.rect, frameSize.width, frameSize.height)
      const annotationStart = redBox.startOffset ?? 0
      const annotationEnd = redBox.endOffset ?? clipDuration(clip)
      const strokeWidth = redBox.strokeWidth ?? DEFAULT_RED_BOX_STROKE_WIDTH
      filterParts.push(
        `[${vOut}]drawbox=x=${drawbox.x}:y=${drawbox.y}:w=${drawbox.width}:h=${drawbox.height}:` +
          `color=red@1:t=${strokeWidth}:` +
          `enable='between(t,${annotationStart},${annotationEnd})'[${annotationLabel}]`,
      )
      vOut = annotationLabel
    })

    const elements = clip.effects.filter(isElementEffect).sort((a, b) => a.z - b.z)
    elements.forEach((element, elIndex) => {
      const elInput = inputIndexByElementId.get(element.id)
      if (elInput == null) {
        return
      }
      const scaledLabel = `els${index}_${elIndex}`
      const outLabel = `el${index}_${elIndex}`
      const w = clampBoxDimension(element.rect.width * frameDims.width)
      const h = clampBoxDimension(element.rect.height * frameDims.height)
      const x = Math.round(element.rect.x * frameDims.width)
      const y = Math.round(element.rect.y * frameDims.height)
      const start = element.startOffset ?? 0
      const end = element.endOffset ?? clipDuration(clip)
      filterParts.push(`[${elInput}:v]scale=${w}:${h},format=rgba[${scaledLabel}]`)
      filterParts.push(
        `[${vOut}][${scaledLabel}]overlay=x=${x}:y=${y}:` +
          `enable='between(t,${start},${end})':format=auto[${outLabel}]`,
      )
      vOut = outLabel
    })

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
      const inputIndex = inputIndexByTtsClipId.get(clip.id)!
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

function shortenFfmpegLogLine(line: string, maxLength = 160): string {
  const trimmed = line.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  const filtergraphIdx = trimmed.indexOf('filtergraph description')
  if (filtergraphIdx >= 0) {
    const prefix = trimmed.slice(0, filtergraphIdx + 'filtergraph description'.length)
    return `${prefix} … (filter graph truncated)`
  }
  return `${trimmed.slice(0, maxLength - 1)}…`
}

function inferFailedInputIndex(logs: readonly string[]): number | null {
  for (const line of logs) {
    const match = line.match(/(?:stream|Input stream)\s+#(\d+)(?::|\])/i)
    if (match) {
      const index = Number(match[1])
      if (Number.isFinite(index)) {
        return index
      }
    }
  }
  return null
}

export function formatFfmpegError(
  exitCode: number,
  logs: string[],
  clipCount?: number,
): string {
  const meaningful = logs.filter((line) =>
    /error|invalid|no such|matches no streams|failed|cannot find/i.test(line),
  )
  const tail = (meaningful.length > 0 ? meaningful : logs)
    .slice(-4)
    .map((line) => shortenFfmpegLogLine(line))
    .join(' | ')
  const inputIndex = inferFailedInputIndex(logs)
  const clipHint =
    inputIndex != null && clipCount != null && inputIndex < clipCount
      ? ` (near timeline clip ${inputIndex + 1})`
      : inputIndex != null
        ? ` (input stream #${inputIndex})`
        : ''
  if (tail) {
    return `FFmpeg could not render this project (exit code ${exitCode})${clipHint}: ${tail}`
  }
  return `FFmpeg could not render this project (exit code ${exitCode})${clipHint}.`
}

export function parseVideoDimensionsFromLogs(
  logs: readonly string[],
): ExportFrameDimensions | null {
  for (const line of logs) {
    if (!/\bVideo:/i.test(line)) {
      continue
    }
    const match = line.match(/(\d{2,})x(\d{2,})/)
    if (!match) {
      continue
    }
    const width = Number(match[1])
    const height = Number(match[2])
    if (width > 0 && height > 0) {
      return { width, height }
    }
  }
  return null
}

export function parseAudioStreamFromLogs(logs: readonly string[]): boolean {
  return logs.some((line) => /Stream\s+#\d+:\d+.*\bAudio:/i.test(line))
}
