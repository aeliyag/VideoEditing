import type { CSSProperties } from 'react'

import { resolvePreviewObjectUrl } from '../preview/resolvePreviewMedia'
import type { ElementEffect, MediaStore, TextElementEffect } from '../types/project'
import {
  textAlignToCss,
  textFontPx,
  textFontShorthand,
} from './elementStyle'

export async function rasterizeElement(
  element: ElementEffect,
  frameWidth: number,
  frameHeight: number,
  mediaStore: MediaStore,
): Promise<Blob> {
  const width = Math.max(1, Math.round(element.rect.width * frameWidth))
  const height = Math.max(1, Math.round(element.rect.height * frameHeight))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable.')
  }

  ctx.clearRect(0, 0, width, height)
  ctx.globalAlpha = element.opacity

  if (element.kind === 'image') {
    const asset = mediaStore.get(element.sourceId)
    if (!asset) {
      throw new Error('Missing image asset for element export.')
    }
    const url = resolvePreviewObjectUrl(asset)
    const image = await loadImage(url)
    ctx.drawImage(image, 0, 0, width, height)
  } else if (element.kind === 'text') {
    drawTextElement(ctx, element, width, height, frameHeight)
  } else {
    drawShapeElement(ctx, element, width, height)
  }

  return canvasToBlob(canvas)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load element image.'))
    image.src = url
  })
}

function drawTextElement(
  ctx: CanvasRenderingContext2D,
  element: TextElementEffect,
  width: number,
  height: number,
  frameHeight: number,
) {
  if (element.backgroundColor) {
    ctx.fillStyle = element.backgroundColor
    ctx.fillRect(0, 0, width, height)
  }

  ctx.fillStyle = element.color
  ctx.font = textFontShorthand(element, frameHeight)
  ctx.textBaseline = 'top'

  const fontSize = textFontPx(element, frameHeight)
  const padding = Math.max(4, fontSize * 0.15)
  const lines = wrapTextLines(ctx, element.text, width - padding * 2)
  const lineHeight = fontSize * 1.2
  let y = padding

  for (const line of lines) {
    let x = padding
    if (element.align === 'center') {
      const metrics = ctx.measureText(line)
      x = (width - metrics.width) / 2
    } else if (element.align === 'right') {
      const metrics = ctx.measureText(line)
      x = width - padding - metrics.width
    }
    ctx.fillText(line, x, y)
    y += lineHeight
    if (y > height - padding) {
      break
    }
  }
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const paragraphs = text.split('\n')
  const lines: string[] = []

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = words[0]!
    for (let i = 1; i < words.length; i++) {
      const word = words[i]!
      const test = `${current} ${word}`
      if (ctx.measureText(test).width <= maxWidth) {
        current = test
      } else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }

  return lines.length > 0 ? lines : ['']
}

function drawShapeElement(
  ctx: CanvasRenderingContext2D,
  element: Extract<ElementEffect, { kind: 'shape' }>,
  width: number,
  height: number,
) {
  const strokeWidth = element.strokeWidth

  if (element.shape === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    if (element.fill) {
      ctx.fillStyle = element.fill
      ctx.fill()
    }
    if (element.stroke) {
      ctx.strokeStyle = element.stroke
      ctx.lineWidth = strokeWidth
      ctx.stroke()
    }
    return
  }

  if (element.fill) {
    ctx.fillStyle = element.fill
    ctx.fillRect(0, 0, width, height)
  }
  if (element.stroke) {
    ctx.strokeStyle = element.stroke
    ctx.lineWidth = strokeWidth
    ctx.strokeRect(strokeWidth / 2, strokeWidth / 2, width - strokeWidth, height - strokeWidth)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode element PNG.'))
          return
        }
        resolve(blob)
      },
      'image/png',
    )
  })
}

export function elementPreviewStyle(
  element: ElementEffect,
  frameHeight: number,
): CSSProperties {
  const base: CSSProperties = {
    width: '100%',
    height: '100%',
    opacity: element.opacity,
    pointerEvents: 'none',
    overflow: 'hidden',
  }

  if (element.kind === 'text') {
    return {
      ...base,
      color: element.color,
      font: textFontShorthand(element, frameHeight),
      textAlign: textAlignToCss(element.align),
      backgroundColor: element.backgroundColor ?? undefined,
      padding: `${Math.max(4, textFontPx(element, frameHeight) * 0.15)}px`,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      display: 'flex',
      alignItems: 'flex-start',
    }
  }

  if (element.kind === 'shape') {
    return {
      ...base,
      backgroundColor: element.fill ?? undefined,
      border:
        element.stroke != null
          ? `${element.strokeWidth}px solid ${element.stroke}`
          : undefined,
      borderRadius: element.shape === 'ellipse' ? '50%' : undefined,
      boxSizing: 'border-box',
    }
  }

  return base
}
