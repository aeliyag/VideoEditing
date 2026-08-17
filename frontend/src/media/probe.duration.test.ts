import { describe, expect, it } from 'vitest'

import { resolveProbedVideoDuration } from './probe'

describe('resolveProbedVideoDuration', () => {
  it('prefers a finite element duration', () => {
    expect(
      resolveProbedVideoDuration({
        elementDuration: 42.5,
        seekableEnd: 10,
        discoveredEnd: 12,
        durationHint: 8,
      }),
    ).toBe(42.5)
  })

  it('does not treat Infinity or 0 as a real duration', () => {
    expect(
      resolveProbedVideoDuration({
        elementDuration: Infinity,
        seekableEnd: 0,
        durationHint: 27.4,
      }),
    ).toBe(27.4)

    expect(
      resolveProbedVideoDuration({
        elementDuration: 0,
        seekableEnd: 0,
      }),
    ).toBe(0)
  })

  it('uses seekable end when metadata duration is missing', () => {
    expect(
      resolveProbedVideoDuration({
        elementDuration: Infinity,
        seekableEnd: 18.2,
        durationHint: 10,
      }),
    ).toBe(18.2)
  })

  it('uses discovered seek-to-end time before the recording hint', () => {
    expect(
      resolveProbedVideoDuration({
        elementDuration: Infinity,
        seekableEnd: 0,
        discoveredEnd: 33.1,
        durationHint: 10,
      }),
    ).toBe(33.1)
  })

  it('does not fall back to a 10 second cap when duration is unknown', () => {
    expect(
      resolveProbedVideoDuration({
        elementDuration: Infinity,
        seekableEnd: 0,
        durationHint: 67,
      }),
    ).toBe(67)
  })
})
