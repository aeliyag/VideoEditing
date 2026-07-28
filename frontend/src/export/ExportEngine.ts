import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

import type { ProjectDocument, MediaStore, TimelineClip } from '../types/project'
import { isRedBoxEffect } from '../types/project'
import { getVideoTrack, sortedClips, clipDuration } from '../timeline/helpers'
import {
  getCameraEffect,
  resolveFrameRect,
} from '../camera/frames'

const CORE_VERSION = '0.12.6'

let ffmpegInstance: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

async function getFfmpeg(onLog?: (message: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) {
    return ffmpegInstance
  }
  if (loadPromise) {
    return loadPromise
  }

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg()
    ffmpeg.on('log', ({ message }) => {
      onLog?.(message)
    })
    const baseURL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    ffmpegInstance = ffmpeg
    return ffmpeg
  })()

  return loadPromise
}

function uniqueSourceIds(doc: ProjectDocument): string[] {
  const track = getVideoTrack(doc)
  if (!track) {
    return []
  }
  return [...new Set(sortedClips(track).map((c) => c.sourceId))]
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
  const start = resolveFrameRect(
    doc,
    camera.startFrameId,
    sourceWidth,
    sourceHeight,
  )
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

  // Render Ken Burns at 60fps with smoothstep easing, then downsample to 30fps.
  // Higher temporal resolution + eased progress reduces zoompan stair-step jitter.
  const renderFps = 60
  const outputFps = 30
  const frameCount = Math.max(2, Math.round(d * renderFps))
  const lastFrame = Math.max(1, frameCount - 1)

  // Output canvas is 16:9; zoompan samples a 16:9 window from the source.
  const outW = Math.max(2, Math.round(sourceWidth / 2) * 2)
  const outH = Math.max(2, Math.round((outW * 9) / 16 / 2) * 2)

  const startCropW = start.width * sourceWidth
  const endCropW = end.width * sourceWidth
  const startZoom = outW / Math.max(1, startCropW)
  const endZoom = outW / Math.max(1, endCropW)
  const startX = start.x * sourceWidth
  const startY = start.y * sourceHeight
  const endX = end.x * sourceWidth
  const endY = end.y * sourceHeight

  // Smoothstep: p*p*(3-2*p) where p = on/lastFrame
  const p = `(on/${lastFrame})`
  const ease = `(${p}*${p}*(3-2*${p}))`

  // Render at 16:9 via zoompan, then scale to the source frame size so concat
  // matches non-camera clips and preview fill behavior.
  return (
    `[${inputLabel}]zoompan=` +
    `z='${startZoom}+(${endZoom}-${startZoom})*${ease}':` +
    `x='${startX}+(${endX}-${startX})*${ease}':` +
    `y='${startY}+(${endY}-${startY})*${ease}':` +
    `d=1:s=${outW}x${outH}:fps=${renderFps},` +
    `fps=${outputFps},` +
    `scale=${sourceWidth}:${sourceHeight}:flags=bicubic[${outLabel}]`
  )
}

export type ExportProgress = (ratio: number, message: string) => void

export async function exportProjectToMp4(
  doc: ProjectDocument,
  mediaStore: MediaStore,
  onProgress?: ExportProgress,
): Promise<Blob> {
  const track = getVideoTrack(doc)
  if (!track || track.clips.length === 0) {
    throw new Error('Nothing to export. Import and edit a video first.')
  }

  onProgress?.(0.05, 'Loading FFmpeg…')
  const ffmpeg = await getFfmpeg((msg) => onProgress?.(0.1, msg))

  const clips = sortedClips(track)
  const sourceIds = uniqueSourceIds(doc)
  const inputIndexBySource = new Map<string, number>()
  const outputName = 'output.mp4'

  try {
    await ffmpeg.deleteFile(outputName)
  } catch {
    // The first export has no previous output.
  }

  for (let i = 0; i < sourceIds.length; i++) {
    const sourceId = sourceIds[i]!
    const asset = mediaStore.get(sourceId)
    if (!asset) {
      throw new Error('Missing media for export.')
    }
    const name = `input_${i}.mp4`
    await ffmpeg.writeFile(name, await fetchFile(asset.file))
    inputIndexBySource.set(sourceId, i)
    onProgress?.(0.1 + (0.2 * (i + 1)) / sourceIds.length, `Staged ${asset.file.name}`)
  }

  const hasAudio = clips.some((c) => mediaStore.get(c.sourceId)?.hasAudio)
  const filterParts: string[] = []
  const concatInputs: string[] = []

  clips.forEach((clip, index) => {
    const inputIndex = inputIndexBySource.get(clip.sourceId)!
    const asset = mediaStore.get(clip.sourceId)!
    const start = clip.sourceStart
    const end = clip.sourceEnd
    const trimLabel = `vt${index}`
    filterParts.push(
      `[${inputIndex}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=30[${trimLabel}]`,
    )

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
      const width = Math.round(redBox.rect.width * asset.width)
      const height = Math.round(redBox.rect.height * asset.height)
      const annotationStart = redBox.startOffset ?? 0
      const annotationEnd = redBox.endOffset ?? clipDuration(clip)
      filterParts.push(
        `[${vOut}]drawbox=x=${x}:y=${y}:w=${width}:h=${height}:` +
          `color=red@1:t=${redBox.strokeWidth}:` +
          `enable='between(t,${annotationStart},${annotationEnd})'[${annotationLabel}]`,
      )
      vOut = annotationLabel
    }
    concatInputs.push(`[${vOut}]`)

    if (hasAudio) {
      const aLabel = `a${index}`
      filterParts.push(
        `[${inputIndex}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[${aLabel}]`,
      )
      concatInputs.push(`[${aLabel}]`)
    }
  })

  const n = clips.length
  if (hasAudio) {
    filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=1[outv][outa]`)
  } else {
    filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=0[outv]`)
  }

  const filterComplex = filterParts.join(';')
  const args = [
    ...sourceIds.flatMap((_, i) => ['-i', `input_${i}.mp4`]),
    '-filter_complex',
    filterComplex,
    '-map',
    '[outv]',
  ]
  if (hasAudio) {
    args.push('-map', '[outa]', '-c:a', 'aac')
  }
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-y', outputName)

  onProgress?.(0.35, 'Encoding…')
  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(0.35 + progress * 0.6, 'Encoding…')
  })

  const exitCode = await ffmpeg.exec(args)
  if (exitCode !== 0) {
    throw new Error(`FFmpeg could not render this project (exit code ${exitCode}).`)
  }

  onProgress?.(0.98, 'Finalizing…')
  const data = await ffmpeg.readFile(outputName)
  if (typeof data === 'string') {
    throw new Error('Unexpected export output.')
  }
  onProgress?.(1, 'Done')

  for (let i = 0; i < sourceIds.length; i++) {
    try {
      await ffmpeg.deleteFile(`input_${i}.mp4`)
    } catch {
      // Cleanup must not invalidate a completed export.
    }
  }
  await ffmpeg.deleteFile(outputName)
  return new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' })
}
