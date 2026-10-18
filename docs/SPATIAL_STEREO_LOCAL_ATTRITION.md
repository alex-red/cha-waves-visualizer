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

## Recorded diagnostic — October 18, 2026

Setup commit **`c6915ba5fadec2ba50540d5ae5646c7df90f2e58`** froze the implementation and protocol before the saved-case run. All **nine cases** completed, producing input-only evidence for **103,779 base-accepted points** and separate truth/mask diagnostics. Every predicted keep-set matches the saved local-filter result exactly, including point order/values and accepted→ambiguous outcome changes. No reconstruction estimator ran and no setting changed.

Across the five positives, the same **23,931 estimates** are lost: **23,613 correct and 318 bad**. The joint partition makes directional overlap explicit:

| Five-positive partition | Correct | Bad | Total |
|---|---:|---:|---:|
| Retained: both directions pass | 49,638 | 199 | 49,837 |
| Forward-only failure | 6,427 | 47 | 6,474 |
| Reverse-only failure | 7,624 | 132 | 7,756 |
| Both directions fail | 9,562 | 139 | 9,701 |
| All base-accepted points | 73,251 | 517 | 73,768 |

These four groups partition accepted estimates; they do not describe mutually exclusive causes within a direction. Valid truth remains 96,000 pixels. Base coverage is 76.842%, and retained coverage is 51.914%, matching the previous screen. No negative-case accuracy is added to these denominators.

## Exposure/noise: ambiguity dominates the loss

The decisive failed case retains **6,235 / 19,200 truth pixels (32.474%)**, with 6,216 correct and 19 bad estimates. Its 3,841 lost estimates partition as follows:

| Exposure/noise loss group | Correct | Bad | Total |
|---|---:|---:|---:|
| Forward-only failure | 1,194 | 6 | 1,200 |
| Reverse-only failure | 1,325 | 16 | 1,341 |
| Both directions fail | 1,292 | 8 | 1,300 |

For each direction, the following **first-failure** counts partition all 10,076 base estimates. Forward and reverse columns refer to overlapping point sets and must not be added together:

| First failure | Forward correct / bad | Reverse correct / bad |
|---|---:|---:|
| Invalid anchor | 0 / 0 | 0 / 0 |
| Invalid patch support | 0 / 0 | 3 / 0 |
| Anchored raw cost >6 | **6 / 0** | **47 / 0** |
| No valid competing label | 0 / 0 | 0 / 0 |
| Zero-cost competing minimum | 255 / 1 | 326 / 3 |
| Ratio >0.8 with positive competitor | **2,225 / 13** | **2,241 / 21** |
| Pass | 7,541 / 35 | 7,410 / 25 |

The raw-cost cap is a small part of this observed attrition. Most first failures concern competing labels: either a zero-cost minimum or an insufficient raw-cost margin. Independent ratio failures total 2,243 forward and 2,309 reverse, including failures already labeled raw-cost first; the overlap is retained in the report. These counts are not a threshold sweep or a claim that relaxing one predicate would restore a corresponding number of points.

A geometrically correct stored disparity can still lack unique local image evidence. Correctness under the synthetic truth therefore does not justify accepting an ambiguous assignment. This diagnostic explains why the current confidence rule loses coverage; it does not validate a replacement rule.

## Negative controls and limits

The periodic control loses all **17,168** base estimates, each with unknown geometry: 15,450 fail both directions, 882 fail forward only and 836 fail reverse only. Every failing direction has a zero-cost competitor as its first failure. All **14,848 / 14,848** base-accepted points in its predefined unsupported mask are rejected. The directional asymmetry is retained rather than treating a repeated pattern as geometrically correct or assuming every point has identical search support.

Uniform and independent-noise controls already have empty base results, so they provide no attrition rows. The corrupted-patch case has zero base acceptance in its 2,170-pixel unsupported mask; its accepted points outside that mask remain separately scored. These cases do not establish new negative-control performance: they explain the previously recorded filter decisions.

## Artifacts and verification

The deterministic report is in ignored `local-captures/stereo-local-attrition-development/report.json`, SHA256 **`fc6b5a5a3c2918c067f4bac02d3eac4353598aabbda3c58a80303d219a190b7a`**. It links all nine input-only evidence files by exact hash and links each case to its original input/images, base/local results, truth, regions and unsupported mask. Original artifacts are preserved.

All **565 Vitest checks** across 80 files, full package/script/Vue typechecks and repository hygiene pass. New checks cover raw cost/ratio/zero/absent competitors, asymmetric support, null predicates/truth, stratified partitions and region pooling, exact point order/value/outcome preservation, tampered evidence and result metadata, frozen input boundaries, deterministic reports and refusal to overwrite output. This CLI-only increment preserves the current browser build, live preview, capture relay and Tailscale route; it adds no worker resource-budget claim.

An independent saved-artifact audit used a separate P6 decoder, grayscale Census descriptor implementation and Hamming lookup, with no shared diagnostic or reconstruction function. All **103,779 point rows / 207,558 directional records** matched exactly, including competing minima, first minimizing labels, tie/valid-label counts, ratios, nullable checks and failure labels. Recomputed case/region summaries, the five-positive pool, truth support and unsupported retention also matched. Hashes, unchanged source results, exact filtered subsets/order/values and all outcome transitions were checked. This verifies reproducibility of the saved-data explanation, not physical accuracy or a new confidence calibration. The ignored audit summary SHA256 is `75d2182960f7961e61fb01c33e1cc87e503dd155e2b544dd85cfc5ba5739d491`.

## Next evidence question

Keep both ineligible proposals as regression records, keep SAD as the default, and keep holdout-C unopened. The observed bottleneck is discriminating correspondence evidence, especially in the exposure/noise control; raising a raw-cost allowance would not address the dominant recorded ambiguity.

Next, freeze a bounded **additional-view evidence test** to determine whether extra image observations resolve the current aliases while retaining negative controls and missing support. Its hypothesis, camera/input contract and decision rule must precede estimation. Do not assume another view will resolve repetition or select a production candidate from this diagnostic alone. Independently measured real-camera geometry/registration can proceed in parallel; acoustic ECHO-04/05 and the broader mapping/AI gates remain open.
