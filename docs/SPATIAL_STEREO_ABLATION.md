# Development-only stereo diagnostic ablations

This protocol separates the fixed Census/SGM candidate's matching and rejection behavior on the three original development cases. It is diagnostic work only: it does not search parameters, promote an algorithm, run estimation on holdout data, or evaluate real scenes. The existing [comparison report](SPATIAL_STEREO_COMPARISON.md) and opened sealed/real results remain regression records; do not retune against them.

## Frozen inputs and variants

Use only the three cases in [the development pin](data/stereo-comparison-cases.json), whose SHA256 is `30d767fd5913dd1aea1af0fd4400f37bd4c2ac0b3e4abb6957560c5f8eaa87df`. Keep their source images, calibration, truth and diagnostic regions fixed. The separate four-case `holdout-c-*` fixture and [holdout pin](data/stereo-holdout-c.json) are reserved for a later evaluation. Generate or inspect that pin without running an estimator; do not open its truth for candidate selection.

The [ablation input/control/implementation pin](data/stereo-ablation.json) SHA256 is `93abdc7eaf1c8deac995dc4d9173c6e2633335c64a21d7c4fdfa966ef60b1ecb`. The fresh holdout pin SHA256 is `8ff8000b086a1ed6adbffc818ba5181ac7f22bae46aa75431533fc508c277781`. Both were generated before any development ablation result. The reserved split contains textured tilt, weak stripe/repeated texture, a negative exposure change and a narrow occluder, with new seeds and geometry. It shares the existing synthetic renderer and supplied rig; it is not independent real-room or camera-registration evidence.

Run exactly these nine variants:

| Variant | Fixed change from the reference |
|---|---|
| `sad-baseline` | Existing `rectified-rgb-sad-v1` baseline |
| `census-sgm` | Original fixed 5×5 Census descriptor and four-cardinal-path SGM candidate |
| `census-local` | Same Census cost and acceptance screens, with no path aggregation |
| `without-texture` | Disable only the texture-variance screen |
| `without-rgb` | Disable only the RGB patch-MAE screen |
| `without-uniqueness` | Disable only the uniqueness screen |
| `without-left-right` | Disable only the left-right consistency screen |
| `without-components` | Disable only the connected-component-size screen |
| `without-endpoints` | Disable only the search-endpoint winner rejection |

Every Census variant retains the raw Census Hamming-cost limit of 6/24. Keep SGM penalties P1=2 and P2=12, and the minimum component area 12 pixels, unchanged wherever those rules apply. Keep all other numeric settings equal to the frozen candidate. Each `without-*` variant disables exactly its named screen; do not combine bypasses or fill holes. `census-local` isolates path aggregation while retaining the Census candidate's other screens. The SAD-to-Census comparison changes multiple algorithm details and is not a descriptor-only ablation. All variants are diagnostic and must not become production candidates or production result IDs.

## Run and report

The runner accepts only the pinned development inputs and these fixed variants. It refuses real-scene and evaluation paths, and each output must use a new directory. `--pins` emits the development input hashes, variant controls, holdout-pin hash and hashes of the explicitly selected implementation source files; normal estimation checks those exact pins first. `--holdout-pins` alone generates a fresh holdout data/settings/budget pin and performs no estimation. There is no split selector. Outputs use the separate `cha-stereo-ablation-result-v1` diagnostic format and cannot be used as production stereo results or visual exports.

```sh
bun run spatial:stereo:ablate -- --pins
bun run spatial:stereo:ablate -- --holdout-pins
bun run spatial:stereo:ablate -- --output local-captures/stereo-ablation-development
```

Record the exact input and implementation pin hashes and command with each run. Report pooled counts and rates, then each development case and each diagnostic region separately. Retain all per-pixel outcomes and rejected/accepted categories. For each ablation against full `census-sgm`, report gained and lost accepted pixels that have correct disparity (error ≤1 output pixel), and gained and lost accepted pixels with bad disparity (>1 pixel). Compute subset accuracy only from truth-known pixels and include both evaluated-estimate and missing-aware >1-pixel rates. Keep coverage, all absolute geometry gates, missing-truth counts, and other outcomes visible; overlapping diagnostic regions must not be summed. No result is asserted by this protocol.

## Holdout and resource boundary

The existing sealed cases are open and remain fixed regressions. Do not use them to tune or select. The fresh reserved `holdout-c-*` split is pinned before this diagnostic run and remains unopened for estimation. If development-only diagnosis supports another candidate, define its selection rule and commit its implementation/settings before opening the fresh split's estimator results. That later evaluation must run every case and retain failures. It must not be replaced by a more favorable split.

The planned budget for a future candidate check is at most 256×192 pixels, at most 64 disparity labels, one CPU process per case and variant, 30 seconds wall time, and 512 MiB peak RSS. These are planned limits, not measurements or currently enforced ablation-command limits. Report elapsed runtime separately; runtime alone does not establish peak RSS. Measure and enforce the resource budget with a future candidate-check harness before making a resource claim.

This diagnostic step does not close independent world registration, unseen real-camera evaluation, broader mapping, the full SPATIAL-05 gate or ECHO-04/05. Keep observed, estimated and generated content distinct.
