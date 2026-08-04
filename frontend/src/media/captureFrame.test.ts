import { describe, expect, it } from 'vitest'

import { FrameCaptureError } from './captureFrame'

describe('captureFrame', () => {
  it('FrameCaptureError exposes a clear CORS message shape', () => {
    const err = new FrameCaptureError(
      'Cannot capture this video frame — the source is not CORS-accessible.',
    )
    expect(err.name).toBe('FrameCaptureError')
    expect(err.message).toContain('CORS')
  })

  it.skip('seekVideoToTime and canvas capture require a browser DOM', () => {})
})
