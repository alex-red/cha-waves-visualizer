# Portfolio snapshot verification

Verified October 16, 2026. This record covers the portfolio preparation increment; older benchmark reports retain their original build identities. No new physical capture, wall-identification result or performance benchmark was produced.

## Verified scope

Checks ran against an isolated copy of the public candidate files, with dependencies linked from the installed workspace. This was not a fresh dependency installation. The live relay and its output were left in place; real scans, certificates and owner credentials were excluded from the copy. The two preserved real-scan byte hashes were unchanged after preparation.

Environment: Apple M4 Pro, macOS, Node 24.15.0, Bun 1.4.3, Playwright 1.64.1, Chromium 156.0.8078.4 and WebKit 27.2. Browser suites used fresh automatically selected ports and one worker; they did not reuse the live relay.

| Check | Result |
|---|---|
| `bun run test` | 338 tests passed across 41 files, with generated Nuxt state absent |
| `bun run test:satellite` | 32 tests passed |
| `bun run test:tooling` | 21 tests passed |
| `bun run test:repository` | 4 tests passed |
| `bun run verify:repository` | 286 public candidate files passed selected private-artifact/credential patterns and local Markdown target checks |
| Existing committed revision | 208 files passed the same repository inspection |
| `bun run typecheck` | Package TS6/TS7, script and Vue checks passed before generation |
| `bun run verify:fixtures` | Independent algebra and portable-project checks passed; solver remains 1.0.0 |
| `bun run build` | Static generation passed |
| Static-security and offline verification | Both passed; offline build identity below |
| Full Chromium suite | 151 tests passed on the final complete run |
| Repeated Chromium reflow checks | All 12 checks passed across three runs after the gesture helper correction |
| Targeted WebKit suite | 29 tests passed across Echo Lab, diagnostics, reflow, accessibility, workspace, cutaway and deployment |
| Visual review | Current desktop workspace and synthetic Echo Lab images inspected; compact dialog scrolling checked in the in-app browser |

An initial isolated unit run exposed a dependency on generated Nuxt configuration. Vitest now explicitly uses a checked-in TypeScript configuration, and all 338 tests passed without `.nuxt`. An initial full Chromium run had one compact-dialog wheel-gesture failure. The helper now waits for a stable actionable dialog and targets padding away from controls and the viewport edge. Repeated reflow checks and the final complete Chromium run passed. These failures were addressed rather than counted as successful runs.

## Build and source identity

Verified offline build: `65385ded95d55a23f060bb08a4db388d4fc80fa9db7ecdd69dbb76f4a7d45e46` — 24 cached assets, 2,370,193 bytes.

Source/configuration fingerprint: `28b4a9bc634deca2871c4ca5833d7a28ec437376ac45f1559574693350af9c81` (185 files). This hashes sorted paths, a NUL, file bytes and a NUL for each candidate under `apps/`, `packages/`, `scripts/` and `.github/`, excluding PNGs, plus `package.json`, `bun.lock`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.packages.json`, `tsconfig.scripts.json` and `.nvmrc`. Documentation and screenshots are excluded so narrative updates do not redefine the tested source identity.

## Reproduce

Install dependencies with the pinned runtimes. Run the checks in the root [README](../README.md), keeping typecheck before build. The full Chromium command used the repository's existing runner:

```sh
PLAYWRIGHT_CHROMIUM_CHANNEL=chromium bun run test:echo -- apps/web/e2e --workers=1 --reporter=dot
```

Set `PLAYWRIGHT_BROWSERS_PATH` to an existing compatible browser cache when needed. The focused WebKit run uses `PLAYWRIGHT_BROWSERS=webkit` and the seven spec files for the areas listed above. No wrapper Playwright configuration is required.

## Remaining limits

The configured GitHub remote could not be resolved through the available GitHub CLI account or its SSH route. No push, visibility change or deployment was performed, and the revised CI workflow has not run remotely. It defines a common verified build followed by separate Chromium, Firefox and WebKit jobs; this local pass did not rerun Firefox or the full WebKit suite.

The repository guard checks selected patterns and file targets, not every secret format, image content, external URL or Markdown heading anchor. Fixture screenshots were also reviewed manually. Direct dependency license texts are included; final deployment/distribution review remains separate.

The build still reports large JavaScript chunks, including the lazy Three renderer. Historical latency measurements do not automatically apply to this build. Actual-host behavior, manual assistive-technology review, broader devices, calibrated field prediction and physical acoustic mapping remain outstanding. Browser microphone checks use synthetic inputs and do not establish Android acoustic accuracy.
