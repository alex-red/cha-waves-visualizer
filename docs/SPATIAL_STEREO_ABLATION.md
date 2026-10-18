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

Record the exact input and implementation pin hashes and command with each run. Report pooled counts and rates, then each development case and each diagnostic region separately. Retain all per-pixel outcomes and rejected/accepted categories. For each ablation against full `census-sgm`, report gained and lost accepted pixels that have correct disparity (error ≤1 output pixel), and gained and lost accepted pixels with bad disparity (>1 pixel). Compute subset accuracy only from truth-known pixels and include both evaluated-estimate and missing-aware >1-pixel rates. Keep coverage, all absolute geometry gates, missing-truth counts, and other outcomes visible; overlapping diagnostic regions must not be summed. These reporting choices were fixed before the run below.

## Holdout and resource boundary

The existing sealed cases are open and remain fixed regressions. Do not use them to tune or select. The fresh reserved `holdout-c-*` split is pinned before this diagnostic run and remains unopened for estimation. If development-only diagnosis supports another candidate, define its selection rule and commit its implementation/settings before opening the fresh split's estimator results. That later evaluation must run every case and retain failures. It must not be replaced by a more favorable split.

The planned budget for a future candidate check is at most 256×192 pixels, at most 64 disparity labels, one CPU process per case and variant, 30 seconds wall time, and 512 MiB peak RSS. These are planned limits, not measurements or currently enforced ablation-command limits. Report elapsed runtime separately; runtime alone does not establish peak RSS. Measure and enforce the resource budget with a future candidate-check harness before making a resource claim.

This diagnostic step does not close independent world registration, unseen real-camera evaluation, broader mapping, the full SPATIAL-05 gate or ECHO-04/05. Keep observed, estimated and generated content distinct.

## Development result — October 18, 2026

Setup commit **`48143e22e982e32600cf29f8547d5aa435c7413c`** froze the implementation, controls, development inputs and reserved holdout before the first full diagnostic run. The command above produced report SHA256 **`ddabff879dea83dc2970f75de90bac1900e44dcb24e977f7ffa9b8032d7932af`**, retained under ignored `local-captures/stereo-ablation-development/ablation.json`. Every row below pools the same 57,600 truth-known pixels; no missing truth is silently scored as success. Runtime remains separate from deterministic report bytes.

| Diagnostic variant | Accepted with truth | Coverage | Bad-1 among estimates | Bad-1 counting missing |
|---|---:|---:|---:|---:|
| SAD baseline | 15,603 | 27.089% | 153 / 15,603 = 0.981% | 73.177% |
| Full Census/SGM | 20,737 | 36.002% | 184 / 20,737 = 0.887% | 64.318% |
| Local Census | 12,492 | 21.688% | 144 / 12,492 = 1.153% | 78.563% |
| Without texture screen | 47,732 | 82.868% | 431 / 47,732 = 0.903% | 17.880% |
| Without RGB screen | 20,738 | 36.003% | 185 / 20,738 = 0.892% | 64.318% |
| Without uniqueness screen | 20,949 | 36.370% | 239 / 20,949 = 1.141% | 64.045% |
| Without left-right screen | 22,198 | 38.538% | 595 / 22,198 = 2.680% | 62.495% |
| Without component screen | 21,361 | 37.085% | 209 / 21,361 = 0.978% | 63.278% |
| Without endpoint screen | 20,737 | 36.002% | 184 / 20,737 = 0.887% | 64.318% |

The **texture-variance screen is the largest coverage restriction on these generated inputs**. Disabling it in both matching directions adds **26,748 correct and 247 bad** accepted disparities, with no lost reference points or changed labels among retained points. Coverage rises by 46.866 percentage points and missing-aware error falls by 46.438 points. Error fraction among estimates rises slightly, from 0.887% to 0.903%; absolute false-match count rises from 184 to 431. This is evidence to investigate the screen, not to remove it from the candidate automatically.

| Development case | Coverage, full → no texture screen | Bad-1 counts, full → no texture screen | No-texture depth P90 / maximum |
|---|---|---|---|
| Textured tilt/occluder A | 32.599% → 84.646% | 8 → 31 | 0.11657 / 1.89085 m |
| Weak stripe/repeated A | 41.797% → 78.609% | 169 → 364 | 0.16952 / 1.20702 m |
| Exposure tilt/occluder A | 33.609% → 85.349% | 7 → 36 | 0.12742 / 1.67895 m |

The no-texture diagnostic passes all absolute geometry gates on each development case, while retaining metre-scale depth outliers. In the known weak stripe, accepted support rises from **265/3,111 (8.518%)** to **2,892/3,111 (92.960%)**, with bad-1 counts 0 → 12. On that case's boundary region, accepted support rises 189 → 434 while incorrect disparities rise 56 → 93. In its unavailable-correspondence region, accepted support rises 19 → 38 and bad-1 counts 19 → 37. A numerically correct disparity at an occluded/out-of-frame correspondence does not establish an observed match. The model and smooth synthetic scene can favor propagation; this is not evidence that real textureless, reflective or moving regions can be mapped safely.

Other fixed contrasts help narrow the next experiment:

- Removing aggregation loses **8,169 correct and 129 bad** reference points and gains only **38 correct and 15 bad** points. Among retained points, 74 correct disparities become bad. The SGM paths support coverage under these conditions; the prior SAD-to-SGM difference cannot be attributed to Census alone.
- Removing left-right consistency adds **1,050 correct and 411 bad** points. In the weak/repeated case's unavailable-correspondence region it accepts **166 points, all bad**, compared with 19, all bad, for the full reference. This screen rejects substantial false support as well as usable estimates.
- Removing uniqueness adds **157 correct and 55 bad** points; removing components adds **599 correct and 25 bad** points. These are smaller tradeoffs than the texture effect.
- Removing RGB screening adds **one bad point and no correct points**. Removing endpoint rejection changes first-rejection categories but not the final accepted point set. Neither is the coverage bottleneck on these cases.

The screens are ordered and interact through reverse matching and component connectivity. These one-factor contrasts are not additive causal contributions; an outcome such as `textureless` means a failed variance screen, not independently verified absence of a recoverable surface.

## Verification and next decision

All **516 Vitest checks** and full package/script/Vue typechecks pass. Tests verify strict CLI options, changed-pin rejection before estimation, deterministic diagnostic reports, all outcomes, support transitions with missing truth and the exact >1 px boundary, fixed controls, real effects of left-right/component bypasses, and original method bytes. The three original development SGM result hashes and original comparison report remain unchanged. A separate Python calculation over all **27 saved result arrays** verifies hashes, outcome conservation, counts/rates, depth P90/max, each region, gained/lost/retained transitions, pooled counts and the listed implementation source hashes without invoking an estimator or shared evaluator.

No estimator has run on the fresh holdout, and no real-scene ablation or candidate selection was performed. SAD stays the default; the original fixed SGM entry point keeps its behavior. No UI build, live preview, relay or Tailscale route was replaced.

The completed [confidence eligibility screen](SPATIAL_STEREO_CONFIDENCE.md), frozen at commit `9e70803`, finds the no-texture proposal ineligible. It passes the positive absolute gates and pooled relative gates, and the resource gate passes. The periodic-stripe negative fails decisively: the proposal accepts 14,848/14,848 unsupported pixels (100%, against ≤1%); full Census/SGM also accepts all 14,848, while SAD accepts none. Proposal acceptance is zero on the other three negative masks. All 27 workers completed with measurements in one local run; maximum gate RSS was 77.125 MiB and maximum wall time was 222 ms. Defaults remain unchanged, and holdout-C remains unopened.

Next, test the hypothesis that the different periodic-stripe outcomes arise from local matching versus path aggregation under repeated ambiguity. Keep the explicit unsupported mask and fixed development cases, and make no algorithm fix or parameter choice from this observation alone. A distinct candidate and resource check must be frozen before any future holdout run; do not change or replace the opened sealed and real-scene regression results.
