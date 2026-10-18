# Saved local-ambiguity attrition diagnostic

The fixed local-ambiguity proposal remains ineligible because its exposure/noise case reaches only 32.474% coverage against a 35% positive-case gate. Its filter removes 23,613 correct and 318 bad estimates over the five positive development cases. This diagnostic will localize those losses by recomputing the fixed local-cost predicates on already saved estimates; it will not rerun a reconstruction estimator, search parameters, select a candidate, or change defaults.

## Frozen inputs and scope

Read only the exact nine development cases and the already saved outputs in the two pinned roots:

- Original confidence inputs and no-variance proposal results: pin SHA256 `a16437db6d648aa454df23b05c8ab465997f40720728f85f89a3cefe9ff15879`; scores SHA256 `1132cbad82e4dedccdd5172e31dc3ff3aa1396ef62d9afe76549bd7c12ce90b7`.
- Fixed local-ambiguity proposal results: pin SHA256 `91c4a6347db83744d47e178c21889d51673e5f9500eb888b01793dbfb4c1ae91`; scores SHA256 `961eff298c62c8b90adb5aff3cb759084dc121f0be7b224d7cad7bdba3c4f5df`.

The reserved four-case holdout-C pin SHA256 is `8ff8000b086a1ed6adbffc818ba5181ac7f22bae46aa75431533fc508c277781`; it remains unopened for estimation and is outside this diagnostic. Freeze a new [attrition pin](data/stereo-local-attrition.json) with the diagnostic implementation before analyzing the nine cases. Validate exact case IDs, input/result lineage, source hashes, dimensions, settings, outcomes and masks. Bound every file read and refuse output replacement. If any reconstructed field disagrees with its frozen pin, abort; do not fit, repair or silently substitute it.

The frozen attrition pin SHA256 is `b59e1ee445ac0649c4281f5b00f796d439de39eceed54729112abd9e82ff3180`. It links both prior data/score pins, the exact nine input records, the local rule/settings and 16 implementation sources. This protocol and implementation are committed before the first full saved-case analysis; results are added separately afterward.

## Fixed directional analysis

Use the proposal's existing bidirectional local rule unchanged: grayscale 5×5 Census with radius 2; anchor `round(disparity)`; right-image location `round(x - disparity)`; maximum raw anchored cost 6; exclude disparity labels within ±1 of the anchor from the alternate-cost search; require a finite positive competing minimum and anchored-cost/competitor ratio ≤0.8 in both directions. No threshold, case, estimator or post-filter setting is varied.

For every accepted point in the saved no-variance base result, calculate and retain the forward and reverse predicates independently, even if the first direction fails. Classify each direction's outcome using a fixed reason order: invalid anchor, invalid support, over-limit anchored raw cost, missing competing minimum, zero competitor, then ratio failure; otherwise pass. Keep the raw cost, competing minimum, first minimizing label, tie count and number of valid competitors. Record evaluated predicates as true/false and unavailable predicates as null. First-failure labels form a partition within each direction. Independently evaluated predicate failures may overlap; they are not additive causal contributions.

Also report exactly four disjoint groups: retained (both directions pass), forward-only failure, reverse-only failure, and both directions failing. Check that this partition conserves all considered base-accepted points and agrees exactly with the saved filtered keep-set. Surviving point values and all outcomes outside accepted→ambiguous transitions must remain identical. For every lost/retained point, compare the original frozen truth only after local raw-cost evidence is recorded; classify truth-known points as correct (absolute disparity error ≤1 pixel) or bad (>1 pixel), and unknown truth as unknown. Do not treat missing truth as an error-free observation or use truth to select a direction, reason, threshold or variant.

## Reports

Retain raw per-point/per-direction cost and support evidence in separate case artifacts; derive report counts from those records so aggregates never replace the underlying evidence. Report each of the nine cases and its predefined diagnostic regions, and pool the five positives separately. Regions may overlap; do not sum their counts. For the four negative controls, report retained and rejected support inside each fixed unsupported mask separately from points outside the mask. For positives, report all original no-variance base acceptance, retained/lost local-filter support, truth-known correct/bad/unknown counts, and coverage so the 32.474% exposure/noise failure remains visible. Include per-direction predicate failures, the joint partition, and the first-failure summary with explicit denominators.

Directional denominators count all base-accepted points considered in that direction. First-failure counts partition that set; independent predicate-failure counts describe incidence within the same set, with null checks retained as unavailable in the evidence. Every reason is split by correct/bad/unknown truth, both overall and within each region. Coverage uses valid-truth pixels, not accepted points, as its denominator.

This is saved-data analysis only. It makes no new reconstruction or accuracy claim and establishes no causal interpretation from overlapping reasons. Preserve source result files byte-for-byte and write reports to a new directory. No holdout scene arrays or results are opened; only its reserved metadata-file hash is checked.

## Reproduction and pin boundary

The diagnostic command accepts only the two exact saved roots, validates their frozen pins and emits a separate attrition pin/report. It has no arbitrary-input, parameter-search or holdout option:

```sh
bun run spatial:stereo:attrition -- --pins
bun run spatial:stereo:attrition -- --confidence local-captures/stereo-confidence-development --local local-captures/stereo-local-ambiguity-development --output local-captures/stereo-local-attrition
```

`--pins` emits metadata and hashes only; it performs no case analysis. The implementation and `docs/data/stereo-local-attrition.json` must be frozen before running the nine-case analysis. The diagnostic adds no estimator resource-gate claim. Any later proposal requires a separate, explicit freeze and eligibility screen before holdout estimation. Broader independent camera/registration evidence, the physical ECHO-04/05 gate and AI completion remain open.
