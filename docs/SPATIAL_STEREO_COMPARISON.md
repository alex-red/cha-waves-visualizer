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
