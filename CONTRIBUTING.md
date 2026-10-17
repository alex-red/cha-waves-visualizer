# Contributing to Cha Waves

Use Bun 1.4.3 and the Node version in `.nvmrc`, then install with `bun install --frozen-lockfile`. Start with the [implementation status](docs/IMPLEMENTATION_STATUS.md), [architecture](docs/ARCHITECTURE.md) and [model boundaries](docs/PHYSICS_ASSUMPTIONS.md). [AGENTS.md](AGENTS.md) records repository conventions for automated contributors.

## Making a change

Keep numerical helpers independent of the interface and reuse them in workers and offline tools. Keep geometry, physical quantities, parameter provenance and result identity explicit. Describe the user-visible behavior, relevant checks and remaining limits in your pull request.

Run relevant unit checks first. Run `bun run typecheck` before `bun run build`; both write generated Nuxt state. After a UI or worker change, verify the static-security/offline output and affected browser flows. Use the repository Playwright configuration and one worker when checking phone capture. Do not reuse or stop a live user relay.

```sh
bun run test
bun run test:satellite
bun run test:tooling
bun run test:repository
bun run verify:repository
bun run typecheck
bun run verify:fixtures
bun run build
bun run verify:static-security
bun run verify:offline
bun run test:echo
```

`bun run test:e2e -- --workers=1` runs the broader default Chromium suite after building. Existing browser installations can be selected with `PLAYWRIGHT_BROWSERS_PATH`; use `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium` when only full Chromium is installed. See the [Echo workflow](docs/ECHO_WORKFLOW.md).

## Evidence and private data

Commit only authored examples and synthetic recording fixtures. Keep real recordings, home plans, tokens, certificates and capture-specific private reports in ignored local storage. Never attach a live pairing URL or QR code to an issue or screenshot. The repository hygiene check catches selected file and credential patterns; it is not a complete secret scanner or privacy audit.

Report software correctness, synthetic reconstruction and physical accuracy separately. A small timing residual does not establish a wall identity. Physical experiments follow the [current evidence gates](docs/ECHO_EXPERIMENT_PLAN.md); retain failed attempts and inspect original samples with `echo:inspect`.

For ordinary bugs, open a GitHub issue with reproduction steps and a synthetic project when possible. For security problems, follow [SECURITY.md](SECURITY.md).
