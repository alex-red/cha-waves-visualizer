# Echo scan document format

Echo scans are portable JSON files for the room echo lab. Version 3 stores raw observations, stable review selections, and optional acquisition telemetry. Reconstructions and other derived values are recomputed after import; they are not accepted as measurement data.

## Version 3

Every newly serialized document uses `format: "cha-echo-scan-v3"` and one of two modes.

Synthetic scans contain a room fixture and its generated captures:

```json
{
  "format": "cha-echo-scan-v3",
  "mode": "synthetic",
  "fixture": { "widthM": 6.4, "depthM": 4.8, "originXM": 0, "originYM": 0 },
  "captures": [
    { "position": { "xM": 1.2, "yM": 1.4 }, "arrivalTimesMs": [7.0, 12.2, 8.1, 13.5] }
  ]
}
```

Each synthetic capture has a finite position within ±1,000,000 metres and exactly four positive finite arrival delays (at most 1,000,000 ms). Fixture dimensions must be positive and at most 30 metres. Origin coordinates are optional, finite, and within ±1,000,000 metres; omitted origins default to zero in the room model.

Recorded scans keep each phone recording with its unique capture ID and link review state to that ID. A recording may include `captureBackend` (`audio-worklet` or `script-processor`), normalized signal statistics (`peak`, `rms`, and `clippedFraction`, each from 0 to 1), and optional version 1 `acquisition` metadata. They may also include an optional `batches` array of version 1 pose manifests. Each manifest records manual pose context, a one-second software-clock warmup target (captured probes require at least one second), fixed playback gain 0.1, and exactly five ordered attempt statuses. A captured attempt refers to one existing recording ID; an interrupted attempt carries its reason; attempts after interruption are `not-started`. A batch preserves only captures that completed, including in a partial batch. See [acquisition evidence](ECHO_ACQUISITION.md) for timing interpretation and limits.

```json
{
  "format": "cha-echo-scan-v3",
  "mode": "recorded",
  "recordings": [
    {
      "id": "capture-1",
      "capturedAt": "2026-10-15T12:30:00.000Z",
      "position": { "xM": 2.4, "yM": 1.8 },
      "sampleRate": 48000,
      "pcm16Base64": "...",
      "durationMs": 700,
      "deviceLabel": "Phone microphone",
      "captureBackend": "audio-worklet",
      "acquisition": {
        "version": 1,
        "requested": { "echoCancellation": false, "noiseSuppression": false, "autoGainControl": false },
        "applied": { "echoCancellation": false, "noiseSuppression": false, "autoGainControl": false, "sampleRate": 48000, "channelCount": 1 },
        "timing": {
          "clock": "audio-context", "precision": "sample-frame", "contextSampleRate": 48000,
          "captureStartFrame": 10000, "captureFrames": 33600,
          "scheduledChirpStartFrame": 14800, "chirpFrames": 3840
        },
        "continuity": {
          "status": "observed", "presentInputFrames": 33200, "missingInputFrames": 200,
          "unobservedFrames": 200, "presentZeroFrames": 1000, "longestPresentZeroRunFrames": 600
        }
      }
    }
  ],
  "batches": [{
    "version": 1, "id": "batch-1", "startedAt": "2026-10-15T12:30:00.000Z", "endedAt": "2026-10-15T12:30:06.000Z",
    "position": { "xM": 2.4, "yM": 1.8 },
    "context": { "heightM": 1.1, "orientation": "upright", "headingDeg": 90, "speakerVolumePercent": 60 },
    "playbackGain": 0.1, "plannedProbeCount": 5, "warmupMs": 1000, "probeIntervalMs": 1000,
    "sampleRate": 48000, "warmupStartFrame": 1000, "warmupEndFrame": 49000,
    "attempts": [
      { "index": 1, "status": "captured", "captureId": "capture-1" },
      { "index": 2, "status": "captured", "captureId": "capture-2" },
      { "index": 3, "status": "interrupted", "reason": "hidden" },
      { "index": 4, "status": "not-started" },
      { "index": 5, "status": "not-started" }
    ]
  }],
  "reviews": [
    {
      "captureId": "capture-1",
      "peaks": [{ "delayMs": 0, "strength": 0.9 }, { "delayMs": 18.4, "strength": 0.4 }],
      "directPeakIndex": 0,
      "wallPeakIndices": [1]
    }
  ]
}
```

The recording example abbreviates the PCM payload. Its metadata values describe a 700 ms, 48 kHz capture (33,600 frames), with the chirp scheduled 4,800 frames (100 ms) after the capture start and an 80 ms chirp (3,840 frames). The continuity counts sum to 33,600; the present-zero counts are a subset of present input frames. Batch manifests are optional and do not replace the individual PCM recordings. A captured attempt must reference a recording at the batch's position and sample rate, with AudioWorklet sample-frame acquisition timing and a nonoverlapping capture window after the warmup. The repeated-probe heading is manual: for a flat phone it indicates the direction of the top edge; for an upright phone it indicates the direction the screen faces. Manifest history is never inferred for v1 or v2 imports.

Review entries may be partial. Each refers to an existing recording exactly once and can contain up to 16 peaks with nondecreasing delays from 0 through 2,000 ms and finite nonnegative strengths, an optional direct peak index, and zero to four distinct wall peak indexes. A selected wall arrival must be later than the direct peak and no more than 175 ms after it. A review without a direct peak cannot contain wall selections.

The parser rejects unknown fields, duplicate recording IDs, reviews or batch IDs, missing capture references, invalid sample data, secret-bearing fields, and JSON larger than 10 MiB. A document holds at most 12 synthetic captures, 12 recordings, 12 reviews and 12 batch manifests. Each probe recording counts toward the 12-capture limit; a batch manifest does not count as a capture. Recorded PCM inherits the satellite limits of 512 KiB and two seconds per capture. Acquisition settings use an explicit allowlist and do not accept device or group identifiers.

The browser-safe API is exported from `packages/echo-scan.ts`: `parseEchoScan(text)` returns a validated document plus import notices; `serializeEchoScan(document)` validates and emits formatted v3 JSON. `createSyntheticEchoScan` and `createRecordedEchoScan` construct typed documents. Keep session tokens and pairing credentials out of scan files.

## Importing older scans

The parser accepts `cha-echo-scan-v2` and `cha-echo-scan-v1` exports. Version 2 imports preserve validated PCM and capture-linked reviews, with acquisition telemetry absent; the app reports that telemetry was unavailable for that recording. Version 1 synthetic imports preserve the fixture and captures, then discard saved reconstruction data. Version 1 recorded imports preserve validated PCM and reset peak and wall selections because the old parallel arrays did not link reviews reliably to individual captures. Every imported document is serialized in v3 form. Missing legacy telemetry means unknown; it does not mean zero input gaps or zero-valued samples.
