# Performance evidence

The direct-engine benchmark is a narrow engine measurement: direct main-thread Node.js calls to `computeField` on the M4 Pro setup recorded in the [benchmark report](../reports/ENGINE_BENCHMARK.md), with full samples and metadata in [engine-benchmark.json](../reports/engine-benchmark.json). It ran 20 warmups and 100 measured calls per case. Values are milliseconds; all four cases use the same 1.5 m receiver plane, with 560 cells at 0.5 m and 2,240 cells at 0.25 m. The scene has 5 walls and 1 opening. Wall-clock timing encloses the awaited solver call; engine elapsed timing is its reported `computeMs`, including cooperative row yields.

These results describe this fixture and local Node run only. They do not measure browser-worker request-to-paint latency, browser scheduling, or GPU rendering speed. The separate browser end-to-end budgets remain proposed targets, including p95 ≤150 ms from preview command to accepted paint and p95 ≤500 ms from release to balanced field paint; see [validation and performance targets](./VALIDATION_AND_PERFORMANCE.md#performance-budgets). This benchmark does not establish that those budgets are met, nor a general performance or accuracy claim.

Reproduce with `bun run benchmark` and check fixture consistency with `bun run verify:fixtures` from the repository root.


## Browser worker-to-Canvas run

The separate [browser report](../reports/BROWSER_BENCHMARK.md) records 100 measured updates after 20 warmups against the generated static build. On its recorded headless Chromium/M4 Pro setup, the acoustic 2,240-cell case had a median of 30.4 ms and p95 of 32.2 ms from worker request posting to accepted-result Canvas draw. The report includes the build-assets SHA-256, solver version, raw samples, grid, receiver plane, and browser version.

This measurement includes serialization, worker scheduling/computation, main-thread scheduling, and the Canvas draw callback. It excludes input handling before posting, the 80 ms preview coalescing timer, cold loading, GPU rendering, and physical frame presentation. It therefore does not establish the full preview-command or pointer-release-to-display budgets. Direct Node timings and worker timings also include different timer/yield scheduling; their difference is not a measured GPU acceleration benefit. No other device/browser performance is inferred.

Reproduce by running `bun run build`, starting `bun run preview`, and running `bun run benchmark:browser` in another terminal. Both harnesses write local files only and use the authored demonstration fixture.


## Fresh-context startup run

The [startup report](../reports/STARTUP_BENCHMARK.md) records 20 navigations, each in a new Chromium browser context against its recorded static preview build. Median navigation-to-first-accepted-balanced-Canvas-draw time was **108.3 ms**, with **p95 125.9 ms**. All samples used the same default fixture query hash, acoustic solver 1.0.0, 56 × 40 cells at 0.25 m and the 1.5 m receiver plane. No startup JavaScript errors were captured.

The measurement starts at the document navigation time origin and ends at the app's diagnostic event immediately after its accepted-result draw callback. Browser-context cache and storage start fresh; the Chromium process, local server, OS caches and DNS may be warm. The preview sends uncompressed responses with `no-store`; production network/compression behavior is not inferred. Power state was not measured. This is not compositor/display or pointer-to-display latency, nor a phone/device budget result. With only 20 samples, p99 is the maximum observed sample.

Reproduce with `bun run build`, `bun run preview`, then `bun run benchmark:startup` while other benchmarks/tests are idle. The [raw report](../reports/startup-benchmark.json) includes build-asset SHA-256, environment, fixture identity, diagnostic records and browser-reported navigation/resource timing observations. The earlier engine and worker reports describe their own historical build/fixture scopes and are not silently replaced by this run.
