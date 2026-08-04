import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

import {
  buildExportGraph,
  classifyExportAsset,
  formatFfmpegError,
  parseAudioStreamFromLogs,
  parseVideoFpsFromLogs,
  stageFileNameForAsset,
} from './buildExportGraph'
import type { ProjectDocument, MediaStore } from '../types/project'
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

function uniqueAudioSourceIds(doc: ProjectDocument): string[] {
  const track = getAudioTrack(doc)
  if (!track) {
    return []
  }
  return [...new Set(sortedClips(track).map((c) => c.sourceId))]
}

function uniqueVideoSourceIds(doc: ProjectDocument): string[] {
  const track = getVideoTrack(doc)
  if (!track) {
    return []
  }
  return [...new Set(sortedClips(track).map((c) => c.sourceId))]
}

async function probeStagedVideoStream(
  ffmpeg: FFmpeg,
  filename: string,
): Promise<{ hasAudio: boolean; fps: number | null }> {
  const logs: string[] = []
  const onLog = ({ message }: { message: string }) => {
    logs.push(message)
  }
  ffmpeg.on('log', onLog)
  try {
    await ffmpeg.exec(['-i', filename, '-f', 'null', '-'])
  } catch {
    // FFmpeg returns non-zero for probe-only runs; logs still contain stream info.
  }
  return {
    hasAudio: parseAudioStreamFromLogs(logs),
    fps: parseVideoFpsFromLogs(logs),
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
  const videoSourceIds = uniqueVideoSourceIds(doc)
  const audioSourceIds = uniqueAudioSourceIds(doc)
  const allSourceIds = [...videoSourceIds, ...audioSourceIds]
  const inputIndexBySource = new Map<string, number>()
  const mediaKindBySource = new Map<string, ReturnType<typeof classifyExportAsset>>()
  const audioStreamBySource = new Map<string, boolean>()
  const fpsBySource = new Map<string, number>()
  const stagedNames: string[] = []
  const outputName = 'output.mp4'

  try {
    await ffmpeg.deleteFile(outputName)
  } catch {
    // The first export has no previous output.
  }

  for (let i = 0; i < allSourceIds.length; i++) {
    const sourceId = allSourceIds[i]!
    const asset = mediaStore.get(sourceId)
    if (!asset) {
      throw new Error('Missing media for export.')
    }
    const kind = classifyExportAsset(asset)
    const name = stageFileNameForAsset(i, asset)
    await ffmpeg.writeFile(name, await fetchFile(asset.file))
    stagedNames.push(name)
    inputIndexBySource.set(sourceId, i)
    mediaKindBySource.set(sourceId, kind)

    if (kind === 'video') {
      const { hasAudio, fps } = await probeStagedVideoStream(ffmpeg, name)
      audioStreamBySource.set(sourceId, hasAudio)
      if (fps != null) {
        fpsBySource.set(sourceId, fps)
      }
    } else if (kind === 'audio') {
      audioStreamBySource.set(sourceId, true)
    } else {
      audioStreamBySource.set(sourceId, false)
    }

    onProgress?.(0.1 + (0.2 * (i + 1)) / allSourceIds.length, `Staged ${asset.file.name}`)
  }

  const audioTrack = getAudioTrack(doc)
  const ttsClips = audioTrack ? sortedClips(audioTrack) : []

  const graph = buildExportGraph({
    doc,
    clips,
    ttsClips,
    inputIndexBySource,
    mediaStore,
    mediaKindBySource,
    audioStreamBySource,
    fpsBySource,
  })

  const args = [
    ...stagedNames.flatMap((name) => ['-i', name]),
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
    throw new Error(formatFfmpegError(exitCode, execLogs))
  }

  onProgress?.(0.98, 'Finalizing…')
  const data = await ffmpeg.readFile(outputName)
  if (typeof data === 'string') {
    throw new Error('Unexpected export output.')
  }
  onProgress?.(1, 'Done')

  for (const name of stagedNames) {
    try {
      await ffmpeg.deleteFile(name)
    } catch {
      // Cleanup must not invalidate a completed export.
    }
  }
  await ffmpeg.deleteFile(outputName)
  return new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' })
}
