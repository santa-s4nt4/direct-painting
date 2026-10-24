// A shared layer keeps one stack position. Eye overrides contain only differences
// from the shared settings, so BOTH edits can preserve unrelated eye adjustments.
export const EYE_FIELDS = ['mode', 'procedural', 'blendMode', 'mixAmount', 'trimIn', 'trimOut', 'edgeColor', 'edgeWidth', 'color', 'colorBase', 'colorLightness', 'colorEditMode', 'colorGradient', 'fireworkColorTo', 'enabled', 'samples', 'duration', 'start', 'fadeMs', 'fadeInMs', 'holdMs', 'fadeOutMs', 'shape', 'ringWidth', 'effects', 'angle', 'followDirection', 'sizeRange', 'diameterRange', 'widthRange', 'heightRange'];
function baseLayer(clip) { const { eyeOverrides, editScope, ...base } = clip; return base; }
export function resolveLayer(clip, side) { return { ...baseLayer(clip), ...(clip.eyeOverrides?.[side] ?? {}), targets: [side] }; }
export function layerVariants(clip) {
  if (!clip.eyeOverrides || !Object.keys(clip.eyeOverrides).length) return [clip];
  return clip.targets.map(side => ({ ...resolveLayer(clip, side), id: `${clip.id}::${side}` }));
}
function difference(value, base) {
  const patch = {};
  for (const key of EYE_FIELDS) if (JSON.stringify(value[key]) !== JSON.stringify(base[key]) && value[key] !== undefined) patch[key] = value[key];
  return patch;
}
export function editLayer(clip, scope, edit) {
  if (scope !== 'all') {
    const side = Number(scope);
    if (!clip.targets.includes(side)) return clip;
    const patch = difference(edit(resolveLayer(clip, side)), baseLayer(clip));
    const eyeOverrides = { ...clip.eyeOverrides, [side]: patch };
    if (!Object.keys(patch).length) delete eyeOverrides[side];
    return { ...clip, eyeOverrides };
  }
  const base = edit(baseLayer(clip)), eyeOverrides = {};
  for (const side of clip.targets) {
    if (clip.eyeOverrides?.[side]) {
      const patch = difference(edit(resolveLayer(clip, side)), base);
      if (Object.keys(patch).length) eyeOverrides[side] = patch;
    }
  }
  return { ...base, id: clip.id, targets: clip.targets, ...(clip.editScope ? { editScope: clip.editScope } : {}), ...(Object.keys(eyeOverrides).length ? { eyeOverrides } : {}) };
}
export function removeLayerSides(clip, sides) {
  const targets = clip.targets.filter(side => !sides.includes(side));
  if (targets.length === 1) return { ...resolveLayer(clip, targets[0]), editScope: 'all' };
  const eyeOverrides = Object.fromEntries(Object.entries(clip.eyeOverrides ?? {}).filter(([side]) => targets.includes(Number(side))));
  return { ...clip, targets, eyeOverrides, editScope: 'all' };
}
export function moveLayer(clips, id, direction) {
  const index = clips.findIndex(clip => clip.id === id), to = index + direction;
  if (index < 0 || to < 0 || to >= clips.length) return clips;
  const result = clips.slice(); [result[index], result[to]] = [result[to], result[index]]; return result;
}
