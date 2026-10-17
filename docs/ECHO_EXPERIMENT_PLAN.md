# Echo experiment: evidence, next gates, and iteration plan

Updated October 16, 2026 after wireless Android Chrome capture and a repeated-probe readiness series. This is the current acoustic research plan; the home field visualizer remains a separate product track. The first capture experiment is complete. Its result is a working transport and review pipeline, not a validated room map.

## 1. Decision and evidence

Keep QR pairing, private HTTPS transport, portable PCM scans, explicit peak reviews, and the synthetic geometry solver. Revise acquisition and validate one wall before asking for another whole-room scan. A large open-plan kitchen is not a four-wall rectangular reference fixture.

| Observation | Supported conclusion | Still unknown |
|---|---|---|
| Three labeled poses `(0,0)`, `(1,0)`, `(0,1)` reached the desktop | Pairing, local playback/recording and transfer were exercised on a real phone | Calibrated timing or geometric accuracy |
| Later feature at +1.979, +1.938, +2.042 ms relative to the strongest peak | A nearly stationary feature was observed across both horizontal moves | Device/filter response, body, floor/ceiling, or another path; strongest peak is not a verified direct arrival |
| Other candidates were weak and sensitive to detection threshold | No four identifiable wall arrivals per pose were established | Whether improved processing can recover useful room information |
| Some recordings contain exactly 40 ms of zero samples | Capture integrity needs instrumentation; original samples must be preserved | Missing worklet input versus present zero-valued input |
| X-pose zero run is at 129.333–169.333 ms, before its chirp match | That particular gap does not interrupt the matched sweep | The cause of that gap |
| Two near-full-scale samples per accepted recording | Minor clipping needs monitoring | It does not explain the long zero intervals |

A later same-pose series in a different room completed all five 48 kHz, 700 ms probes with complete observed input, no clipping and no exact-zero interval ≥5 ms. The strongest reference in the first probe occurs 6 ms earlier than in the other four. This is measured against the software schedule and an unverified strongest peak, not a direct-arrival calibration or identified wall track. The phone was on the floor; floor coupling is a possible contributor, not an assigned reflector. The room description and corner origin do not establish wall distances or geometry. Capture IDs and exact source hashes remain in the private report.

Real recordings stay in user-controlled local files. Repository examples and tests use synthetic PCM. Reports must identify the exact source file hash, capture ID, pose, sample rate/count and analysis parameters so that observations cannot accidentally migrate between recordings.

## 2. Acoustic work in dependency order

These items are planned unless explicitly marked complete. Numerical tolerances below are proposed experimental acceptance criteria, not achieved accuracy claims.

| ID / priority | Dependency | Action | Acceptance / decision |
|---|---|---|---|
| ECHO-01 / P0 | — | Reproducible offline inspection and provenance | **Implemented in this iteration:** one repository command validates a scan, identifies captures/hashes, reports zero intervals and matched-window overlap, exposes candidate threshold sensitivity and compares positions without rewriting the scan |
| ECHO-02 / P0 | 01 | Instrument acquisition before another physical session | **Software implemented:** optional versioned telemetry flows through capture, validation, relay, v3 scan import/export, UI and offline report; v1/v2 scans preserve observations without invented telemetry. A real five-probe Android batch now reports complete observed input in all probes, no clipping and no PCM zero runs ≥5 ms; this exercises telemetry without calibrating hardware timing |
| ECHO-03 / P0 | 02 | Repeated probes within a warmed-up microphone session | **Software complete:** five-probe batch mode with single-probe compatibility, one stream and AudioContext, a 1 s software-clock warmup target, five separate 700 ms PCM windows at least 1 s apart, all attempt states, manual pose metadata, partial-batch preservation, and microphone cleanup before review or send. Software verification passed. A real Android batch completed five probes with complete observed input. Probes 2–5 share a strongest-reference sample; probe 1 is 6 ms earlier and retained. That difference is not a verified wall-arrival spread. |
| ECHO-04 / P0 | 02,03 | Controlled single-wall reference | Follow the [staged single-wall protocol](ECHO_SINGLE_WALL.md): one measured wall, 0.5 m steps, fixed phone height/orientation and nearby-body placement, five probes per pose. Inspect each stage before requesting the next. Approximate expected round-trip delay slope: 5.83 ms/m |
| ECHO-05 / P0 | 04 | Evaluate the single-wall gate | Identify the same direct/reflection pair and use candidate-minus-direct delays within each capture. Proposed slope error ≤15%; within-pose max–min spread ≤0.3 ms across all five probes. No missing/unobserved input or exact-zero run ≥5 ms overlapping either full matched window. An unavailable or uncertain pair leaves the gate incomplete. Keep all outcomes; software-schedule spread is not this gate. Assess source/mic separation before absolute distance claims |
| ECHO-06 / P1 | 01,04 | Compare DSP alternatives against the same recordings | Compare current matched filtering with bounded regularized impulse-response estimation and a measured source-response reference. Evaluate expected wall tracks, false candidates and timing errors. Do not erase all stationary features: genuine floor/ceiling paths can be stationary |
| ECHO-07 / conditional | Failed 05 after acquisition/DSP checks | Isolate the browser capture path | Compare the same controlled protocol with supported native unprocessed Android capture, keeping the web relay/review interface. Verify device support; native capture is not automatically unprocessed. Add external hardware only if the comparison justifies it |
| ECHO-08 / P2 | Passed 05 on a held-out capture set | Expand to multiple reflectors | Associate supported wall tracks across poses, model floor/ceiling and furniture ambiguity, and allow incomplete observations. Retain the rectangle solver as a reference case; do not require four visible walls in every open-plan recording |

ECHO-02 and ECHO-03 software work is complete and one real Android repeated series has exercised complete input continuity and telemetry. The first-probe timing shift remains unexplained. No arbitrary room scan is requested. The next physical protocol is ECHO-04's controlled single-wall test; the current series identifies no wall and neither passes nor fails ECHO-05. If the single-wall gate fails, pause room-shape claims and use the evidence to choose ECHO-06/07. Revisit the tolerances before the experiment, not after seeing the answer. Additional devices, camera/IMU fusion and learned acoustic SLAM are separate research choices after this gate.

ECHO-03 uses one batch manifest per pose, with five separate probe PCM recordings and five explicit attempt states (`captured`, `interrupted`, or `not-started`). One microphone stream and AudioContext stay open through a 1 s software-clock warmup target and the five 700 ms windows scheduled at least 1 s apart. If the target is reached late, the first probe starts later; an interrupted warmup can produce a shorter partial manifest with no captured probes. The software clock defines scheduling, not acoustic emission time. A partial batch keeps every completed probe. Cancel on page hide/page exit, ended track, or stopped context, and stop the microphone before review or send. Keep the existing single-capture mode for compatibility.

The relay still accepts at most 12 captures per session and the scan at most 12 captures; each probe consumes one slot, not each manifest. A complete five-probe pose therefore consumes five slots. Three poses with five repeats require exporting the current scan and starting a new pairing session; do not raise limits. The relay rejects an over-limit whole-batch upload explicitly and never evicts older data. Upload each batch atomically, retry with stable IDs, and always allow a local batch JSON download. Scan v3 adds optional batch metadata; legacy scans retain their existing meaning and receive no invented batch history.

## 3. Process improvements from this run

| Stumbling block | Actionable improvement | Acceptance |
|---|---|---|
| Temporary Python/Bun snippets and plotting dependencies | Repository-owned, dependency-light offline inspection CLI sharing the app's numerical helpers | Runs on saved JSON without a relay or Python; deterministic JSON and readable Markdown; no raw PCM or secrets in output |
| A gap interval was initially carried over from the wrong recording | Capture-level evidence contract and immutable provenance in every report | Every interval is attached to a capture ID and file/audio hashes; regression covers distinct gaps in different captures |
| No direct observation of missing versus zero-valued worklet input | ECHO-02 telemetry | Distinct cases survive capture, transport and export/import; old captures report unknown |
| More physical captures were requested before proving a measurable reflector | Gate-driven experiment protocol | Each physical session names the hypothesis, controlled variables, expected timing change and stop condition beforehand |
| Private Tailscale requests timed out through a host proxy; secure context and relay were separate checks | Read-only endpoint doctor with normal certificate validation and a bounded timeout | Reports HTTPS/localhost readiness, app response and expected unauthenticated relay response; creates no session and requests no microphone |
| Browser cache was empty; full Chromium existed but headless shell did not | First-class browser-channel override and documented browser-cache environment | Focused tests run using the repository config, without a temporary wrapper config |
| Six concurrent browser workers caused scheduling failures | Dedicated focused Echo Lab test command, fresh test server and one worker by default | Chooses a free test port unless one is explicitly supplied; does not reuse or stop a user's relay; browser failures remain failures |
| Build/typecheck shared generated Nuxt state; running relay cached old CSP hashes | Ordered verification and refresh runbook | Typecheck precedes generation; before replacing a live build, export captures, verify the new build and restart only the known relay instance |
| Repeated manual exports interrupted access to received scans | Opt-in private relay archive, authenticated loopback API and `echo:pull` CLI | Explicit scan ID, exact-byte hash verification, no key/token output, durable atomic acceptance and no public owner endpoint |
| Agent analyses did not always identify the exact input artifact | Bounded ownership and structured result handoff | Agent reports paths/hashes, capture IDs, commands, observations, uncertainty and modified files; root checks decisive numerical claims against the report |

## 4. Tooling deliverables for this iteration

1. `echo:inspect`: strict scan parsing, deterministic provenance and threshold-sensitivity report, zero-run/window overlap, existing-review preservation and derived cross-pose checks. Legacy/synthetic inputs are labeled explicitly. Reports omit audio and session secrets.
2. `echo:pull` and the [local owner API](ECHO_LOCAL_API.md): private automatic relay archives, explicit ID selection, exact-byte SHA256 verification and exclusive private downloads. Desktop-only review edits retain their browser export path.
3. `satellite:doctor`: read-only local/HTTPS readiness checks; no pairing, configuration changes, certificate bypass or automatic Tailscale setup.
4. `test:echo`: repository-configured focused browser regression with a fresh available port, bounded concurrency, inherited browser cache/channel settings and normal failure exit status.
5. A short future-agent entry point and [workflow guide](ECHO_WORKFLOW.md), linked from the project roadmap and documentation index. Tests cover the CLI boundaries, evidence provenance and runner behavior. No new runtime dependency is needed.

## 5. Definition of done and next handoff

The tooling iteration is done when focused tests and full typechecks pass, the report reproduces the three-position findings from the saved scan without modifying it, the doctor checks the existing private HTTPS endpoint without changing its session, and the focused browser command passes using the normal repository config. Record exact checks in the implementation status; do not turn software test passes into physical accuracy claims.

**ECHO-03 software implementation and verification are complete.** Its 338 Vitest checks, 22 relay/helper tests, 14 tooling tests, full typecheck, build, security/offline checks and 14 focused Chromium checks passed, including the three repeated-series browser cases. The subsequent real Android series exercised complete input continuity and telemetry in five probes. Acoustic timing and wall identification remain unvalidated. The next physical gate is ECHO-04's controlled single-wall test; do not request an arbitrary room scan. Each future ticket should close with its acceptance evidence or an explicit failed gate, remaining uncertainty, and the next decision.

The workflow tools above are implemented. Earlier verification and ECHO-03 software checks are recorded separately; software tests do not establish physical room accuracy. The saved kitchen scan was re-inspected with matching source bytes/reviews. The later corner series and its floor placement are documented in private capture-specific findings. The local API retrieves that export byte-for-byte and reproduces its entire inspection report. Original audio and reports remain in ignored `local-captures/`; the private HTTPS endpoint passes the read-only doctor. No room-map claim is made.

Research context: [ELF-SLAM](https://tanrui.github.io/pub/TMC-ELFSLAM.pdf) separates direct/body response and uses acoustic and inertial processing beyond this prototype. [Media Capture and Streams](https://w3c.github.io/mediacapture-main/) defines requested constraints and applied settings. [Android recording guidance](https://developer.android.com/media/platform/mediarecorder) describes device-dependent unprocessed input. These are design references, not validation of this implementation.
