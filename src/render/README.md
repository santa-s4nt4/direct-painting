# Browser rendering

`createPaintingRenderer(canvas)` shares the editor/output interface: `setProject`, `setLiveStroke` / `receiveLive`, `setView`, `draw`, and `dispose`. The default is `VolumePaintingRenderer` using Three.js WebGL2; `CPUVolumeRenderer` is the fallback. `RGBAScene` and the old `WebGLPaintingRenderer` remain deterministic compatibility references. Interactive rendering does not read GPU pixels back to CPU.

## Spatial strokes

The world box is 3840×3480×3480, centered at the origin with Y down. Source coordinates keep their legacy 3840×2160 origin so saved artwork is unchanged. A recorded orthonormal 3×3 `plane` maps a source point relative to (1920,1080,0) into world coordinates. New strokes use the inverse view rotation, making the working plane face the camera. Saved planes do not change when the view rotates. `points3D` connects two recorded endpoints for Line; its ribbon faces the current camera, with a round end cap even when aligned to the view direction. This is a collection of spatial planar primitives, not a voxel renderer.

Both presentation and accumulation targets are 1920×1080. The default view shows the central Full HD region at 100%. Zoom is 50–500%; pan covers the box height, and roll/pitch/yaw wrap through a full rotation. The same functions transform input, GPU geometry, CPU projected polygons, box clipping and the editor wireframe. See `src/space.js` and `src/view.js`.

`camera-view.js` positions the actual PerspectiveCamera around the origin and calls `lookAt(0,0,0)`, including roll through the up vector. The focal length remains 5000 while orbit distance can vary. `space.js` uses the same distance for projection and inverse input. An active stroke retains its input plane while the camera moves. `camera-motion.js` owns normal / MIDI ADSR poses; the server shares timestamped MIDI events with editor/output. Retired rec settings migrate to normal and discard their camera track.

## GPU passes

Move circles, rectangles, outline variants and completed Lines use analytic quads with per-stroke plane transforms. They do not allocate a raster mask per saved layer. A live Move target is 1×1; actual live geometry is analytic as well. Legacy Trail/Return data retains incremental cached mask rendering for compatible playback.

Jobs are sorted by center depth and clipped against the box. Each isolated shape is composited with the official Spectral.js Analog pigment shader and premultiplied alpha. There is no separate edge color. Gaussian Blur defaults OFF (16px). Motion blur defaults ON (100% shutter = one 60Hz frame, adjustable 0–200%). Both can be toggled independently on the Draw brush or each layer. Shared quarter-resolution Gaussian scratch targets are reused across layers. Retired glitch/chromatic settings are ignored on import.

Motion blur integrates 8–32 source-time samples (adaptive to motion) into the same analytic fragment shader, averages premultiplied color/alpha, then composites Analog once per layer. Expanded bounds cover the whole exposure. Translation, pressure-driven size and rectangle rotation use actual recorded geometry, including its easing; saved planes keep 3D projection correct. Stationary geometry bypasses sampling. There are no temporal framebuffer histories or per-layer render targets. The CPU fallback averages projected polygons before optional Gaussian Blur. Live input retains at most 32 displayed-head positions within a short history, cleared on stroke change; output builds the same history from transmitted heads. Scrubbing, loop restart and MIDI reset do not reuse pixels from another time.

Global Camera Motion Blur defaults ON (100% shutter), separately from object Motion blur. `camera-exposure.js` combines object source times with 8–16 camera poses and their inverse plane homographies. The shader evaluates a bounded screen quad, clips samples against the world box, averages once, and composites once. Normal manual movement uses bounded pose history; MIDI poses are evaluated analytically at exposure times. Camera blur needs no extra framebuffer or target per layer. CPU vector shapes average projected polygons; legacy bitmap layers retain normal playback but camera blur for those layers is GPU-only.

Legacy effects without an explicit `motionBlur` flag migrate once to Blur OFF / Motion blur ON, retaining radius. Saves with the new flag retain explicit choices. See `motion-blur.js`, `motion-shader.js`, `effects.js` and the live transport.

A pending Line creates cached Move Ring gestures only for its first-cycle markers. It uses exactly the same easing, pressure-derived size, ring stroke, visibility and release opacity as a normal Circle Ring. On completion and next-cycle handoff those marker caches are dropped; the saved source data remains available for JSON/Undo.

The CPU fallback clips projected vector polygons and applies the existing alpha-aware blur and Spectral mixer. Legacy bitmap strokes use inverse plane homography. GPU context restoration recreates resources from source clips.

## Timing and verification

The application transport is fixed at 16 seconds (120 BPM, 4/4, eight bars) and rendering is scheduled on the 60Hz frame grid. The reusable legacy clock and source renderers still accept arbitrary durations for compatibility tests.

- `npm test`: geometry, project migration, shader-independent math, timing, live transport, MIDI, editing and reference rendering.
- `/benchmarks/volume.html`: current spatial renderer, exact Ring equivalence, rotated input, 3D Line, fallback, and ten active spatial layers.
- `/benchmarks/motion.html`: current temporal-shutter browser checks and ten moving spatial layers (prepared, not run in this environment).
- `npm run test:motion-gpu`: production GLSL pixel comparisons in an offscreen macOS GPU context; it does not validate Three.js/WebGL2 browser integration.
- `/benchmarks/render.html`: legacy GPU versus CPU reference, pigment mixing, Blur, view bounds, cache behavior, context recovery and fallback.
- `npm run test:midi`: actual CoreMIDI virtual-source → host relay integration on macOS.

The earlier, pre-Motion-blur spatial benchmark ([JSON](../../artifacts/volume-render-checks.json)) measured ten 1600px rectangle-ring layers, all visible with Blur16, at mean2.10ms/p95 4.00ms on this Mac Chrome. No saved masks or CPU pixel uploads were created. These are draw timings, not iPad hardware or end-to-end input latency guarantees. See [3D box notes](../../docs/box-canvas.md) and [MIDI transport](../../docs/midi-sync.md).

Current verification: 169 Node tests (including three Happy DOM UI tests), build success, seven native CoreMIDI cases and 17 offscreen shader cases. The eight camera cases have maximum RMS error 0.0334/255, with boundary pixels differing by up to 16/255. Browser automation was unavailable, so actual layout, browser Three.js/WebGL2 integration and iPad performance remain unverified. See [camera behavior and validation](../../docs/camera-motion.md).

Navigation SVGs update only when the view changes. The editor updates transport UI before drawing and schedules its next animation frame first, so a drawing exception cannot cancel subsequent timeline updates. The output frame loop uses the same scheduling order. Camera changes never change the fixed 16-second clock.
