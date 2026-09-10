import { useEffect, useState } from 'react'

import { fetchAkoolVoices } from '../akool/client'
import {
  akoolKeyHint,
  clearUserAkoolApiKey,
  getUserAkoolApiKey,
  getUserAkoolApiKeyHint,
  hasUserAkoolApiKey,
  setUserAkoolApiKey,
  subscribeAkoolKeyChange,
  subscribeOpenSettings,
} from '../akool/userKey'

export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [hint, setHint] = useState(getUserAkoolApiKeyHint)
  const [connected, setConnected] = useState(hasUserAkoolApiKey)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const refresh = () => {
      setHint(getUserAkoolApiKeyHint())
      setConnected(hasUserAkoolApiKey())
    }
    return subscribeAkoolKeyChange(refresh)
  }, [])

  useEffect(() => subscribeOpenSettings(() => setOpen(true)), [])

  const onConnect = async () => {
    const nextKey = keyInput.trim()
    if (!nextKey) {
      setError('Paste your Akool API key.')
      return
    }
    const previousKey = getUserAkoolApiKey()
    setBusy(true)
    setError('')
    setStatus('Testing key…')
    setUserAkoolApiKey(nextKey)
    try {
      await fetchAkoolVoices()
      setKeyInput('')
      setStatus(`Connected (${akoolKeyHint(nextKey)})`)
    } catch (err) {
      if (previousKey) {
        setUserAkoolApiKey(previousKey)
      } else {
        clearUserAkoolApiKey()
      }
      setError(err instanceof Error ? err.message : 'Could not validate that API key.')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const onDisconnect = () => {
    clearUserAkoolApiKey()
    setKeyInput('')
    setStatus('Disconnected. AI tools will use your key only after you connect again.')
    setError('')
  }

  return (
    <div className="settings-wrap">
      <button
        type="button"
        className="btn btn-small"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? 'Close settings' : 'Settings'}
      </button>
      {open && (
        <div className="settings-panel">
          <h3 className="frame-bank-title">Akool API</h3>
          <p className="crop-panel-hint">
            Connect <strong>your</strong> Akool key so generations bill your account, not
            the app owner. The key stays in this browser.{' '}
            <a href="https://akool.com" target="_blank" rel="noreferrer">
              Get a key
            </a>{' '}
            from Akool → API icon → API Credentials.
          </p>
          {connected ? (
            <p className="settings-connected">Connected {hint}</p>
          ) : (
            <p className="crop-panel-hint">Not connected.</p>
          )}
          <label className="tts-field">
            API key
            <input
              className="tts-select"
              type="password"
              autoComplete="off"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={connected ? 'Paste a new key to replace' : 'Paste your Akool API key'}
            />
          </label>
          <div className="frame-bank-buttons">
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={busy || !keyInput.trim()}
              onClick={() => void onConnect()}
            >
              {busy ? 'Testing…' : connected ? 'Replace & test' : 'Save & test'}
            </button>
            {connected && (
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={onDisconnect}
              >
                Disconnect
              </button>
            )}
          </div>
          {status && <p className="akool-status">{status}</p>}
          {error && <p className="tts-error">{error}</p>}
        </div>
      )}
    </div>
  )
}
