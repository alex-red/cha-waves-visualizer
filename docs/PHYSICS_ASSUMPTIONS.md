# Physics assumptions and model boundaries

P0 uses two independent quick models consuming one canonical building. Outputs are **computed approximations** with **assumed material values**. Numerical correctness establishes faithful implementation of these models; it does not establish real-home prediction accuracy.

## Sound — direct-path model

For source s and receiver r, calculate true 3D distance `d = ||r − s||`.

```text
relativeDirectLevelDb = −20 log10(d / referenceDistanceM) − sum(assumedTransmissionPenaltyDb)
directTravelTimeMs = 1000 × d / speedOfSoundMps
```

Defaults: reference distance 1 m; speed of sound 343 m/s (explicit room-temperature approximation); source height 1.2 m; receiver plane 1.5 m; representative frequency 1,000 Hz; minimum model-valid distance 1 m. Below the minimum, mark invalid rather than claiming the far-field formula describes the source region. Heights are above the selected level, converted to absolute z in canonical data.

Output label: **Modeled relative direct-path level (dB re 1 m)**. It is not calibrated SPL, total room loudness, speech intelligibility, or hearing safety. Transmission penalties are a switchable educational approximation. A “wall” material name cannot establish isolation performance; absorption and transmission are distinct parameters.

No diffraction, paths around hallway bends, modal behavior, coherent interference, scattering, or late reverberation is computed. Travel time belongs to the direct geometric path and is not a prediction of the full audible impulse response. Changing frequency affects only explicitly configured band parameters in P0; it does not create a wave solution.

Optional P1 first-order reflections use image sources, finite-face intersection, sidedness, visibility, and supported height geometry. Validate path length and arrival times independently. Keep their visual/path output separate from the direct heatmap. `sqrt(1-alpha)` is a simplified reflection-amplitude relation only under documented absorption assumptions; transmission must not be confused with absorption. Coherent pressure needs complex amplitudes/phase; adding dB levels is invalid. No realistic interference from naive energy sums.

## Wi-Fi — free-space plus assembly losses

Use actual representative carrier frequency f in Hz, not a technology generation label.

```text
FSPL_dB = 20 log10(4π d f / c0)    where c0 = 299,792,458 m/s
receivedPowerDbm = EIRP_dbm + receiverGain_dbi − FSPL_dB − wallLoss_dB − otherLoss_dB
```

This exact constant form avoids unnecessary discrepancy from the rounded `−147.55` intercept in the source example. For distance in meters and frequency in Hz its intercept is approximately −147.5522 dB. Use one convention in calculations and tests.

Defaults: 2.4e9 Hz initially, selectable illustrative 5e9 and 6e9 Hz; EIRP 18 dBm; receiver gain 0 dBi; other loss 0 dB; AP height 1.2 m; receiver plane 1.2 m; minimum distance 1 m as an explicit model guard, not a universal antenna far-field guarantee.

EIRP already includes transmit gain and feeder effects. Effective wall loss is summed once per distinct crossed assembly using opening/height semantics from DATA_CONTRACTS. No RF reflection/scattering/diffraction, phase interference, human occupancy, neighboring APs, channel contention, hardware variation, MIMO, roaming, or throughput is modeled. Band values are representative centers, not regulatory channel-selection advice. A Wi-Fi generation name does not change the FSPL formula.

Output label: **Predicted received power (dBm)**. Optional threshold area fraction describes eligible samples above a declared dBm threshold, never guaranteed connectivity. Do not label colors “excellent internet” or invent Mbps.

## Proposed demo parameters

All following values are deliberately authored **fixture-assumed** teaching values, not construction facts, literature tables, or validated measurements. They may be tuned for a legible fixture only with the assumption record retained.

| Assembly | Acoustic penalty at 1 kHz | RF penalty at 2.4 / 5 / 6 GHz |
|---|---:|---:|
| Demo lightweight partition | 8 dB | 3 / 5 / 6 dB |
| Demo masonry partition | 15 dB | 10 / 15 / 18 dB |
| Demo closed interior door | 6 dB | 2 / 3 / 4 dB |
| Valid open passage | 0 dB | 0 / 0 / 0 dB |

Source fixtures, editable profile controls, and inspectors all show that these values are assumptions. Selecting an unsupported band returns a missing-profile state, not a guessed coefficient. Default fixtures do not provide calibrated source levels or absorption coefficients disguised as transmission. No material precision claim follows from a fine raster.

## Reference checks

At 2 m with 1 m acoustic reference and no crossings: approximately −6.0206 dB. At 3.43 m and 343 m/s: 10 ms. For RF at 2 m, 2.4 GHz, 18 dBm EIRP, 0 dBi gain, and no losses: approximately −28.07 dBm using the exact c0 form. Doubling either RF frequency or distance changes FSPL by 6.0206 dB; increasing EIRP by 3 dB raises received predictions by 3 dB.

These values validate algebra in an idealized reference configuration, not typical apartment measurements. A changed camera, display palette, or furniture color cannot affect them.

## Provenance and uncertainty

Keep parameter provenance (`fixture-assumed`, `user-entered`, `literature-derived`, `manufacturer-measured`, `site-measured`) distinct from solver evidence and calibration state. Show geometry origin, material origin, solver type, and calibration status separately. A literature input does not make the computed output measured. P0 has no probability intervals or universal accuracy score.

Future survey calibration reports fitted parameter bounds, training IDs, spatially separated holdout IDs, measurement conditions, and held-out residuals. Reference solver agreement is a separate validation class. Use “validated on holdout” only for independent physical observations under a stated protocol.

Optional audio is muted, gesture-started, gain-limited, and labeled **Illustrative audio**. P0 PannerNode/filter/delay sketches cannot represent validated room acoustics. RIR convolution is P1 after supported numerical and capture workflows exist.
