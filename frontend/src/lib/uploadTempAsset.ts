import { v4 as uuidv4 } from 'uuid'

import { uploadProjectMedia } from '../storage/storageUpload'
import { supabase } from './supabase'

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot) : ''
}

/** Upload a local file and return a signed URL Akool can fetch (1 hour). */
export async function uploadTempAssetUrl(file: File, userId: string): Promise<string> {
  const path = `${userId}/temp/${uuidv4()}${fileExtension(file.name)}`
  await uploadProjectMedia(path, file, { upsert: false })

  const { data, error: signError } = await supabase.storage
    .from('project-media')
    .createSignedUrl(path, 3600)

  if (signError || !data?.signedUrl) {
    throw new Error(signError?.message ?? 'Failed to create signed URL for upload')
  }

  return data.signedUrl
}

/** Download a remote URL into a File for the material library. */
export async function fetchRemoteAsFile(
  url: string,
  fileName: string,
  mimeType: string,
): Promise<File> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${fileName}`)
  }
  const blob = await response.blob()
  return new File([blob], fileName, { type: mimeType || blob.type || 'application/octet-stream' })
}
