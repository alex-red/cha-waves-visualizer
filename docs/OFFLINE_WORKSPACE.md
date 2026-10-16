# Offline workspace

Open **Homes → Make available offline** while connected. Keep the tab open until **Ready to open offline** appears. The app downloads and verifies the entire generated workspace, including field workers, placement search and the lazy cutaway renderer. Later visits to the same site can open saved homes, calculate fields, edit inputs and export JSON without a connection.

Offline access is optional. Opening the app or Homes does not install a service worker or populate app caches. Nuxt development mode does not offer installation; use the generated static preview or an HTTPS deployment. The implementation serves from the origin root; subdirectory hosting is not supported by this offline scope.

## Saved homes and portable backups

App files live in versioned CacheStorage caches. Projects, experiment libraries, reference images and raw surveys continue to use the existing IndexedDB storage. The offline copy is not a project backup. Export project JSON to keep a portable copy outside browser storage.

**Request persistent storage** asks the browser to retain this site's data when it needs space. The browser can decline or lack this API; local editing and exports remain available. The displayed estimate covers the whole site's storage, not just the current home. It is read at startup and after a persistence request; it is not a live usage counter. A grant reduces eviction risk and does not protect against clearing site data or losing the device. See [MDN's persistence contract](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

**Remove offline copy** unregisters this app's root worker and deletes its own cache prefix. It preserves saved homes and unrelated caches/registrations. An already open page can finish using its current controller until closed; it does not repopulate a deleted app cache during ordinary fetches. Clearing browser site data can remove both projects and app files.

## Updates and recovery

While connected, choose **Check for updates**. A new worker downloads a complete separate version and checks every asset against its generated SHA-256 digest. Failed or incomplete installations leave the previous complete version available. Activation rechecks that the cached update is complete. A ready update waits for **Save and reload update**, which saves the current committed project before activating and reloading. If saving fails, reload is blocked and the home remains exportable.

Other open tabs keep their loaded app after activation. Their exact old asset requests can use retained previous caches, including chunks not loaded before going offline. New navigations use the active version's cached entry point. Previous caches are retained while windows are open and can be reclaimed on a later activation with no windows, or by removing the offline copy. Several updates can therefore occupy additional space. If an app cache has been cleared, use **Repair offline copy** while connected. Export important projects before clearing browser storage.

## Build and hosting contract

```sh
bun run build
bun run verify:static-security
bun run verify:offline
bun run preview
```

Static generation emits `sw.js` and `offline-build.json` alongside the app. The version covers precached asset bytes and paths, the worker implementation and generated hosting headers. Lazy chunks, worker scripts and payloads are included; source maps, error fallback HTML and hosting metadata are excluded. The verifier detects source or artifact changes after generation.

The generated `_headers` includes security policy and `Cache-Control: no-store` rules for the worker and build metadata. Hosts must apply these rules and deploy one complete artifact atomically. The local preview already uses no-store responses. Cached HTML retains the response's CSP; script hashes must match that exact HTML. HTTPS is required except for trusted local origins. [MDN describes the install, waiting and activation lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

Only exact same-origin GET asset requests with no query string are served from app caches. `/` maps to cached `/index.html`; unknown routes have no SPA fallback. POST, cross-origin and query-bearing requests use the network. Private endpoints or project data are not dynamically added to caches.

The feature has no account, synchronization, background project uploads or numerical-model changes. Actual-host update behavior and real-device eviction remain deployment validation work. Current local verification is recorded in [implementation status](IMPLEMENTATION_STATUS.md).

Desktop and phone controls were visually inspected: [desktop](../reports/screenshots/offline-workspace.png), [phone](../reports/screenshots/offline-workspace-phone.png).

## Local verification

October 15, 2026: all **236 unit tests** and **274 browser checks** passed (137 each in Chromium and WebKit), alongside strict typechecks, production generation, independent numerical/project fixtures, generated security-header and offline-artifact verification. Ten additional update/reload checks and ten editor split checks passed across the two engines. The final build caches 15 files totaling 2,163,336 bytes under version `1fe2cb74d856537192b9f0d4579653fbfd7a0e5d111ad327bcf1899504dbc6b6`. Solver version 1.0.0, field hashes and project format 3 round-trip identity remain unchanged. Firefox and physical-device/actual-host checks remain outside this local evidence.
