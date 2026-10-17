# Browser worker/Canvas benchmark

Generated 2026-10-15T05:24:44.922Z. Build assets SHA-256: 8016cc496b6f96583cc4d1446dc793d268f01fa4da6ab847fc652d332f54cf5f. Solver: acoustic-direct-v1 1.0.0.

Worker request posting through accepted-result Canvas draw in an animation-frame callback, including worker serialization, solve and main-thread scheduling. Excludes input-event handling before posting, cold loading, GPU rendering, frame presentation to display, and on-site model validity.

Chromium 156.0.8078.4; Apple M4 Pro; darwin 27.0.0; 100 measured updates after 20 warmups. Viewport 1280 × 800, authored five-wall scene, acoustics 1 kHz, 0.25 m grid (2,240 cells), receiver 1.5 m. Headless browser with no CPU/network throttling.

| Timing | Median (ms) | p95 (ms) | p99 (ms) |
|---|---:|---:|---:|
| Request to Canvas draw | 30.400 | 32.200 | 32.500 |
| Worker compute | 1.100 | 1.400 | 1.500 |

Reproduce: build, start `bun run preview`, then `bun run benchmark:browser` in another terminal. Raw data: [browser-benchmark.json](browser-benchmark.json). These observations do not establish latency on other devices or a full pointer-to-display budget. The commands were updated for the current runner; measurements retain their original build identity.
