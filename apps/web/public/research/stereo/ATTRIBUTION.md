# Synthetic calibrated stereo reference

Self-authored by Cha Waves; MIT, the repository license. No photographs or external scene data.

The two training P6 images, two held-out images, calibrated cameras, evaluator-only depth maps and deterministic generator are in `packages/test-fixtures/stereo/` and `packages/test-fixtures/stereo-scene.ts`. Follow `docs/SPATIAL_IMAGE_REFERENCE.md` to reproduce the reconstruction and report. The image renderer and the image-correspondence estimator are separate implementations.

Training manifest SHA256: `caeaf104bd0d6e75420045d78179e2af765606eaac5b93f3f24a657c55271c0f`.

Evaluation manifest SHA256: `da1e6092fc1463b2bb251eb87ebfc9dde178fafeb439520a6baa15ef9058b4aa`.

Reconstruction result SHA256: `e3801402601ad05fa2c9c830909b3b642e28f2f01dea18021277c39a55868ec5`.

Splat SHA256: `232305feb7f48cee4e2598803259a7173e00db04f7050ba9e0bf3b05e038e13c` (14,599 Gaussians, 467,168 bytes).

The splats use stereo-derived centers and reference-image RGB with heuristic covariance. No Gaussian training or AI generation is performed. Supplied synthetic calibration establishes metric scale; registration was not estimated. Missing support and large errors remain: 76.0% of reference pixels were accepted, 90th-percentile axial-depth error is 0.0425 m, and maximum error is 1.6446 m. The report scores held-out images using a separate fixed surfel preview, not the browser Gaussian renderer. This does not validate physical room mapping or acoustic fusion.
