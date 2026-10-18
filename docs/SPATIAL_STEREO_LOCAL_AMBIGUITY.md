# Fixed local ambiguity post-filter

This protocol tests one fixed post-filter motivated by the [development confidence screen](SPATIAL_STEREO_CONFIDENCE.md). That screen found full Census/SGM and the no-texture proposal both accepted all support in the periodic-stripe negative, while SAD accepted none. The hypothesis is that a local raw-cost ambiguity check may reject this repeated support after no-variance SGM. This is a hypothesis to test, not a claimed fix or a parameter-selection rule.

## Frozen inputs and proposal

Reuse the exact nine development confidence cases: the same five positive cases and four negative controls, with identical images, calibration, truth, predefined diagnostic regions and unsupported masks. The old confidence pin SHA256 is `a16437db6d648aa454df23b05c8ab465997f40720728f85f89a3cefe9ff15879`. Freeze the new case/input, settings and source hashes in [the local ambiguity pin](data/stereo-local-ambiguity.json) before any estimator runs. Keep the fresh four-case holdout-C pin at SHA256 `8ff8000b086a1ed6adbffc818ba5181ac7f22bae46aa75431533fc508c277781`; it remains unopened for estimation.

The only proposal is no-variance Census/SGM followed by one local Census uniqueness check. It adds no other algorithm or threshold changes:

1. Run the existing no-variance SGM path with its original settings and acceptance rules, including aggregate-cost uniqueness, RGB screening, left-right consistency, component filtering and endpoint rejection. The texture-variance gate stays disabled as in the frozen `without-texture` control.
2. For each already accepted point, compute a 5×5 grayscale Census cost from the original input pair in both directions. In the reference view, anchor the local check at `Math.round(refinedDisparity)`. In the right view, use `Math.round(x - refinedDisparity)` and the same rounded disparity anchor.
3. At each anchor, compare the raw Census cost for the anchored winner with the minimum raw cost over valid disparity labels more than one label away from the anchor. Require a finite positive competitor, a finite valid local support, anchored winner cost ≤6, and `winner / competitor ≤0.8` in both directions. Reject zero/zero, ties and invalid support.
4. Apply the check only to points accepted by the base no-variance SGM result. Reclassify a rejected point as ambiguous. Do not fill holes, move disparities, or rerun left-right or component filtering after this post-filter. The retained support may therefore contain fragments of previously accepted components.

The small local-cost helper is independent of the frozen SGM core, whose raw cost implementation is private. The helper may be reused by the pure report/worker path, with pinned source hashes. Keep every numeric setting fixed; do not tune the cost, radius, ratios, masks or cases after viewing results.

The frozen local pin SHA256 is `91c4a6347db83744d47e178c21889d51673e5f9500eb888b01793dbfb4c1ae91`. Its source list covers the proposal, adapter, worker, runner, shared estimators/evaluators and input helpers. The case records must exactly equal the earlier confidence pin before execution. This protocol and implementation are committed before the development estimation run; results are recorded separately afterward.

## Eligibility screen

Compare exactly three variants on every case: SAD default, full Census/SGM and this single local-filter proposal. This produces 27 jobs. Use the existing confidence screen's gates:

- On each of the five positive cases, the proposal must reach at least 35% truth coverage, at most 10% bad-1 among evaluated estimates, and axial-depth P90 error at most 0.25 m. Null or nonfinite metrics fail.
- Against SAD, apply all three existing relative gates pooled over the five positive cases: at least a 2 percentage-point improvement in missing-aware >1-pixel error, at most a 2-point loss in coverage, and no increase in >1-pixel error among evaluated estimates.
- On each negative control, proposal acceptance within its predefined unsupported evaluable mask must be at most 1%. This is an unsupported-support rate, not a disparity bad-1 rate.
- Every one of the 27 jobs must have measured wall time ≤30 seconds and OS-reported peak RSS ≤512 MiB. Both measurements must be present. A failed or missing worker measurement fails eligibility, but do not skip later jobs.

Retain all 27 outcomes even when a gate fails. Report pooled and per-case counts, every positive geometry gate, negative unsupported acceptance denominators, and per-region outcomes. Against full Census/SGM, report gained and lost accepted correct and bad pixels. Keep truth and unsupported masks evaluator-only; estimators receive only their pinned image pair and settings. Do not pool negative acceptance with disparity error or add overlapping region counts.

## Pinning, execution and resource records

The runner uses only the committed local-ambiguity pin, has no arbitrary-input or holdout-estimation option, and refuses replacement of an existing output directory. Generate/inspect pin metadata without estimating, then run the fixed protocol:

```sh
bun run spatial:stereo:local -- --pins
bun run spatial:stereo:local -- --output local-captures/stereo-local-ambiguity
```

`--pins` emits metadata and hashes only; it runs no estimators. Record the exact pin and source hashes. Run each case/variant in a separate Bun child. The parent samples RSS every 25 ms and kills a child when an observed sample exceeds the cap. Each child reports OS high-water `maxRSS` after result serialization and stdout flush. Preserve the sampled peak and OS checkpoint as separate fields, and gate on the larger measurement. Sampling may miss a transient between observations; the OS checkpoint and sampling are distinct evidence.

Keep deterministic scores separate from resource/runtime and eligibility-decision records. Retain a slot for every planned job, including failed, killed or unavailable measurements; continue through all 27 jobs after failures. Wall time, process RSS and failure availability can vary by host and do not belong in deterministic score bytes. Do not claim that the 30-second/512-MiB budget passed without complete measurements.

If parent sampling is unavailable, retain that status; a valid worker OS checkpoint still permits the resource gate, as in the previous confidence protocol. Missing OS measurement fails it. The budget covers each worker's startup, input generation, estimation, serialization and output. Parent orchestration and browser/GPU memory are outside this per-job scope. Exit 2 records an ineligible completed screen; exit 1 records a validation or installation failure.

The earlier no-variance failure remains a regression record. This run does not search settings, replace cases, relax thresholds, select a production candidate or estimate on holdout-C. A future held-out test requires a distinct candidate, pin, selection rule and resource check frozen before estimation. This work makes no physical-room, world-registration, AI-completion, acoustic or UI claim; ECHO-04/05 and the broader SPATIAL-05 evidence gates remain open.

## Recorded result — October 18, 2026: ineligible

Setup commit **`7b482272acce61a732e1d43e6f155ae8b3dbb2e0`** froze the implementation and protocol before the first development estimation run. All **27/27** jobs completed and were retained. The command exited **2**: negative support, pooled relative and measured resource gates pass, but one positive case fails its coverage gate. No case, setting, rule or threshold changed after this result.

| Unsupported correspondence mask | SAD accepted | Full Census/SGM accepted | Local-filter proposal accepted |
|---|---:|---:|---:|
| Uniform pair, 14,848 pixels | 0 | 0 | 0 — pass |
| Independent noise, 14,848 pixels | 0 | 0 | 0 — pass |
| Periodic stripes, 14,848 pixels | 0 | 14,848 (100%) | **0 — pass** |
| Corrupted right patch, 2,170 pixels | 0 | 0 | 0 — pass |

The local filter rejects every periodic assignment over the whole frame, including the complete unsupported mask. Full SGM retains 17,168 points with unknown geometry, as in the earlier screen. Their disparity-error rates remain null. This shows abstention on this fixed repeated pattern; it does not establish calibrated confidence on arbitrary repetition or real scenes. The corrupted-patch mask covers only its unsupported domain; accepted points outside that domain remain in the result.

| Positive case | Proposal coverage | Proposal bad-1 among estimates | Depth P90 / maximum | Absolute gates |
|---|---:|---:|---:|---|
| Textured tilt + occluder | 12,050 / 19,200 = 62.760% | 5 / 12,050 = 0.041% | 0.11022 / 0.43632 m | Pass |
| Weak stripe + repeated pattern | 7,859 / 19,200 = 40.932% | 137 / 7,859 = 1.743% | 0.15395 / 1.20342 m | Pass |
| Exposure + tilt + occluder | 12,377 / 19,200 = 64.464% | 23 / 12,377 = 0.186% | 0.11930 / 1.67895 m | Pass |
| Exposure + noise | **6,235 / 19,200 = 32.474%** | 19 / 6,235 = 0.305% | 0.13227 / 0.42376 m | **Fails 35% coverage minimum** |
| Low contrast | 11,316 / 19,200 = 58.938% | 15 / 11,316 = 0.133% | 0.12273 / 1.79711 m | Pass |

Each positive passes the bad-1 and depth P90 requirements. Coverage is the decisive failure: the exposure/noise case falls from the earlier no-variance proposal's 52.479% to 32.474%, which misses the frozen minimum by 2.526 percentage points. Favorable pooled scores cannot override a required per-case gate. Large individual depth errors remain in three other cases even where P90 passes.

| Pooled measure over five positive cases | SAD baseline | Local-filter proposal |
|---|---:|---:|
| Valid-truth pixels | 96,000 | 96,000 |
| Accepted with truth / unestimated truth | 15,608 / 80,392 | 49,837 / 46,163 |
| Coverage | 16.258% | 51.914% |
| Bad-1 among estimates | 158 / 15,608 = 1.012% | 199 / 49,837 = 0.399% |
| Bad-1 counting missing | 83.906% | 48.294% |

Missing-aware error improves by 35.6125 percentage points against SAD; coverage improves by 35.6552 points and bad-1 fraction among estimates decreases. All relative gates pass. Compared with the earlier no-variance proposal, the filter removes 23,931 positive estimates, including 23,613 correct and 318 bad disparities. Surviving points retain their exact disparity, geometry and color; this check abstains rather than correcting estimates. Full per-region outcomes and support transitions against full SGM remain in the local score record, without adding overlapping region denominators.

## Resource and artifact record

One local **macOS arm64, Bun 1.4.3** run measured all 27 isolated workers. Maximum wall time was **230 ms**, maximum worker OS checkpoint **64.4375 MiB**, and maximum parent RSS sample **85.625 MiB**. The gate uses their maximum, **85.625 MiB**. Every job had both OS and sampled memory records and passed the 30 s / 512 MiB limits. These observations cover the fixed 160×120, 25-label jobs; they do not describe maximum supported input sizes, parent orchestration or browser/GPU costs.

| Artifact in ignored `local-captures/stereo-local-ambiguity-development/` | SHA256 |
|---|---|
| `scores.json` | `961eff298c62c8b90adb5aff3cb759084dc121f0be7b224d7cad7bdba3c4f5df` |
| `resource-runtime.json` | `2667cceb88adc93ed3cea10a19d8a24348f54262c3ecf119b01be7a8eeeda1e4` |
| `decision.json` | `c0da2c7b69c816c1af11e08908b06c8448e0cdd5a35fe3bd5cc39b9250067c30` |

All **554 Vitest checks** and full package/script/Vue typechecks pass. Focused checks cover raw local costs and repeated aliases, invalid support/competitors, unchanged surviving points, outcome accounting, fixed eligibility adaptation, pin verification, internal case/variant boundaries and all 27 retained mocked trials. The final focused CLI check and script typecheck also cover preserving decoded resource records when later scoring fails; the trial still fails eligibility.

A separate saved-artifact calculation, without an estimator or shared evaluator, verified all input/image/truth/region/mask/result links, the 18 implementation-source hashes, point/outcome accounting, every full-scene and per-region geometry summary, pooled positive rates, unsupported acceptance and the eligibility decision. It independently confirmed strict >1 px errors and interpolated depth percentiles. SAD and full SGM arrays exactly match their earlier confidence artifacts; local surviving points exactly match a subset of the prior no-variance result. Recorded resource limits and score/runtime decision hashes also agree. This audit checks saved measurements rather than remeasuring the workers or validating physical accuracy. Holdout-C remains unopened for estimation, and its pin bytes retain the reserved hash. The existing preview, UI build, capture relay and Tailscale route were preserved.

## Decision and next diagnostic

Keep SAD as the default, retain this ineligible proposal as a development reference, and keep holdout-C unopened for estimation. The filter fixes the specific periodic negative while removing too much useful exposure/noise support to satisfy the complete rule. Neither that partial success nor the pooled improvement justifies promotion.

Next, diagnose **where correct development support is lost** under the fixed forward and reverse local predicates. Separate raw anchored-cost rejection from nonadjacent-competitor ambiguity and invalid support, with evaluator-only correctness and region summaries. Preserve this run's frozen settings and failure rather than lowering a threshold to pass it. A later distinct proposal must have its own declared rule and pin before development screening and a separately frozen candidate decision before holdout estimation. Broader independently measured camera/registration evidence, acoustic fusion and AI completion remain open.
