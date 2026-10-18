import { basename, join, resolve } from 'node:path'
import type { StereoInput, StereoResult } from '../../packages/spatial-stereo-types.ts'
import { LOCAL_AMBIGUITY_RULE } from '../../packages/spatial-stereo-local-ambiguity.ts'
import { STEREO_SETTINGS } from '../../packages/spatial-stereo-types.ts'
import { STEREO_SGM_SETTINGS } from '../../packages/spatial-stereo-sgm.ts'
import { loadStereoInput, parseJson, readBounded, sha256, stereoResultSchema } from './stereo-files.ts'

export const STEREO_LOCAL_ATTRITION_PINS = Object.freeze({
  confidenceData: 'a16437db6d648aa454df23b05c8ab465997f40720728f85f89a3cefe9ff15879',
  confidenceScores: '1132cbad82e4dedccdd5172e31dc3ff3aa1396ef62d9afe76549bd7c12ce90b7',
  localData: '91c4a6347db83744d47e178c21889d51673e5f9500eb888b01793dbfb4c1ae91',
  localScores: '961eff298c62c8b90adb5aff3cb759084dc121f0be7b224d7cad7bdba3c4f5df',
  holdout: '8ff8000b086a1ed6adbffc818ba5181ac7f22bae46aa75431533fc508c277781',
})

export type StereoLocalPinnedCase = {
  id: string
  split: 'development'
  inputSha256: string
  leftSha256: string
  rightSha256: string
  truthSha256: string
  regionsSha256: string
  unsupportedSha256: string
  role: 'positive' | 'negative'
  unsupportedPixels: number
}

export type StereoLocalAttritionLoadedCase = {
  id: string
  role: 'positive' | 'negative'
  input: StereoInput
  truth: { camera: StereoInput['left']['camera']; disparityPx: (number | null)[]; depthM: (number | null)[] }
  regions: Record<string, number[]>
  unsupportedPixels: number[]
  base: StereoResult
  filtered: StereoResult
  lineage: {
    inputSha256: string
    leftSha256: string
    rightSha256: string
    truthSha256: string
    regionsSha256: string
    unsupportedSha256: string
    confidenceResultSha256: string
    localResultSha256: string
  }
}

type UnknownRecord = Record<string, any>

function object(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`)
  return value as UnknownRecord
}

function safeBasename(value: unknown, path: string): string {
  if (typeof value !== 'string' || basename(value) !== value || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) throw new Error(`${path} must be a safe artifact basename.`)
  return value
}

async function readJson(path: string, maxBytes: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; value: unknown }> {
  const bytes = await readBounded(path, maxBytes)
  return { bytes, value: parseJson(bytes) }
}

function checkManifestPin(pinCase: StereoLocalPinnedCase, manifest: UnknownRecord, manifestBytes: Uint8Array): void {
  if (sha256(manifestBytes) !== pinCase.inputSha256 || manifest.id !== pinCase.id || manifest.format !== 'cha-stereo-input-v1') throw new Error(`Pinned input manifest mismatch for ${pinCase.id}.`)
  if (manifest.left?.sha256 !== pinCase.leftSha256 || manifest.right?.sha256 !== pinCase.rightSha256) throw new Error(`Pinned image hashes mismatch for ${pinCase.id}.`)
}

function validateResultAccounting(result: StereoResult, caseId: string, role: string): void {
  const size = result.width * result.height
  if (!Number.isSafeInteger(size) || size !== result.outcomes.length) throw new Error(`Invalid outcome array for ${caseId} ${role}.`)
  const names = ['border', 'textureless', 'photometric', 'ambiguous', 'inconsistent', 'accepted'] as const
  const histogram = [0, 0, 0, 0, 0, 0]
  for (const code of result.outcomes) {
    if (!Number.isInteger(code) || code < 0 || code >= histogram.length) throw new Error(`Unknown outcome code for ${caseId} ${role}.`)
    histogram[code]! += 1
  }
  for (let index = 0; index < names.length; index += 1) if (result.counts[names[index]!] !== histogram[index]) throw new Error(`Outcome histogram mismatch for ${caseId} ${role}.`)
  const accepted = new Set<number>()
  for (const point of result.points) {
    if (!Number.isInteger(point.pixelIndex) || point.pixelIndex < 0 || point.pixelIndex >= size || accepted.has(point.pixelIndex) || result.outcomes[point.pixelIndex] !== 5) throw new Error(`Accepted point accounting mismatch for ${caseId} ${role}.`)
    accepted.add(point.pixelIndex)
  }
  if (accepted.size !== result.counts.accepted || accepted.size !== result.points.length || result.status !== (accepted.size > 0 ? 'reconstructed' : 'empty')) throw new Error(`Accepted result conservation mismatch for ${caseId} ${role}.`)
}

export function decodeStereoLocalAttritionResult(recordValue: unknown, options: {
  caseId: string
  variantId: 'no-variance-proposal' | 'local-ambiguity-proposal'
  expectedVariant: unknown
  inputSha256: string
  leftSha256: string
  rightSha256: string
  source: 'confidence' | 'local'
}): StereoResult {
  const record = object(recordValue, `${options.caseId} ${options.source} result`)
  const expectedFormat = options.source === 'confidence' ? 'cha-stereo-confidence-result-v1' : 'cha-stereo-local-result-v1'
  if (record.format !== expectedFormat || record.developmentOnly !== true || record.caseId !== options.caseId || JSON.stringify(record.variant) !== JSON.stringify(options.expectedVariant)) throw new Error(`Result metadata mismatch for ${options.caseId} ${options.source}.`)
  if (record.inputSha256 !== options.inputSha256 || record.sourceHashes?.left !== options.leftSha256 || record.sourceHashes?.right !== options.rightSha256) throw new Error(`Result lineage mismatch for ${options.caseId} ${options.source}.`)
  if (JSON.stringify(record.censusSettings) !== JSON.stringify(STEREO_SGM_SETTINGS)) throw new Error(`Result Census settings mismatch for ${options.caseId} ${options.source}.`)
  if (options.source === 'local' && JSON.stringify(record.localAmbiguityRule) !== JSON.stringify(LOCAL_AMBIGUITY_RULE)) throw new Error(`Local ambiguity rule mismatch for ${options.caseId}.`)
  if (options.source === 'confidence' && record.localAmbiguityRule !== undefined) throw new Error(`Unexpected local ambiguity rule in confidence result for ${options.caseId}.`)
  const checked = stereoResultSchema.parse({
    format: 'cha-stereo-result-v1', inputSha256: record.inputSha256, sourceHashes: record.sourceHashes,
    algorithm: 'rectified-census-sgm-v1', algorithmSettings: STEREO_SGM_SETTINGS, reconstruction: record.reconstruction,
  })
  const result: StereoResult = { ...checked.reconstruction, outcomes: Uint8Array.from(checked.reconstruction.outcomes) }
  if (JSON.stringify(result.settings) !== JSON.stringify(STEREO_SETTINGS) || result.width !== 160 || result.height !== 120 || Math.abs(result.baselineM - 0.3) > 1e-9) throw new Error(`Result calibration/settings mismatch for ${options.caseId} ${options.source}.`)
  validateResultAccounting(result, options.caseId, options.source)
  return result
}

function caseMap(pin: UnknownRecord, path: string): Map<string, StereoLocalPinnedCase> {
  if (!Array.isArray(pin.cases) || pin.cases.length !== 9) throw new Error(`${path} must contain the exact nine pinned development cases.`)
  const items = pin.cases.map((raw: unknown): StereoLocalPinnedCase => {
    const item = object(raw, `${path}.cases[]`)
    if (item.split !== 'development' || !['positive', 'negative'].includes(item.role) || typeof item.id !== 'string' || typeof item.inputSha256 !== 'string') throw new Error(`${path} contains invalid development case metadata.`)
    for (const hashName of ['inputSha256', 'leftSha256', 'rightSha256', 'truthSha256', 'regionsSha256', 'unsupportedSha256']) if (!/^[a-f0-9]{64}$/.test(item[hashName])) throw new Error(`${path} contains invalid ${hashName}.`)
    if (!Number.isInteger(item.unsupportedPixels) || item.unsupportedPixels < 0 || item.unsupportedPixels > 19200) throw new Error(`${path} contains invalid unsupported-mask count.`)
    return item as StereoLocalPinnedCase
  })
  const map = new Map(items.map(item => [item.id, item]))
  if (map.size !== 9 || items.some(item => item.id !== item.id.trim())) throw new Error(`${path} case IDs must be unique.`)
  return map
}

function scoreArtifactIndex(scoresValue: unknown, options: { split: 'confidence' | 'local'; expectedCases: Map<string, StereoLocalPinnedCase> }): Map<string, { inputSha256: string; artifacts: Map<string, { fileName: string; sha256: string }> }> {
  const scores = object(scoresValue, `${options.split} scores index`)
  const expectedFormat = options.split === 'confidence' ? 'cha-stereo-confidence-scores-v1' : 'cha-stereo-local-scores-v1'
  if (scores.format !== expectedFormat || scores.developmentOnly !== true || !Array.isArray(scores.cases) || scores.cases.length !== 9) throw new Error(`Invalid ${options.split} scores artifact index.`)
  if (options.split === 'confidence' && scores.confidencePinsSha256 !== STEREO_LOCAL_ATTRITION_PINS.confidenceData) throw new Error('Confidence score pin lineage changed.')
  if (options.split === 'local' && (scores.confidenceDataPinSha256 !== STEREO_LOCAL_ATTRITION_PINS.confidenceData || scores.localPinsSha256 !== STEREO_LOCAL_ATTRITION_PINS.localData)) throw new Error('Local score pin lineage changed.')
  const index = new Map<string, { inputSha256: string; artifacts: Map<string, { fileName: string; sha256: string }> }>()
  for (const rawCase of scores.cases) {
    const item = object(rawCase, `${options.split} scores case`)
    const id = item.id
    const expected = typeof id === 'string' ? options.expectedCases.get(id) : undefined
    if (typeof id !== 'string' || index.has(id) || !Array.isArray(item.artifacts) || !expected || item.inputSha256 !== expected.inputSha256 || item.role !== expected.role) throw new Error(`Invalid ${options.split} score artifact index case.`)
    const artifacts = new Map<string, { fileName: string; sha256: string }>()
    for (const rawArtifact of item.artifacts) {
      const artifact = object(rawArtifact, `${options.split} score artifact`)
      if (typeof artifact.variantId !== 'string' || artifacts.has(artifact.variantId) || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error(`Invalid ${options.split} result artifact link.`)
      artifacts.set(artifact.variantId, { fileName: safeBasename(artifact.fileName, 'result fileName'), sha256: artifact.sha256 })
    }
    index.set(id, { inputSha256: item.inputSha256, artifacts })
  }
  return index
}

async function readVerifiedResult(root: string, index: Map<string, { inputSha256: string; artifacts: Map<string, { fileName: string; sha256: string }> }>, id: string, variantId: 'no-variance-proposal' | 'local-ambiguity-proposal', options: Omit<Parameters<typeof decodeStereoLocalAttritionResult>[1], 'caseId' | 'variantId' | 'source'> & { source: 'confidence' | 'local' }): Promise<{ result: StereoResult; sha256: string }> {
  const artifact = index.get(id)?.artifacts.get(variantId)
  if (!artifact) throw new Error(`Missing pinned ${options.source} ${variantId} artifact for ${id}.`)
  if (artifact.fileName !== `${id}-${variantId}.json`) throw new Error(`Unexpected pinned result file name for ${id} ${options.source}.`)
  const bytes = await readBounded(join(root, artifact.fileName), 8 * 1024 * 1024)
  if (sha256(bytes) !== artifact.sha256) throw new Error(`Pinned result hash mismatch for ${id} ${options.source}.`)
  const result = decodeStereoLocalAttritionResult(parseJson(bytes), { ...options, caseId: id, variantId, source: options.source })
  return { result, sha256: artifact.sha256 }
}

/** Load saved images/truth/masks/results after validating both frozen lineages. */
export async function loadStereoLocalAttritionCases(
  confidenceDirectory: string,
  localDirectory: string,
  confidencePinValue: unknown,
  localPinValue: unknown,
): Promise<StereoLocalAttritionLoadedCase[]> {
  const confidenceRoot = resolve(confidenceDirectory), localRoot = resolve(localDirectory)
  const confidencePin = object(confidencePinValue, 'confidence pin'), localPin = object(localPinValue, 'local pin')
  const confidenceCases = caseMap(confidencePin, 'confidence pin'), localCases = caseMap(localPin, 'local pin')
  if (JSON.stringify([...confidenceCases]) !== JSON.stringify([...localCases])) throw new Error('Confidence and local data pins disagree about the nine case inputs/masks.')
  const [confidenceScoreFile, localScoreFile] = await Promise.all([
    readJson(join(confidenceRoot, 'scores.json'), 4 * 1024 * 1024),
    readJson(join(localRoot, 'scores.json'), 4 * 1024 * 1024),
  ])
  if (sha256(confidenceScoreFile.bytes) !== STEREO_LOCAL_ATTRITION_PINS.confidenceScores || sha256(localScoreFile.bytes) !== STEREO_LOCAL_ATTRITION_PINS.localScores) throw new Error('Saved scores.json does not match the frozen score hash.')
  const confidenceIndex = scoreArtifactIndex(confidenceScoreFile.value, { split: 'confidence', expectedCases: confidenceCases })
  const localIndex = scoreArtifactIndex(localScoreFile.value, { split: 'local', expectedCases: localCases })
  if (confidenceIndex.size !== 9 || localIndex.size !== 9) throw new Error('Each saved score index must link all nine cases.')
  const confidenceVariants = new Map<string, unknown>(confidencePin.variants.map((variant: UnknownRecord) => [variant.id, variant]))
  const localVariants = new Map<string, unknown>(localPin.variants.map((variant: UnknownRecord) => [variant.id, variant]))
  if (JSON.stringify([...confidenceVariants.keys()]) !== JSON.stringify(['sad-baseline', 'census-sgm', 'no-variance-proposal']) || JSON.stringify([...localVariants.keys()]) !== JSON.stringify(['sad-baseline', 'census-sgm', 'local-ambiguity-proposal'])) throw new Error('Unexpected pinned variant sets.')
  const loaded: StereoLocalAttritionLoadedCase[] = []
  for (const [id, pinned] of confidenceCases) {
    const confidenceArtifacts = confidenceIndex.get(id)?.artifacts, localArtifacts = localIndex.get(id)?.artifacts
    if (!confidenceArtifacts || !localArtifacts || confidenceArtifacts.size !== 3 || localArtifacts.size !== 3) throw new Error(`Incomplete result artifact links for ${id}.`)
    const confidenceExpected = ['sad-baseline', 'census-sgm', 'no-variance-proposal']
    const localExpected = ['sad-baseline', 'census-sgm', 'local-ambiguity-proposal']
    if (JSON.stringify([...confidenceArtifacts.keys()].sort()) !== JSON.stringify([...confidenceExpected].sort())
      || JSON.stringify([...localArtifacts.keys()].sort()) !== JSON.stringify([...localExpected].sort())) throw new Error(`Missing or unexpected variant artifact link for ${id}.`)
    const inputFile = await loadStereoInput(join(confidenceRoot, `${id}-input.json`))
    checkManifestPin(pinned, inputFile.file, inputFile.bytes)
    const localInputBytes = await readBounded(join(localRoot, `${id}-input.json`), 64 * 1024)
    if (sha256(localInputBytes) !== pinned.inputSha256 || !Buffer.from(localInputBytes).equals(Buffer.from(inputFile.bytes))) throw new Error(`Local saved input differs from confidence input for ${id}.`)
    if (inputFile.file.left.sha256 !== pinned.leftSha256 || inputFile.file.right.sha256 !== pinned.rightSha256) throw new Error(`Saved input image links differ from the pin for ${id}.`)
    const [localLeft, localRight] = await Promise.all([
      readBounded(join(localRoot, inputFile.file.left.fileName), 149 * 1024),
      readBounded(join(localRoot, inputFile.file.right.fileName), 149 * 1024),
    ])
    if (sha256(localLeft) !== pinned.leftSha256 || sha256(localRight) !== pinned.rightSha256) throw new Error(`Local saved image differs from the frozen pin for ${id}.`)
    const truthBytes = await readBounded(join(confidenceRoot, `${id}-truth.json`), 1024 * 1024)
    const localTruthBytes = await readBounded(join(localRoot, `${id}-truth.json`), 1024 * 1024)
    const regionsBytes = await readBounded(join(confidenceRoot, `${id}-regions.json`), 512 * 1024)
    const localRegionsBytes = await readBounded(join(localRoot, `${id}-regions.json`), 512 * 1024)
    const unsupportedBytes = await readBounded(join(confidenceRoot, `${id}-unsupported.json`), 512 * 1024)
    const localUnsupportedBytes = await readBounded(join(localRoot, `${id}-unsupported.json`), 512 * 1024)
    if (sha256(truthBytes) !== pinned.truthSha256 || sha256(regionsBytes) !== pinned.regionsSha256 || sha256(unsupportedBytes) !== pinned.unsupportedSha256
      || !Buffer.from(localTruthBytes).equals(Buffer.from(truthBytes)) || !Buffer.from(localRegionsBytes).equals(Buffer.from(regionsBytes)) || !Buffer.from(localUnsupportedBytes).equals(Buffer.from(unsupportedBytes))) throw new Error(`Saved truth/regions/unsupported masks differ from the frozen pin for ${id}.`)
    const truth = object(parseJson(truthBytes), `${id} truth`) as StereoLocalAttritionLoadedCase['truth']
    const regions = object(parseJson(regionsBytes), `${id} regions`) as Record<string, number[]>
    const unsupportedPixels = parseJson(unsupportedBytes) as number[]
    if (truth.disparityPx.length !== 19200 || truth.depthM.length !== 19200 || JSON.stringify(truth.camera) !== JSON.stringify(inputFile.file.left.camera)
      || !Array.isArray(unsupportedPixels) || unsupportedPixels.length !== pinned.unsupportedPixels || unsupportedPixels.some(pixel => !Number.isInteger(pixel) || pixel < 0 || pixel >= 19200)) throw new Error(`Invalid pinned truth or unsupported mask for ${id}.`)
    for (const [name, pixels] of Object.entries(regions)) if (!Array.isArray(pixels) || new Set(pixels).size !== pixels.length || pixels.some(pixel => !Number.isInteger(pixel) || pixel < 0 || pixel >= 19200)) throw new Error(`Invalid ${name} region mask for ${id}.`)
    const readOptions = {
      inputSha256: pinned.inputSha256, leftSha256: pinned.leftSha256, rightSha256: pinned.rightSha256,
    }
    const [base, filtered] = await Promise.all([
      readVerifiedResult(confidenceRoot, confidenceIndex, id, 'no-variance-proposal', { ...readOptions, expectedVariant: confidenceVariants.get('no-variance-proposal'), source: 'confidence' }),
      readVerifiedResult(localRoot, localIndex, id, 'local-ambiguity-proposal', { ...readOptions, expectedVariant: localVariants.get('local-ambiguity-proposal'), source: 'local' }),
    ])
    if (base.result.width !== filtered.result.width || base.result.height !== filtered.result.height || base.result.baselineM !== filtered.result.baselineM || JSON.stringify(base.result.settings) !== JSON.stringify(filtered.result.settings)) throw new Error(`Base and filtered calibration/settings mismatch for ${id}.`)
    loaded.push({
      id, role: pinned.role, input: inputFile.input, truth, regions, unsupportedPixels, base: base.result, filtered: filtered.result,
      lineage: { inputSha256: pinned.inputSha256, leftSha256: pinned.leftSha256, rightSha256: pinned.rightSha256, truthSha256: pinned.truthSha256, regionsSha256: pinned.regionsSha256, unsupportedSha256: pinned.unsupportedSha256, confidenceResultSha256: base.sha256, localResultSha256: filtered.sha256 },
    })
  }
  return loaded
}
