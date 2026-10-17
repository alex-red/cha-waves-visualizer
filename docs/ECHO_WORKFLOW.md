# Reproducible Echo Lab workflow

Use the [experiment plan](ECHO_EXPERIMENT_PLAN.md) for the current hypothesis and acceptance gates. This guide covers the shortest reliable path from an exported scan to a reviewable result. Real audio remains local and outside version control.

For scans explicitly linked to supplied 3D poses, the separate [spatial bundle workflow](SPATIAL_BUNDLE.md) validates hashes and replays declared frame registration with `spatial:inspect`. It preserves missing calibration and does not replace `echo:inspect`'s signal/timing analysis or establish a wall identity. Existing Echo exports need no format change.

## 1. Inspect an existing scan first

When the [local owner API](ECHO_LOCAL_API.md) is enabled, run `bun run echo:pull` to list archives, then retrieve an explicit scan ID into a new local file. Accepted phone PCM and batches are archived automatically; desktop review edits still require a browser export. Otherwise export scan JSON before closing Echo Lab or restarting its relay. Retain the original file; the inspection command does not modify it, infer wall labels or upload data.

```sh
bun run echo:inspect -- --input /absolute/path/scan.json
bun run echo:inspect -- --input /absolute/path/scan.json --format markdown
```

For a local report, redirect output to an explicitly chosen file under the ignored `local-captures/` directory or another private directory. JSON is the default. The CLI rejects oversized/malformed scans and unknown arguments. Synthetic and legacy scans are labeled; they must not be described as current phone recordings.

The report contains exact source-byte and audio-byte hashes, capture IDs, poses, sample rates/counts, detector parameters, signal integrity and full matched-window gap overlap. It records both the source scan format and normalized v3 format. Candidate times include the original capture-clock offset and the offset relative to that capture's strongest peak. Acquisition timing is reported as a software schedule. V2 imports preserve PCM and capture-linked reviews; v1 recorded imports preserve PCM and reset unkeyed review selections. Neither migration invents telemetry. A separate copy of the stored review preserves its direct/wall selections. Threshold-sensitivity results expose whether a candidate survives the tested settings; they do not automatically validate it. Reports contain neither PCM nor pairing tokens.

For five-probe series, the report preserves all attempted outcomes and the manual pose/volume context. It computes strongest-reference-minus-schedule spread only across at least two probes with complete observed input continuity and a detected reference. Missing/unobserved input, interrupted attempts and absent matches have explicit exclusion reasons. This measures software-clock lag variation; it does not verify a direct arrival, wall reflection or acoustic latency.

When comparing runs, start with their hashes and capture IDs. Match IDs and poses explicitly rather than relying on array order, a file name or a prior terminal variable. A 40 ms gap in one capture does not establish a gap in a different capture. Check its location against the candidate's full 80 ms matched window before drawing a timing conclusion.

## 2. Check transport independently of acoustics

```sh
bun run satellite:doctor -- --origin https://your-device.your-tailnet.ts.net
bun run satellite:doctor -- --origin http://127.0.0.1:4175 --json
```

The doctor makes bounded direct GET requests with normal TLS verification. It ignores host HTTP proxy environment variables, which avoids routing a private tailnet hostname through an unrelated proxy. It recognizes the app and checks the relay's expected `401 TOKEN_REQUIRED` response without credentials. It creates no session and does not inspect recordings, enable the microphone, change network configuration or install software.

Endpoint readiness, phone secure context, microphone permission and acoustic usability are separate gates. A successful desktop endpoint check cannot establish the other three. Keep Tailscale Serve private to the tailnet; no public Funnel is needed for this experiment. Setup and teardown commands remain in [PHONE_SATELLITE.md](PHONE_SATELLITE.md).

## 3. Implement and verify one bounded change

Choose the smallest check that exercises the behavior changed:

| Change | First check | Additional gate |
|---|---|---|
| Offline report/detector math | `bun run test -- scripts/echo-inspect.test.ts packages/echo-diagnostics.test.ts` | Typecheck; inspect a generated reference scan and a saved real scan |
| Local owner API or retrieval CLI | `bun run test:satellite` and `bun run test:tooling` | Exact-byte live retrieval and `echo:inspect`; typecheck |
| Doctor or browser runner | `bun run test:tooling` | Read-only live doctor or one focused browser run as appropriate |
| Relay/session/protocol | `bun run test:satellite` | Typecheck; browser transfer regression for affected behavior |
| Recorder/UI/worker | Relevant Vitest files | Typecheck → build → static-security/offline verification → `bun run test:echo` |
| Documentation only | Check links, commands and consistency with implementation | No application rebuild required |

`bun run typecheck` and `bun run build` must be sequential. Unit checks can run independently of the typecheck. Generation must finish before browser tests consume its output. If a change needs a new browser build:

```sh
bun run typecheck
bun run build
bun run verify:static-security
bun run verify:offline
bun run test:echo
```

The focused browser runner uses the repository Playwright config, a newly selected port and a fresh test server. Its four specs cover the lab, diagnostics, single capture and five-probe series; it defaults to one worker. Standard Playwright flags can narrow the run, for example `bun run test:echo -- --grep 'saved three-position'`. A failing test keeps its failing exit status; do not hide it with automatic retries until the cause is understood.

Use existing browser installations explicitly:

```sh
PLAYWRIGHT_BROWSERS_PATH=/absolute/path/to/browser-cache PLAYWRIGHT_CHROMIUM_CHANNEL=chromium bun run test:echo
```

`PLAYWRIGHT_CHROMIUM_CHANNEL=chromium` selects full Chromium instead of the separate headless-shell executable. Omit it for the normal Playwright default. `PLAYWRIGHT_BROWSERS=webkit` selects WebKit. `PLAYWRIGHT_OUTPUT_DIR` can isolate artifacts for an independent run. If `PLAYWRIGHT_PORT` is explicitly supplied, use a free port; the focused runner never reuses an existing server. Browser installation is a separate setup step using Playwright's official installer, not something the test command performs automatically.

Use the broader browser matrix when a change crosses those engines or a regression justifies it. Avoid six-worker repetitions of a failing physical-device fixture; inspect the failing setup and run the affected case serially first.

## 4. Replace a live build without losing the experiment

1. Preserve the scan and run `echo:inspect` to identify its file hash and capture IDs. Pull an explicit archive ID if enabled, and export the browser scan too when desktop reviews matter.
2. Finish tests and build verification. Do not replace assets while the phone is taking a measurement.
3. Identify the relay's exact listening process/session and existing origin configuration. Restart that relay only. It caches CSP headers at startup; a new static build needs matching headers. Do not terminate unrelated preview ports or reconfigure Tailscale.
4. Reopen the app and import the saved scan. Confirm the capture IDs/count, existing reviews and derived diagnostics. The old phone pairing expires with the old in-memory relay session; pair again only when another physical experiment is ready.
5. Verify the result in the actual HTTPS app and save a screenshot of the relevant view. CLI probes complement visible UI checks.

## 5. Plan the physical session and handoff

Before a session, write the hypothesis, equipment/audio route, measured wall distances and poses, phone height/orientation, gain, repeats, expected delay slope, exclusion rule and stop condition. Preserve failed probes with their exclusion reason. Repeated captures at one pose establish variability before a new spatial pose is requested. Use the single-wall gate in ECHO-04/05; three arbitrary kitchen positions are not its replacement.

Agent and human handoffs should include:

- Source file hash and audio hashes/capture IDs, with actual pose labels.
- Command and explicit analysis parameters; reference choice and whether it is verified.
- Measured facts, uncertainty and hypotheses in separate sentences.
- Changed files, tests actually run and remaining gate; no stale test-count claims.
- One next action justified by the current gate, or a clear stop condition.

For algorithm experiments, share a sanitized report or a synthetic fixture through the repository. Real PCM should be read only from its local authorized path. The report format is versioned so future analysis methods can add new sections without changing portable scan/review semantics. ECHO-02/03 software integration is complete: 338 unit tests, full typecheck, build/security/offline checks, 22 relay/helper tests, 14 tooling tests and 14 focused Chromium checks passed. A later real Android five-probe batch exercised the series and telemetry path: all five probes had complete observed input, no clipping and no PCM zero run ≥5 ms. Probes 2–5 had the same strongest-reference sample; probe 1 was 6 ms earlier and remains in the evidence. This is acquisition evidence, not wall timing or geometry validation. The next physical gate is the controlled single-wall protocol, with the hypothesis and stop condition stated before recording.

Each series holds five separate recordings against the existing 12-recording cap. A full relay rejects additional uploads without evicting earlier audio. Save a held series JSON if necessary; export the desktop scan before starting a new pairing session. For three distances with five repeats each, preserve separate scans and identify each report by its hash rather than increasing limits or merging unrelated recordings by array order.
