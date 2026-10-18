# Development eligibility screen for a no-texture-gate proposal

This protocol checks whether one fixed proposal is worth freezing for a future sealed evaluation. The proposal is exactly the existing `without-texture` Census/SGM control: disable only the texture-variance screen in the fixed candidate, with no other code or parameter change. Compare it with the existing SAD default and full Census/SGM. This is a development eligibility screen, not parameter search, candidate promotion, or evidence of generalization.

## Frozen development cases

Run nine cases: the three original positive development cases, two new positive controls, and four negative controls. Freeze and record hashes for every input pair, truth map, evaluator-only mask, implementation file and settings file before estimation. Define all masks before estimation; masks and truth remain evaluator-only.

The two positive controls are:

- The original first positive case with the right view transformed by gain 1.12 and offset 8, plus deterministic RGB noise bounded to ±3.
- A low-contrast view pair formed in both views with gain 0.25 around intensity 96, retaining the known scene geometry and truth.

The four negative controls are:

- Uniform images in both views.
- Independent seeded noise images with no correspondence.
- Exactly periodic 8-pixel stripes in both views. Geometry is null because repeated support is unidentifiable.
- The original first positive case with its right-view central patch replaced by independent noise. Keep the left-surface truth and mark the unsupported correspondence area with a predefined evaluator-only mask.

Use each case's predefined evaluable mask for negative-control acceptance rates. Do not score a negative as a disparity-accuracy case when its geometry is undefined. For the right-patch case, the unsupported mask identifies where accepted estimates lack a valid correspondence; do not reinterpret left-view surface truth as proof of a right match.

The fresh four-case [holdout-C pin](data/stereo-holdout-c.json) SHA256 is `8ff8000b086a1ed6adbffc818ba5181ac7f22bae46aa75431533fc508c277781`. Keep those cases unopened for estimation throughout this increment.

The [confidence data/rule/implementation pin](data/stereo-confidence.json) SHA256 is `a16437db6d648aa454df23b05c8ab465997f40720728f85f89a3cefe9ff15879`. It was generated before any estimator ran on the new controls. Uniform, unrelated-noise and periodic controls each use 14,848 full-search/patch-valid pixels as their unsupported domain; the damaged-patch control has 2,170 originally right-visible correspondences safely inside its replaced region. The original three positive input manifests remain byte-identical. New control manifests describe their actual transformations or lack of shared geometry rather than claiming every image is a ray-rendered scene.

## Fixed eligibility criteria

All criteria must pass for the proposal to be eligible for a later, separately frozen candidate check:

1. On **each of the five positive cases**, the proposal meets every existing absolute geometry gate: truth coverage ≥35%, bad-1 among evaluated estimates ≤10%, and axial-depth P90 error ≤0.25 m. Null or nonfinite metrics fail.
2. Pooled over **all five positive development cases**, the proposal meets all three existing relative gates against SAD: missing-aware >1-pixel error improves by at least 2 percentage points; coverage loss is at most 2 percentage points; and >1-pixel error among evaluated estimates does not increase.
3. On each of the four negative controls, proposal acceptance within the predefined evaluable unsupported mask is at most 1%. This is a new diagnostic requirement declared before these results: at most one accepted assignment per hundred known-unsupported pixels. It is a support-acceptance rate, not a bad-1 rate or a physical accuracy guarantee.
4. All 27 case/variant jobs have measured wall time ≤30 seconds and OS-reported peak RSS ≤512 MiB, with both measurements present. A missing measurement or exceeded limit fails eligibility.

Report every variant on every case, even after a failed criterion. Retain all outcomes and per-case and pooled counts. For positives, report coverage, evaluated and missing-aware bad-1 rates, depth errors and all geometry gates. For every case and diagnostic region, report gained/lost accepted correct and bad pixels against full Census/SGM. For negatives, report acceptance counts and rates over the predefined mask, plus all retained rejection outcomes. Keep truth-known denominators explicit; do not pool negative acceptance with positive disparity errors or add overlapping region counts.

## Run boundary and resource measurements

The runner accepts only the pinned cases and three fixed variants: SAD default, full Census/SGM, and the exact `without-texture` control. Its only estimation command is:

```sh
bun run spatial:stereo:confidence -- --output <new-directory>
```

`--pins` alone prints the data, code and settings hashes and runs no estimators. There is no arbitrary-input or evaluation flag. Internal worker arguments identify only an exact pinned case and variant. Use a fresh output directory and retain all 27 job records, including failures.

Run every job in a separate Bun child process. The parent samples child RSS every 25 ms and kills a job when a sampled value exceeds the cap; the child also records the operating-system high-water `maxRSS` after result serialization and stdout flush. Keep sampled RSS and that OS checkpoint as distinct measurements, using their maximum for eligibility. The small final resource-record emission follows the checkpoint. Sampling may miss a brief transient, so it does not prove instantaneous hard-cap enforcement. If sampling is unavailable, record that fact; a valid worker OS checkpoint still permits the post-run resource gate. Missing OS measurement fails it. Include measured wall time and both memory values in `resource-runtime.json`, with a separate decision linking the score/runtime hashes; successful `scores.json` and result bytes exclude nondeterministic measurements.

The wall-time budget includes worker startup, fixture generation, matching, serialization and output. Peak RSS covers that worker at its reported checkpoint, with observed parent samples alongside; parent orchestration, whole-workflow peak memory and browser/GPU costs are outside this per-job budget. Worker failures and bounded diagnostic output remain in the installed result directory. Exit 2 means a completed screen found the proposal ineligible; exit 1 means the workflow could not validate/install the experiment.

Do not tune settings or replace cases after seeing a result. Passing this development screen establishes eligibility only; it does not promote the proposal to the default or establish held-out success. A later step must freeze a distinct candidate, code, settings, selection rule and resource harness before running every case in holdout-C. No holdout estimator may run in this increment.

This protocol changes no real-scene, UI, acoustic or registration evidence. Independent world registration, unseen real-camera evaluation, full SPATIAL-05 and ECHO-04/05 remain open.

## Recorded result — October 18, 2026: ineligible

Setup commit **`9e7080317222eea4e97540f5071e4729010b24b7`** froze the controls, rule, proposal and source hashes before the first actual screen. All **27/27** jobs completed and were retained. The command exited **2**: positive absolute gates, pooled relative gates and resource gates pass, but the periodic negative fails. No rule, threshold or case changed after evaluation, and no candidate was selected.

| Unsupported correspondence mask | SAD accepted | Full Census/SGM accepted | No-variance proposal accepted | Proposal requirement |
|---|---:|---:|---:|---|
| Uniform pair, 14,848 pixels | 0 | 0 | 0 | ≤1% — pass |
| Independent noise, 14,848 pixels | 0 | 0 | 0 | ≤1% — pass |
| Periodic stripes, 14,848 pixels | 0 | **14,848 (100%)** | **14,848 (100%)** | ≤1% — **fail** |
| Corrupted right patch, 2,170 pixels | 0 | 0 | 0 | ≤1% — pass |

The periodic pattern admits several indistinguishable horizontal offsets by construction. Both SGM versions accept **17,168 points over the whole frame**, including all 14,848 pixels in the frozen full-search domain. Every one has unknown geometry truth; none is counted as a geometrically correct point. Their disparity-error fractions remain null, rather than becoming a misleading 0% error. The separate unsupported-support metric exposes the failure. Because the original full SGM also fails identically, this ambiguity problem predates the variance bypass. SAD abstains on this pattern.

The proposal passes every positive case's existing absolute gates. Over all five positive cases:

| Pooled positive measure | SAD baseline | No-variance proposal |
|---|---:|---:|
| Valid-truth pixels | 96,000 | 96,000 |
| Accepted with truth / unestimated truth | 15,608 / 80,392 | 73,768 / 22,232 |
| Coverage | 16.258% | 76.842% |
| Bad-1 among estimates | 158 / 15,608 = 1.012% | 517 / 73,768 = 0.701% |
| Bad-1 counting missing | 83.906% | 23.697% |

Missing-aware error improves by 60.209 percentage points; coverage improves by 60.583 points and bad-1 fraction among estimates decreases. These gains pass the frozen relative screen but cannot override the unsupported-support failure. The two new appearance controls show why the variance hypothesis remains useful to study:

| New positive control | Coverage, SAD / full SGM / proposal | Proposal bad-1 / depth P90 / max |
|---|---|---|
| Exposure + noise | 0.026% / 19.854% / 52.479% | 49 / 10,076 = 0.486%; 0.14199 / 0.52765 m |
| Low contrast | 0% / 0% / 83.125% | 37 / 15,960 = 0.232%; 0.13148 / 1.79711 m |

The original three positive proposal results match the prior [ablation result](SPATIAL_STEREO_ABLATION.md). Missing support and large outliers remain in these favorable synthetic positives. No negative with undefined geometry was added to their accuracy denominator.

## Resource and artifact record

One local **macOS arm64, Bun 1.4.3** run measured all 27 isolated workers, with a maximum wall time of **222 ms** and maximum gate RSS of **77.125 MiB**. The maximum worker OS checkpoint was **66.6875 MiB**; maximum parent RSS sample was **77.125 MiB**. The gate uses the larger observed value. Every worker had OS and parent-sampled measurements and stayed below the 30 s / 512 MiB limits. These are observations for the fixed 160×120, 25-label cases, not a maximum-input, whole-pipeline or browser performance claim. Timing and memory are not expected to reproduce byte-for-byte.

| Artifact in ignored `local-captures/stereo-confidence-development/` | SHA256 |
|---|---|
| `scores.json` | `1132cbad82e4dedccdd5172e31dc3ff3aa1396ef62d9afe76549bd7c12ce90b7` |
| `resource-runtime.json` | `98d2738657a8ac449c364cfafd3cd88a1da0c97a48b0f338046a9273bb064f6c` |
| `decision.json` | `71b3870a7e0efd09d77f54a5a9e61a80148902972bab9602ed50a0ed9fbf0ba1` |

All **541 Vitest checks**, full package/script/Vue typechecks and repository hygiene pass. New checks cover fixed controls, evaluator-only unsupported masks and null geometry, exact eligibility boundaries, missing/duplicate/failed trials, changed-source rejection, bounded process/output cleanup and unavailable resource measurements. Full-suite concurrency is capped at four workers; large fixture comparisons use SHA256 fingerprints, and the two-run stereo integration check has a 20 s test deadline. These fix test-load timeouts without changing any experimental rule or the 30 s worker budget.

A separate saved-artifact calculation, without an estimator or shared evaluator, verified the pin/score/decision/runtime hashes, every input/image/truth/region/unsupported link, all 27 outcome/point counts, strict >1 px errors, disparity/depth summaries, pooled positive rates and unsupported mask counts. It also checked the recorded resource gates; it did not remeasure the workers or validate physical accuracy. Holdout-C was checked only as file bytes against its reserved hash. Existing numerical entry points, the browser build, live preview, capture relay and Tailscale route were preserved.

## Decision and next hypothesis

Keep SAD as the default and retain full SGM and the failed proposal as explicit research references. Keep holdout-C unopened. The positive results do not justify releasing its answers or treating smooth, self-consistent assignments as independently observed correspondence.

Next, test **local matching ambiguity separately from aggregated SGM confidence** on these now-open development controls. The periodic failure motivates a raw-image-cost ambiguity check or other explicit evidence requirement before accepting a regularized label; it does not yet establish which check will preserve useful low-contrast support. Predeclare that next proposal and its decision rule, retain all failed cases and keep the 1% unsupported cap. A future candidate must pass development screening and be separately frozen before every reserved holdout case is evaluated. No parameter search against the holdout or a relaxed negative threshold follows this failed screen.
