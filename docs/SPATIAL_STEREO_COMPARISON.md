# Stereo failure cases and a separate SGM candidate

This follows the failed [Adirondack real-data baseline](SPATIAL_REAL_STEREO.md). It tests a stronger correspondence method without changing the frozen SAD baseline, its exports or the research gates. No acoustic evidence, pose estimation, Gaussian optimization or AI completion is introduced.

## Protocol fixed before evaluation

Use one candidate with **5×5 Census descriptors and four cardinal SGM paths**, P1=2, P2=12, maximum accepted raw Census Hamming cost 6/24, and minimum connected-component area 12 pixels (4-neighbour connectivity, adjacent disparity difference ≤1 pixel). These values are fixed in advance; no hyperparameter sweep or selection against real-data/evaluation results is performed. Both algorithms use the same declared search range, texture variance threshold 24, RGB patch MAE limit 18, uniqueness ratio 0.8 and reverse tolerance 1 pixel. The candidate rejects search-endpoint winners, inconsistent matches and small components rather than filling holes. Its uniqueness test operates on aggregated costs. Local textureless regions remain unsupported.

SGM aggregates each path as `C + min(previous[d], previous[d±1]+P1, min(previous)+P2) − min(previous)`. Census uses local grayscale ordering; RGB error remains a separate acceptance screen. Candidate parameters are recorded under a distinct algorithm ID, `rectified-census-sgm-v1`; the old `rectified-rgb-sad-v1` remains the default. Supporting up to 64 disparity labels bounds its additional cost/aggregate arrays to approximately 15 MiB per direction at 256×192, excluding objects, descriptors, paths, originals and runtime overhead. This is not peak-memory measurement. Learned priors are not involved; spatial regularization is still an assumption that can propagate incorrect disparities.

The candidate is an independent bounded reference inspired by [Zabih and Woodfill's Census transform](https://www.cs.cornell.edu/~rdz/rdz-papers.html) and [Hirschmüller's SGM method](https://www.robotic.dlr.de/fileadmin/robotic/hirschmu/cvpr05hh.pdf). It is not an implementation of every feature or performance claim in those papers.

## Development and evaluation inputs

Self-authored synthetic ray-rendered inputs in `packages/test-fixtures/stereo-development.ts` contain three development cases (textured tilted backdrop/occluder, weak stripe with repeated texture, and a right-view exposure change) and two disjoint evaluation cases with different geometry, seeds, texture and occluder shape. A supplied 0.30 m rig and unequal horizontal principal points exercise calibration handling. Surface definitions and truth are available only to generation/evaluation, not passed to either estimator. Left-visible truth stays known even when its right correspondence is occluded or outside the frame. Boundary, weak-texture and unavailable-correspondence masks support separate diagnostics; they are never estimator inputs.

Freeze exact paired-image/camera, truth and region hashes before any comparison. Run development first; freeze the candidate code before opening evaluation results. Run both evaluation cases even if development fails, retaining all failures. The split is a reproducible experimental boundary, not a filesystem security boundary. Do not claim generalization from two synthetic scenes.

Report geometry metrics and retained outcomes for every algorithm/case, plus each diagnostic region. Compare coverage and false matches together. A candidate passes the **relative comparison screen** only if its pooled >1-pixel error fraction counting missing estimates as failures improves by at least **2 percentage points**, valid-truth coverage falls by at most **2 points**, and >1-pixel error among evaluated estimates does not increase. Keep the existing absolute geometry gates (coverage ≥35%, bad-1 ≤10%, depth P90 ≤0.25 m) visible per case. Null metrics fail. A relative gain is not a passed physical reconstruction benchmark, and this experiment does not promote a default automatically.

For real data, rerun the known Adirondack input only as a reported regression, then evaluate the freshly pinned [Motorcycle-perfect source](data/middlebury-motorcycle.json) at 256×173 with search 1–24, derived only from `ndisp` and scale. The source pin was prepared by a separate metadata-only task without decoding images or truth. No candidate parameter changes are allowed after the first transfer result. Both algorithms receive identical images/calibration; a separate geometry evaluator opens structured-light truth. The right image is an estimator input, not a held-out view. Keep all original photographs, truth, reconstructions and reports in ignored local storage under their own reuse terms.

ECHO-04/05, independently measured world registration, broader rooms/views and the full SPATIAL-05 gate remain open.

Frozen synthetic [case/split/settings pin](data/stereo-comparison-cases.json) SHA256: `30d767fd5913dd1aea1af0fd4400f37bd4c2ac0b3e4abb6957560c5f8eaa87df`. Fresh real-transfer [source pin](data/middlebury-motorcycle.json) SHA256: `7056bd512283b8249c7cd41936be01d5de2ab666c1f05616533b7d94177a7d09`. These hashes were frozen before running either comparison split or either algorithm on Motorcycle.

## Commands and development result

Use new output directories; all commands refuse replacement. The comparison command checks the committed source/settings pin before estimation, writes every pixel outcome and per-region geometry scores, and keeps nondeterministic elapsed time in a separate `runtime.json`. Exit 2 means the completed comparison failed its relative screen; exit 1 means invalid input or an I/O error.

```sh
bun run spatial:stereo:compare -- --split development --output local-captures/stereo-comparison-development
# Commit the candidate implementation before opening evaluation results.
bun run spatial:stereo:compare -- --split evaluation --output local-captures/stereo-comparison-evaluation

bun run spatial:middlebury -- fetch --dataset motorcycle --output local-captures/middlebury-motorcycle-original
bun run spatial:middlebury -- prepare --dataset motorcycle --source local-captures/middlebury-motorcycle-original --output local-captures/middlebury-motorcycle-prepared
bun run spatial:stereo -- --input local-captures/middlebury-motorcycle-prepared/input.json --output local-captures/middlebury-motorcycle-sad
bun run spatial:stereo:sgm -- --input local-captures/middlebury-motorcycle-prepared/input.json --output local-captures/middlebury-motorcycle-sgm
bun run spatial:middlebury -- truth --dataset motorcycle --source local-captures/middlebury-motorcycle-original --input local-captures/middlebury-motorcycle-prepared/input.json --output local-captures/middlebury-motorcycle-truth
bun run spatial:stereo:geometry -- --input local-captures/middlebury-motorcycle-prepared/input.json --result local-captures/middlebury-motorcycle-sad/reconstruction.json --truth local-captures/middlebury-motorcycle-truth/truth.json --output local-captures/middlebury-motorcycle-sad-scores
bun run spatial:stereo:geometry -- --input local-captures/middlebury-motorcycle-prepared/input.json --result local-captures/middlebury-motorcycle-sgm/reconstruction.json --truth local-captures/middlebury-motorcycle-truth/truth.json --output local-captures/middlebury-motorcycle-sgm-scores
```

The frozen three-case development run pools 57,600 valid truth pixels. SAD accepts 15,603 with truth (27.089% coverage), with 153 bad-1 matches (0.981% among estimates; 73.177% counting missing). Census/SGM accepts 20,737 (36.002% coverage), with 184 bad-1 matches (0.887% among estimates; 64.318% counting missing). Missing-aware error improves by **8.859 percentage points**, coverage by **8.913 points**; all three relative gates pass. Absolute bad-match count rises with coverage, so retain the denominators. These are development results, not sealed evaluation or real-scene evidence.

Development report SHA256: `ea94602dd8f0c7ce5bb281bbbbd19567c0046b40f66cac28db397211eddb0540`. The candidate settings remain those declared above; no parameter search followed this result.

The pooled development gain comes from the exposure case (coverage 2.703% → 33.609%). Coverage falls on both other cases (34.453% → 32.599%, 44.109% → 41.797%). The weak stripe remains mostly unestimated, and boundary/occlusion errors persist. Only the repeated-texture development case passes all absolute gates for either algorithm. The pooled pass therefore does not establish an across-condition improvement.

## Sealed evaluation: relative screen fails

Source definitions/splits/settings were committed in `bf0f600` before the development comparison. Candidate implementation and integration checks were frozen in **`856322b61b8fc8d082e0ba22012eed7f9224cc35`**, before either evaluation estimator or either Motorcycle estimator ran. The implementation freeze is a recorded Git revision; the CLI verifies the source/settings pin, not Git history. No candidate code or parameters changed after these evaluation/transfer results.

| Pooled measure | SAD baseline | Census/SGM |
|---|---:|---:|
| Valid-truth pixels | 38,400 | 38,400 |
| Accepted with truth / unestimated truth | 19,331 / 19,069 | 18,610 / 19,790 |
| Truth coverage | 50.341% | 48.464% |
| >1 px errors / evaluated estimates | 135 / 19,331 (0.698%) | 240 / 18,610 (1.290%) |
| >1 px errors counting missing | 50.010% | 52.161% |

Missing-aware error **worsens by 2.151 percentage points** instead of improving by the required 2 points. Coverage falls by 1.878 points (within the allowed loss), but bad-1 among estimates also increases. Two of three relative gates fail; the command exits 2 and retains both cases. Each algorithm still passes all absolute geometry gates on each case:

| Evaluation case | Coverage, SAD → SGM | Bad-1 among estimates, SAD → SGM | Depth P90, SAD → SGM |
|---|---|---|---|
| Textured tilt/occluder B | 52.411% → 50.703% | 0.835% → 1.376% | 0.09047 → 0.16513 m |
| Weak stripe/tilt/occluder B | 48.271% → 46.224% | 0.550% → 1.194% | 0.08614 → 0.17806 m |

On the second evaluation case, the known weak-texture region has only 7.075% → 5.800% coverage. Boundary coverage falls on both cases; among accepted boundary matches the bad-1 rates improve (23.913% → 18.981%, 22.674% → 12.883%). Occlusion/unavailable-correspondence coverage is at most 2.386% for either method, with many incorrect accepted matches. These diagnostic subsets overlap; do not add their counts. The gain under a development exposure change did not transfer to this split.

Evaluation report SHA256: `3348982ceb137c36d280537a1a3bd494707dbdaabc861d0878984f794902cb62`.

## Real scenes: lower false-match rates, incomplete support

The fresh **Motorcycle-perfect** check uses the pinned 2964×2000 originals, prepared at **256×173**, search **1–24**, and supplied 0.193001 m baseline. The existing **Adirondack-perfect** input/truth are reused unchanged only as a seen-scene regression. Both real scenes use independently acquired structured-light truth, the documented Middlebury PFM convention and identical prepared input for both algorithms. No image enhancement, truth-based selection, alignment, fitted scale or missing-region completion is applied.

| Scene / algorithm | Truth coverage | Bad-1 among estimates | Bad-1 counting missing | Depth P90 / maximum | Absolute gates |
|---|---:|---:|---:|---|---|
| Adirondack / retained SAD | 28.795% | 20.512% | 77.111% | 0.42693 / 1.40005 m | Fail all three |
| Adirondack / Census/SGM | 43.788% | 4.929% | 58.370% | 0.05505 / 1.34175 m | Pass all three |
| Motorcycle / SAD | 54.938% | 8.705% | 49.844% | 0.14426 / 2.19856 m | Pass all three |
| Motorcycle / Census/SGM | 53.215% | 4.828% | 49.354% | 0.10991 / 2.04618 m | Pass all three |

Motorcycle has 44,288 pixels, 43,052 with truth and 1,236 missing truth. SAD accepts 24,360: **23,652 with truth**, 708 without; 19,400 truth pixels remain unestimated and 2,059 evaluated estimates exceed 1 px error. Census/SGM accepts 23,481: **22,910 with truth**, 571 without; 20,142 truth pixels remain unestimated and 1,106 exceed 1 px error. False-match fraction falls, but coverage falls by **1.723 points**. Missing-aware error improves by just **0.490 points**, below the 2-point relative requirement. The absolute gate pass on this pair does not establish the required relative improvement.

The Adirondack candidate accepts 19,880: **19,720 with truth**, 160 without; 25,315 truth pixels remain unestimated and 972 evaluated estimates exceed 1 px error. Its missing-aware improvement is **18.741 points**, passing the same relative screen on this already-seen scene. This cannot substitute for the failed sealed comparison or fresh transfer screen. Its original failed SAD record remains intact.

| Retained artifact | SHA256 |
|---|---|
| Motorcycle prepared input | `5dfa713440295ed2953d5f733b062df225b8f41b83d54774819c206f86a3f568` |
| Motorcycle truth manifest | `5a5e347bcb6aa29962a39c7f00f2988c7c5fd53c5c742638dd1037107a652cca` |
| Motorcycle SAD result | `384d2412cbaa53eb8d5cb7643f123f4050d5e2d93c01051efbafce73073b595a` |
| Motorcycle SAD geometry report | `8227902ff44ccbf8c5a23df482b0b5c9f5c6c60f1ad275653ce48c1d66ece869` |
| Motorcycle SGM result | `e2c4909be93e964cd68589debe4d8eca24daeda241aea99e3c952c6bcdd7378c` |
| Motorcycle SGM geometry report | `6655922fea09c5cf9fdafa6e70a392653ba56684641c5aeb7a127d397c5f40a5` |
| Adirondack SGM result | `07b90545f8396dd200b528c787c655804de19bed76c784ec38096ed759448fde` |
| Adirondack SGM geometry report | `f0e7a4b718ae5852d46030162c5c2efa4dfd1b9e9d96c622e7376e897b79f3ac` |

Adirondack input/truth hashes and original SAD lineage remain in the [first real-stereo record](SPATIAL_REAL_STEREO.md). Real assets/reports stay under ignored `local-captures/`. The separately exported `.splat` files contain heuristic surface Gaussians derived from estimated stereo points; passing geometry screens does not evaluate the Gaussian rendering or train their parameters. There are no independent held-out camera views, estimated world registration, acoustic contribution or AI-completed regions in these real tests. Large retained depth outliers and roughly half missing support remain material limits. No broad room-mapping or full SPATIAL-05 claim follows.

All **501 Vitest checks** and full package/script/Vue typechecks pass. The original synthetic baseline result, visual manifest and `.splat` remain byte-identical. A separate review recomputed all three new real reports from saved points and little-endian float32 truth without importing the evaluator: counts, strict >1 px errors, coverage, missing-aware error, depth P90/max and absolute gates agree. It also verified input/result/truth/report links, both truth-map hashes, outcome conservation and all four Motorcycle original hashes/sizes against the pin. This verifies arithmetic and retained artifact linkage; it does not independently validate source calibration, preparation or structured-light truth. No UI source or browser output was replaced in this CLI-only increment.

## Decision and next evidence

Keep SAD as the default and Census/SGM as an explicit research candidate. The fixed candidate improves real-scene false-match rates, but does not pass the sealed relative comparison or the fresh scene's 2-point missing-aware requirement. Do not tune its thresholds on these now-open results or select another scene to replace the failure.

Next, use development-only fixed ablations to separate descriptor/exposure robustness, spatial regularization and rejection losses. Preserve the current runs as regressions. Before selecting another candidate, freeze a fresh independent evaluation split and resource budget; include boundary/weak-texture/occlusion counts and missing-aware error. Broader camera/view coverage and separately evaluated world registration remain necessary for SPATIAL-05. ECHO-04/05 remains the next independent physical acoustic test, and observed/estimated content stays distinct from later AI completion.

The follow-up [development-only diagnostic run](SPATIAL_STEREO_ABLATION.md) now records those ablations and pins a fresh four-case split without opening it for estimation. It identifies the variance screen's coverage cost and the false support exposed by individual bypasses. It does not change this candidate, its defaults or the retained results above; the next candidate decision requires development negative controls and a predeclared selection rule.
