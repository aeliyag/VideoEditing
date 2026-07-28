import { v4 as uuidv4 } from 'uuid'

import type { MediaAsset, MediaStore, ProjectDocument } from '../types/project'
import { totalDuration } from '../timeline/helpers'
import { getVideoTrack } from '../timeline/helpers'

const DB_NAME = 'video-timeline-library'
const DB_VERSION = 1
const STORE = 'projects'

export interface SavedProjectMeta {
  id: string
  name: string
  updatedAt: number
  clipCount: number
  duration: number
  hasMedia: boolean
}

interface StoredMedia {
  id: string
  fileName: string
  mimeType: string
  data: ArrayBuffer
  duration: number
  fps: number
  width: number
  height: number
  hasAudio: boolean
}

export interface SavedProjectRecord {
  id: string
  name: string
  updatedAt: number
  document: ProjectDocument
  media: StoredMedia[]
  playhead: number
  selectedClipId: string | null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('Failed to open project library'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

async function mediaFromStore(mediaStore: MediaStore): Promise<StoredMedia[]> {
  const entries: StoredMedia[] = []
  for (const asset of mediaStore.values()) {
    entries.push({
      id: asset.id,
      fileName: asset.file.name,
      mimeType: asset.file.type || 'video/mp4',
      data: await asset.file.arrayBuffer(),
      duration: asset.duration,
      fps: asset.fps,
      width: asset.width,
      height: asset.height,
      hasAudio: asset.hasAudio,
    })
  }
  return entries
}

function mediaToStore(media: StoredMedia[]): MediaStore {
  const map: MediaStore = new Map()
  for (const item of media) {
    const file = new File([item.data], item.fileName, {
      type: item.mimeType,
    })
    const asset: MediaAsset = {
      id: item.id,
      file,
      objectUrl: URL.createObjectURL(file),
      duration: item.duration,
      fps: item.fps,
      width: item.width,
      height: item.height,
      hasAudio: item.hasAudio,
    }
    map.set(item.id, asset)
  }
  return map
}

function toMeta(record: SavedProjectRecord): SavedProjectMeta {
  const track = getVideoTrack(record.document)
  return {
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
    clipCount: track?.clips.length ?? 0,
    duration: totalDuration(record.document),
    hasMedia: record.media.length > 0,
  }
}

export async function listSavedProjects(): Promise<SavedProjectMeta[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const rows = await requestToPromise(store.getAll() as IDBRequest<SavedProjectRecord[]>)
    return rows
      .map(toMeta)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function saveProjectVersion(args: {
  id?: string
  name: string
  document: ProjectDocument
  mediaStore: MediaStore
  playhead: number
  selectedClipId: string | null
}): Promise<SavedProjectMeta> {
  const db = await openDb()
  try {
    const id = args.id ?? uuidv4()
    const record: SavedProjectRecord = {
      id,
      name: args.name.trim() || 'Untitled timeline',
      updatedAt: Date.now(),
      document: args.document,
      media: await mediaFromStore(args.mediaStore),
      playhead: args.playhead,
      selectedClipId: args.selectedClipId,
    }
    const tx = db.transaction(STORE, 'readwrite')
    await requestToPromise(tx.objectStore(STORE).put(record))
    return toMeta(record)
  } finally {
    db.close()
  }
}

export async function loadProjectVersion(id: string): Promise<{
  document: ProjectDocument
  mediaStore: MediaStore
  playhead: number
  selectedClipId: string | null
  name: string
} | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const record = await requestToPromise(
      tx.objectStore(STORE).get(id) as IDBRequest<SavedProjectRecord | undefined>,
    )
    if (!record) {
      return null
    }
    return {
      document: record.document,
      mediaStore: mediaToStore(record.media),
      playhead: record.playhead,
      selectedClipId: record.selectedClipId,
      name: record.name,
    }
  } finally {
    db.close()
  }
}

export async function deleteProjectVersion(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    await requestToPromise(tx.objectStore(STORE).delete(id))
  } finally {
    db.close()
  }
}
