# Synthetic one-plane 3D reference

The second software increment prepares SPATIAL-03 with a bounded numerical experiment: one infinite specular plane, one fixed known speaker, and microphones at supplied 3D positions. The pure fitter/evaluator and demo CLI are implemented; verification is recorded in [implementation status](IMPLEMENTATION_STATUS.md). It is not a moving-phone room scanner or physical validation.

## Run the reference

```sh
bun run spatial:plane-demo -- --format markdown
bun run test -- packages/spatial-plane.test.ts packages/spatial-plane-evaluation.test.ts scripts/spatial-plane-demo.test.ts
```

The demonstration fits tilted-wall, floor and ceiling cases. Each has six eligible training positions, one missing and one ambiguous attempt, and three held-out positions. Reports show fit status, surface errors, held-out residuals and exact input hashes. The estimator receives only training observations; truth and held-out data are passed separately to evaluation. A successful result demonstrates the stated numerical model, with physical accuracy still unknown.

## Model and inference

World coordinates are right-handed metres with Z up. A plane is `{ normal: [nx,ny,nz], offsetM }`, with unit normal and `normal · x = offsetM`. Speaker `s` is reflected across the plane to virtual source `v = s + 2 * (offsetM - normal · s) * normal`. For microphone `m`, the direct path is `||s-m||` and reflected path is `||v-m||`. The predicted direct-relative delay is `(reflected - direct) * 1000 / 343` ms. Distinct speaker/microphone positions must be modeled explicitly; `2d/c` is only the colocated case.

This image-source construction follows the model described in [Acoustic echoes reveal room shape](https://pmc.ncbi.nlm.nih.gov/articles/PMC3725100/). The fixed-source solver below is a deliberately restricted reference, not a reproduction of that paper's full echo-assignment algorithm.

For each accepted delay, form reflected range `L = directDistance + delayMs * 343 / 1000`. With fixed `s` and at least four noncoplanar microphone positions, subtracting squared range equations gives a linear least-squares estimate of `v`. The plane is the perpendicular bisector of `s` and `v`. Calculations are centered near the fixed speaker to reduce cancellation with translated coordinates. Pivoted Householder QR uses a common matrix scale and a `1e-8` relative diagonal cutoff to reject weak pose diversity. This is a numerical screening rule, not a calibrated uncertainty estimate; insufficient data is reported rather than regularized into a plausible plane.

The fitted normal points toward the speaker, so its signed distance is positive. Degenerate source/plane configurations, microphones on the opposite side, unsupported source movement and fits outside the declared residual tolerance are rejected. Accepted input plane-normal roundoff is normalized together with its offset, preserving the plane equation. The plane is infinite: finite wall bounds, occlusion, diffraction, reflectivity, echo assignment, device response and acoustic calibration are outside scope.

## Pure API

`packages/spatial-plane.ts` exports:

```ts
type SpatialPlane = { normal: Vector3; offsetM: number }
type PlaneObservation = {
  id: string
  speakerPositionM: Vector3
  microphonePositionM: Vector3
  arrivalCandidatesMs: number[]
}
type PlaneOutcome = { id: string; status: 'eligible' | 'missing' | 'ambiguous' }
type PlaneFitResult = {
  status: 'ok' | 'invalid-data' | 'insufficient-data' | 'unsupported-source-motion' | 'no-solution'
  message: string
  outcomes: PlaneOutcome[]
  eligibleCount: number
  plane?: SpatialPlane
  imageSourceM?: Vector3
  rmsResidualMs?: number
  maxResidualMs?: number
}
```

- `predictPlaneDelayMs(plane, speakerPositionM, microphonePositionM): number` checks unit plane normals, finite coordinates and valid same-side reflection. Throws on invalid/unsupported inputs.
- `fitSinglePlane(observations, options?: { maxResidualMs?: number }): PlaneFitResult` receives observation data only. It must not import fixtures or accept truth geometry. The default residual limit is 0.05 ms, a synthetic numerical screening choice, not a physical accuracy claim. Freeze any override before evaluation.

Observation IDs use the spatial bundle's 1–80 ASCII ID rule. Limit input to 48 observations, 16 candidates per observation, coordinates/offsets to ±1,000,000 m, and positive finite candidate delays to 1,000,000 ms. Reject duplicate IDs and malformed inputs. A residual limit must be finite between 0 and 10 ms. Speaker positions must agree within 1e-8 m; varying source positions return `unsupported-source-motion`. Empty candidate sets remain `missing`; multiple candidates remain `ambiguous`, without selecting the one that would fit. Report all outcomes in input order. Require four eligible positions with full 3D diversity. Only an accepted result has `plane` and `imageSourceM`; rejected fits must not publish an accepted geometric result.

## Fixture and evaluation boundary

`packages/test-fixtures/spatial-plane.ts` constructs deterministic synthetic cases from frozen delay literals and separately held truth planes: tilted wall, floor and ceiling. The fixed speaker is `[2, 1, 1.2]`, with full-3D training microphone positions and distinct held-out positions. Each case contains `{ id, training, heldOut, truth }`; `truth` is a `SpatialPlane`. Missing and ambiguous attempts have stable IDs. The estimator gets only `training`; `truth` and `heldOut` stay evaluator inputs. No real captures or private data are used.

Timing literals were computed independently with mirror-source/Euclidean path arithmetic. They are frozen because Bun and Node can differ by a floating-point unit when computing `Math.hypot`, which otherwise changes serialized training hashes. This preserves identical estimator input bytes across the two runtimes; it does not claim additional measurement precision.

| Case | SHA256 of exact `JSON.stringify(training)` UTF-8 bytes |
|---|---|
| tilted-wall | `d93abd593823c4084f793413d0bc7ac35c6f693cea4c7af0c9b6ee9f82d0a995` |
| floor | `da1443fcefdec65f9fd363399fc844410fcbc06abd39608523090508c487133e` |
| ceiling | `8efa56596d5f64dd4b0397691f528ab3fa2d8ec0bcf9b55ae5e89e6e311a6490` |

Training IDs are `<case>-training-01` through `-06`, `<case>-training-missing` and `<case>-training-ambiguous`. Held-out IDs are `<case>-heldout-01` through `-03`.

`packages/spatial-plane-evaluation.ts` exports `evaluatePlaneFit(result, truth, heldOut)` returning a deterministic result with:

- Fit status and eligible/missing/ambiguous attempt counts.
- Sign-invariant normal-angle error in degrees and absolute signed-offset error in metres, with normals sign-aligned first. These metrics describe an explicitly shared world frame, without best-fit alignment/rescaling.
- Held-out candidate/evaluated/excluded counts and RMS/maximum direct-relative timing residuals, preserving explicit exclusions. An unavailable estimate does not become zero error. Training/held-out ID overlap, duplicate IDs and malformed evaluation input are rejected; unsupported predicted reflections have explicit exclusions.
- Explicit synthetic-only limitations and the fixed-source/infinite-plane assumptions.

Evaluation does not refit against held-out observations or truth. `bun run spatial:plane-demo -- --format json` runs the three frozen cases and hashes exact separate JSON serializations of training observations, held-out observations and truth, with stable observation IDs. Truth is not part of the estimator input. Command argument/process handling stays outside pure packages; importing the command does not run it.

## Verification scope

Use independent analytical cases as well as generated data: colocated source/microphone, a separated speaker/mic mirror-source distance, translation of the same experiment and floor/ceiling normals. Cover missing/ambiguous data, insufficient/coplanar poses, source motion, mixed/wrong arrivals, normal-sign equivalence, input immutability and independent held-out checks. Public tests and demos establish numerical behavior under these assumptions only. The known-wall ECHO-04/05 physical gate remains unchanged.

This reference has its own observation contract because the existing synthetic Echo scan requires four rectangle arrivals per pose. It does not silently migrate those arrays into one identified physical plane. A future adapter must explicitly select supported arrivals and require known sensor registration; unknown or multiple candidates remain unavailable/ambiguous.
