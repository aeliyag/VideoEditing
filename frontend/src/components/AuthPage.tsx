import { useState } from 'react'

import { useAuth } from '../state/AuthProvider'

type AuthMode = 'sign-in' | 'sign-up'

export function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const trimmedEmail = email.trim()
      if (!trimmedEmail || !password) {
        setError('Email and password are required.')
        return
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.')
        return
      }

      if (mode === 'sign-in') {
        const result = await signIn(trimmedEmail, password)
        if (result.error) {
          setError(result.error)
        }
      } else {
        const result = await signUp(trimmedEmail, password)
        if (result.error) {
          setError(result.error)
        } else {
          setMessage('Account created. You are now signed in.')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Video Timeline Editor</h1>
        <p className="auth-subtitle">
          Sign in to save projects to the cloud and use TTS features.
        </p>

        {!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY ? (
          <p className="auth-error">
            Supabase is not configured. Copy frontend/.env.example to frontend/.env and set
            VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </p>
        ) : null}

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'sign-in' ? 'auth-tab-active' : ''}`}
            onClick={() => {
              setMode('sign-in')
              setError(null)
              setMessage(null)
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'sign-up' ? 'auth-tab-active' : ''}`}
            onClick={() => {
              setMode('sign-up')
              setError(null)
              setMessage(null)
            }}
          >
            Sign up
          </button>
        </div>

        <form className="auth-form" onSubmit={(e) => void onSubmit(e)}>
          <label className="auth-field">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label className="auth-field">
            Password
            <input
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}
          {message && <p className="auth-message">{message}</p>}

          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}

export function AuthLoadingSplash() {
  return (
    <div className="auth-page">
      <div className="auth-card auth-card-loading">
        <p className="auth-subtitle">Restoring your session…</p>
      </div>
    </div>
  )
}
