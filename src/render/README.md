# Browser rendering

`createPaintingRenderer(canvas)` supplies the shared editor/output interface:
`setProject`, `setLiveStroke` / `receiveLive`, `draw`, and `dispose`.

The default backend is Three.js `WebGLRenderer` (WebGL2). `CPUPaintingRenderer`
keeps the previous rendering path for devices without a working WebGL2 context.
The deterministic `RGBAScene` remains a test reference;
interactive rendering never reads GPU pixels back into CPU memory.

## Painting surface and viewport

The painting coordinate system and raster targets are 3840×2160 (UHD). The
editor and `/output` canvases remain 1920×1080. At the default view (scale 1,
offset -960,-540), the center Full HD region is displayed at original size.
Scale 0.5 fits the entire painting from the front and is the minimum; scale 5
is the maximum zoom. Pan bounds use the unrotated 4K extent. Unversioned UHD top-left defaults migrate once; versioned pans persist.

A PerspectiveCamera presents the UHD plane using shared roll/pitch/yaw.
Input coordinates map through the inverse plane homography;
GPU masks, color compositing, CPU fallback and saved coordinates use UHD bounds.
Old Full HD project cameras are migrated into the new limits without modifying
recorded positions, diameters or timing. View relay updates use the same bounds.

## GPU passes

1. `StampCursor` advances through new source samples only. Instanced quads stamp
   shape coverage and relative visit time into a cropped RGBA8
   render target. Each texel records the latest visit, so overlapping marks do
   not build up alpha and held Trail heads stay bright.
2. Every layer uses Analog pigment mixing with the official Spectral.js GLSL
   port and two alternating accumulation targets. Transparent pixels are not
   treated as black pigment. There is no independent edge color.
3. Enabled effects render the isolated layer into a shared premultiplied RGBA
   target. Blur uses quarter-resolution separable Gaussian passes. Scratch targets are
   warmed once and reused across layers. Effects do not invalidate stroke masks.
4. Blur is the only effect and defaults to 16px ON. Retired glitch and chromatic
   parameters are ignored on import. CPU
   fallback has an alpha-aware three-box approximation without Canvas2D.filter.
5. The composited painting texture is presented by an ordinary Three.js plane.
   The perspective camera applies zoom/pan and the plane applies its 3D rotation;
   masks and source coordinates remain unchanged. Small /api/view messages synchronize pinches
   through SSE without resending the project every animation frame.

The live mask is allocated/warmed once on startup. Existing cached masks stay on
GPU across strokes, loops, color/timing/visibility changes and layer reordering.
Only source geometry or ring-width changes invalidate a layer mask. Unused
masks are evicted above a 96 MiB cache budget; currently active masks are retained
so a dense visible scene cannot cause repeated eviction/reallocation each frame.
GPU context restoration rebuilds masks from original samples. Trail rebuilds skip
source segments older than the 1800ms visible window. Source data is retained.

Accumulation targets differ only in the last composited region, so only that
region is copied before the next layer. Quarter-resolution Blur passes use an
outward-rounded scissor over the brush bounds plus its halo, with cleared scratch
targets. Live masks stay full size but maintain incremental painting bounds.
`maskBounds` stays separate from the visible quad so cropping never stretches UVs.
Large full-canvas marks still consume full-canvas fill and mask memory.

## 3D plane, tools and future meshes

The final painting is a UHD PlaneGeometry, with a PerspectiveCamera and a shared
Rz(roll) Rx(pitch) Ry(yaw) rotation. The same projection is inverted for Pencil
input. The orientation cube controls pitch/yaw, two-finger twists control roll,
and the view relay/JSON carry all three angles. Tilt is limited to ±75 degrees
to keep the drawing plane invertible; zoom is 50–500%. The CPU backend uses the
same inverse projective transform. Presentation supports depth testing/writing.
The paint itself is still planar; volumetric brushes/extrusion are future work.

New tools are Move and Line. Saved Trail/Return/Place/p5 layers retain compatibility
rendering. Rectangle outlines use a separate footprint flag throughout CPU,
instanced stamps, direct moving shapes and live relay. Angle presets are UI
shortcuts; source angles remain editable numbers.

Line clips retain two source endpoints at t=0, with the first contact's loop phase
as start. Pending lines render endpoint rings; released lines stamp the entire
segment on their first visible frame. The shared LineSchedule handles pause,
seek, duration and START edits. The relay advances the gate and broadcasts/persists
release even if the editor sleeps; stale first-cycle snapshots cannot reopen it.

Input/history/project serialization remain separate from Three.js. `scene`,
`camera`, `painting` and `paintingTexture` remain available for future meshes.

## Verification

`/benchmarks/render.html` runs browser pixel comparisons against `RGBAScene`,
3D plane/input consistency, rectangle outlines, first-cycle and released lines,
a legacy 10-layer UHD CPU/GPU benchmark with a Full HD viewport, a first-live-point measurement, resource
reuse checks, delayed live-packet checks, context-loss restoration and CPU
fallback. `finish()` and `readPixels()` exist only for these explicit checks;
they are never used by editor/output animation.

The benchmark reports wall-clock render time with a GPU synchronization in the
GPU measurement. It does not measure total browser UI latency or guarantee a
particular device's frame rate. Save the page's JSON report with the test's
browser/OS details when comparing changes.

`/benchmarks/trail.html` is retained for legacy testing (no editor UI link). It measures device-specific layer counts, cold masks, warm
playback, live painting, seeks, loop reentry/eviction and a 60-second Trail. It
does not access editor storage or the relay. See
[measurements and iPad estimates](../../docs/trail-performance.md).

Three.js APIs: https://threejs.org/docs/pages/WebGLRenderer
and https://threejs.org/docs/pages/PerspectiveCamera.html
