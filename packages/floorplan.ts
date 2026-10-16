import { z } from 'zod'

/** Inspect dimensions before decoding untrusted local raster images. */
export function inspectRasterDimensions(bytes: Uint8Array): { mimeType: 'image/png' | 'image/jpeg'; width: number; height: number } {
  let width = 0, height = 0
  let mimeType: 'image/png' | 'image/jpeg'
  if ([137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v) && bytes.length >= 24 && String.fromCharCode(...bytes.slice(12,16)) === 'IHDR') {
    mimeType = 'image/png'
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    width = view.getUint32(16); height = view.getUint32(20)
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mimeType = 'image/jpeg'
    let offset = 2
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error('Invalid JPEG marker')
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]!
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!
      if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG image')
      if (marker >= 192 && marker <= 207 && ![196,200,204].includes(marker)) {
        if (length < 8) throw new Error('Invalid JPEG dimensions')
        height = (bytes[offset+3]! << 8) | bytes[offset+4]!
        width = (bytes[offset+5]! << 8) | bytes[offset+6]!
        break
      }
      offset += length
    }
  } else throw new Error('Choose a PNG or JPEG image')
  if (!width || !height || width * height > 16_000_000) throw new Error('Image must have valid dimensions and contain at most 16 megapixels')
  return { mimeType, width, height }
}

export const FloorPlanReferenceSchema = z.object({
  dataUrl: z.string().max(2_100_000).regex(/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/),
  pixelWidth: z.number().int().positive().max(1600),
  pixelHeight: z.number().int().positive().max(1600),
  widthM: z.number().positive().finite().max(1000),
  heightM: z.number().positive().finite().max(1000),
  originXY: z.tuple([z.number().finite(), z.number().finite()]),
  opacity: z.number().min(0).max(1),
}).strict().superRefine((reference, ctx) => {
  try {
    const decoded = atob(reference.dataUrl.slice(reference.dataUrl.indexOf(',') + 1))
    const dimensions = inspectRasterDimensions(Uint8Array.from(decoded, char => char.charCodeAt(0)))
    if (dimensions.width !== reference.pixelWidth || dimensions.height !== reference.pixelHeight || !reference.dataUrl.startsWith(`data:${dimensions.mimeType};`)) throw new Error('Image dimensions or type do not match the reference')
  } catch (error) {
    ctx.addIssue({ code: 'custom', path: ['dataUrl'], message: error instanceof Error ? error.message : 'Invalid raster image' })
  }
})
export type FloorPlanReference = z.infer<typeof FloorPlanReferenceSchema>
