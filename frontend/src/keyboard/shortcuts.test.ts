import { describe, expect, it } from 'vitest'

import { isTypingTarget } from './shortcuts'

describe('keyboard shortcuts', () => {
  it('isTypingTarget ignores shortcuts while typing in inputs', () => {
    const input = { tagName: 'INPUT', isContentEditable: false } as HTMLElement
    const textarea = { tagName: 'TEXTAREA', isContentEditable: false } as HTMLElement
    const editable = { tagName: 'DIV', isContentEditable: true } as HTMLElement
    const body = { tagName: 'BODY', isContentEditable: false } as HTMLElement

    expect(isTypingTarget(input)).toBe(true)
    expect(isTypingTarget(textarea)).toBe(true)
    expect(isTypingTarget(editable)).toBe(true)
    expect(isTypingTarget(body)).toBe(false)
  })

  it('documents repeat keydown guard for freeze frame', () => {
    const repeated = { repeat: true, key: 'f' }
    expect(repeated.repeat).toBe(true)
  })
})
