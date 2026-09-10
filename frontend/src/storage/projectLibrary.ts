import { v4 as uuidv4 } from 'uuid'

import type { MediaAsset, MediaStore, ProjectDocument } from '../types/project'
import { totalDuration } from '../timeline/helpers'
import { getVideoTrack } from '../timeline/helpers'
import { mediaRecordKey, shouldWriteMediaAsset } from './localSave'

const DB_NAME = 'video-timeline-library-v2'
const DB_VERSION = 1
const PROJECT_STORE = 'projects'
const MEDIA_STORE = 'media'

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
  userId: string
  assetId: string
  fileName: string
  mimeType: string
  blob: Blob
  duration: number
  fps: number
  width: number
  height: number
  hasAudio: boolean
}

interface SavedProjectRecord {
  id: string
  userId: string
  name: string
  updatedAt: number
  document: ProjectDocument
  mediaIds: string[]
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
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        const projects = db.createObjectStore(PROJECT_STORE, { keyPath: 'id' })
        projects.createIndex('userId', 'userId', { unique: false })
      }
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'id' })
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

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function toMeta(record: SavedProjectRecord): SavedProjectMeta {
  const track = getVideoTrack(record.document)
  return {
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
    clipCount: track?.clips.length ?? 0,
    duration: totalDuration(record.document),
    hasMedia: record.mediaIds.length > 0,
  }
}

function mediaToStore(items: StoredMedia[]): MediaStore {
  const map: MediaStore = new Map()
  for (const item of items) {
    const file = new File([item.blob], item.fileName, {
      type: item.mimeType,
    })
    const asset: MediaAsset = {
      id: item.assetId,
      file,
      objectUrl: URL.createObjectURL(file),
      duration: item.duration,
      fps: item.fps,
      width: item.width,
      height: item.height,
      hasAudio: item.hasAudio,
    }
    map.set(item.assetId, asset)
  }
  return map
}

async function collectLiveMediaKeys(
  projectStore: IDBObjectStore,
  userId: string,
): Promise<Set<string>> {
  const index = projectStore.index('userId')
  const rows = await requestToPromise(index.getAll(userId) as IDBRequest<SavedProjectRecord[]>)
  const live = new Set<string>()
  for (const row of rows) {
    for (const assetId of row.mediaIds) {
      live.add(mediaRecordKey(userId, assetId))
    }
  }
  return live
}

async function deleteOrphanedMedia(
  mediaStore: IDBObjectStore,
  userId: string,
  liveKeys: ReadonlySet<string>,
): Promise<void> {
  const all = await requestToPromise(mediaStore.getAll() as IDBRequest<StoredMedia[]>)
  for (const item of all) {
    if (item.userId === userId && !liveKeys.has(item.id)) {
      mediaStore.delete(item.id)
    }
  }
}

export async function listSavedProjects(userId: string): Promise<SavedProjectMeta[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(PROJECT_STORE, 'readonly')
    const index = tx.objectStore(PROJECT_STORE).index('userId')
    const rows = await requestToPromise(index.getAll(userId) as IDBRequest<SavedProjectRecord[]>)
    return rows.map(toMeta).sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function saveProjectVersion(args: {
  userId: string
  id?: string
  name: string
  document: ProjectDocument
  mediaStore: MediaStore
  playhead: number
  selectedClipId: string | null
  forceUploadMediaIds?: ReadonlySet<string>
}): Promise<SavedProjectMeta> {
  const db = await openDb()
  try {
    const id = args.id ?? uuidv4()
    const mediaIds: string[] = []
    const tx = db.transaction([PROJECT_STORE, MEDIA_STORE], 'readwrite')
    const projectStore = tx.objectStore(PROJECT_STORE)
    const mediaObjectStore = tx.objectStore(MEDIA_STORE)

    for (const asset of args.mediaStore.values()) {
      mediaIds.push(asset.id)
      const key = mediaRecordKey(args.userId, asset.id)
      const existing = await requestToPromise(
        mediaObjectStore.get(key) as IDBRequest<StoredMedia | undefined>,
      )
      if (!shouldWriteMediaAsset(Boolean(existing), asset.id, args.forceUploadMediaIds)) {
        continue
      }
      const record: StoredMedia = {
        id: key,
        userId: args.userId,
        assetId: asset.id,
        fileName: asset.file.name,
        mimeType: asset.file.type || 'application/octet-stream',
        blob: asset.file,
        duration: asset.duration,
        fps: asset.fps,
        width: asset.width,
        height: asset.height,
        hasAudio: asset.hasAudio,
      }
      mediaObjectStore.put(record)
    }

    const record: SavedProjectRecord = {
      id,
      userId: args.userId,
      name: args.name.trim() || 'Untitled timeline',
      updatedAt: Date.now(),
      document: args.document,
      mediaIds,
      playhead: args.playhead,
      selectedClipId: args.selectedClipId,
    }
    projectStore.put(record)

    const liveKeys = await collectLiveMediaKeys(projectStore, args.userId)
    await deleteOrphanedMedia(mediaObjectStore, args.userId, liveKeys)
    await txDone(tx)
    return toMeta(record)
  } finally {
    db.close()
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
  const db = await openDb()
  try {
    const tx = db.transaction([PROJECT_STORE, MEDIA_STORE], 'readonly')
    const record = await requestToPromise(
      tx.objectStore(PROJECT_STORE).get(id) as IDBRequest<SavedProjectRecord | undefined>,
    )
    if (!record || record.userId !== userId) {
      return null
    }
    const media: StoredMedia[] = []
    for (const assetId of record.mediaIds) {
      const item = await requestToPromise(
        tx.objectStore(MEDIA_STORE).get(mediaRecordKey(userId, assetId)) as IDBRequest<
          StoredMedia | undefined
        >,
      )
      if (!item) {
        throw new Error(`Saved media “${assetId}” is missing from this browser.`)
      }
      media.push(item)
    }
    return {
      document: record.document,
      mediaStore: mediaToStore(media),
      playhead: record.playhead,
      selectedClipId: record.selectedClipId,
      name: record.name,
    }
  } finally {
    db.close()
  }
}

export async function deleteProjectVersion(userId: string, id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([PROJECT_STORE, MEDIA_STORE], 'readwrite')
    const projectStore = tx.objectStore(PROJECT_STORE)
    const existing = await requestToPromise(
      projectStore.get(id) as IDBRequest<SavedProjectRecord | undefined>,
    )
    if (existing && existing.userId === userId) {
      projectStore.delete(id)
    }
    const liveKeys = await collectLiveMediaKeys(projectStore, userId)
    await deleteOrphanedMedia(tx.objectStore(MEDIA_STORE), userId, liveKeys)
    await txDone(tx)
  } finally {
    db.close()
  }
}
