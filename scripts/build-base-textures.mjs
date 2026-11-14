// Builds the bundled low-resolution base maps shown on the globe while the streamed imagery and
// relief tiles arrive. Input must be a global equirectangular image (lon -180..180 left to right,
// lat +90..-90 top to bottom), which is what three.js sphere UVs expect after the horizontal flip
// applied in GlobeView. Needs ImageMagick (`magick`) on PATH.
//
// Usage: node scripts/build-base-textures.mjs <input> <output.jpg> [width=2048]
import { execFileSync } from 'node:child_process';

const [input, output, widthArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/build-base-textures.mjs <input> <output.jpg> [width=2048]');
  process.exit(2);
}
const W = Number(widthArg ?? 2048);
const H = Math.round(W / 2);
execFileSync('magick', [input, '-resize', `${W}x${H}!`, '-depth', '8', '-interlace', 'JPEG', '-quality', '82', output], { stdio: 'inherit' });
console.log(`wrote ${output} (${W}×${H})`);
