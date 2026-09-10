import { describe, expect, it } from 'vitest'

import { akoolKeyHint } from './userKey'

describe('akoolKeyHint', () => {
  it('shows only the last four characters', () => {
    expect(akoolKeyHint('sk-live-abcdefghij')).toBe('••••ghij')
  })

  it('masks short keys entirely', () => {
    expect(akoolKeyHint('abcd')).toBe('••••')
    expect(akoolKeyHint('  ab  ')).toBe('••••')
  })
})
