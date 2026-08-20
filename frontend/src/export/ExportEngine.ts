import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

import {
  buildExportGraph,
  classifyExportAsset,
  formatFfmpegError,
  parseAudioStreamFromLogs,
  parseVideoDimensionsFromLogs,
  parseVideoFpsFromLogs,
  stageFileNameForAsset,
  type ExportFrameDimensions,
} from './buildExportGraph'
import { collectAllElements } from '../elements/elementOps'
import { rasterizeElement } from '../elements/rasterizeElement'
import type { ProjectDocument, MediaStore, TimelineClip } from '../types/project'
import { getVideoTrack, getAudioTrack, sortedClips } from '../timeline/helpers'

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

async function probeStagedVideoStream(
  ffmpeg: FFmpeg,
  filename: string,
): Promise<{ hasAudio: boolean; fps: number | null; dimensions: ExportFrameDimensions | null }> {
  const logs: string[] = []
  const onLog = ({ message }: { message: string }) => {
    logs.push(message)
  }
  ffmpeg.on('log', onLog)
  try {
    await ffmpeg.exec(['-i', filename, '-f', 'null', '-'])
  } catch {
    // FFmpeg returns non-zero for probe-only runs; logs still contain stream info.
  } finally {
    ffmpeg.off('log', onLog)
  }
  return {
    hasAudio: parseAudioStreamFromLogs(logs),
    fps: parseVideoFpsFromLogs(logs),
    dimensions: parseVideoDimensionsFromLogs(logs),
  }
}

function buildAudioStreamByInputIndex(
  clips: TimelineClip[],
  ttsClips: TimelineClip[],
  inputIndexByVideoClipId: ReadonlyMap<string, number>,
  inputIndexByTtsClipId: ReadonlyMap<string, number>,
  mediaKindBySource: ReadonlyMap<string, ReturnType<typeof classifyExportAsset>>,
  audioStreamBySource: ReadonlyMap<string, boolean>,
): Map<number, boolean> {
  const audioStreamByInputIndex = new Map<number, boolean>()
  for (const clip of clips) {
    const inputIndex = inputIndexByVideoClipId.get(clip.id)!
    const kind = mediaKindBySource.get(clip.sourceId) ?? 'video'
    audioStreamByInputIndex.set(
      inputIndex,
      kind === 'video' && audioStreamBySource.get(clip.sourceId) === true,
    )
  }
  for (const clip of ttsClips) {
    audioStreamByInputIndex.set(inputIndexByTtsClipId.get(clip.id)!, true)
  }
  return audioStreamByInputIndex
}

function uniqueSourceIds(clips: TimelineClip[], ttsClips: TimelineClip[]): string[] {
  return [...new Set([...clips.map((c) => c.sourceId), ...ttsClips.map((c) => c.sourceId)])]
}

function assignInputIndices(
  clips: TimelineClip[],
  ttsClips: TimelineClip[],
  elementIds: string[],
): {
  inputIndexByVideoClipId: Map<string, number>
  inputIndexByTtsClipId: Map<string, number>
  inputIndexByElementId: Map<string, number>
  inputCount: number
} {
  const inputIndexByVideoClipId = new Map<string, number>()
  const inputIndexByTtsClipId = new Map<string, number>()
  const inputIndexByElementId = new Map<string, number>()
  let nextIndex = 0
  for (const clip of clips) {
    inputIndexByVideoClipId.set(clip.id, nextIndex++)
  }
  for (const clip of ttsClips) {
    inputIndexByTtsClipId.set(clip.id, nextIndex++)
  }
  for (const elementId of elementIds) {
    inputIndexByElementId.set(elementId, nextIndex++)
  }
  return {
    inputIndexByVideoClipId,
    inputIndexByTtsClipId,
    inputIndexByElementId,
    inputCount: nextIndex,
  }
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
  const audioTrack = getAudioTrack(doc)
  const ttsClips = audioTrack ? sortedClips(audioTrack) : []
  const allElements = collectAllElements(doc)
  if (allElements.length > 30) {
    onProgress?.(
      0.08,
      `Warning: ${allElements.length} overlay elements may slow export or exceed memory limits.`,
    )
  }

  const elementIds = allElements.map((element) => element.id)
  const { inputIndexByVideoClipId, inputIndexByTtsClipId, inputIndexByElementId, inputCount } =
    assignInputIndices(clips, ttsClips, elementIds)

  const stagedElementNameById = new Map<string, string>()

  const mediaKindBySource = new Map<string, ReturnType<typeof classifyExportAsset>>()
  const audioStreamBySource = new Map<string, boolean>()
  const fpsBySource = new Map<string, number>()
  const dimensionsBySource = new Map<string, ExportFrameDimensions>()
  const stagedNameBySourceId = new Map<string, string>()
  const outputName = 'output.mp4'

  try {
    await ffmpeg.deleteFile(outputName)
  } catch {
    // The first export has no previous output.
  }

  const sourceIds = uniqueSourceIds(clips, ttsClips)
  for (let i = 0; i < sourceIds.length; i++) {
    const sourceId = sourceIds[i]!
    const asset = mediaStore.get(sourceId)
    if (!asset) {
      throw new Error('Missing media for export.')
    }
    const kind = classifyExportAsset(asset)
    const name = stageFileNameForAsset(i, asset)
    await ffmpeg.writeFile(name, await fetchFile(asset.file))
    stagedNameBySourceId.set(sourceId, name)
    mediaKindBySource.set(sourceId, kind)

    if (kind === 'video' || kind === 'image') {
      const { hasAudio, fps, dimensions } = await probeStagedVideoStream(ffmpeg, name)
      audioStreamBySource.set(sourceId, kind === 'video' ? hasAudio : false)
      if (fps != null) {
        fpsBySource.set(sourceId, fps)
      }
      if (dimensions) {
        dimensionsBySource.set(sourceId, dimensions)
      }
    } else if (kind === 'audio') {
      audioStreamBySource.set(sourceId, true)
    } else {
      audioStreamBySource.set(sourceId, false)
    }

    onProgress?.(0.1 + (0.2 * (i + 1)) / sourceIds.length, `Staged ${asset.file.name}`)
  }

  for (let i = 0; i < allElements.length; i++) {
    const element = allElements[i]!
    const ownerClip = clips.find((clip) =>
      clip.effects.some((effect) => effect.type === 'element' && effect.id === element.id),
    )
    const asset = ownerClip ? mediaStore.get(ownerClip.sourceId) : undefined
    if (!asset) {
      throw new Error('Missing clip media for element export.')
    }
    const frameDims =
      dimensionsBySource.get(ownerClip!.sourceId) ?? {
        width: asset.width,
        height: asset.height,
      }
    const pngBlob = await rasterizeElement(
      element,
      frameDims.width,
      frameDims.height,
      mediaStore,
    )
    const name = `element_${i}.png`
    await ffmpeg.writeFile(name, await fetchFile(pngBlob))
    stagedElementNameById.set(element.id, name)
    onProgress?.(
      0.3 + (0.05 * (i + 1)) / Math.max(allElements.length, 1),
      `Staged element ${i + 1}/${allElements.length}`,
    )
  }

  const audioStreamByInputIndex = buildAudioStreamByInputIndex(
    clips,
    ttsClips,
    inputIndexByVideoClipId,
    inputIndexByTtsClipId,
    mediaKindBySource,
    audioStreamBySource,
  )

  const graph = buildExportGraph({
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
    inputIndexByElementId,
    dimensionsBySource,
  })

  // One ffmpeg input slot per timeline clip. Repeat `-i` for the same staged file
  // so each clip gets its own [N:v]/[N:a] pads without duplicating bytes in wasm FS.
  const inputArgs: string[] = []
  for (const clip of clips) {
    const stagedName = stagedNameBySourceId.get(clip.sourceId)
    if (!stagedName) {
      throw new Error('Missing staged media for export.')
    }
    inputArgs.push('-i', stagedName)
  }
  for (const clip of ttsClips) {
    const stagedName = stagedNameBySourceId.get(clip.sourceId)
    if (!stagedName) {
      throw new Error('Missing staged media for export.')
    }
    inputArgs.push('-i', stagedName)
  }
  for (const element of allElements) {
    const stagedName = stagedElementNameById.get(element.id)
    if (!stagedName) {
      throw new Error('Missing staged element PNG for export.')
    }
    inputArgs.push('-i', stagedName)
  }

  if (inputArgs.length / 2 !== inputCount) {
    throw new Error('Export input wiring mismatch.')
  }

  const args = [
    ...inputArgs,
    '-filter_complex',
    graph.filterComplex,
    '-map',
    '[outv]',
  ]
  if (graph.useTtsMix) {
    args.push('-map', '[aout]', '-c:a', 'aac')
  } else if (graph.mapAudio) {
    args.push('-map', '[outa]', '-c:a', 'aac')
  }
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-y', outputName)

  onProgress?.(0.35, 'Encoding…')
  const execLogs: string[] = []
  ffmpeg.on('log', ({ message }) => {
    execLogs.push(message)
    onProgress?.(0.35, message)
  })
  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(0.35 + progress * 0.6, 'Encoding…')
  })

  const exitCode = await ffmpeg.exec(args)
  if (exitCode !== 0) {
    throw new Error(formatFfmpegError(exitCode, execLogs, clips.length))
  }

  onProgress?.(0.98, 'Finalizing…')
  let data: Uint8Array | string
  try {
    data = await ffmpeg.readFile(outputName)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Export encoding finished but the output file could not be read (${detail}). ` +
        'Try exporting a shorter timeline or reload the page and retry.',
    )
  }
  if (typeof data === 'string' || data.byteLength === 0) {
    throw new Error('Export produced an empty file. Try reloading and exporting again.')
  }
  onProgress?.(1, 'Done')

  for (const name of stagedNameBySourceId.values()) {
    try {
      await ffmpeg.deleteFile(name)
    } catch {
      // Cleanup must not invalidate a completed export.
    }
  }
  for (const name of stagedElementNameById.values()) {
    try {
      await ffmpeg.deleteFile(name)
    } catch {
      // Ignore cleanup errors.
    }
  }
  try {
    await ffmpeg.deleteFile(outputName)
  } catch {
    // Ignore cleanup errors.
  }

  return new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' })
}
