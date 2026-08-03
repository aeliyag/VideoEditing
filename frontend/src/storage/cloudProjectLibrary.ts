import { v4 as uuidv4 } from 'uuid'

import { supabase } from '../lib/supabase'
import type { MediaAsset, MediaStore, ProjectDocument } from '../types/project'
import { totalDuration } from '../timeline/helpers'
import { getVideoTrack } from '../timeline/helpers'
import type { SavedProjectMeta } from './projectLibrary'

const BUCKET = 'project-media'

interface ProjectRow {
  id: string
  user_id: string
  name: string
  document: ProjectDocument
  playhead: number
  selected_clip_id: string | null
  clip_count: number
  duration: number
  has_media: boolean
  updated_at: string
}

interface ProjectMediaRow {
  id: string
  project_id: string
  user_id: string
  storage_path: string
  file_name: string
  mime_type: string
  duration: number
  fps: number
  width: number
  height: number
  has_audio: boolean
  updated_at: string
}

function mediaExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot) : ''
}

function mediaStoragePath(
  userId: string,
  projectId: string,
  mediaId: string,
  fileName: string,
): string {
  return `${userId}/${projectId}/${mediaId}${mediaExtension(fileName)}`
}

function mediaToStore(rows: ProjectMediaRow[], blobs: Map<string, Blob>): MediaStore {
  const map: MediaStore = new Map()
  for (const row of rows) {
    const blob = blobs.get(row.storage_path)
    if (!blob) {
      continue
    }
    const file = new File([blob], row.file_name, { type: row.mime_type })
    const asset: MediaAsset = {
      id: row.id,
      file,
      objectUrl: URL.createObjectURL(file),
      duration: row.duration,
      fps: row.fps,
      width: row.width,
      height: row.height,
      hasAudio: row.has_audio,
    }
    map.set(row.id, asset)
  }
  return map
}

export async function listSavedProjects(userId: string): Promise<SavedProjectMeta[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, clip_count, duration, has_media, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    updatedAt: new Date(row.updated_at as string).getTime(),
    clipCount: row.clip_count as number,
    duration: row.duration as number,
    hasMedia: row.has_media as boolean,
  }))
}

export async function saveProjectVersion(
  userId: string,
  args: {
    id?: string
    name: string
    document: ProjectDocument
    mediaStore: MediaStore
    playhead: number
    selectedClipId: string | null
  },
): Promise<SavedProjectMeta> {
  const projectId = args.id ?? uuidv4()
  const track = getVideoTrack(args.document)
  const clipCount = track?.clips.length ?? 0
  const duration = totalDuration(args.document)
  const hasMedia = args.mediaStore.size > 0
  const now = new Date().toISOString()

  const { data: existingMedia, error: existingError } = await supabase
    .from('project_media')
    .select('id, storage_path')
    .eq('project_id', projectId)
    .eq('user_id', userId)

  if (existingError) {
    throw new Error(existingError.message)
  }

  const currentMediaIds = new Set<string>()
  const mediaRows: ProjectMediaRow[] = []

  for (const asset of args.mediaStore.values()) {
    currentMediaIds.add(asset.id)
    const storagePath = mediaStoragePath(userId, projectId, asset.id, asset.file.name)
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, asset.file, { upsert: true, contentType: asset.file.type || undefined })

    if (uploadError) {
      throw new Error(uploadError.message)
    }

    mediaRows.push({
      id: asset.id,
      project_id: projectId,
      user_id: userId,
      storage_path: storagePath,
      file_name: asset.file.name,
      mime_type: asset.file.type || 'application/octet-stream',
      duration: asset.duration,
      fps: asset.fps,
      width: asset.width,
      height: asset.height,
      has_audio: asset.hasAudio,
      updated_at: now,
    })
  }

  const { error: projectError } = await supabase.from('projects').upsert(
    {
      id: projectId,
      user_id: userId,
      name: args.name.trim() || 'Untitled timeline',
      document: args.document,
      playhead: args.playhead,
      selected_clip_id: args.selectedClipId,
      clip_count: clipCount,
      duration,
      has_media: hasMedia,
      updated_at: now,
    },
    { onConflict: 'id' },
  )

  if (projectError) {
    throw new Error(projectError.message)
  }

  if (mediaRows.length > 0) {
    const { error: mediaUpsertError } = await supabase.from('project_media').upsert(mediaRows, {
      onConflict: 'id',
    })
    if (mediaUpsertError) {
      throw new Error(mediaUpsertError.message)
    }
  }

  const orphaned = (existingMedia ?? []).filter((row) => !currentMediaIds.has(row.id as string))
  if (orphaned.length > 0) {
    const paths = orphaned.map((row) => row.storage_path as string)
    await supabase.storage.from(BUCKET).remove(paths)
    await supabase
      .from('project_media')
      .delete()
      .in(
        'id',
        orphaned.map((row) => row.id as string),
      )
  }

  return {
    id: projectId,
    name: args.name.trim() || 'Untitled timeline',
    updatedAt: new Date(now).getTime(),
    clipCount,
    duration,
    hasMedia,
  }
}

export async function loadProjectVersion(
  userId: string,
  id: string,
): Promise<{
  document: ProjectDocument
  mediaStore: MediaStore
  playhead: number
  selectedClipId: string | null
  name: string
} | null> {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (projectError) {
    throw new Error(projectError.message)
  }
  if (!project) {
    return null
  }

  const { data: mediaRows, error: mediaError } = await supabase
    .from('project_media')
    .select('*')
    .eq('project_id', id)
    .eq('user_id', userId)

  if (mediaError) {
    throw new Error(mediaError.message)
  }

  const rows = (mediaRows ?? []) as ProjectMediaRow[]
  const blobs = new Map<string, Blob>()

  for (const row of rows) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(row.storage_path)

    if (downloadError || !blob) {
      throw new Error(downloadError?.message ?? `Failed to download ${row.file_name}`)
    }
    blobs.set(row.storage_path, blob)
  }

  const row = project as ProjectRow
  return {
    document: row.document,
    mediaStore: mediaToStore(rows, blobs),
    playhead: row.playhead,
    selectedClipId: row.selected_clip_id,
    name: row.name,
  }
}

export async function deleteProjectVersion(userId: string, id: string): Promise<void> {
  const { data: mediaRows, error: mediaError } = await supabase
    .from('project_media')
    .select('storage_path')
    .eq('project_id', id)
    .eq('user_id', userId)

  if (mediaError) {
    throw new Error(mediaError.message)
  }

  const paths = (mediaRows ?? []).map((row) => row.storage_path as string)
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths)
    if (storageError) {
      throw new Error(storageError.message)
    }
  }

  const { error: deleteError } = await supabase
    .from('projects')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (deleteError) {
    throw new Error(deleteError.message)
  }
}
