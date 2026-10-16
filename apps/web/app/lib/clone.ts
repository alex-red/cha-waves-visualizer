import type { FieldResult } from '../../../../packages/engine'

/** Clone committed inputs and field buffers without creating reactive aliases. */
export function clone<T>(value: T): T {
  if (value && typeof value === 'object' && 'values' in value && value.values instanceof Float32Array && 'validity' in value && value.validity instanceof Uint8Array) {
    const field = value as unknown as FieldResult
    return { ...field, values: field.values.slice(), validity: field.validity.slice(), grid: { ...field.grid, originXY: [...field.grid.originXY] as [number, number] }, identity: { ...field.identity } } as T
  }
  return structuredClone(value) as T
}
