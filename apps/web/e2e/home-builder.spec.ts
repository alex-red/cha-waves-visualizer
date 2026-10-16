import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

async function ready(page: Page) {
  await expect(page.getByTestId('solver-status')).not.toContainText('Calculating', { timeout: 15_000 })
  await expect(page.getByTestId('probe-value')).not.toContainText('—')
}

async function exportProject(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('project-export').click(),
  ])
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(await readFile(path!, 'utf8')) as {
    metadata: { name: string }
    scene: { levels: Array<{ boundary: [number, number][]; ceilingHeightM: number }> }
    referenceImage?: { pixelWidth: number; pixelHeight: number; widthM: number; heightM: number; dataUrl: string }
  }
}

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
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const scanlines = Buffer.alloc((width * 4 + 1) * height, 255)
  for (let y = 0; y < height; y++) scanlines[y * (width * 4 + 1)] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

test('creates a new rectangular home with the entered dimensions', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('new-home').click()
  const dialog = page.getByTestId('home-builder-dialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('home-name').fill('Willow apartment')
  await page.getByTestId('home-width').fill('9.2')
  await page.getByTestId('home-depth').fill('7.1')
  await page.getByTestId('home-ceiling-height').fill('3.0')
  await page.getByTestId('home-create').click()
  await expect(dialog).not.toBeVisible()
  await ready(page)
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })

  const project = await exportProject(page)
  expect(project.metadata.name).toBe('Willow apartment')
  expect(project.scene.levels[0]?.boundary).toEqual([[0, 0], [9.2, 0], [9.2, 7.1], [0, 7.1]])
  expect(project.scene.levels[0]?.ceilingHeightM).toBe(3)
  expect(project.referenceImage).toBeUndefined()
})

test('calibrates a local PNG floor plan and stores its explicit image extent', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByTestId('new-home').click()
  await expect(page.getByTestId('home-builder-dialog')).toBeVisible()
  await page.getByTestId('home-mode-plan').click()
  await page.getByTestId('home-name').fill('Garden flat')
  await page.getByTestId('floorplan-file').setInputFiles({
    name: 'plan.png',
    mimeType: 'image/png',
    buffer: pngFixture(800, 600),
  })
  await expect(page.getByTestId('floorplan-stage')).toBeVisible()
  await page.getByTestId('floorplan-calibrate').click()
  const stageLocator = page.getByTestId('floorplan-stage')
  await stageLocator.scrollIntoViewIfNeeded()
  const stage = await stageLocator.boundingBox()
  expect(stage).toBeTruthy()
  await stageLocator.click({ position: { x: stage!.width * 0.2, y: stage!.height * 0.2 } })
  await expect(page.getByTestId('floorplan-feedback')).toContainText('second point')
  await stageLocator.click({ position: { x: stage!.width * 0.8, y: stage!.height * 0.8 } })
  await expect(page.getByTestId('floorplan-feedback')).toContainText('Enter the real distance')
  await page.getByTestId('floorplan-distance').fill('4.5')
  await page.getByTestId('floorplan-set-scale').click()
  await expect(page.getByTestId('floorplan-whole-image')).toBeEnabled()
  await page.getByTestId('floorplan-whole-image').click()
  await expect(page.getByTestId('home-create')).toBeEnabled()
  await page.getByTestId('home-create').click()
  await expect(page.getByTestId('home-builder-dialog')).not.toBeVisible()
  await ready(page)
  await expect(page.getByTestId('project-status')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 })

  const project = await exportProject(page)
  expect(project.metadata.name).toBe('Garden flat')
  expect(project.referenceImage).toMatchObject({ pixelWidth: 800, pixelHeight: 600 })
  expect(project.referenceImage?.dataUrl).toMatch(/^data:image\/(png|jpeg);base64,/)
  expect(project.referenceImage?.widthM).toBeGreaterThan(1)
  expect(project.referenceImage?.heightM).toBeGreaterThan(1)
  expect(project.scene.levels[0]?.boundary).toEqual([
    [0, 0], [project.referenceImage!.widthM, 0],
    [project.referenceImage!.widthM, project.referenceImage!.heightM], [0, project.referenceImage!.heightM],
  ])
})
