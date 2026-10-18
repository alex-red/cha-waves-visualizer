# Calibrated stereo image reference

This experiment prepares SPATIAL-05 with an actual image-to-geometry inverse. It uses a self-authored synthetic stereo pair with supplied metric pinhole cameras. It does not estimate poses, train Gaussian parameters, recover physical scale, validate a real room or establish an acoustic contribution. The existing [visual bundle](SPATIAL_VISUAL_BASELINE.md) remains the output/viewing contract.

## Protocol frozen before evaluation

The reference uses two rectified 160 × 120 RGB images, a 0.30 m horizontal baseline, identical OpenGL camera orientations and known intrinsics. Two additional camera images are held out. An independent ray/surface renderer produces a textured tilted backdrop, a nearer occluder and a textureless region. Images and camera calibration are estimator inputs; surface definitions, depth maps and held-out images are evaluator-only inputs. All data is synthetic and self-authored under the repository MIT license.

The estimator performs local RGB block matching along epipolar rows with subpixel disparity refinement and a reverse consistency check. A five-pixel patch, disparities 4–28 pixels, minimum texture variance 24, maximum mean absolute RGB error 18, best/second cost ratio 0.8 (excluding immediate disparity neighbours), and reverse tolerance 1 pixel are frozen in `STEREO_SETTINGS`. Reject unsupported camera configurations rather than pretending they were rectified. Preserve an outcome for every reference pixel; reject textureless, ambiguous, inconsistent, border and poor matches without filling holes.

Depth is `fx × baseline / disparity`; points are back-projected from pixel centres in the supplied metric frame. Colours come from the reference image. Export small surface Gaussians derived from those reconstructed points, with declared heuristic covariances. This is a stereo-derived splat baseline, not the optimization method in the 3D Gaussian Splatting paper.

Evaluate accepted depths directly against the withheld reference depth map, with no alignment or rescaling. Report coverage against the entire reference image, depth-error distributions and retained rejection counts. Render the reconstructed points into each held-out camera using a separately implemented depth-buffered surfel preview. Report covered-pixel RGB MAE, full-image RGB MAE (missing pixels are black), PSNR and raster coverage. These scores describe that preview renderer, not Three.js Gaussian rendering. Do not hide missing regions by scoring only successful matches.

Before running the benchmark, freeze these synthetic screening gates: accepted reference fraction ≥ 35%, 90th-percentile absolute axial-depth error ≤ 0.12 m, and for **each** held-out view coverage ≥ 30%, covered RGB MAE ≤ 30/255 and full-image RGB MAE ≤ 65/255. Null/nonfinite metrics fail. These are numerical experiment criteria, not physical confidence or a full SPATIAL-05 pass. Retain failed runs and do not lower criteria to obtain success.

Negative controls must include blank images, a mismatched/corrupted right image and unsupported calibration. The estimator must have no access to truth or held-out views. Exact original image bytes, calibration, settings, splits, reconstruction and evaluation hashes must accompany the result.

Frozen training manifest SHA256: `caeaf104bd0d6e75420045d78179e2af765606eaac5b93f3f24a657c55271c0f`. Separate evaluator manifest SHA256: `da1e6092fc1463b2bb251eb87ebfc9dde178fafeb439520a6baa15ef9058b4aa`. The manifests hash-link all four original P6 images and three little-endian float32 axial-depth maps. The generator has no reconstruction dependency.

## Reproduce and inspect

No additional packages, models, network or GPU are needed. Choose **new** output directories; the tools refuse to overwrite existing results.

```sh
bun run spatial:stereo -- --input packages/test-fixtures/stereo/training/input.json --output local-captures/stereo-run
bun run spatial:stereo:evaluate -- --input packages/test-fixtures/stereo/training/input.json --result local-captures/stereo-run/reconstruction.json --evaluation packages/test-fixtures/stereo/evaluation/evaluation.json --output local-captures/stereo-scores
```

The first command opens only the input manifest and its two hash-linked P6 images. It produces `reconstruction.json` with every pixel outcome, an RGB point-cloud PLY, a standard splat plus visual manifest when points exist, and a separate `runtime.json`. Empty reconstructions retain their outcomes/PLY, without inventing a renderable scene. Deterministic results exclude timing; runtime and minimum decoded attributes are separate cost observations, not peak memory or device performance claims.

The second command binds input/result/evaluation SHA256, settings and calibration before reading evaluator files. It rejects held-out training IDs, images and camera poses. It produces `report.json` and observed/predicted/coverage P6 previews. Exit 0 means the frozen gates pass, 2 means a retained failed evaluation, and 1 means invalid input or I/O failure. Inputs are never modified; filenames are bounded basenames, links cannot escape the manifest directory, and all files have size/count limits. Only identity-oriented, distortion-free, rectified horizontal pinhole pairs are supported; arbitrary calibrated photographs require rectification and a subsequent method.

`bun run spatial:stereo:fixture -- --output <new-directory>` regenerates separate `training/` and `evaluation/` directories. Source images are canonical RGB8 P6 without comments; depth maps are little-endian float32 axial metres, with NaN reserved for missing truth. `input.json` explicitly declares metre/Y-up/OpenGL/identity-rectified conventions. Settings and image/camera hashes belong to that input; evaluator depths and held-out observations live in another manifest that binds its exact input hash. The estimator never imports the scene generator or evaluator.

In **Research Lab → Visual splats → Load stereo reconstruction**, inspect the fixed result, select its training cameras and download its originals/report. Local CLI outputs reopen through the same two-file importer. Points, cameras and heuristic covariances share the input metric asset frame; a supplied synthetic 90° X rotation maps Y-up to the research world's Z-up. The evidence panel appears only for the exact frozen manifest and asset hashes. Its image scores belong to the offline surfel preview, rather than the Gaussian canvas. Imported metadata alone cannot acquire this panel.

## Frozen result and remaining errors

Reconstruction JSON SHA256: `e3801402601ad05fa2c9c830909b3b642e28f2f01dea18021277c39a55868ec5`. Splat SHA256: `232305feb7f48cee4e2598803259a7173e00db04f7050ba9e0bf3b05e038e13c` (14,599 Gaussians / 467,168 bytes). The [bundled report](../apps/web/public/research/stereo/report.json) records the exact sources, settings, thresholds and scores. Reruns check deterministic byte identity, including the bundled manifest and report.

| Measure | Frozen synthetic result |
|---|---|
| Accepted reference pixels | 14,599 / 19,200 (76.04%) |
| Rejections retained | 1,508 border; 1,415 textureless; 1,014 photometric; 293 ambiguous; 371 inconsistent |
| Absolute axial-depth error | Mean 0.02892 m; median 0.01971 m; P90 0.04248 m; **maximum 1.64464 m** |
| Upper held-out view | 82.33% raster coverage; covered MAE 12.84/255; full-image MAE 34.24/255; PSNR 12.53 dB |
| Lower held-out view | 84.99% raster coverage; covered MAE 12.67/255; full-image MAE 31.25/255; PSNR 13.04 dB |

The frozen gates pass, with all accepted depths evaluated. Large outliers and missing regions remain; passing the aggregate criteria does not make each point reliable. A stronger occlusion/outlier diagnostic is the next numerical improvement, evaluated on a new frozen case rather than tuned against these held-out images. Local reconstruction took approximately 51–77 ms in observed Bun runs; this is a small host CPU experiment, not a general throughput benchmark. The 583,960-byte decoded-attribute minimum excludes other CPU/GPU allocations.

Blank inputs, an all-black right-image mismatch, repeated texture, unsupported calibration, bad hashes, leaked training views and overwritten outputs are regression cases. The mismatch control retains an empty result and fails evaluation. Full SPATIAL-05 still needs broader real imagery and view coverage, calibrated/estimated registration against independent geometry, and practical resource evaluation. No acoustic gate changes.

## Method references and limits

[OpenCV's stereo documentation](https://docs.opencv.org/5.0/main_modules/stereo.html) describes block matching, uniqueness filtering, reverse disparity checks and reprojection. The [Middlebury evaluation protocol](https://vision.middlebury.edu/stereo/eval3/MiddEval3-newFeatures.html) motivates reporting both error distributions and failed/occluded support rather than a single attractive result. This implementation is a bounded independent reference, not an OpenCV implementation or a Middlebury benchmark entry.

The first photographic stereo cross-check is now implemented in the separate [Middlebury real-stereo report](SPATIAL_REAL_STEREO.md). Its frozen run failed all three screening gates, so it establishes a retained real-image baseline and does not establish robust reconstruction. Broader real image/camera datasets, estimated registration against independent structure, view-dependent appearance, performance costs and acoustic/fusion ablations remain subsequent gates. ECHO-04/05 remains the next physical acoustic test.
