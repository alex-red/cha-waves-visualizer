# Static deployment and recovery

The application builds to `apps/web/.output/public`. This document describes the implemented static artifact and local verification. It does not record a public deployment.

## Build and inspect

```sh
bun run build
bun run verify:static-security
bun run verify:offline
bun run preview
```

The build emits a `_headers` file in the publish directory after generating the HTML. The preview derives the same headers from those HTML files, so tests exercise the production content-security policy rather than an unrestricted development server.

The policy allows same-origin scripts and exact SHA-256 hashes of the generated inline script blocks, without enabling arbitrary inline scripts or `eval`. Styles allow inline rules because the generated app includes inline CSS and Vue changes style attributes. Connections default to the same origin; embedded media and workers have explicit directives. Additional headers disable framing, MIME sniffing, referrer transmission, and camera/microphone/geolocation permissions. This policy is for the generated static app; it is not applied to Nuxt's development/HMR server.

The preview supports GET and HEAD, returns 405 for other methods, rejects malformed encoded and hidden/traversal paths, resolves symlinks within the public root, and does not serve the hosting `_headers` configuration. Preview responses use `no-store`. Public output currently contains no source maps or source map references.

The `_headers` syntax is compatible with [Netlify's publish-directory header format](https://docs.netlify.com/manage/routing/headers/). Other hosts must translate or explicitly apply these headers; merely uploading this file does not establish policy on every host. Changes to generated HTML require regenerating the hashes. CSP hashes depend on exact script contents, including whitespace; see [MDN's script-src reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src). The [CSP reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy) describes style and resource directives.

Actual production HTTPS, hosting logs, domain configuration, redirects, compression, caching, response headers, and update behavior must be checked on the eventual host. The [offline workspace](OFFLINE_WORKSPACE.md) is explicitly installed from Homes. Generated worker/build metadata use no-store rules; deploy one complete root-hosted artifact atomically and preserve the exact security headers. Online checks stage a verified version, and an explicit save/reload activates it.

## Calculation recovery

A worker constructor failure, runtime error, or unreadable message exposes **Restart calculation**. Restarting retires the previous worker, clears pending/preview identities and cached working field data, creates a new worker, and recalculates the current scene and any saved baseline. Late replies from retired requests cannot replace the accepted field.

The canonical scene, settings, project identity and history remain intact. A drag in progress is discarded on worker failure; it is not committed or autosaved. Users may continue numeric edits and export committed inputs independently of field availability. There is no automatic retry loop.

## Storage evidence

The browser suite exercises an actual version 1 database lacking the `updatedAt` index and verifies migration to version 2 without losing its compatible project. Synthetic transaction abort and quota errors keep the previous stored record intact while the working scene and baseline remain exportable. A blocked upgrade shows a recovery notice; a database connection arriving after that rejected open is closed so it cannot block a later upgrade.

A reported local-save failure does not promise durable persistence. Export is the recovery path for the current working project. Database version migration and project JSON format versioning are separate contracts; unsupported project formats still fail validation before replacing the workspace.

Portable project format 3 carries named experiments and optional raw RSSI surveys. Format 1/2 records and files migrate with their existing scene/settings/baseline/reference and experiment library intact, where present; migration creates no observations. This does not change the IndexedDB database version or its upgrade path. Invalid experiment snapshots reject the whole import before installation; existing working inputs and library remain available for export.

## Privacy verification scope

Deployment browser tests watch the initial page, worker result and lazy cutaway startup for cross-origin requests and CSP console failures. Those tested flows pass without cross-origin requests. Solver diagnostics remain local DOM attributes/events. There is no application telemetry endpoint or cloud solver. The eventual host will still receive ordinary asset requests and may keep its own access logs.
