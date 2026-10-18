# Calibrated stereo image reference

This experiment prepares SPATIAL-05 with an actual image-to-geometry inverse. It uses a self-authored synthetic stereo pair with supplied metric pinhole cameras. It does not estimate poses, train Gaussian parameters, recover physical scale, validate a real room or establish an acoustic contribution. The existing [visual bundle](SPATIAL_VISUAL_BASELINE.md) remains the output/viewing contract.

## Protocol frozen before evaluation

The reference uses two rectified 160 × 120 RGB images, a 0.30 m horizontal baseline, identical OpenGL camera orientations and known intrinsics. Two additional camera images are held out. An independent ray/surface renderer produces a textured tilted backdrop, a nearer occluder and a textureless region. Images and camera calibration are estimator inputs; surface definitions, depth maps and held-out images are evaluator-only inputs. All data is synthetic and self-authored under the repository MIT license.

The estimator performs local RGB block matching along epipolar rows with subpixel disparity refinement and a reverse consistency check. A five-pixel patch, disparities 4–28 pixels, minimum texture variance 24, maximum mean absolute RGB error 18, best/second cost ratio 0.8 (excluding immediate disparity neighbours), and reverse tolerance 1 pixel are frozen in `STEREO_SETTINGS`. Reject unsupported camera configurations rather than pretending they were rectified. Preserve an outcome for every reference pixel; reject textureless, ambiguous, inconsistent, border and poor matches without filling holes.

Depth is `fx × baseline / disparity`; points are back-projected from pixel centres in the supplied metric frame. Colours come from the reference image. Export small surface Gaussians derived from those reconstructed points, with declared heuristic covariances. This is a stereo-derived splat baseline, not the optimization method in the 3D Gaussian Splatting paper.

Evaluate accepted depths directly against the withheld reference depth map, with no alignment or rescaling. Report coverage against the entire reference image, depth-error distributions and retained rejection counts. Render the reconstructed points into each held-out camera using a separately implemented depth-buffered surfel preview. Report covered-pixel RGB MAE, full-image RGB MAE (missing pixels are black), PSNR and raster coverage. These scores describe that preview renderer, not Three.js Gaussian rendering. Do not hide missing regions by scoring only successful matches.

Before running the benchmark, freeze these synthetic screening gates: accepted reference fraction ≥ 35%, 90th-percentile absolute axial-depth error ≤ 0.12 m, and for **each** held-out view coverage ≥ 30%, covered RGB MAE ≤ 30/255 and full-image RGB MAE ≤ 65/255. Null/nonfinite metrics fail. These are numerical experiment criteria, not physical confidence or a full SPATIAL-05 pass. Retain failed runs and do not lower criteria to obtain success.

Negative controls must include blank images, a mismatched/corrupted right image and unsupported calibration. The estimator must have no access to truth or held-out views. Exact original image bytes, calibration, settings, splits, reconstruction and evaluation hashes must accompany the result.

## Method references and limits

[OpenCV's stereo documentation](https://docs.opencv.org/5.0/main_modules/stereo.html) describes block matching, uniqueness filtering, reverse disparity checks and reprojection. The [Middlebury evaluation protocol](https://vision.middlebury.edu/stereo/eval3/MiddEval3-newFeatures.html) motivates reporting both error distributions and failed/occluded support rather than a single attractive result. This implementation is a bounded independent reference, not an OpenCV implementation or a Middlebury benchmark entry.

Synthetic imagery cannot establish real sensor robustness, independently measured registration or general multi-view reconstruction. Real image/camera datasets, estimated registration against independent structure, view-dependent appearance, performance costs and acoustic/fusion ablations remain subsequent gates. ECHO-04/05 remains the next physical acoustic test.
