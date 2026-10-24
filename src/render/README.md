# Browser rendering

`createPaintingRenderer(canvas)` supplies the shared editor/output interface:
`setProject`, `setLiveStroke` / `receiveLive`, `draw`, and `dispose`.

The default backend is Three.js `WebGLRenderer` (WebGL2). `CPUPaintingRenderer`
keeps the previous rendering path for devices without a working WebGL2 context.
The deterministic `RGBAScene` remains a test reference;
interactive rendering never reads GPU pixels back into CPU memory.

## GPU passes

1. `StampCursor` advances through new source samples only. Instanced quads stamp
   shape coverage and relative visit time into a cropped RGBA8
   render target. Each texel records the latest visit, so overlapping marks do
   not build up alpha and held Trail heads stay bright.
2. Every layer uses Analog pigment mixing with the official Spectral.js GLSL
   port and two alternating accumulation targets. Transparent pixels are not
   treated as black pigment. There is no independent edge color.
3. Enabled effects render the isolated layer into a shared premultiplied RGBA
   target. Blur uses quarter-resolution separable Gaussian passes; glitch and
   chromatic channel offsets run in the final compositor. Scratch targets are
   warmed once and reused across layers. Effects do not invalidate stroke masks.
4. Effect animation uses source time, so pause, seek and remote output agree.
   Blur defaults to 64px ON; glitch and chromatic aberration default OFF. CPU
   fallback has an alpha-aware three-box approximation without Canvas2D.filter.
5. The composited painting texture is presented by an ordinary Three.js plane.

The live mask is allocated/warmed once on startup. Existing cached masks stay on
GPU across strokes, loops, color/timing/visibility changes and layer reordering.
Only source geometry or ring-width changes invalidate a layer mask. Unused
masks are evicted above a 96 MiB cache budget; currently active masks are retained
so a dense visible scene cannot cause repeated eviction/reallocation each frame.
GPU context restoration rebuilds masks from original samples.

## Future 3D

Input/history/project serialization remain independent of WebGL. The renderer
exposes `scene`, `camera`, `painting` and `paintingTexture`; its presentation
framebuffer includes depth support. A perspective camera, transformed painting
plane or additional Three.js meshes can be added without changing Pencil input,
layer editing, relay or the JSON source format. The current UI remains 2D.
The cropped 2D metadata targets themselves deliberately have no depth buffers.

## Verification

`/benchmarks/render.html` runs browser pixel comparisons against `RGBAScene`,
a 10-layer Full HD CPU/GPU benchmark, a first-live-point measurement, resource
reuse checks, delayed live-packet checks, context-loss restoration and CPU
fallback. `finish()` and `readPixels()` exist only for these explicit checks;
they are never used by editor/output animation.

The benchmark reports wall-clock render time with a GPU synchronization in the
GPU measurement. It does not measure total browser UI latency or guarantee a
particular device's frame rate. Save the page's JSON report with the test's
browser/OS details when comparing changes.

Three.js APIs: https://threejs.org/docs/pages/WebGLRenderer
and https://threejs.org/docs/pages/OrthographicCamera.html
