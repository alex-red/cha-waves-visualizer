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
