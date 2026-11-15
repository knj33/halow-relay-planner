// Recolour a KiCad GLB export by part type (reference-designator prefix of each part node), on a
// green board, so that a dense board reads as dense. Metal (light, unsaturated) faces are kept.
// Usage: node recolor.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

const PART = { R: '#ffd23f', C: '#3fd8ff', L: '#c58cff', FB: '#c58cff', U: '#ff6f91', Q: '#ff6f91', D: '#ff9de2', Y: '#e9f0ff', X: '#e9f0ff' };
const BOARD = '#1f5e2c'; // green solder mask, like a real PCB
const hex = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255) ** 2.2); // sRGB → linear
const cache = new Map();
function material(key, color, emissive) {
  if (cache.has(key)) return cache.get(key);
  const m = doc.createMaterial(key).setBaseColorFactor([...hex(color), 1]).setRoughnessFactor(0.45).setMetallicFactor(0.08);
  // Glow, so even 0603 parts (1.6 × 0.8 mm) show as bright specks at slide scale.
  if (emissive) m.setEmissiveFactor(hex(color).map((v) => v * 0.55));
  cache.set(key, m);
  return m;
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sat = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);

let parts = 0;
let board = 0;
function visit(node, prefix) {
  const m = /^([A-Z]{1,3})\d+$/.exec(node.getName());
  if (m) prefix = m[1];
  const mesh = node.getMesh();
  if (mesh) {
    for (const p of mesh.listPrimitives()) {
      const c = p.getMaterial()?.getBaseColorFactor() ?? [1, 1, 1, 1];
      if (prefix) {
        const tint = PART[prefix];
        if (!tint || (lum(c) > 0.18 && sat(c) < 0.12)) continue; // keep metal; linear-space thresholds
        p.setMaterial(material(`part-${prefix}`, tint, true));
        parts++;
      } else if (lum(c) < 0.8) {
        p.setMaterial(material('board', BOARD, false)); // body + mask dark; white silkscreen kept
        board++;
      }
    }
  }
  for (const ch of node.listChildren()) visit(ch, prefix);
}
for (const scene of root.listScenes()) for (const n of scene.listChildren()) visit(n, null);
await io.write(out, doc);
console.log(`recoloured ${parts} part primitives, ${board} board primitives -> ${out}`);
