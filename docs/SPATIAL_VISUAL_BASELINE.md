# Visual splat import baseline

This is the precomputed-asset import slice of SPATIAL-05. It supplements the audio [spatial bundle](SPATIAL_BUNDLE.md) with a separate, deliberately small visual contract. Rendering, registration, image-supported reconstruction and acoustic fusion are distinct outcomes. This slice does not train a reconstruction, recover physical scale, validate cameras against images or pass the full SPATIAL-05 research gate.

## Manifest and original asset

`packages/spatial-visual-types.ts` defines `cha-visual-bundle-v1`; `packages/spatial-visual.ts` validates the manifest, inspects the binary and maps explicitly registered points. A bundle consists of a manifest JSON and one explicitly named standard `.splat` file. Preserve both exact original files. A home project or Echo scan is not a visual bundle.

| Field | Meaning |
|---|---|
| `asset` | Basename, `splat32` format, exact-byte lowercase SHA256 and declared Gaussian count |
| `assetFrame` | Right-handed coordinates, declared signed Y/Z up direction; cameras use OpenGL axes (+X right, +Y up, −Z forward) |
| `worldFrame` | Metres, right-handed Z-up, matching the research world convention |
| Known `registration` | Positive uniform `scaleMPerUnit`, then quaternion XYZW rotation, then translation in metres; method remains supplied, estimated or synthetic |
| Unknown `registration` | A reason; no implicit identity, metric scale or placement in world coordinates |
| `provenance` | Synthetic, image-reconstruction, mesh-conversion or generated origin; creator, source, license, method/version and notes |
| `cameras` | Up to 128 named poses in the asset frame, pinhole intrinsics, illustrative/training/held-out role and optional image hash |

Provenance, camera roles and image hashes are supplied metadata. The importer verifies the asset bytes; it does not fetch or verify source URLs, inspect camera images or establish the accuracy of these declarations. Illustrative cameras must not become evidence of a capture trajectory. Generated content remains labeled generated and cannot enter the acoustic solver.

The parser rejects unsupported fields/versions, unsafe filenames, non-HTTPS metadata links, duplicate camera IDs, invalid intrinsics and nonfinite/out-of-bounds coordinates. Quaternion norm tolerance is 1e-6; operations normalize accepted rotations. Scale is bounded from 1e-6 to 1e6 metres per unit, focal lengths from 1e-3 to 131,072 pixels. The manifest is limited to 256 KiB, and assets to 8 MiB / 262,144 Gaussians. Size/count limits are enforced before renderer allocation.

Each standard record is 32 bytes: little-endian float32 center XYZ, positive float32 standard deviations XYZ, RGBA bytes, and packed quaternion bytes **WXYZ**. PLY, SH coefficients, SPZ and compressed variants are outside this format. Inspection validates records, normalized rotations and rotated 3σ covariance bounds. It retains original bytes; it does not repair or resample malformed data. An asset's transformed bounds and camera positions must remain within ±1,000,000 m when world registration is known.

## Reproducible fixtures

| Fixture | Inputs and provenance | Supported conclusion |
|---|---|---|
| Metric study room | Self-authored procedural fixture, 1,883 Gaussians / 60,256 bytes, MIT; asset SHA256 `14f5c2425e69891d4e045e21dd76c48bd8fa3f69b9b02e3880a5afba9a012697`; synthetic scale 1 m/unit, 90° Z rotation, translation [1, 2, 0] m; three illustrative cameras | Software transforms and camera projection on known synthetic inputs |
| CC0 violin | [Marcel Padilla's 10k mesh conversion](https://github.com/marcelpadilla/splats/blob/main/data/violin/meta.json), 10,000 Gaussians / 320,000 bytes; asset SHA256 `6cb5a33059da30752a49324ab6f84721bb29527bac3810e0856283f0ab59a6dc`; nonmetric scale, unknown world placement, no cameras | External file parsing and rendering; no image training or camera validation |

The metric-room fixture tests software scale/rotation/translation and synthetic camera projection; it is not measured geometry. Its generator uses fixed inputs and packed output, with a frozen hash. The violin's original source metadata and [attribution](../apps/web/public/research/violin/ATTRIBUTION.md) are retained beside the unmodified file. Its asset-specific CC0 terms are separate from the repository license. Neither example is an image-supported reconstruction dataset.

## Browser boundary

`apps/web/app/lib/visual-browser.ts` reads only the explicitly supplied manifest and asset, checks actual and reported sizes, decodes strict UTF-8, hashes before binary inspection and retains both originals for lossless download. Manifest metadata URLs are never fetched. Failed imports must not replace an accepted scene; superseded imports must not install after a selection change or workspace close.

Reported decoded-attribute bytes cover only center, covariance and RGBA arrays (40 bytes per Gaussian). They exclude original files, sorting buffers, renderer/GPU allocations and other overhead. Local read/hash/inspection and first-render timings are per-load observations; they are not frame-rate, phone performance or total-memory claims.

The renderer uses the repository's existing Three.js dependency. Training a splat model, reconstructing an image-supported scene, validating held-out views, and comparing registration to independent structure remain subsequent experiments. The known-wall ECHO-04/05 physical gate stays independent of visual import.
