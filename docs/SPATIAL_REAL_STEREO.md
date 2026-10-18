# First real-image stereo cross-check

This SPATIAL-05 preparation step uses **Middlebury 2014 Adirondack-perfect**, selected before evaluating its ground truth. The [dataset](https://vision.middlebury.edu/stereo/data/scenes2014/) provides a rectified photographic stereo pair, calibration and separately acquired structured-light disparities. The [reuse page](https://vision.middlebury.edu/stereo/data/) grants permission to use and publish its images/disparity maps and requests citation of Scharstein et al., *High-resolution stereo datasets with subpixel-accurate ground truth*, GCPR 2014. This is a custom reuse grant, not the repository MIT license. Original photos, ground truth and derived real-image assets stay in ignored local storage; CI uses synthetic codec/calibration/evaluation tests.

## Frozen protocol before ground-truth evaluation

Use exactly the default `im0.png`, `im1.png`, `calib.txt` and evaluator-only `disp0.pfm` from the [Adirondack-perfect directory](https://vision.middlebury.edu/stereo/data/scenes2014/datasets/Adirondack-perfect/). Exposure/lighting variants are excluded. Hash every original and prepared artifact. Do not inspect `vmin`/`vmax`, truth extrema or image reconstructions to choose parameters. The estimator receives only the prepared stereo pair, calibration and fixed settings. A separate evaluator opens ground truth after reconstruction.

Bound output to **256 × 177** RGB pixels. Decode PNG RGB without color enhancement, then apply deterministic area averaging over source pixel areas. Scale focal lengths independently by actual X/Y resize ratios. Source calibration uses zero-indexed pixel centres; our camera contract uses image-edge coordinates with pixel centres at `x+0.5,y+0.5`, so principal points become `(sourcePrincipalPoint + 0.5) × ratio`. Supplied baseline converts millimetres to metres. Preserve the source camera frame, with camera centres at `[0,0,0]` and `[baselineM,0,0]`, OpenGL +X right/+Y up/−Z forward. A convention transform is not estimated world registration.

The matcher retains its existing five-pixel patches, texture variance 24, maximum RGB MAE 18, uniqueness ratio 0.8 and reverse tolerance 1 pixel. Search **1–25 pixels**, derived only from the supplied `ndisp=280` and X scale `256/2880`, rounding the conservative upper bound upward. Disparity zero remains outside this reference's search; report resulting missing support. Account for unequal principal points with `depthM = baselineM × fx / (disparityPx + cxRight − cxLeft)`. Do not replace unequal `cx` by an average. Equal-principal-point fixtures must remain byte-identical.

For evaluation, read the original single-channel PFM with declared endianness and bottom-up row ordering. Under the [Middlebury PFM convention](https://vision.middlebury.edu/stereo/submit3/upload-format.html), the header sign determines byte order, its magnitude is ignored, and stored floats already represent pixel disparities. Preserve NaN/+Infinity as missing truth. Map each output pixel centre to the nearest original truth pixel and scale disparity by the X ratio; never interpolate across holes or surfaces. Compute metric depth using original calibration and disparity. Resized RGB pixels average an area while truth samples one location; this sampling difference is an explicit limit. Report the result as our reduced-resolution check, not an official Middlebury score.

Freeze these screening gates: **at least 35% of pixels with truth receive an estimate; at most 10% of evaluated estimates have disparity error >1 output pixel; axial-depth P90 error is at most 0.25 m**. Every gate must pass; null/nonfinite metrics fail. Report counts of missing truth, accepted estimates without truth and unestimated truth separately. Report error distributions, maxima, ten worst pixel IDs, and the >1-pixel fraction both among evaluated estimates and with every missing estimate counted as a failure. Do not hide abstention behind an accuracy score or change thresholds after evaluation. Failed results remain valid research outcomes.

This pair offers no independent held-out camera view. The right image is an estimator input and must not be relabeled held-out. Structured-light truth checks geometry in the supplied calibrated rig frame; it does not test estimated registration, room coverage, acoustic contribution, Gaussian optimization or AI completion. ECHO-04/05 remains the independent physical acoustic gate.

The [source pin](data/middlebury-adirondack.json) records original byte sizes and SHA256 values. Its SHA256 is `938bfe7f63bc1c6ec6c6d6aefde2d7f02717053675bd0ebe9987fda8331820aa`; the prepared 256 × 177 input manifest is `8d6c7a33c309e21d8fddbe65a4a1845a3262b846585933f986888fe12524b459`. These were frozen before running reconstruction or ground-truth evaluation. Original PFM SHA256 is `7f60d0734b9a00c8ac56db21a36a2193b67e4ddb02d84360c476c094574a03ff`; hashing does not expose its contents to the estimator.

## Reproduce locally

Bun runs the workflow. PNG preparation additionally needs Python 3 and Pillow; observed preparation used Pillow 12.2.0. No CV/ML runtime, model, GPU or other package was installed. Pillow only decodes RGB PNG bytes; TypeScript performs the deterministic area resize, calibration conversion, matching and evaluation. CI tests those paths with synthetic inputs and a supplied decoder, without downloads or a Pillow dependency.

Use new output directories. The explicit fetch command retrieves approximately 35 MB from the pinned official HTTPS URLs and rejects changed hashes/sizes; preparation and evaluation make no network requests.

```sh
bun run spatial:middlebury -- fetch --output local-captures/adk-original
bun run spatial:middlebury -- prepare --source local-captures/adk-original --output local-captures/adk-input
bun run spatial:stereo -- --input local-captures/adk-input/input.json --output local-captures/adk-result
bun run spatial:middlebury -- truth --source local-captures/adk-original --input local-captures/adk-input/input.json --output local-captures/adk-truth
bun run spatial:stereo:geometry -- --input local-captures/adk-input/input.json --result local-captures/adk-result/reconstruction.json --truth local-captures/adk-truth/truth.json --output local-captures/adk-scores
```

Preparation reads only calibration and the two PNGs. Reconstruction receives the prepared input alone. The separate truth step opens the PFM and writes hash-linked little-endian float32 disparity/depth maps, with NaN representing missing truth. Evaluation binds input/result/truth hashes, both cameras, settings and original prepared image hashes; it performs no alignment or rescaling. Exit 2 means a completed evaluation with failed gates, 1 means an input/I/O error, and 0 means a pass. Reports retain every coverage denominator and the ten worst pixel IDs. All output directories refuse replacement.

Open `adk-result/manifest.json` plus `adk-result/reconstruction.splat` through **Research Lab → Visual splats → Open your own visual bundle**. The asset has two training cameras and supplied metric rig registration; this is a coordinate convention, not recovered world placement. The real-data evaluation remains a separate local report and does not acquire the synthetic example's hash-gated badge. No real source or derived asset is bundled into the website.

## Corrected frozen result: all gates fail

| Measure | Result | Frozen gate |
|---|---|---|
| Total / valid-truth / missing-truth pixels | 45,312 / 45,035 / 277 | Report all support |
| Accepted pixels | 13,146: 12,968 with truth, 178 without | Unknown truth is not scored as success |
| Valid truth receiving an estimate | **28.795%**; 32,067 truth pixels unestimated | ≥35% — **fail** |
| Disparity error >1 output pixel among evaluated estimates | **20.512%** (2,660 / 12,968) | ≤10% — **fail** |
| Disparity error >1 pixel, counting missing estimates as failures | 77.111% | Report abstention cost |
| Absolute axial-depth error | Median 0.02531 m; mean 0.10711 m; **P90 0.42693 m**; maximum 1.40005 m | P90 ≤0.25 m — **fail** |
| Absolute disparity error | Median 0.30483 px; mean 1.28481 px; P90 4.09812 px; maximum 17.95710 px | Report error tail |

Every outcome remains: 1,761 border, 17,011 textureless, 563 photometric, 9,133 ambiguous, 3,698 inconsistent and 13,146 accepted pixels. These categories are screening outcomes, not independently verified explanations of every failure. No threshold or matcher setting changed after evaluation. The matcher has insufficient coverage and retains large incorrect matches on this real scene; the small synthetic pass does not generalize to this protocol.

Reconstruction JSON SHA256: `49888365d20fb80d4130dff8918ea33b4a49e92ebc8108637f238cbe8c437104`. Corrected truth manifest SHA256: `f8ec0592ce4fd06b2ef1c144788cd161c475c9b311c02512d4382542f1f9bc2c`. Corrected report SHA256: `eba8439064789e6ab91d9b8c163f7d9b15a66a7e679827d5e3ea44b114b09701`. A separate review recalculated the counts, >1-pixel rates, depth/disparity percentiles and maxima from the retained result/maps and verified the source hashes. The initial report used an incorrect multiplication by the PFM header magnitude and is explicitly marked **invalid** in local storage. Its input/reconstruction bytes were preserved for the corrected evaluation; the codec fix follows the official format convention, rather than changing estimator parameters.

## Verification and next decision

All **479 Vitest checks** and full package/script/Vue typechecks pass. Synthetic checks cover non-unit PFM headers in both byte orders, row orientation/missing truth, half-pixel calibration, deterministic area resize, unequal principal points, bound/hash/lineage rejection, absent truth during preparation, no partial download installation and failed-gate exit status. The earlier synthetic reconstruction/result/bundled artifacts remain byte-identical. The real PNG preparation, reconstruction and corrected geometry evaluation ran locally; originals and reports remain ignored. This CLI-only change does not replace a browser build, preview, capture relay or Tailscale route.

The completed [Census/SGM comparison](SPATIAL_STEREO_COMPARISON.md) keeps the original SAD result above as the failed baseline and reports mixed follow-up evidence. Development-set relative gates pass, while the sealed synthetic relative screen fails: coverage changes from 50.341% to 48.464%, and bad-1 among estimates rises from 0.698% to 1.290%. Adirondack SGM passes the absolute gates (43.788% coverage, 4.929% bad-1, depth P90 0.055046 m), but this does not change the original SAD outcome. On the fresh Motorcycle case, SAD and SGM both pass absolute gates; SGM improves bad-1 from 8.705% to 4.828%, while coverage changes from 54.938% to 53.215% and missing-aware error improves from 49.844% to 49.354%, a 0.490 percentage-point gain below the required 2-point relative screen.

The next decision is to run fixed ablations on development cases only, then freeze a fresh sealed split before any parameter selection. Independent registration, held-out camera views and the physical acoustic gates remain open. Gaussian optimization or completion should not conceal missing support or turn incorrect points into physical evidence.
