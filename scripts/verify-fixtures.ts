import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDemoScene, defaultSettings, evaluatePoint, computeField, sha256Hex, SOLVER_VERSION } from '../packages/engine.ts'
import { transformWithOxc } from 'vite'

const closeTo = (actual: number, expected: number, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`)
}

const scene = createDemoScene()
const probe = scene.probes[0]!.position
const closed = evaluatePoint(scene, defaultSettings('acoustics'), probe)
scene.openings[0]!.isOpen = true
const open = evaluatePoint(scene, defaultSettings('acoustics'), probe)
assert.ok(closed.valid && closed.value !== undefined && open.valid && open.value !== undefined)
closeTo(open.value - closed.value, 6)

const freeSpaceScene = createDemoScene()
freeSpaceScene.walls = []
freeSpaceScene.openings = []
freeSpaceScene.emitters[0]!.position = [1, 1, 1.2]
freeSpaceScene.emitters[1]!.position = [1, 1, 1.2]
const distancePoint: [number, number, number] = [3, 1, 1.2]
const distance = 2
const acoustic = evaluatePoint(freeSpaceScene, defaultSettings('acoustics'), distancePoint)
assert.ok(acoustic.valid && acoustic.value !== undefined)
closeTo(acoustic.value, -20 * Math.log10(distance))
const radio = evaluatePoint(freeSpaceScene, defaultSettings('radio'), distancePoint)
assert.ok(radio.valid && radio.value !== undefined)
const fspl = 20 * Math.log10(4 * Math.PI * distance * 2.4e9 / 299792458)
closeTo(radio.value, 18 - fspl)

const fieldChecks = []
for (const mode of ['acoustics', 'radio'] as const) {
  const field = await computeField(createDemoScene(), defaultSettings(mode), { step: 0.5, receiverZ: 1.2, levelId: 'main' })
  assert.equal(field.values.length, field.validity.length)
  for (let index = 0; index < field.values.length; index++) {
    const mask = field.validity[index]!
    assert.ok(mask >= 0 && mask <= 5, `unexpected validity mask ${mask} at cell ${index}`)
    assert.ok(Number.isFinite(field.values[index]), `non-finite numeric field cell ${index}`)
    if (mask === 1) assert.ok(Number.isFinite(field.values[index]), `valid cell ${index} must have a finite result`)
  }
  fieldChecks.push({ mode, cells: field.values.length, valid: field.validity.reduce((sum, mask) => sum + (mask === 1 ? 1 : 0), 0), invalid: field.validity.reduce((sum, mask) => sum + (mask === 1 ? 0 : 1), 0), queryHash: field.identity.queryHash })
}

// project.ts uses extensionless imports, so compile its TypeScript and resolve the local imports explicitly.
const tempDir = await mkdtemp(join(tmpdir(), 'cha-waves-fixture-check-'))
try {
  const projectPath = new URL('../packages/project.ts', import.meta.url)
  const source = await readFile(projectPath, 'utf8')
  const transformed = await transformWithOxc(source, projectPath.pathname, { lang: 'ts', target: 'es2022' })
  const engineUrl = new URL('../packages/engine.ts', import.meta.url).href
  const floorplanUrl = new URL('../packages/floorplan.ts', import.meta.url).href
  const surveyPath = new URL('../packages/survey.ts', import.meta.url)
  const surveySource = await readFile(surveyPath, 'utf8')
  const surveyTransformed = await transformWithOxc(surveySource, surveyPath.pathname, { lang: 'ts', target: 'es2022' })
  const surveyModulePath = join(tempDir, 'survey.mjs')
  await writeFile(surveyModulePath, surveyTransformed.code
    .replaceAll('from "./engine"', `from "${engineUrl}"`)
    .replaceAll('from "zod"', `from "${import.meta.resolve('zod')}"`), 'utf8')
  const projectModule = transformed.code
    .replaceAll('from "./survey"', `from "${pathToFileURL(surveyModulePath).href}"`)
    .replaceAll('from "./floorplan"', `from "${floorplanUrl}"`)
    .replaceAll('from "./engine"', `from "${engineUrl}"`)
    .replaceAll('from "zod"', `from "${import.meta.resolve('zod')}"`)
  const modulePath = join(tempDir, 'project.mjs')
  await writeFile(modulePath, projectModule, 'utf8')
  const project = await import(pathToFileURL(modulePath).href) as {
    validateProjectDocument: (value: unknown) => unknown
    serializeProject: (value: unknown) => string
    parseProject: (text: string) => unknown
  }
  const document = project.validateProjectDocument({
    format: 'cha-waves-project', formatVersion: 1, solverVersion: SOLVER_VERSION,
    metadata: { id: 'fixture-project', name: 'engine-fixture', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    scene: createDemoScene(), settings: defaultSettings('acoustics'),
  })
  const exported = project.serializeProject(document)
  const imported = project.parseProject(exported)
  const exportHash = sha256Hex(exported)
  const importedHash = sha256Hex(project.serializeProject(imported))
  assert.equal(importedHash, exportHash, 'project export/import must preserve canonical serialized identity')
  assert.equal((imported as { solverVersion: string }).solverVersion, SOLVER_VERSION)
  console.log(JSON.stringify({ status: 'passed', solverVersion: SOLVER_VERSION, doorwayDeltaDb: open.value - closed.value, freeSpaceAcousticDb: acoustic.value, radioReceivedDbm: radio.value, fields: fieldChecks, projectRoundTripSha256: exportHash }, null, 2))
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
