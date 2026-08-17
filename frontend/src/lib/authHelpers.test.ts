import { describe, expect, it } from 'vitest'

import {
  authRedirectUrl,
  mapSignInError,
  parseSignUpResult,
} from './authHelpers'

describe('authRedirectUrl', () => {
  it('preserves trailing slash on base path', () => {
    expect(authRedirectUrl('https://example.com', '/VideoEditing/')).toBe(
      'https://example.com/VideoEditing/',
    )
  })

  it('adds trailing slash when missing', () => {
    expect(authRedirectUrl('https://example.com', '/VideoEditing')).toBe(
      'https://example.com/VideoEditing/',
    )
  })
})

describe('mapSignInError', () => {
  it('maps invalid credentials to a clearer message', () => {
    expect(
      mapSignInError({ code: 'invalid_credentials', message: 'Invalid login credentials' }),
    ).toContain('already registered')
  })

  it('maps email_not_confirmed', () => {
    expect(
      mapSignInError({ code: 'email_not_confirmed', message: 'Email not confirmed' }),
    ).toBe('Please confirm your email before signing in.')
  })

  it('passes through unknown errors', () => {
    expect(mapSignInError({ code: 'other', message: 'Something went wrong' })).toBe(
      'Something went wrong',
    )
  })
})

describe('parseSignUpResult', () => {
  it('detects a created session', () => {
    expect(
      parseSignUpResult(
        { session: { access_token: 'token' } as never, user: { id: '1' } as never },
        null,
      ),
    ).toEqual({
      error: null,
      sessionCreated: true,
      needsEmailConfirmation: false,
      duplicateEmail: false,
    })
  })

  it('detects duplicate email signup', () => {
    expect(
      parseSignUpResult(
        { session: null, user: { id: '1', identities: [] } as never },
        null,
      ),
    ).toEqual({
      error: null,
      sessionCreated: false,
      needsEmailConfirmation: false,
      duplicateEmail: true,
    })
  })

  it('detects email confirmation required', () => {
    expect(
      parseSignUpResult(
        {
          session: null,
          user: { id: '1', identities: [{ id: '1' }], email_confirmed_at: null } as never,
        },
        null,
      ),
    ).toEqual({
      error: null,
      sessionCreated: false,
      needsEmailConfirmation: true,
      duplicateEmail: false,
    })
  })

  it('returns signUp errors', () => {
    expect(
      parseSignUpResult(
        { session: null, user: null },
        { message: 'Signup failed', name: 'AuthApiError', status: 400 } as never,
      ),
    ).toEqual({
      error: 'Signup failed',
      sessionCreated: false,
      needsEmailConfirmation: false,
      duplicateEmail: false,
    })
  })
})
