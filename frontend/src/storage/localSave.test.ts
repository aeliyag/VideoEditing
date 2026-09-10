import { describe, expect, it } from 'vitest'

import { mediaRecordKey, shouldWriteMediaAsset } from './localSave'

describe('mediaRecordKey', () => {
  it('namespaces media by user so accounts on one browser stay separate', () => {
    expect(mediaRecordKey('user-a', 'clip-1')).toBe('user-a:clip-1')
    expect(mediaRecordKey('user-b', 'clip-1')).toBe('user-b:clip-1')
  })
})

describe('shouldWriteMediaAsset', () => {
  it('skips a blob that is already stored', () => {
    expect(shouldWriteMediaAsset(true, 'clip-1')).toBe(false)
  })

  it('writes a blob that has never been stored', () => {
    expect(shouldWriteMediaAsset(false, 'clip-1')).toBe(true)
  })

  it('rewrites a stored blob when it was explicitly marked dirty', () => {
    expect(shouldWriteMediaAsset(true, 'clip-1', new Set(['clip-1']))).toBe(true)
    expect(shouldWriteMediaAsset(true, 'clip-1', new Set(['other']))).toBe(false)
  })
})
