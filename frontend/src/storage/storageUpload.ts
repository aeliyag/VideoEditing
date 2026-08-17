import { supabase } from '../lib/supabase'

export const PROJECT_MEDIA_BUCKET = 'project-media'

const MIME_NOT_SUPPORTED = /mime type .+ is not supported/i

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/octet-stream': '.bin',
}

interface UploadOptions {
  upsert?: boolean
}

export interface UploadProjectMediaResult {
  /** Path actually used in storage (extension may differ from the source file). */
  storagePath: string
}

function fallbackContentTypes(file: File): string[] {
  const native = file.type || ''
  const fallbacks: string[] = []

  if (native.startsWith('image/')) {
    fallbacks.push('image/jpeg', 'video/mp4', 'application/octet-stream')
  } else if (native.startsWith('audio/')) {
    fallbacks.push('audio/mpeg', 'video/mp4', 'application/octet-stream')
  } else if (native.startsWith('video/')) {
    fallbacks.push('video/mp4', 'application/octet-stream')
  } else {
    fallbacks.push('video/mp4', 'audio/mpeg', 'image/jpeg', 'application/octet-stream')
  }

  const ordered = [native, ...fallbacks].filter(Boolean)
  return [...new Set(ordered)]
}

function isMimeRejected(message: string): boolean {
  return MIME_NOT_SUPPORTED.test(message)
}

function storagePathForContentType(storagePath: string, contentType: string): string {
  const extension = CONTENT_TYPE_EXTENSION[contentType]
  if (!extension) {
    return storagePath
  }
  const slash = storagePath.lastIndexOf('/')
  const directory = slash >= 0 ? storagePath.slice(0, slash + 1) : ''
  const fileName = slash >= 0 ? storagePath.slice(slash + 1) : storagePath
  const dot = fileName.lastIndexOf('.')
  const baseName = dot >= 0 ? fileName.slice(0, dot) : fileName
  return `${directory}${baseName}${extension}`
}

async function encodeImageAsJpeg(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/jpeg') {
    return file
  }

  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas 2D context unavailable.')
    }
    context.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (encoded) => (encoded ? resolve(encoded) : reject(new Error('JPEG encode failed.'))),
        'image/jpeg',
        0.92,
      )
    })
    const jpegName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], jpegName, { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}

function uploadBodyForAttempt(file: File, contentType: string): File | Blob {
  if (contentType === 'application/octet-stream') {
    return file
  }
  if (file.type === contentType) {
    return file
  }
  return new Blob([file], { type: contentType })
}

/**
 * Upload a file to project-media, retrying with alternate content types and storage
 * extensions when the bucket rejects the native MIME (common for image/png).
 */
export async function uploadProjectMedia(
  storagePath: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadProjectMediaResult> {
  const upsert = options.upsert ?? true
  const contentTypes = fallbackContentTypes(file)
  let lastError: string | null = null

  for (const contentType of contentTypes) {
    const path = storagePathForContentType(storagePath, contentType)
    let body: File | Blob = uploadBodyForAttempt(file, contentType)

    if (contentType === 'image/jpeg' && file.type.startsWith('image/') && file.type !== 'image/jpeg') {
      body = await encodeImageAsJpeg(file)
    }

    const { error } = await supabase.storage.from(PROJECT_MEDIA_BUCKET).upload(path, body, {
      upsert,
      contentType,
    })

    if (!error) {
      return { storagePath: path }
    }

    lastError = error.message
    if (!isMimeRejected(error.message)) {
      break
    }
  }

  throw new Error(
    lastError && isMimeRejected(lastError)
      ? `${lastError} Run supabase/project-media-bucket.sql in your Supabase SQL editor.`
      : (lastError ?? 'Upload failed.'),
  )
}
