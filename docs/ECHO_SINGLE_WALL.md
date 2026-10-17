# Controlled single-wall test (ECHO-04/05)

This test asks whether the phone can identify one repeatable reflector at measured distances. It does not reconstruct a room. Run it in stages: inspect the first five-probe pose before requesting the next one.

## Hypothesis and fixed setup

A reflection from the chosen wall should arrive later relative to the direct sound as the phone moves perpendicularly away from that wall. With the prototype's assumed sound speed of 343 m/s, the approximate change is `2 × movement / 343`: **+2.92 ms per 0.5 m step**, or **+5.83 ms over 1 m**. These are path-change predictions, not absolute arrival times. Phone speaker/microphone separation and unknown acoustic centers limit the colocated approximation.

Choose one clear hard wall, away from a corner, with space for three measured positions along the same perpendicular line. Mark 0.5 m, 1.0 m and 1.5 m from the wall to the **center of the phone**, using the same datum each time. Record any actual distance that differs from the target. The center datum measures movement consistently; it is not an acoustic-center calibration.

For the floor-based variant, keep the phone flat on the same floor surface, screen up, with its top edge pointing away from the wall. Keep the case, built-in speaker/microphone route, system volume (50%), software probe gain (0.1), height (0 m), orientation and heading fixed. Keep ports unobstructed and furniture/doors/background noise unchanged. Step back after starting and use the same body position relative to the phone for every pose. Touch or move the phone only between series. Floor coupling remains a possible contributor; stationary features must not be deleted on that basis.

Use a **new wall-local coordinate frame**, independent of earlier room scans: the wall is at X=0, +X points perpendicularly away from it, and the marked measurement line is Y=0. Phone heading is 0° when its top edge points along +X. This frame identifies only the chosen wall and movement line; it does not assert room dimensions or other wall locations.

## Staged capture sequence

Preserve any current desktop export, then select **New scan** in Echo Lab → **Phone satellite**. A new pairing alone does not clear the desktop's earlier recordings. Choose **Wireless HTTPS**, create a fresh pairing, scan the QR and choose **Pair device** on Android Chrome. The existing server and Tailscale route need no restart.

| Stage | Pairing / scan | Phone X / Y (m) | Action |
|---|---|---|---|
| A1 | A | 0.5 / 0 | Enter fixed context above; **Record five sweeps**, review and send; pause for offline inspection |
| A2 | A | 1.0 / 0 | If A1 supports further investigation, change only measured X distance; record/send five; pause for comparison |
| B1 | B | 1.5 / 0 | Preserve scan A, choose **New scan**, pair again; record/send five; finish planned collection |

Each five-probe batch starts its own microphone stream and AudioContext, even within one pairing. A pairing is a transport session, not a shared acoustic clock. Keep every attempt, including probe 1 and interruptions. Do not add an unrecorded warmup or discard probe 1 because a previous batch's first reference was earlier.

The 12-recording cap permits ten probes in scan A and five in scan B. Do not put all fifteen in one scan or raise the cap. The owner API archives received PCM/batches; browser review edits still require an export. Retrieve each stage with `echo:pull` using its explicit archive ID and a new output filename, then run `echo:inspect`. Scan A's archive hash changes when A2 is appended; retain the earlier downloaded A1 snapshot and its own report. See [local retrieval](ECHO_LOCAL_API.md).

## Selection and acceptance rules, fixed before capture

Use the existing primary detector parameters for all captures: 80 ms probe, threshold **0.08**, minimum peak spacing **1.5 ms**, maximum 16 peaks. Report 0.04/0.02/0.01 results as sensitivity diagnostics. A lower-threshold candidate may motivate a later DSP experiment; it cannot rescue this gate after seeing the distance trend.

Identify the same direct-path feature and a distinct candidate reflection within each capture. The strongest or earliest detected peak alone does not establish direct-path identity. Record the evidence for the identities and any alternatives. Across poses, associate the same features using a stated rule; do not choose whichever pair gives the expected slope. If direct/reference identity remains uncertain, label the result exploratory or inconclusive.

For each retained pair report:

- Capture ID, scan SHA256, pose and original PCM sample times for direct and candidate features.
- **Candidate-minus-direct delay within that capture**; keep strongest-reference-relative and software-schedule comparisons separately labeled.
- Missing/unobserved input, clipping, exact-zero intervals and overlap with each feature's full 80 ms matched window. A gap before a matched window is not an overlap.
- All five attempt outcomes and any exclusions, with reasons. No automatic first-probe or statistical-outlier exclusion.

The proposed ECHO-05 gate uses a maximum-minus-minimum spread **≤0.3 ms across the five candidate-minus-direct delays at each pose**, and a positive slope within **15% of 5.83 ms/m** across the three measured poses. These are screening criteria, not demonstrated physical accuracy. Both selected matched windows must have observed input without missing/unobserved frames or overlapping exact-zero runs ≥5 ms. If an attempt lacks usable data or an identifiable pair, retain it and report the planned gate as incomplete rather than silently shrinking the sample.

Do not use strongest-reference-minus-schedule spread for the 0.3 ms gate. Do not compare raw absolute PCM times between AudioContexts to claim a wall-delay slope. A passing numerical slope still requires defensible feature identities; it does not establish absolute wall range, floor identification or a room rectangle.

## Stop conditions and next decision

Pause after A1 for integrity and reference/candidate review. Stop physical collection if the setup cannot stay controlled, required distances cannot be measured, a selected matched window has missing/unobserved input or a long exact-zero overlap, or the direct/reflection pair cannot be identified consistently. Preserve all data. If A1 is usable, use A2 to investigate whether the candidate moves; proceed to B1 only if that comparison supports the track. Finish after the three planned distances; further captures need a new hypothesis.

If the gate remains inconclusive, work on ECHO-06 using these same saved samples before requesting more room scans. The earlier floor-corner series remains separate acquisition evidence, with its first-probe timing shift unresolved.
