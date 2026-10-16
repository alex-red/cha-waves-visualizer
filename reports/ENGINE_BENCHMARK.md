# Engine benchmark

Generated 2026-10-15T05:16:23.809Z. Measurements describe local direct Node.js execution of the field solver. They do not describe browser rendering, worker execution, or end-to-end application latency.

## Setup

- Command: `node --experimental-transform-types scripts/benchmark.ts --samples=100 --warmups=20`
- Node: v24.15.0; darwin 27.0.0; arm64
- CPU: Apple M4 Pro (12 logical CPUs)
- Solver: 1.0.0; fixture: `engine-benchmark-create-demo-scene-v1` (5 walls, 1 opening)
- Cache: none. Each measured call executes `computeField` again.
- Runs: 20 warmups and 100 measured runs per case; receiver height 1.5 m.
- Grid steps: 0.5 m (preview) and 0.25 m (balanced).

## Results

Wall-clock values measure the full awaited call around `computeField`. Engine elapsed values are the solver's returned `computeMs`, which includes its cooperative row-yield scheduling. Percentiles use nearest-rank selection.

| Mode | Frequency (Hz) | Step (m) | Cells | Wall median (ms) | Wall p95 (ms) | Wall p99 (ms) | Engine elapsed median (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| acoustics | 1000 | 0.5 | 560 | 3.010 | 3.236 | 3.306 | 2.966 |
| acoustics | 1000 | 0.25 | 2240 | 8.006 | 8.656 | 9.318 | 7.912 |
| radio | 2400000000 | 0.5 | 560 | 3.188 | 3.392 | 3.462 | 3.146 |
| radio | 2400000000 | 0.25 | 2240 | 8.485 | 9.694 | 10.778 | 8.393 |

Full distributions and environment metadata are in [engine-benchmark.json](./engine-benchmark.json). Rerun the command above to replace both generated reports.
