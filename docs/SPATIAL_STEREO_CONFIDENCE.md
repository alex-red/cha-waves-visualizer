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
