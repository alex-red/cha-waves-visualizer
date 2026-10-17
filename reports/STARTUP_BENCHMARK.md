# Startup benchmark

Generated 2026-10-15T06:05:57.435Z. Built asset SHA-256: `9dfc1d178e345b991870031c8623aed710f3d78a9dc8e6ec2e43fa1ef6bab9e4` (12 files). Fixture: `createDemoScene startup default`, query hash `25acf268fe7e32c32672ac1f9d9939b25568abd8fc8571c1a25200adba5b3f7a`; solver acoustic-direct-v1 1.0.0.

Measures from the document navigation time origin through the first accepted balanced field result draw in Canvas, reported by the app diagnostic event after its requestAnimationFrame draw callback. It covers local preview document/assets, app startup, worker startup and solve, and accepted-result Canvas drawing. It does not measure compositor submission, display presentation, input-to-display latency, real-device behavior, physical room accuracy, or cold OS/DNS/network caches.

Chromium 156.0.8078.4, Apple M4 Pro, darwin 27.0.0; 20 measured navigations, each in a new browser context and with no warmup. Viewport 1280 × 800; grid 56 × 40, cell size 0.25 m. The default Node preview sends uncompressed responses with `Cache-Control: no-store`. The Chromium process and host OS caches, DNS cache, and local preview server can stay warm. Power state was not measured.

| Timing | Median (ms) | p75 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Min (ms) | Max (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Navigation start to first accepted Canvas draw | 108.300 | 109.300 | 124.400 | 125.900 | 127.100 | 106.700 | 127.100 |

Reproduce after building and starting the local production preview with `bun run preview`: run `bun run benchmark:startup`. Optional flags: `--samples=1..100` (default 20), `--base-url=http://127.0.0.1:4173` (local HTTP only). Raw samples, init-script captures, navigation/resource timing observations, environment, and asset manifest are in [startup-benchmark.json](startup-benchmark.json). Resource sizes are observations only and can be zero when Chromium reports a cache hit. The commands were updated for the current runner; measurements retain their original build identity.
