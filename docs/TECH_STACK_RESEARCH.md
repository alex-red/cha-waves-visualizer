# Technology research — October 14, 2026

Checked against primary sources on the planning date. These are observed releases and capability descriptions, not a dependency lockfile. Exact compatible patch versions must be resolved and recorded during M0; do not ship floating `latest` dependencies. “Latest available” and “best production default” are separate decisions.

## Recommended stack and adoption gates

| Layer | October observation and source | Project decision |
|---|---|---|
| Framework | [Nuxt blog](https://nuxt.com/blog) lists Nuxt 4.6, released October 5; 4.5 introduced Vite 8 support | Nuxt 4.6 stable line; prerender content, client-only lab; no need to wait for Nuxt 5 |
| UI runtime | [Vue releases](https://github.com/vuejs/core/releases) lists stable 3.5.44 and prerelease 3.6.0-rc.11 | Stable Vue 3.5 compatible with Nuxt; 3.6/Vapor behind a separate experiment after dependency compatibility and usability checks |
| Bundler | [Vite 8 announcement](https://v8.vite.dev/blog/announcing-vite8), March 12, 2026, describes stable Rolldown integration | Use Nuxt's supported Vite 8 integration; do not override transitive builder versions blindly |
| Type checking | [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), July 8, 2026, confirms native compiler and TS6 compatibility path for API consumers | Prefer TS7 for pure TS packages; prove Nuxt/Vue tooling support. If compiler-API consumers need TS6, use documented side-by-side aliases, with both checks in CI |
| Development runtime | [Node release table](https://nodejs.org/en/about/previous-releases) reports Node 24 LTS and Node 26 Current; page shows 24.22.0 and 26.12.0 | Pin supported Node 24 LTS patch at bootstrap; optional Node 26 compatibility job, promote when LTS and dependencies support it |
| 3D rendering | [Three releases](https://github.com/mrdoob/three.js/releases) lists r186; [WebGPURenderer docs](https://threejs.org/docs/pages/WebGPURenderer.html) describes WebGPU with WebGL2 fallback | Spike current stable Three r186; use orthographic cutaway and TSL field material if fallback parity passes |
| Shader architecture | [Three renderer manual](https://threejs.org/manual/pages/webgpurenderer) describes TSL targeting WGSL/GLSL and calls renderer experimental | Keep renderer isolated. Avoid assuming legacy ShaderMaterial or EffectComposer ports directly. Cut to stable WebGL renderer if needed |
| GPU API | [MDN WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) documents API constraints and support | Feature detect adapter/device; GPU rendering enhancement; CPU worker numerical path always present |

Chosen supporting tools: Bun 1.4.3 workspace/package manager and script runner, strict TypeScript, Zod runtime schemas, Pinia for application state, Dexie for IndexedDB migrations/transactions, native module Workers and transferable arrays, Canvas 2D, Vitest, fast-check, Playwright, axe-core, ESLint and Prettier. Node 24 remains required by the package engine range and by scripts that explicitly invoke Node. Current dependency pins and integration checks are recorded in [implementation status](IMPLEMENTATION_STATUS.md); this research section retains its planning-date context.

Use CSS custom properties and authored component styling; accessible headless controls may come from Reka UI after compatibility review. Do not add a complete visual kit just to inherit its generic layout. Use SVG for small analytical charts plus accessible tables. Native Web Audio nodes suffice for optional P0 preview; custom AudioWorklet DSP is deferred. Rust/WASM, SharedArrayBuffer, OffscreenCanvas, service workers, and GPU compute need independent evidence before becoming production dependencies.

## Compatibility spike, before lock-in

Create a minimal Nuxt static build exercising: module worker packaging; Zod schema imports in Node and worker; TS7 package typecheck and Vue SFC typecheck; IndexedDB transaction/migration; Three initialization and disposal; field texture plus mask on native WebGPU and forced WebGL2; unavailable-GPU Canvas fallback; production navigation and direct `/lab` load. Capture resolved versions, browser/device versions, failures, bundle sizes, and renderer initialization time.

Accept the stack only if production build and required fallbacks pass. The alternative to Three's newer renderer is an isolated WebGLRenderer cutaway with a compatible material adapter, while the Canvas plan remains available. The alternative to TS7 for Vue tooling is a documented TS6 compatibility path, not disabled type checking. Nuxt 4.6's Vapor integration is interesting but does not convert an RC runtime into a production default.

## Prior art and physics context

| Reference | Verified relevance | How to use |
|---|---|---|
| [Resona](https://github.com/LeeeeT/resona) | Browser 2D hybrid acoustic simulation using WebGPU/Web Audio | Study advanced interactions and model boundaries; do not claim first browser wave visualization |
| [SignalPlan](https://github.com/NC4321/SignalPlan) | Browser Wi-Fi floorplan coverage planning | Review scope and calibration UX; differentiate integrated comparison and explainability |
| [pyroomacoustics docs](https://pyroomacoustics.readthedocs.io/en/stable/) | Established room simulation reference; docs show 0.10.0 | Pin a release for P1 matched image-source benchmark cases |
| [ITU-R P.1238 index](https://www.itu.int/rec/R-REC-P.1238/en) | Indoor propagation recommendation | Confirm current revision before parameter use; consult model applicability |
| [ITU-R P.2040 index](https://www.itu.int/rec/R-REC-P.2040/en) | Building material propagation recommendation | Cite specific construction/frequency data only when verified and usable |

The handoff cites P.1238-13 and P.2040-4 from September 2025. Reconfirm in-force revisions and exact document contents when adopting numerical parameters. Linking a recommendation does not make invented material values literature-derived. No tables or source code have been copied from prior-art tools.

## Frontier technology policy

Adopt current stable tools when they improve this product: native build/typecheck tooling, optional WebGPU rendering, portable shader composition, worker isolation, perceptual color tokens, and demand-driven rendering. Benchmark gains locally; published tool speedups are not Cha Waves benchmarks. Stage Vapor, native-tooling integration changes, and advanced wave solvers in isolated experiments with rollback paths.

Dependency upgrades occur as small reviewed changes: compile, run numerical regressions, test both rendering backends, inspect bundle impact, and record changes to reproducibility manifests when solver behavior changes. Revisit this research at bootstrap and each release candidate.
