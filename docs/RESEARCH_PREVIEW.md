# Echo Lab: a browser-based testbed for auditable smartphone acoustic measurements

**Preliminary technical report · October 16, 2026**

Status: research in progress. This is not a peer-reviewed paper or a validated room-mapping result.

## Abstract

We present Echo Lab, a browser-based platform for smartphone acoustic probing, portable recording review and reproducible offline inspection. The system combines repeated chirp acquisition, input-continuity telemetry, capture-linked provenance and explicit arrival selection. Synthetic examples demonstrate reconstruction under a matched rectangular-room model with known measurement positions and unlabeled first-order arrivals. Initial Android measurements comprise three spatial poses and a separate five-probe stationary batch. The spatial recordings contain a nearly stationary feature approximately 2 ms after an unverified strongest reference. The repeated batch reports complete observed input, while its first strongest reference occurs 6 ms earlier than subsequent probes. Neither dataset establishes an identified wall reflection or physical room reconstruction. The current work provides experimental infrastructure and preliminary observations, with controlled single-wall validation defined as the next evaluation stage.

## Research question and present scope

Can a browser-based phone capture pipeline produce interpretable, repeatable direct/reflection timing under controlled conditions? Establishing that capability precedes room reconstruction.

The current contribution is an implemented testbed and a reproducible inspection workflow. Novelty relative to other acquisition systems has not been established. The home sound/RF visualizer is a separate educational modeling track and is not part of this acoustic evaluation.

The [long-term spatial research plan](SPATIAL_RESEARCH_PLAN.md), clarified October 17, 2026, extends the ambition to wave-based 3D mapping, multimodal reconstruction and AI completion, including Gaussian splatting. Those are future research stages; this report evaluates only the acquisition and synthetic inverse work described here.

## System

The phone emits an 80 ms chirp and records mono PCM in a 700 ms window. Repeated mode uses one microphone stream and AudioContext, a one-second software-clock warmup target and five separate capture windows. Telemetry distinguishes present input, missing input, unobserved frames and present zero-valued input. Requested and browser-reported processing settings are retained without claiming unprocessed hardware audio.

Portable scans preserve raw samples and capture-linked review choices. Offline inspection shares the browser's numerical helpers and reports source/audio hashes, timing candidates, zero-window overlap and threshold sensitivity. Matched filtering generates candidates; a reviewer must identify direct and reflected arrivals before geometry fitting.

## Preliminary observations

| Evidence set | Observation | Supported interpretation |
|---|---|---|
| Synthetic rectangular fixtures | Known poses and four first-order arrivals support a rectangular fit, including seeded timing noise | Numerical behavior under matched assumptions; no independent physical validation |
| Three kitchen poses, separated along both horizontal axes | A later feature appears at about +1.979, +1.938 and +2.042 ms relative to each strongest reference; four wall arrivals per pose were not established | A nearly stationary feature with unresolved origin |
| Separate five-probe stationary Android batch | All five report 33,600 observed frames at 48 kHz, no missing/unobserved frames, no detected clipping and no exact-zero runs ≥5 ms | Acquisition integrity for this batch |
| Same stationary batch | First strongest reference is 6 ms earlier than probes 2–5 | Unexplained reference-to-schedule variation; no verified wall-timing or acoustic-latency result |

These are small exploratory datasets, not independent validation sets. The stationary batch was recorded with the phone on the floor. Its geometry was not measured. The kitchen scan predates acquisition telemetry. In its X-displaced capture, a 40 ms exact-zero interval occurs before the full matched probe window; it must not be reported as interrupting that match.

Private capture-specific reports retain full provenance. Real PCM, private room records and session credentials are excluded from the repository. Consequently, the public code reproduces the inspection method and synthetic examples; the published physical observations cannot be independently reanalyzed from this repository alone. The evidence summary does not substitute for an openly reviewable measurement dataset.

## Limitations and competing explanations

The strongest peak is not a verified direct arrival. Stationary features may arise from the device, processing, body, floor, ceiling or other paths; none is assigned here. Software scheduling does not measure acoustic emission time. The synthetic inverse assumes known positions, axis alignment, a rectangular room and exactly four first-order arrivals. Fit residuals describe agreement with selected times, not confidence in their physical interpretation.

The data does not establish whether browser processing, the device response, experimental placement or the current detector limits wall identification. It also does not support a general conclusion that browser-based acoustic mapping is impossible.

## Next evaluation

The existing [single-wall protocol](ECHO_SINGLE_WALL.md) specifies one measured reflector, fixed pose and volume, five probes at each staged distance, fixed primary detector settings and explicit stopping rules. The expected round-trip delay slope is approximately 5.83 ms/m under the stated model. Proposed gates are ≤15% slope error and ≤0.3 ms within-pose max–min spread in candidate-minus-identified-direct delay, subject to full-window integrity checks. These are prospective criteria, not achieved results.

Inspect each stage before proceeding. An uncertain arrival identity leaves the gate incomplete. A stronger results paper would additionally require independent sessions, a defined scope of devices/environments, baseline comparisons, uncertainty and failure reporting, and evaluation data available for review. [Active experiment plan](ECHO_EXPERIMENT_PLAN.md)

## Related work

Echo-based geometry inference is established prior work. [Dokmanić et al., *Acoustic echoes reveal room shape* (PNAS, 2013)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3725100/) reconstruct convex room geometry using echo assignment and microphone geometry. [Luo et al., *Indoor Smartphone SLAM with Acoustic Echoes*](https://tanrui.github.io/pub/TMC-ELFSLAM.pdf) combine acoustic representations and inertial information. [Lan et al., *Building Audio-Visual Digital Twins with Smartphones* (MobiSys, 2026)](https://waves.seas.upenn.edu/projects/av-twin/) use audio and visual information for room reconstruction and editing. Echo Lab is not a reproduction or an evaluated competitor to these systems.

## Reproduce the software workflow

Follow the root [README](../README.md) to build and run the virtual scan. `bun run test -- packages/echo.test.ts scripts/echo-inspect.test.ts` exercises synthetic geometry, matching and report behavior. For a locally held scan, use:

```sh
bun run echo:inspect -- --input /absolute/path/to/scan.json --format markdown
```

Reports omit PCM and pairing secrets. Preserve original files and keep real captures in ignored storage. [Workflow and provenance rules](ECHO_WORKFLOW.md)
