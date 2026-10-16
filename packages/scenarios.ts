import { applySceneCommand, type SceneCommand } from './commands'
import { defaultSettings, parseScene, type Scene, type SolverSettings } from './engine'

/** A small authored home used for guided, reproducible model experiments. */
export function createHomeScene(): Scene {
  const fixture = 'fixture-assumed' as const
  const bands = (entries: readonly [number, number][]) => entries.map(([frequencyHz, valueDb]) => ({
    frequencyHz,
    valueDb,
    provenance: fixture,
  }))

  return parseScene({
    id: 'home-guided-scenario',
    revision: 1,
    levels: [{
      id: 'main',
      name: 'Main floor',
      boundary: [[0, 0], [6, 0], [12, 0], [12, 5], [12, 9], [6, 9], [0, 9], [0, 5]],
      floorZ: 0,
      ceilingHeightM: 2.7,
    }],
    zones: [
      { id: 'living-room', levelId: 'main', name: 'Living room', polygon: [[0.2, 0.2], [5.8, 0.2], [5.8, 4.8], [0.2, 4.8]] },
      { id: 'kitchen', levelId: 'main', name: 'Kitchen', polygon: [[6.2, 0.2], [11.8, 0.2], [11.8, 4.8], [6.2, 4.8]] },
      { id: 'bedroom', levelId: 'main', name: 'Bedroom', polygon: [[0.2, 5.2], [5.8, 5.2], [5.8, 8.8], [0.2, 8.8]] },
      { id: 'study', levelId: 'main', name: 'Study', polygon: [[6.2, 5.2], [11.8, 5.2], [11.8, 8.8], [6.2, 8.8]] },
    ],
    materials: [
      {
        id: 'exterior-masonry', name: 'Assumed exterior masonry', provenance: fixture,
        acousticTransmissionDb: bands([[125, 18], [1000, 32], [4000, 38]]),
        radioLossDb: bands([[2.4e9, 15], [5e9, 20], [6e9, 22]]),
      },
      {
        id: 'interior-partition', name: 'Assumed interior partition', provenance: fixture,
        acousticTransmissionDb: bands([[125, 5], [1000, 11], [4000, 16]]),
        radioLossDb: bands([[2.4e9, 4], [5e9, 7], [6e9, 9]]),
      },
      {
        id: 'interior-door-leaf', name: 'Assumed closed interior door', provenance: fixture,
        acousticTransmissionDb: bands([[125, 3], [1000, 7], [4000, 10]]),
        radioLossDb: bands([[2.4e9, 2], [5e9, 3], [6e9, 4]]),
      },
    ],
    walls: [
      { id: 'envelope-south-west', levelId: 'main', start: [0, 0], end: [6, 0], thicknessM: 0.2, baseZ: 0, heightM: 2.7, materialId: 'exterior-masonry' },
      { id: 'envelope-south-east', levelId: 'main', start: [6, 0], end: [12, 0], thicknessM: 0.2, baseZ: 0, heightM: 2.7, materialId: 'exterior-masonry' },
      { id: 'envelope-east-south', levelId: 'main', start: [12, 0], end: [12, 5], thicknessM: 0.2, baseZ: 0, heightM: 2.7, materialId: 'exterior-masonry' },
      { id: 'envelope-east-north', levelId: 'main', start: [12, 5], end: [12, 9], thicknessM: 0.2, baseZ: 0, heightM: 2.7, materialId: 'exterior-masonry' },
      { id: 'envelope-north-east', levelId: 'main', start: [12, 9], end: [6, 9], thicknessM: 0.2, baseZ: 0, heightM: 2.7, materialId: 'exterior-masonry' },
      { id: 'envelope-north-west', levelId: 'main', start: [6, 9], end: [0, 9], thicknessM: 0.2, baseZ: 0, heightM: 2.7, materialId: 'exterior-masonry' },
      { id: 'envelope-west-north', levelId: 'main', start: [0, 9], end: [0, 5], thicknessM: 0.2, baseZ: 0, heightM: 2.7, materialId: 'exterior-masonry' },
      { id: 'envelope-west-south', levelId: 'main', start: [0, 5], end: [0, 0], thicknessM: 0.2, baseZ: 0, heightM: 2.7, materialId: 'exterior-masonry' },
      { id: 'partition-west-south', levelId: 'main', start: [0.17, 5], end: [6, 5], thicknessM: 0.12, baseZ: 0, heightM: 2.7, materialId: 'interior-partition' },
      { id: 'partition-east-south', levelId: 'main', start: [6, 5], end: [11.83, 5], thicknessM: 0.12, baseZ: 0, heightM: 2.7, materialId: 'interior-partition' },
      { id: 'partition-south', levelId: 'main', start: [6, 0.17], end: [6, 5], thicknessM: 0.12, baseZ: 0, heightM: 2.7, materialId: 'interior-partition' },
      { id: 'partition-north', levelId: 'main', start: [6, 5], end: [6, 8.83], thicknessM: 0.12, baseZ: 0, heightM: 2.7, materialId: 'interior-partition' },
    ],
    openings: [
      { id: 'bedroom-door', wallId: 'partition-west-south', fromT: 0.43, toT: 0.58, sillAboveBaseM: 0, heightM: 2.1, kind: 'door', isOpen: false, materialId: 'interior-door-leaf' },
      { id: 'kitchen-door', wallId: 'partition-south', fromT: 0.38, toT: 0.54, sillAboveBaseM: 0, heightM: 2.1, kind: 'door', isOpen: false, materialId: 'interior-door-leaf' },
      { id: 'study-door', wallId: 'partition-east-south', fromT: 0.43, toT: 0.58, sillAboveBaseM: 0, heightM: 2.1, kind: 'door', isOpen: false, materialId: 'interior-door-leaf' },
    ],
    emitters: [
      { id: 'living-speaker', levelId: 'main', domain: 'acoustics', position: [2, 2, 1.2], active: true },
      { id: 'living-access-point', levelId: 'main', domain: 'radio', position: [2, 2, 2.2], active: true, eirpDbm: 20 },
    ],
    probes: [
      { id: 'bedroom-probe', levelId: 'main', position: [4, 7, 1.2], name: 'Bedroom listening point' },
      { id: 'study-probe', levelId: 'main', position: [9, 7, 1.2], name: 'Study signal point' },
    ],
  })
}

export type GuidedIntervention = {
  id: string
  title: string
  domain: 'acoustics' | 'radio'
  description: string
  action:
    | { kind: 'scene-command'; command: SceneCommand }
    | { kind: 'settings'; patch: Partial<SolverSettings> }
  expectedEffect: string
}

/** Guided changes and their intended interpretation for the authored home. */
export const HOME_SCENARIO_INTERVENTIONS: readonly GuidedIntervention[] = [
  {
    id: 'open-bedroom-door',
    title: 'Open the bedroom door',
    domain: 'acoustics',
    description: 'Compare the living speaker level in the bedroom with the door closed and open.',
    action: { kind: 'scene-command', command: { type: 'set-door-state', openingId: 'bedroom-door', isOpen: true } },
    expectedEffect: 'The direct-path door-leaf loss is removed while distance stays fixed.',
  },
  {
    id: 'move-access-point',
    title: 'Move the access point to the bedroom',
    domain: 'radio',
    description: 'Move the access point into the bedroom beside the fixed bedroom probe.',
    action: { kind: 'scene-command', command: { type: 'move-emitter', emitterId: 'living-access-point', position: [4, 6.5, 2.2] } },
    expectedEffect: 'The bedroom reading rises as the source gets closer and the living-room partition leaves the direct path.',
  },
  {
    id: 'change-radio-frequency',
    title: 'Change Wi-Fi frequency',
    domain: 'radio',
    description: 'Evaluate the same access point and probe at 5 GHz instead of 2.4 GHz.',
    action: { kind: 'settings', patch: { mode: 'radio', frequencyHz: 5e9 } },
    expectedEffect: 'Free-space path loss and the assumed wall-loss bands change with frequency.',
  },
  {
    id: 'open-study-door-control',
    title: 'Negative control: open the study door',
    domain: 'acoustics',
    description: 'Open a door away from the living-speaker to bedroom-probe path.',
    action: { kind: 'scene-command', command: { type: 'set-door-state', openingId: 'study-door', isOpen: true } },
    expectedEffect: 'The direct model reading remains unchanged because the source, probe, and intersected walls are unchanged.',
  },
]

export type HomeScenarioIntervention = {
  id: string
  title: string
  instruction: string
  scene: Scene
  settings: SolverSettings
}

export type HomeScenario = {
  id: string
  title: string
  description: string
  scene: Scene
  settings: SolverSettings
  interventions: readonly HomeScenarioIntervention[]
}

/** Complete, ready-to-load baseline and intervention states for guided UI flows. */
export function createHomeScenarios(): HomeScenario[] {
  const acousticScene = createHomeScene()
  const acousticSettings: SolverSettings = { ...defaultSettings('acoustics'), frequencyHz: 1000 }
  const acousticOpenDoor = applySceneCommand(acousticScene, {
    type: 'set-door-state', openingId: 'bedroom-door', isOpen: true,
  })
  const acousticNegativeControl = applySceneCommand(acousticScene, {
    type: 'set-door-state', openingId: 'study-door', isOpen: true,
  })

  const radioScene = createHomeScene()
  const radioSettings: SolverSettings = { ...defaultSettings('radio'), frequencyHz: 2.4e9 }
  const relocatedAccessPoint = applySceneCommand(radioScene, {
    type: 'move-emitter', emitterId: 'living-access-point', position: [4, 6.5, 2.2],
  })

  return [
    {
      id: 'home-acoustics',
      title: 'Sound through a home',
      description: 'Explore how an interior door changes direct sound transmission between the living room and bedroom.',
      scene: acousticScene,
      settings: acousticSettings,
      interventions: [
        {
          id: 'open-bedroom-door', title: 'Open the bedroom door',
          instruction: 'Open the door between the living room and bedroom, then compare the bedroom reading.',
          scene: acousticOpenDoor, settings: acousticSettings,
        },
        {
          id: 'open-study-door-control', title: 'Negative control: open the study door',
          instruction: 'Open the study door, which is away from the direct path, and confirm the bedroom reading stays the same.',
          scene: acousticNegativeControl, settings: acousticSettings,
        },
      ],
    },
    {
      id: 'home-radio',
      title: 'Wi-Fi coverage in a home',
      description: 'Compare radio propagation at the bedroom probe while changing access-point placement or frequency.',
      scene: radioScene,
      settings: radioSettings,
      interventions: [
        {
          id: 'move-access-point', title: 'Move the access point to the bedroom',
          instruction: 'Move the access point beside the fixed bedroom probe and compare the received power.',
          scene: relocatedAccessPoint, settings: radioSettings,
        },
        {
          id: 'change-radio-frequency', title: 'Change Wi-Fi frequency to 5 GHz',
          instruction: 'Keep the access point and probe in place, then evaluate at 5 GHz.',
          scene: radioScene, settings: { ...radioSettings, frequencyHz: 5e9 },
        },
      ],
    },
  ]
}

/** Fresh states avoid sharing mutable Scene objects between UI sessions. */
export const HOME_SCENARIOS: HomeScenario[] = createHomeScenarios()
