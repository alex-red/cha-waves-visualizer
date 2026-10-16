import { inspectRasterDimensions } from '../../../../packages/floorplan'

export const FLOORPLAN_MAX_FILE_BYTES = 12 * 1024 * 1024
export const FLOORPLAN_MAX_PIXELS = 16_000_000
export const FLOORPLAN_MAX_SIDE = 1_600
export const FLOORPLAN_MAX_ENCODED_BYTES = 1_500_000

export type ProcessedFloorPlanImage = Readonly<{
  dataUrl: string
  pixelWidth: number
  pixelHeight: number
}>

export class FloorPlanImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FloorPlanImageError'
  }
}

/** Validate the file signature and dimensions before asking the browser to decode it. */
export async function processFloorPlanImage(file: File): Promise<ProcessedFloorPlanImage> {
  if (file.size > FLOORPLAN_MAX_FILE_BYTES) {
    throw new FloorPlanImageError('Choose an image smaller than 12 MB.')
  }
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    throw new FloorPlanImageError('Choose a PNG or JPEG floor plan.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  let dimensions: { mimeType: 'image/png' | 'image/jpeg'; width: number; height: number }
  try {
    dimensions = inspectRasterDimensions(bytes)
  } catch {
    throw new FloorPlanImageError('This file does not contain a readable PNG or JPEG image.')
  }
  if (dimensions.mimeType !== file.type) throw new FloorPlanImageError('The selected file type does not match its image content.')
  const { width, height } = dimensions
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > FLOORPLAN_MAX_PIXELS) {
    throw new FloorPlanImageError('The image must be no larger than 16 megapixels.')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: dimensions.mimeType }))
  } catch {
    throw new FloorPlanImageError('The browser could not decode this image.')
  }
  try {
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new FloorPlanImageError('The image dimensions do not match its file header.')
    }
    const scale = Math.min(1, FLOORPLAN_MAX_SIDE / Math.max(width, height))
    const pixelWidth = Math.max(1, Math.round(width * scale))
    const pixelHeight = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (!context) throw new FloorPlanImageError('Image processing is unavailable in this browser.')
    context.drawImage(bitmap, 0, 0, pixelWidth, pixelHeight)

    // Canvas export strips EXIF and other source metadata. Keep plan linework lossless when it fits;
    // use JPEG for a compact, broadly supported fallback when a PNG is large.
    let dataUrl = canvas.toDataURL('image/png')
    if (encodedBytes(dataUrl) > FLOORPLAN_MAX_ENCODED_BYTES) {
      for (const quality of [0.86, 0.78, 0.70, 0.62, 0.54, 0.46]) {
        dataUrl = canvas.toDataURL('image/jpeg', quality)
        if (encodedBytes(dataUrl) <= FLOORPLAN_MAX_ENCODED_BYTES) break
      }
    }
    if (encodedBytes(dataUrl) > FLOORPLAN_MAX_ENCODED_BYTES) {
      throw new FloorPlanImageError('This image could not be compressed below 1.5 MB. Try a simpler or smaller image.')
    }
    return { dataUrl, pixelWidth, pixelHeight }
  } finally {
    bitmap.close()
  }
}

function encodedBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
}
