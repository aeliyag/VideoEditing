import type { ProjectState } from './projectReducer'
import type { MediaStore } from '../types/project'
import { revokeMediaAsset } from '../media/probe'

export interface EditorSnapshot {
  state: ProjectState
  mediaStore: MediaStore
}

const MAX_HISTORY = 50

export interface HistoryStacks {
  past: EditorSnapshot[]
  future: EditorSnapshot[]
}

export function createHistoryStacks(): HistoryStacks {
  return { past: [], future: [] }
}

function cloneMediaStore(store: MediaStore): MediaStore {
  return new Map(store)
}

export function snapshotEditor(state: ProjectState, mediaStore: MediaStore): EditorSnapshot {
  return {
    state: {
      document: structuredClone(state.document),
      ui: { ...state.ui },
    },
    mediaStore: cloneMediaStore(mediaStore),
  }
}

export function pushHistory(
  stacks: HistoryStacks,
  snapshot: EditorSnapshot,
): HistoryStacks {
  const past = [...stacks.past, snapshot]
  if (past.length > MAX_HISTORY) {
    past.shift()
  }
  return { past, future: [] }
}

export function undoHistory(
  stacks: HistoryStacks,
  current: EditorSnapshot,
): { stacks: HistoryStacks; snapshot: EditorSnapshot | null } {
  if (stacks.past.length === 0) {
    return { stacks, snapshot: null }
  }
  const past = [...stacks.past]
  const previous = past.pop()!
  return {
    stacks: {
      past,
      future: [current, ...stacks.future],
    },
    snapshot: previous,
  }
}

export function redoHistory(
  stacks: HistoryStacks,
  current: EditorSnapshot,
): { stacks: HistoryStacks; snapshot: EditorSnapshot | null } {
  if (stacks.future.length === 0) {
    return { stacks, snapshot: null }
  }
  const future = [...stacks.future]
  const next = future.shift()!
  return {
    stacks: {
      past: [...stacks.past, current],
      future,
    },
    snapshot: next,
  }
}

/** Revoke assets present in next store but absent from previous (undo cleanup). */
export function revokeAddedAssets(previous: MediaStore, next: MediaStore): void {
  for (const [id, asset] of next) {
    if (!previous.has(id)) {
      revokeMediaAsset(asset)
    }
  }
}

export function diffAddedAssetIds(previous: MediaStore, next: MediaStore): string[] {
  const added: string[] = []
  for (const id of next.keys()) {
    if (!previous.has(id)) {
      added.push(id)
    }
  }
  return added
}

export function restoreAssetsFromSnapshot(
  current: MediaStore,
  target: MediaStore,
): MediaStore {
  revokeAddedAssets(target, current)
  return cloneMediaStore(target)
}
