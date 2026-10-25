import { canvasView, viewRotation, CAMERA_DISTANCE } from '../view.js';
import {
  WebGLRenderer, WebGLRenderTarget, Scene, PerspectiveCamera, Mesh, PlaneGeometry,
  RawShaderMaterial, InstancedBufferGeometry, InstancedBufferAttribute, DynamicDrawUsage,
  Vector2, Vector4, Vector3, GLSL3, NoBlending, CustomBlending, OneFactor,
  OneMinusSrcAlphaFactor, AddEquation, DoubleSide, NearestFilter, LinearFilter, NoColorSpace,
} from 'three';
import { CANVAS_WIDTH as W, CANVAS_HEIGHT as H, VIEWPORT_WIDTH as VW, VIEWPORT_HEIGHT as VH, MAX_BRUSH_SIZE } from '../canvas.js';
import { DEFAULT_RING_WIDTH, layerEffects, paintingStyle } from '../effects.js';
import { prepareShapeClip } from '../geometry.js';
import { CachedGesture, gestureTime, gestureVisible, gestureOpacity } from '../loop.js';
import { layerVariants } from '../layers.js';
import { colorAtTime } from '../color.js';
import { TRAIL_LIFETIME } from '../motion.js';
import { sameGeometry, strokeBounds, StampCursor, LiveStroke } from './stroke.js';
import { stampVertex, stampFragment, layerVertex, normalFragment, analogFragment, screenVertex, copyFragment, presentVertex, presentFragment, blurFragment, effectFragment } from './shaders.js';

const FULL = { x: 0, y: 0, width: W, height: H };
const CAPACITY = 4096;
export function target(width, height, linear = false) {
  const rt = new WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false, minFilter: linear ? LinearFilter : NearestFilter, magFilter: linear ? LinearFilter : NearestFilter });
  rt.texture.colorSpace = NoColorSpace; rt.texture.generateMipmaps = false; return rt;
}
export function material(vertexShader, fragmentShader, uniforms, blending = NoBlending) {
  return new RawShaderMaterial({ glslVersion: GLSL3, vertexShader, fragmentShader, uniforms, blending, depthTest: false, depthWrite: false, toneMapped: false, side: DoubleSide, transparent: blending !== NoBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor, blendEquation: AddEquation });
}
function color(vector, hex) { const value = Number.parseInt(hex.slice(1), 16); vector.set((value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255); }

export class WebGLPaintingRenderer {
  backend = 'webgl2'; items = []; duration = 10000; live = new LiveStroke(); frame = 0; view = canvasView();
  stats = { backend: 'webgl2', frames: 0, stamps: 0, maskPasses: 0, masksCreated: 0, maskBytes: 0, drawCalls: 0, copyPixels: 0, blurPixels: 0, maskRebuilds: 0, cpuPixelUploads: 0 };
  constructor(canvas, { onBackendChange = () => {}, cacheBytes = 96 * 1024 * 1024, volume = false } = {}) {
    this.volume = volume; this.targetWidth = volume ? VW : W; this.targetHeight = volume ? VH : H;
    this.canvas = canvas; this.onBackendChange = onBackendChange; this.cacheBytes = cacheBytes;
    this.renderer = new WebGLRenderer({ canvas, alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1); this.renderer.setSize(VW, VH, false); this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => { throw new Error([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n')); };
    this.quad = new PlaneGeometry(1, 1);
    this.camera = new PerspectiveCamera(2 * Math.atan(VH / (2 * CAMERA_DISTANCE)) * 180 / Math.PI, VW / VH, 1, 20000); this.camera.position.z = CAMERA_DISTANCE;
    this.passScene = new Scene(); this.passMesh = new Mesh(this.quad); this.passMesh.frustumCulled = false; this.passScene.add(this.passMesh);
    this.accumulator = target(this.targetWidth, this.targetHeight);
    this.liveTarget = target(volume ? 1 : W, volume ? 1 : H); // Allocate once at startup, never at Pencil down.
    this.stampGeometry = new InstancedBufferGeometry(); this.stampGeometry.index = this.quad.index; this.stampGeometry.attributes.position = this.quad.attributes.position;
    this.brushData = new Float32Array(CAPACITY * 4); this.appearanceData = new Float32Array(CAPACITY * 3);
    this.stampGeometry.setAttribute('brush', new InstancedBufferAttribute(this.brushData, 4).setUsage(DynamicDrawUsage));
    this.stampGeometry.setAttribute('appearance', new InstancedBufferAttribute(this.appearanceData, 3).setUsage(DynamicDrawUsage));
    this.stampMaterial = material(stampVertex, stampFragment, { targetBounds: { value: new Vector4() }, edgeSize: { value: 5 } });
    this.stampMesh = new Mesh(this.stampGeometry, this.stampMaterial); this.stampMesh.frustumCulled = false;
    this.stampScene = new Scene(); this.stampScene.add(this.stampMesh);
    this.normalMaterial = this.layerMaterial(normalFragment, CustomBlending);
    this.copyMaterial = material(screenVertex, copyFragment, { image: { value: null } });
    this.presentMaterial = material(presentVertex, presentFragment, { image: { value: this.accumulator.texture } });
    this.presentMaterial.depthTest = true; this.presentMaterial.depthWrite = true;
    // The final painting is a normal Three.js scene object. Camera, scene and
    // texture are separate from input/history and available for future 3D use.
    this.scene = new Scene(); this.painting = new Mesh(new PlaneGeometry(W, H), this.presentMaterial); this.painting.matrixAutoUpdate = false; this.painting.renderOrder = -1000; this.scene.add(this.painting); this.setView(this.view);
    this.clearTarget(this.accumulator); this.clearTarget(this.liveTarget);
    this.renderer.compile(this.stampScene, this.camera);
    this.passMesh.material = this.normalMaterial; this.renderer.compile(this.passScene, this.camera);
    this.renderer.compile(this.scene, this.camera);
    this.prepareEffects();
    this.contextLost = false;
    this.lost = event => { event.preventDefault(); this.contextLost = true; this.notify('webgl2-lost'); };
    this.restored = () => {
      this.contextLost = false;
      for (const item of this.items) { item.cursor?.reset(); item.initialized = false; }
      if (this.liveItem) { this.liveItem.cursor?.reset(); this.liveItem.initialized = false; }
      this.notify('webgl2');
    };
    canvas.addEventListener('webglcontextlost', this.lost); canvas.addEventListener('webglcontextrestored', this.restored);
    this.notify('webgl2');
  }
  notify(backend) { this.canvas.dataset.renderer = backend; this.onBackendChange(backend); }
  layerMaterial(fragment, blending) {
    return material(layerVertex, fragment, {
      bounds: { value: new Vector4() }, maskBounds: { value: new Vector4() }, resolution: { value: new Vector2(W, H) }, maskTexture: { value: null },
      fillColor: { value: new Vector3(1, 1, 1) },
      sourceTime: { value: 0 }, layerOpacity: { value: 1 }, trail: { value: 0 },
      directShape: { value: 0 }, directBrush: { value: new Vector4() }, directAngle: { value: 0 }, edgeSize: { value: 5 },
      image: { value: null }, belowTexture: { value: null }, mixAmount: { value: .5 },
    }, blending);
  }
  setView(view) {
    if (this.viewSource === view) return; this.viewSource = view;
    this.view = canvasView(view);
    const r = viewRotation(this.view), { scale, x, y } = this.view;
    this.painting.matrix.set(r[0], -r[1], r[2], 0, -r[3], r[4], -r[5], 0, r[6], -r[7], r[8], 0, 0, 0, 0, 1);
    this.painting.matrixWorldNeedsUpdate = true;
    this.camera.zoom = scale;
    this.camera.setViewOffset(VW, VH, VW / 2 - x - W * scale / 2, VH / 2 - y - H * scale / 2, VW, VH);
    this.camera.updateProjectionMatrix();
  }
  setProject(project) {
    if (project.settings?.view) this.setView(project.settings.view);
    this.duration = project.duration;
    const old = new Map(this.items.map(item => [item.clip.id, item]));
    this.items = project.clips.flatMap(layerVariants).map(paintingStyle).map(source => {
      let item = old.get(source.id); old.delete(source.id);
      if (!item || !sameGeometry(item.source, source)) {
        if (item) this.release(item);
        const clip = prepareShapeClip(source), moving = clip.mode === 'move' || clip.mode === 'place';
        item = { source, clip, bounds: strokeBounds(clip), moving, cursor: moving ? null : new StampCursor(clip.samples), gesture: moving ? new CachedGesture(clip) : null, initialized: false, target: null, lastUsed: -1 };
      } else { item.clip = { ...source, samples: item.clip.samples }; if (item.gesture) item.gesture.clip = item.clip; }
      item.source = source; return item;
    });
    for (const item of old.values()) this.release(item);
  }
  release(item) {
    if (item.target && item.target !== this.liveTarget) { this.stats.maskBytes -= item.target.width * item.target.height * 4; item.target.dispose(); }
    item.target = null; item.initialized = false; item.cursor?.reset();
  }
  clearTarget(rt) { rt.scissorTest = false; this.renderer.setRenderTarget(rt); this.renderer.setClearColor(0, 0); this.renderer.clear(true, false, false); }
  pass(shader, rt, bounds = FULL) {
    // Scissors use bottom-left target pixels, while painting bounds use top-left
    // world pixels. Round outward so quarter-resolution blur keeps its halo.
    const x = Math.max(0, Math.floor(bounds.x * rt.width / W)), y = Math.max(0, Math.floor(bounds.y * rt.height / H));
    const right = Math.min(rt.width, Math.ceil((bounds.x + bounds.width) * rt.width / W)), bottom = Math.min(rt.height, Math.ceil((bounds.y + bounds.height) * rt.height / H));
    const width = Math.max(0, right - x), height = Math.max(0, bottom - y);
    if (!width || !height) return;
    rt.scissor.set(x, rt.height - bottom, width, height); rt.scissorTest = true;
    this.passMesh.material = shader; this.renderer.setRenderTarget(rt); this.renderer.render(this.passScene, this.camera); rt.scissorTest = false;
    if (shader === this.copyMaterial) this.stats.copyPixels += width * height;
    if (shader === this.blurMaterial) this.stats.blurPixels += width * height;
  }
  setLiveStroke(stroke, now, move) { this.live.setLocal(stroke, now, move); }
  receiveLive(packet, now) { this.live.update(packet, now); }
  ensureMask(item) {
    if (!item.target) {
      item.target = target(item.bounds.width, item.bounds.height); this.stats.masksCreated++;
      this.stats.maskBytes += item.bounds.width * item.bounds.height * 4;
    }
  }
  paintMask(item, until, head = null, visibleTime = until) {
    this.ensureMask(item);
    if (!item.initialized || until < item.cursor.time) { this.clearTarget(item.target); item.cursor.reset(item.clip.mode === 'trail' ? Math.max(0, Math.min(until, visibleTime - TRAIL_LIFETIME)) : 0); item.initialized = true; this.stats.maskRebuilds++; }
    if (until === item.cursor.time && !head) return;
    const b = item.bounds, shader = this.stampMaterial;
    shader.uniforms.targetBounds.value.set(b.x, b.y, b.width, b.height); shader.uniforms.edgeSize.value = item.clip.ringWidth ?? DEFAULT_RING_WIDTH;
    let count = 0;
    const flush = () => {
      if (!count) return;
      this.stampGeometry.instanceCount = count;
      for (const key of ['brush', 'appearance']) { const attr = this.stampGeometry.attributes[key]; attr.clearUpdateRanges(); attr.addUpdateRange(0, count * attr.itemSize); attr.needsUpdate = true; }
      this.renderer.setRenderTarget(item.target); this.renderer.render(this.stampScene, this.camera);
      this.stats.stamps += count; this.stats.maskPasses++; count = 0;
    };
    const add = (point, time) => {
      const rect = ['rect', 'rect-ring'].includes(point.shape), size = Math.max(1, Math.min(MAX_BRUSH_SIZE, Math.round(point.size)));
      this.brushData.set([point.x, point.y, rect ? Math.max(1, Math.min(MAX_BRUSH_SIZE, point.width ?? size)) : size, rect ? Math.max(1, Math.min(MAX_BRUSH_SIZE, point.height ?? size)) : size], count * 4);
      this.appearanceData.set([(point.angle ?? 0) * Math.PI / 180, rect ? (point.shape === 'rect-ring' ? 3 : 1) : point.shape === 'ring' ? 2 : 0, time], count * 3);
      if (++count === CAPACITY) flush();
    };
    item.cursor.advance(until, add);
    if (head) add(head.point, head.time);
    flush();
  }
  prepareLayer(shader, item, time, opacity, visual) {
    const clip = item.clip, u = shader.uniforms;
    let b = item.paintBounds ?? item.bounds;
    if (visual) {
      const rect = ['rect', 'rect-ring'].includes(visual.shape), size = Math.max(1, Math.round(visual.size));
      const w = rect ? visual.width ?? size : size, h = rect ? visual.height ?? size : size;
      const radius = (rect ? Math.hypot(w, h) : size) / 2 + 2;
      b = { x: Math.floor(visual.x - radius), y: Math.floor(visual.y - radius), width: Math.ceil(radius * 2 + 2), height: Math.ceil(radius * 2 + 2) };
      u.directShape.value = rect ? (visual.shape === 'rect-ring' ? 4 : 2) : visual.shape === 'ring' ? 3 : 1;
      u.directBrush.value.set(Math.round(visual.x), Math.round(visual.y), w, h);
      u.directAngle.value = (visual.angle ?? 0) * Math.PI / 180;
    } else u.directShape.value = 0;
    u.bounds.value.set(b.x, b.y, b.width, b.height); u.maskTexture.value = item.target?.texture ?? this.liveTarget.texture;
    const mask = item.bounds; u.maskBounds.value.set(mask.x, mask.y, mask.width, mask.height);
    u.sourceTime.value = time; u.layerOpacity.value = opacity * (clip.opacity ?? 1); u.trail.value = clip.mode === 'trail' ? 1 : 0;
    u.edgeSize.value = clip.ringWidth ?? DEFAULT_RING_WIDTH;
    color(u.fillColor.value, colorAtTime(clip, time, visual));
    return b;
  }
  prepareEffects() {
    if (this.effectMaterial) return;
    this.effectMaterial = this.layerMaterial(effectFragment, NoBlending);
    this.effectSource = target(W, H, true);
    this.blurA = target(W / 4, H / 4, true); this.blurB = target(W / 4, H / 4, true);
    this.blurMaterial = material(screenVertex, blurFragment, { image: { value: null }, direction: { value: new Vector2() } });
    for (const rt of [this.effectSource, this.blurA, this.blurB]) this.clearTarget(rt);
    this.passMesh.material = this.effectMaterial; this.renderer.compile(this.passScene, this.camera);
    this.passMesh.material = this.blurMaterial; this.renderer.compile(this.passScene, this.camera);
  }
  compose(item, time, opacity, visual) {
    const clip = item.clip, effects = layerEffects(clip);
    const processed = effects.blur && effects.blurRadius > 0;
    let shader, b;
    if (processed) {
      this.prepareEffects();
      this.clearTarget(this.effectSource);
      b = this.prepareLayer(this.normalMaterial, item, time, opacity, visual);
      this.pass(this.normalMaterial, this.effectSource);
      let image = this.effectSource.texture;
      const pad = effects.blurRadius + 8;
      const affected = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
      if (effects.blur && effects.blurRadius > 0) {
        this.clearTarget(this.blurA);
        this.copyMaterial.uniforms.image.value = image; this.pass(this.copyMaterial, this.blurA, affected);
        this.clearTarget(this.blurB);
        this.blurMaterial.uniforms.image.value = this.blurA.texture; this.blurMaterial.uniforms.direction.value.set(effects.blurRadius / 16 / W, 0); this.pass(this.blurMaterial, this.blurB, affected);
        this.clearTarget(this.blurA);
        this.blurMaterial.uniforms.image.value = this.blurB.texture; this.blurMaterial.uniforms.direction.value.set(0, effects.blurRadius / 16 / H); this.pass(this.blurMaterial, this.blurA, affected);
        image = this.blurA.texture;
      }
      shader = this.effectMaterial;
      const u = shader.uniforms;
      u.bounds.value.set(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
      u.image.value = image;
    } else {
      this.analogMaterial ??= this.layerMaterial(analogFragment, NoBlending);
      shader = this.analogMaterial; this.prepareLayer(shader, item, time, opacity, visual);
    }
    // Both inputs are immutable for this pass. Never sample the render target
    // being written; the same pair is reused by all layers and subsequent frames.
    this.alternate ??= target(W, H);
    // The pair differs only where the previous layer wrote. Synchronize that
    // region, then composite this layer. The first pair starts transparent.
    if (this.pendingBounds) { this.copyMaterial.uniforms.image.value = this.current.texture; this.pass(this.copyMaterial, this.alternate, this.pendingBounds); }
    else this.clearTarget(this.alternate);
    shader.uniforms.belowTexture.value = this.current.texture;
    shader.uniforms.mixAmount.value = (clip.mixAmount ?? 50) / 100;
    this.pass(shader, this.alternate);
    const written = shader.uniforms.bounds.value;
    this.pendingBounds = { x: written.x, y: written.y, width: written.z, height: written.w };
    const old = this.current; this.current = this.alternate; this.alternate = old;
  }
  draw(side, phase, { now = performance.now(), placementPreview = false } = {}) {
    if (this.contextLost) return;
    this.frame++; this.renderer.info.reset(); this.current = this.accumulator; this.pendingBounds = null; this.clearTarget(this.current);
    for (const item of this.items) {
      const clip = item.clip;
      if (!clip.enabled || !clip.targets.includes(side) || !gestureVisible(clip, phase, this.duration)) continue;
      item.lastUsed = this.frame;
      if (clip.mode === 'line' && clip.linePending) { for (const point of clip.samples) this.compose({ ...item, clip: { ...clip, ringWidth: Math.min(clip.ringWidth ?? 5, 12, Math.floor(point.size / 4)) } }, 0, 1, { ...point, shape: 'ring' }); continue; }
      const time = gestureTime(clip, phase, this.duration);
      let visual = null;
      if (item.moving) { visual = item.gesture.render(time); if (visual.active === false) continue; }
      else this.paintMask(item, clip.mode === 'line' ? 1 : Math.min(time, clip.duration), null, time);
      const opacity = (placementPreview && clip.mode === 'place' && time < 1 ? 1 : gestureOpacity(clip, time)) * (visual?.opacity ?? 1);
      this.compose(item, time, opacity, visual);
    }
    const live = this.live;
    if (live.id && live.targets?.includes(side)) {
      if (!this.liveItem || this.liveItem.clip.id !== live.id) {
        const clip = { id: live.id, mode: live.mode, samples: live.samples, color: live.color, opacity: live.opacity, effects: live.effects, ringWidth: live.ringWidth };
        this.liveItem = { clip, bounds: FULL, target: this.liveTarget, cursor: new StampCursor(live.samples), initialized: false, boundedSamples: 0 };
      }
      const item = this.liveItem; item.clip.samples = live.samples; item.cursor.samples = live.samples;
      // The reusable live mask stays 4K, but its visible quad and Blur only
      // cover points received so far. Never scan all old input on each frame.
      if (live.mode === 'trail' || live.mode === 'return') {
        if (live.samples.length < item.boundedSamples) { item.paintBounds = null; item.boundedSamples = 0; }
        const added = live.samples.slice(item.boundedSamples);
        if (added.length) {
          const next = strokeBounds({ samples: added }), old = item.paintBounds;
          if (old) {
            const x = Math.min(old.x, next.x), y = Math.min(old.y, next.y);
            item.paintBounds = { x, y, width: Math.max(old.x + old.width, next.x + next.width) - x, height: Math.max(old.y + old.height, next.y + next.height) - y };
          } else item.paintBounds = next;
          item.boundedSamples = live.samples.length;
        }
      }
      const time = live.time(now);
      if (live.mode === 'move' || live.mode === 'place') this.compose(item, time, 1, live.move ?? live.head);
      else { this.paintMask(item, live.samples.at(-1).t, live.mode === 'trail' ? { point: live.head, time } : null, time); this.compose(item, time, 1); }
    }
    this.accumulator = this.current;
    this.paintingTexture = this.current.texture;
    this.presentMaterial.uniforms.image.value = this.current.texture;
    this.renderer.setRenderTarget(null); this.renderer.setClearColor(0, 1); this.renderer.clear(true, true, false); this.renderer.render(this.scene, this.camera);
    this.stats.frames++; this.stats.drawCalls = this.renderer.info.render.calls;
    // Keep inactive masks warm, but evict the oldest ones when the cache budget
    // is exceeded. Active layers are never evicted/reallocated every frame.
    if (this.stats.maskBytes > this.cacheBytes) {
      const inactive = this.items.filter(item => item.target && item.lastUsed !== this.frame).sort((a, b) => a.lastUsed - b.lastUsed);
      for (const item of inactive) { this.release(item); if (this.stats.maskBytes <= this.cacheBytes) break; }
    }
  }
  // Explicit diagnostics only. Never called during interactive rendering.
  readPixels({ presented = false } = {}) { const pixels = new Uint8Array((presented ? VW * VH : W * H) * 4); if (presented) { const gl = this.renderer.getContext(); gl.readPixels(0, 0, VW, VH, gl.RGBA, gl.UNSIGNED_BYTE, pixels); } else this.renderer.readRenderTargetPixels(this.current, 0, 0, W, H, pixels); return pixels; }
  finish() { this.renderer.getContext().finish(); }
  dispose() {
    for (const item of this.items) this.release(item);
    for (const rt of [this.accumulator, this.alternate, this.liveTarget, this.effectSource, this.blurA, this.blurB]) rt?.dispose();
    for (const m of [this.stampMaterial, this.normalMaterial, this.analogMaterial, this.copyMaterial, this.presentMaterial, this.effectMaterial, this.blurMaterial]) m?.dispose();
    this.quad.dispose(); this.stampGeometry.dispose(); this.painting.geometry.dispose(); this.renderer.dispose();
    this.canvas.removeEventListener('webglcontextlost', this.lost); this.canvas.removeEventListener('webglcontextrestored', this.restored);
  }
}
