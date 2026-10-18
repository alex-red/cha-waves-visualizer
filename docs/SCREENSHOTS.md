# README screenshot notes

The README uses actual application screenshots. Fixtures are authored or synthetic; these images do not show a recovered physical room or AI scene completion. Images are unchanged captures, with the stereo viewer framed as a close-up. No private recordings, pairing sessions or endpoints are included.

| Image | Source and reproduction |
|---|---|
| [Sound cutaway](images/sound-cutaway.png) | Curated from [guided-cutaway.png](../reports/screenshots/guided-cutaway.png), 2560 × 1464. Open **Explore → Sound through a home → Load baseline example**, close Explore, then choose **Cutaway**. The capture sequence is in `apps/web/e2e/scenarios.spec.ts`. |
| [Wi-Fi cutaway](images/wifi-cutaway.jpg) | Captured October 18, 2026 from source revision `d6d7034`, at the browser's 1088 × 674 viewport. Open **Explore → Wi-Fi coverage in a home → Load baseline example**, close Explore, then choose **Cutaway**. Uses the default 2.4 GHz model and WebGPU renderer. |
| [Stereo splats](images/stereo-splats.jpg) | Captured October 18, 2026 from source revision `d6d7034`, 688 × 489 viewer close-up. Open **Research Lab → Visual splats → Load stereo reconstruction**, select **Free orbit**, and frame the viewer with appearance and camera frustums enabled. Uses the explicit `?spatial-webgl=1` WebGL2 path. The bundled [synthetic stereo reference](SPATIAL_IMAGE_REFERENCE.md) retains missing geometry and outliers; calibration is supplied, splats are heuristic and no Gaussian optimization is performed. |
| [Field comparison](images/field-comparison.png) | Curated from [comparison.png](../reports/screenshots/comparison.png), 2560 × 1464. In a fresh default workspace, choose **Save as baseline**, open **Hall door**, then **Compare**. `apps/web/e2e/comparison.spec.ts` checks the common −36 to 0 dB scale and predicted +6.0 dB probe change. The historical capture shows a transient local-save status. |
| [Echo Lab](images/echo-lab.png) | Existing 1280 × 900 capture of **Echo Lab → Virtual scan → Run all five positions**, with the synthetic fixture revealed. This is a simulated rectangle fit, without physical validation. |

The older [plan image](images/workspace.png) remains used by the [case study](CASE_STUDY.md). Research screenshot sessions use a separate local origin; capturing them does not replace the owner's relay or active scan. Scene cameras may be orbited or zoomed for framing without changing the underlying samples, calibration, gates or results.
