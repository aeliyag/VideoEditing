import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'video-editor.akool-api-key'
export const AKOOL_KEY_CHANGED_EVENT = 'video-editor-akool-key-changed'
export const OPEN_SETTINGS_EVENT = 'video-editor-open-settings'

let memoryKey: string | null = null

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function akoolKeyHint(key: string): string {
  const trimmed = key.trim()
  if (trimmed.length <= 4) {
    return '••••'
  }
  return `••••${trimmed.slice(-4)}`
}

export function getUserAkoolApiKey(): string | null {
  if (memoryKey?.trim()) {
    return memoryKey.trim()
  }
  const value = storage()?.getItem(STORAGE_KEY)?.trim()
  return value || null
}

export function getUserAkoolApiKeyHint(): string | null {
  const key = getUserAkoolApiKey()
  return key ? akoolKeyHint(key) : null
}

export function hasUserAkoolApiKey(): boolean {
  return Boolean(getUserAkoolApiKey())
}

export function setUserAkoolApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    clearUserAkoolApiKey()
    return
  }
  memoryKey = trimmed
  storage()?.setItem(STORAGE_KEY, trimmed)
  notifyAkoolKeyChanged()
}

export function clearUserAkoolApiKey(): void {
  memoryKey = null
  storage()?.removeItem(STORAGE_KEY)
  notifyAkoolKeyChanged()
}

function metadataAkoolKey(user: { user_metadata?: Record<string, unknown> } | null): string | null {
  const value = user?.user_metadata?.akool_api_key
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function loadAkoolApiKeyFromAccount(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser()
  const fromMetadata = metadataAkoolKey(userData.user)
  if (fromMetadata) {
    setUserAkoolApiKey(fromMetadata)
    return fromMetadata
  }

  const { data } = await supabase.from('user_integrations').select('akool_api_key').maybeSingle()
  const fromTable = data?.akool_api_key?.trim()
  if (fromTable) {
    setUserAkoolApiKey(fromTable)
    return fromTable
  }

  return getUserAkoolApiKey()
}

export async function saveAkoolApiKeyToAccount(key: string): Promise<void> {
  const trimmed = key.trim()
  if (!trimmed) {
    await deleteAkoolApiKeyFromAccount()
    return
  }
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    throw new Error('Sign in required to save an Akool API key.')
  }
  const { error: metaError } = await supabase.auth.updateUser({
    data: { akool_api_key: trimmed },
  })
  if (metaError) {
    throw new Error(metaError.message)
  }
  await supabase.from('user_integrations').upsert({
    user_id: userData.user.id,
    akool_api_key: trimmed,
    updated_at: new Date().toISOString(),
  })
  setUserAkoolApiKey(trimmed)
}

export async function deleteAkoolApiKeyFromAccount(): Promise<void> {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    clearUserAkoolApiKey()
    return
  }
  const { error: metaError } = await supabase.auth.updateUser({
    data: { akool_api_key: null },
  })
  if (metaError) {
    throw new Error(metaError.message)
  }
  await supabase.from('user_integrations').upsert({
    user_id: userData.user.id,
    akool_api_key: null,
    updated_at: new Date().toISOString(),
  })
  clearUserAkoolApiKey()
}

export function subscribeAkoolKeyChange(onChange: () => void): () => void {
  const handler = () => onChange()
  window.addEventListener(AKOOL_KEY_CHANGED_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(AKOOL_KEY_CHANGED_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

export function requestOpenSettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT))
}

export function subscribeOpenSettings(onOpen: () => void): () => void {
  const handler = () => onOpen()
  window.addEventListener(OPEN_SETTINGS_EVENT, handler)
  return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler)
}

function notifyAkoolKeyChanged(): void {
  window.dispatchEvent(new CustomEvent(AKOOL_KEY_CHANGED_EVENT))
}
