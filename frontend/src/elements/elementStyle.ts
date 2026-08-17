import type { TextElementEffect } from '../types/project'

export const ELEMENT_FONT_OPTIONS = [
  'system-ui, sans-serif',
  'Georgia, serif',
  'Menlo, monospace',
  'Impact, sans-serif',
] as const

export function textFontPx(element: TextElementEffect, frameHeightPx: number): number {
  return Math.max(8, element.fontScale * frameHeightPx)
}

export function textFontShorthand(element: TextElementEffect, frameHeightPx: number): string {
  const size = textFontPx(element, frameHeightPx)
  return `${element.fontWeight} ${size}px ${element.fontFamily}`
}

export function textAlignToCss(align: TextElementEffect['align']): 'left' | 'center' | 'right' {
  return align
}
