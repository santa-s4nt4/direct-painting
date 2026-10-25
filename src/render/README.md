# Browser rendering

`createPaintingRenderer(canvas)` shares the editor/output interface: `setProject`, `setLiveStroke` / `receiveLive`, `setView`, `draw`, and `dispose`. The default is `VolumePaintingRenderer` using Three.js WebGL2; `CPUVolumeRenderer` is the fallback. `RGBAScene` and the old `WebGLPaintingRenderer` remain deterministic compatibility references. Interactive rendering does not read GPU pixels back to CPU.

## Spatial strokes

The world box is 3840×3480×3480, centered at the origin with Y down. Source coordinates keep their legacy 3840×2160 origin so saved artwork is unchanged. A recorded orthonormal 3×3 `plane` maps a source point relative to (1920,1080,0) into world coordinates. New strokes use the inverse view rotation, making the working plane face the camera. Saved planes do not change when the view rotates. `points3D` connects two recorded endpoints for Line; its ribbon faces the current camera, with a round end cap even when aligned to the view direction. This is a collection of spatial planar primitives, not a voxel renderer.

Both presentation and accumulation targets are 1920×1080. The default view shows the central Full HD region at 100%. Zoom is 50–500%; pan covers the box height, and roll/pitch/yaw wrap through a full rotation. The same functions transform input, GPU geometry, CPU projected polygons, box clipping and the editor wireframe. See `src/space.js` and `src/view.js`.

## GPU passes

Move circles, rectangles, outline variants and completed Lines use analytic quads with per-stroke plane transforms. They do not allocate a raster mask per saved layer. A live Move target is 1×1; actual live geometry is analytic as well. Legacy Trail/Return data retains incremental cached mask rendering for compatible playback.

Jobs are sorted by center depth and clipped against the box. Each isolated shape is composited with the official Spectral.js Analog pigment shader and premultiplied alpha. There is no separate edge color. Blur is the only effect, defaults to 16px ON, and can be toggled on each layer or set on the Draw brush. Shared quarter-resolution Gaussian scratch targets are reused across layers. Retired glitch/chromatic settings are ignored on import.

A pending Line creates cached Move Ring gestures only for its first-cycle markers. It uses exactly the same easing, pressure-derived size, ring stroke, visibility and release opacity as a normal Circle Ring. On completion and next-cycle handoff those marker caches are dropped; the saved source data remains available for JSON/Undo.

The CPU fallback clips projected vector polygons and applies the existing alpha-aware blur and Spectral mixer. Legacy bitmap strokes use inverse plane homography. GPU context restoration recreates resources from source clips.

## Timing and verification

The application transport is fixed at 16 seconds (120 BPM, 4/4, eight bars) and rendering is scheduled on the 60Hz frame grid. The reusable legacy clock and source renderers still accept arbitrary durations for compatibility tests.

- `npm test`: geometry, project migration, shader-independent math, timing, live transport, MIDI, editing and reference rendering.
- `/benchmarks/volume.html`: current spatial renderer, exact Ring equivalence, rotated input, 3D Line, fallback, and ten active spatial layers.
- `/benchmarks/render.html`: legacy GPU versus CPU reference, pigment mixing, Blur, view bounds, cache behavior, context recovery and fallback.
- `npm run test:midi`: actual CoreMIDI virtual-source → host relay integration on macOS.

The current spatial benchmark ([JSON](../../artifacts/volume-render-checks.json)) measured ten 1600px rectangle-ring layers, all visible with Blur16, at mean2.10ms/p95 4.00ms on this Mac Chrome. No saved masks or CPU pixel uploads were created. These are draw timings, not iPad hardware or end-to-end input latency guarantees. See [3D box notes](../../docs/box-canvas.md) and [MIDI transport](../../docs/midi-sync.md).
