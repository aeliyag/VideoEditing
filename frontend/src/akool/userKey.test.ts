import { describe, expect, it } from 'vitest'

import { resolveAkoolApiBase } from './apiBase'
import { akoolKeyHint } from './userKey'

describe('resolveAkoolApiBase', () => {
  it('uses the Vite proxy in development', () => {
    expect(
      resolveAkoolApiBase({
        DEV: true,
        VITE_SUPABASE_URL: 'https://example.supabase.co',
      }),
    ).toBe('/api/akool')
  })

  it('uses the Supabase edge function in production when no override is set', () => {
    expect(
      resolveAkoolApiBase({
        DEV: false,
        VITE_SUPABASE_URL: 'https://example.supabase.co/',
      }),
    ).toBe('https://example.supabase.co/functions/v1/akool-proxy')
  })

  it('prefers an explicit proxy URL', () => {
    expect(
      resolveAkoolApiBase({
        DEV: false,
        VITE_AKOOL_API_BASE: 'https://custom.example/proxy/',
        VITE_SUPABASE_URL: 'https://example.supabase.co',
      }),
    ).toBe('https://custom.example/proxy')
  })
})

describe('akoolKeyHint', () => {
  it('shows only the last four characters', () => {
    expect(akoolKeyHint('sk-live-abcdefghij')).toBe('••••ghij')
  })

  it('masks short keys entirely', () => {
    expect(akoolKeyHint('abcd')).toBe('••••')
    expect(akoolKeyHint('  ab  ')).toBe('••••')
  })
})
