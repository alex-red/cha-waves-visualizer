import { expect, test } from '@playwright/test'
import { deflateSync } from 'node:zlib'

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(name: string, contents: Buffer): Buffer {
  const type = Buffer.from(name, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(contents.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([type, contents])))
  return Buffer.concat([length, type, contents, checksum])
}

function pngFixture(width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const scanlines = Buffer.alloc((width * 4 + 1) * height, 255)
  for (let y = 0; y < height; y++) scanlines[y * (width * 4 + 1)] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

test('uses keyboard coordinates for calibration and rejects missing coordinates', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await page.getByTestId('new-home').click()
  await page.getByTestId('home-mode-plan').click()
  await page.getByTestId('floorplan-file').setInputFiles({
    name: 'keyboard-plan.png',
    mimeType: 'image/png',
    buffer: pngFixture(800, 600),
  })
  await expect(page.getByTestId('floorplan-stage')).toBeVisible()
  await page.getByTestId('floorplan-calibrate').click()

  await page.getByText('Enter image coordinates instead').click()
  const x = page.getByTestId('floorplan-coordinate-x')
  const y = page.getByTestId('floorplan-coordinate-y')
  await x.fill('')
  await y.fill('100')
  await page.getByTestId('floorplan-add-coordinate').press('Enter')
  await expect(page.getByTestId('floorplan-feedback')).toContainText('Enter both image coordinates')

  await x.fill('100')
  await page.getByTestId('floorplan-add-coordinate').press('Enter')
  await expect(page.getByTestId('floorplan-feedback')).toContainText('second point')
  await x.fill('700')
  await y.fill('500')
  await page.getByTestId('floorplan-add-coordinate').press('Enter')
  await expect(page.getByTestId('floorplan-feedback')).toContainText('Enter the real distance')

  const distance = page.getByTestId('floorplan-distance')
  await distance.fill('4')
  await page.getByTestId('floorplan-set-scale').press('Enter')
  await expect(page.getByTestId('floorplan-whole-image')).toBeEnabled()
})
