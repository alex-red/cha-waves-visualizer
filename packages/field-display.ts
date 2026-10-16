import type { FieldResult } from './engine'

export type FieldDisplayMode = 'sound' | 'wifi'
export type FieldScale = FieldDisplayMode | 'delta'
export type Rgb = [number, number, number]

export const FIELD_OPACITY = 0.82
export const FIELD_PAPER_HEX = '#eee9df'
export const FIELD_PAPER_RGB: Rgb = [238, 233, 223]
export const FIELD_SCALES = {
  sound: { min: -36, max: 0, quantity: 'Relative direct level', unit: 'dB', colors: ['#f8dcaa', '#efb879', '#df8956', '#c95f36', '#984122'] },
  wifi: { min: -90, max: -30, quantity: 'Received power', unit: 'dBm', colors: ['#d5e8e2', '#a9d1ca', '#6bb2b1', '#358a93', '#17616e'] },
  delta: { min: -12, max: 12, quantity: 'Change', unit: 'dB', colors: ['#347997', '#a7c7ce', '#f7f3e9', '#e5b49b', '#b94927'] },
} as const

function hexRgb(hex: string): Rgb {
  return [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)) as Rgb
}

/** Identical transfer bounds and interpolation for plan, comparison and cutaway. */
export function fieldColorRgb(value: number, scale: FieldScale): Rgb {
  const { min, max, colors } = FIELD_SCALES[scale]
  const position = Math.max(0, Math.min(1, (value - min) / (max - min))) * (colors.length - 1)
  const index = Math.min(colors.length - 2, Math.floor(position)), fraction = position - index
  const a = hexRgb(colors[index]!), b = hexRgb(colors[index + 1]!)
  return a.map((channel, i) => Math.round(channel + (b[i]! - channel) * fraction)) as Rgb
}

export function fieldCssColor(value: number, scale: FieldScale): string {
  return `rgba(${fieldColorRgb(value, scale).join(',')},${FIELD_OPACITY})`
}

export function overFieldPaper(rgb: Rgb): Rgb {
  return rgb.map((value, channel) => Math.round(value * FIELD_OPACITY + FIELD_PAPER_RGB[channel]! * (1 - FIELD_OPACITY))) as Rgb
}

function sameGrid(a: FieldResult, b: FieldResult): boolean {
  return a.quantity === b.quantity && a.unit === b.unit
    && a.identity.solverId === b.identity.solverId && a.identity.solverVersion === b.identity.solverVersion
    && a.grid.levelId === b.grid.levelId && a.grid.cols === b.grid.cols && a.grid.rows === b.grid.rows
    && a.grid.cellSizeM === b.grid.cellSizeM && a.grid.receiverZM === b.grid.receiverZM
    && a.grid.originXY[0] === b.grid.originXY[0] && a.grid.originXY[1] === b.grid.originXY[1]
}

/** Opaque paper-composited field colors, with transparent invalid cells. */
export function fieldTexturePixels(field: FieldResult, mode: FieldDisplayMode, compare: boolean, baseline?: FieldResult | null): Uint8Array {
  const count = field.grid.cols * field.grid.rows
  const pixels = new Uint8Array(count * 4)
  const useDelta = compare && baseline && sameGrid(field, baseline)
  for (let i = 0; i < count; i++) {
    if (field.validity[i] !== 1 || (useDelta && baseline.validity[i] !== 1)) continue
    const value = useDelta ? field.values[i]! - baseline.values[i]! : field.values[i]!
    const rgb = overFieldPaper(fieldColorRgb(value, useDelta ? 'delta' : mode))
    pixels.set([...rgb, 255], i * 4)
  }
  return pixels
}
