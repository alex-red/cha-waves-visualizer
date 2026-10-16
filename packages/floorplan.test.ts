import { describe, expect, it } from 'vitest'
import { FloorPlanReferenceSchema, inspectRasterDimensions } from './floorplan'
import { createDemoScene, defaultSettings } from './engine'
import { createProject, parseProject, serializeProject } from './project'

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set(PNG_SIGNATURE)
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0, 8, 8, (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255, 3,
  ])
}

function pngDataUrl(width: number, height: number): string {
  return `data:image/png;base64,${btoa(String.fromCharCode(...pngHeader(width, height)))}`
}

describe('floor plan raster metadata', () => {
  it('reads PNG dimensions before decode', () => {
    expect(inspectRasterDimensions(pngHeader(640, 480))).toEqual({ mimeType: 'image/png', width: 640, height: 480 })
  })

  it('reads JPEG dimensions before decode', () => {
    expect(inspectRasterDimensions(jpegHeader(1920, 1080))).toEqual({ mimeType: 'image/jpeg', width: 1920, height: 1080 })
  })

  it('rejects invalid signatures, truncated dimensions, and images over 16 megapixels', () => {
    expect(() => inspectRasterDimensions(new Uint8Array([1, 2, 3]))).toThrow(/PNG or JPEG/)
    expect(() => inspectRasterDimensions(pngHeader(0, 40))).toThrow(/valid dimensions/)
    expect(() => inspectRasterDimensions(pngHeader(4097, 4096))).toThrow(/16 megapixels/)
    expect(() => inspectRasterDimensions(jpegHeader(4097, 4096))).toThrow(/16 megapixels/)
  })

  it('rejects a reference whose MIME type or declared dimensions disagree with its image', () => {
    const base = { dataUrl: pngDataUrl(640, 480), pixelWidth: 640, pixelHeight: 480, widthM: 10, heightM: 7.5, originXY: [0, 0] as [number, number], opacity: 0.5 }
    expect(FloorPlanReferenceSchema.safeParse(base).success).toBe(true)
    expect(FloorPlanReferenceSchema.safeParse({ ...base, dataUrl: base.dataUrl.replace('image/png', 'image/jpeg') }).success).toBe(false)
    expect(FloorPlanReferenceSchema.safeParse({ ...base, pixelWidth: 641 }).success).toBe(false)
    expect(FloorPlanReferenceSchema.safeParse({ ...base, dataUrl: pngDataUrl(4097, 4096), pixelWidth: 4097, pixelHeight: 4096 }).success).toBe(false)
  })

  it('round trips an optional floor plan reference through a project document', () => {
    const referenceImage = {
      dataUrl: pngDataUrl(640, 480), pixelWidth: 640, pixelHeight: 480,
      widthM: 10, heightM: 7.5, originXY: [0, 0] as [number, number], opacity: 0.42,
    }
    const project = createProject(createDemoScene(), defaultSettings('acoustics'), undefined, referenceImage)
    const restored = parseProject(serializeProject(project))
    expect(restored.referenceImage).toEqual(referenceImage)
  })
})
