const STORAGE_KEY = 'video-editor.akool-api-key'
export const AKOOL_KEY_CHANGED_EVENT = 'video-editor-akool-key-changed'
export const OPEN_SETTINGS_EVENT = 'video-editor-open-settings'

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
  storage()?.setItem(STORAGE_KEY, trimmed)
  notifyAkoolKeyChanged()
}

export function clearUserAkoolApiKey(): void {
  storage()?.removeItem(STORAGE_KEY)
  notifyAkoolKeyChanged()
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
