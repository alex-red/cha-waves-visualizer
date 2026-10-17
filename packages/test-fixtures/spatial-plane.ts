import type { PlaneObservation, SpatialPlane } from '../spatial-plane.ts'

type SpatialPlaneCase = { id: string; training: PlaneObservation[]; heldOut: PlaneObservation[]; truth: SpatialPlane }

const speaker = [2, 1, 1.2] as const
const trainingPositions = [
  [0.5, 0.2, 0.6],
  [1.3, 0.2, 0.6],
  [0.5, 1.5, 0.6],
  [0.5, 0.2, 2],
  [1.7, 1.4, 1.8],
  [2.4, 0.8, 1.1],
] as const
const heldOutPositions = [
  [2.8, 0.4, 1.5],
  [0.9, 2.4, 2.4],
  [3, 2, 2.5],
] as const

// Frozen from the independent mirror-source construction: reflect the fixed speaker
// across each truth plane, measure direct and image-source Euclidean paths, then
// compute (reflected - direct) * 1000 / 343 ms. Keeping the resulting literals here
// makes estimator-input JSON byte-stable across JS engines.
const frozenDelays = {
  'tilted-wall': {
    training: [[9.063688943150881], [11.005779737094278], [11.60279680957231], [12.497728190947493], [17.240255913794176], [16.154302013662477], [], [11.005779737094278, 11.255779737094278]],
    heldOut: [[15.2708280118215], [16.04620064819251], [17.503817174043938]],
  },
  floor: {
    training: [[1.9624141192303048], [2.5358569517880953], [2.054449730651345], [5.086602809309314], [6.5899600511908005], [5.495094266111989], [], [2.5358569517880953, 2.7858569517880953]],
    heldOut: [[5.350452941360173], [5.449347143575077], [5.947881028681683]],
  },
  ceiling: {
    training: [[7.954019434261463], [9.072245606161877], [8.153375165990086], [4.072415300368065], [6.5899600511908005], [9.529654405892888], [], [9.072245606161877, 9.322245606161877]],
    heldOut: [[7.009204895108684], [2.4525349974880415], [2.27131990895086]],
  },
} satisfies Record<string, { training: number[][]; heldOut: number[][] }>

const root14 = Math.sqrt(14)
const caseDefinitions: Array<{ id: keyof typeof frozenDelays; truth: SpatialPlane }> = [
  { id: 'tilted-wall', truth: { normal: [1 / root14, 2 / root14, 3 / root14], offsetM: -1 } },
  { id: 'floor', truth: { normal: [0, 0, 1], offsetM: 0 } },
  { id: 'ceiling', truth: { normal: [0, 0, -1], offsetM: -3 } },
]

function observation(id: string, position: readonly number[], arrivalCandidatesMs: number[]): PlaneObservation {
  return {
    id,
    speakerPositionM: [...speaker],
    microphonePositionM: [position[0]!, position[1]!, position[2]!],
    arrivalCandidatesMs: [...arrivalCandidatesMs],
  }
}

/** Create fresh synthetic estimator inputs, held-out measurements, and separate truth for each case. */
export function createSpatialPlaneCases(): SpatialPlaneCase[] {
  return caseDefinitions.map(({ id, truth }) => {
    const delays = frozenDelays[id]
    const training = trainingPositions.map((position, index) => observation(
      `${id}-training-${String(index + 1).padStart(2, '0')}`, position, delays.training[index]!,
    ))
    training.push(observation(`${id}-training-missing`, trainingPositions[0], delays.training[6]!))
    training.push(observation(`${id}-training-ambiguous`, trainingPositions[1], delays.training[7]!))
    return {
      id,
      training,
      heldOut: heldOutPositions.map((position, index) => observation(
        `${id}-heldout-${String(index + 1).padStart(2, '0')}`, position, delays.heldOut[index]!,
      )),
      truth: { normal: [...truth.normal], offsetM: truth.offsetM },
    }
  })
}
