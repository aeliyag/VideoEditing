import type { MediaStore, ProjectDocument } from '../types/project'
import type { SavedProjectMeta } from './projectLibrary'
import * as cloud from './cloudProjectLibrary'

export type { SavedProjectMeta } from './projectLibrary'

function requireUserId(userId: string | null): string {
  if (!userId) {
    throw new Error('Sign in required to access project history.')
  }
  return userId
}

export async function listSavedProjects(userId: string | null): Promise<SavedProjectMeta[]> {
  return cloud.listSavedProjects(requireUserId(userId))
}

export async function saveProjectVersion(
  userId: string | null,
  args: {
    id?: string
    name: string
    document: ProjectDocument
    mediaStore: MediaStore
    playhead: number
    selectedClipId: string | null
  },
): Promise<SavedProjectMeta> {
  return cloud.saveProjectVersion(requireUserId(userId), args)
}

export async function loadProjectVersion(
  userId: string | null,
  id: string,
): Promise<{
  document: ProjectDocument
  mediaStore: MediaStore
  playhead: number
  selectedClipId: string | null
  name: string
} | null> {
  return cloud.loadProjectVersion(requireUserId(userId), id)
}

export async function deleteProjectVersion(userId: string | null, id: string): Promise<void> {
  return cloud.deleteProjectVersion(requireUserId(userId), id)
}
