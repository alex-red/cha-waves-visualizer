# Local scan retrieval

The optional owner API lets local tools retrieve received phone recordings without browser automation or repeated manual exports. It archives each accepted phone session as a recorded v3 scan. It uses a separate authenticated listener on `127.0.0.1`; keep Tailscale Serve pointed at the ordinary relay port only.

## Enable once on the relay

Preserve the current browser export before restarting the identified relay. Keep its existing host, port and HTTPS origin; add all three owner API flags together:

```sh
bun run satellite -- --host 127.0.0.1 --port 4175 \
  --external-origin https://your-device.your-tailnet.ts.net \
  --local-api-port 4176 \
  --local-api-key-file local-captures/.satellite-owner-key \
  --capture-dir local-captures/relay-archive
```

The relay creates a random owner key in a `0600` file and an owner-only archive directory (`0700`); scan files are `0600`. Paths inside the static site root are rejected. The owner key is separate from phone pairing tokens and is never printed. The listener always binds to `127.0.0.1`. No extra Tailscale route or public endpoint is required. Omit these flags to retain the default in-memory relay behavior.

## Retrieve and inspect

```sh
# List IDs, SHA256 hashes, counts and capture date ranges; no PCM or tokens.
bun run echo:pull

# Choose an explicit ID from that listing; never silently choose the latest room.
bun run echo:pull -- --scan SCAN_ID --output local-captures/SCAN_ID.scan.json
bun run echo:inspect -- --input /absolute/path/to/local-captures/SCAN_ID.scan.json
```

The CLI defaults to `http://127.0.0.1:4176` and the key path above. `--origin` accepts only a canonical HTTP origin on `127.0.0.1`; `--key-file` supports a different private key path. Requests bypass proxy settings, reject redirects, and have bounded time and response size. The download must parse as a recorded scan and its exact-byte SHA256 must match the API ETag. The command creates a new private output file and refuses to overwrite an existing one. Use the hash and capture IDs when handing evidence to another agent.

## API contract

Both endpoints require `Authorization: Bearer <owner-key>`. Use the CLI so the key stays out of command lines and logs. Requests require a loopback peer and an exact `Host` matching the bound `127.0.0.1` port. Browser `Origin` and `Sec-Fetch-*` headers are rejected. Responses have `Cache-Control: no-store`, no CORS, and no pairing tokens.

| GET route | Response |
|---|---|
| `/v1/scans` | `{ "format": "cha-echo-local-scans-v1", "scans": [...] }`; each entry has `id`, `sha256`, `byteLength`, `recordingCount`, `batchCount`, `firstCapturedAt`, `lastCapturedAt` |
| `/v1/scans/<id>` | Exact saved scan JSON bytes and a quoted SHA256 ETag |

IDs contain 1–128 letters, digits, underscores or hyphens. Listing order is by ID; date ranges come from recording timestamps. There is no implicit latest scan. Missing authentication returns `403`; authenticated non-GET requests return `405`; unknown scans return `404`; an unavailable listing returns `503`. The ordinary phone relay does not serve these routes.

## Persistence and scope

Each phone session gets a random archive ID unrelated to its pairing bearer. Capture and batch acceptance first writes a validated snapshot atomically, then commits relay memory. Per-session transactions and a global archive queue preserve retry behavior and capacity under concurrent uploads. A failed archive write returns `503` without accepting the new data; retry with stable IDs. Archives survive session expiry, session end and relay restart. Live pairing sessions still expire and are not restored after restart.

Snapshots contain raw received PCM and batch metadata with empty desktop reviews. Browser-only peak selections, later desktop imports and unsent phone data are not automatically mirrored. Export the desktop scan when its reviews matter. A user-provided recorded v3 export may be installed manually as a new `<id>.json` file in the private archive with mode `0600`; retain its exact bytes. The API ignores malformed, synthetic, symlinked and non-private files.

The archive allows 100 scan files and each scan is limited to 10 MiB. There is no automatic deletion, eviction, or retention timer. At capacity, preserve or move old files deliberately before opening another session. Ending a pairing session does not delete its archive. Keep real audio, the key and private reports in ignored local storage. These limits do not increase the existing 12-probe session/scan limit.
