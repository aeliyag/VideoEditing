import type { MediaStore, ProjectDocument } from '../types/project'
import type { SavedProjectMeta } from './projectLibrary'
import * as local from './projectLibrary'

export type { SavedProjectMeta } from './projectLibrary'

function requireUserId(userId: string | null): string {
  if (!userId) {
    throw new Error('Sign in required to access project history.')
  }
  return userId
}

export async function listSavedProjects(userId: string | null): Promise<SavedProjectMeta[]> {
  return local.listSavedProjects(requireUserId(userId))
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
    forceUploadMediaIds?: ReadonlySet<string>
  },
): Promise<SavedProjectMeta> {
  return local.saveProjectVersion({
    ...args,
    userId: requireUserId(userId),
  })
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
  return local.loadProjectVersion(requireUserId(userId), id)
}

export async function deleteProjectVersion(userId: string | null, id: string): Promise<void> {
  return local.deleteProjectVersion(requireUserId(userId), id)
}
