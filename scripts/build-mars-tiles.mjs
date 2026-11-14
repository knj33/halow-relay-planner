// Builds Terrarium-encoded XYZ (Web Mercator) elevation tiles for the bundled coarse Mars fallback
// from the NASA PDS MGS MOLA MEGDR 16 px/deg topography grid (public domain):
//   https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img
// The .img is headerless: 2880 lines x 5760 samples of MSB signed 16-bit metres relative to the
// MOLA areoid, line 0 at +90°, sample 0 at 0°E (positive east), pixel-centred.
// Usage: node scripts/build-mars-tiles.mjs <path/to/megt90n000eb.img>
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-mars-tiles.mjs <path/to/megt90n000eb.img>');
  process.exit(2);
}
const outDir = path.resolve('public/mars-terrain');
const MAX_Z = 4;
const T = 256;
const W = 5760;
const H = 2880;

const buf = fs.readFileSync(src);
if (buf.length !== W * H * 2) throw new Error(`expected ${W * H * 2} bytes, got ${buf.length}`);
const dn = new Int16Array(W * H);
for (let i = 0; i < dn.length; i++) dn[i] = buf.readInt16BE(i * 2);
console.log(`source ${W}x${H}`);

// Bilinear sample in metres. Column 0 is lon 0°E, row 0 is lat +90; pixels are cell-centred.
function elevation(latDeg, lonDeg) {
  const fx = ((((lonDeg % 360) + 360) % 360) / 360) * W - 0.5;
  const fy = Math.max(0, Math.min(H - 1, ((90 - latDeg) / 180) * H - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.min(H - 2, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % W) + W) % W;
  const xb = (xa + 1) % W;
  const a = dn[y0 * W + xa];
  const b = dn[y0 * W + xb];
  const c = dn[(y0 + 1) * W + xa];
  const d = dn[(y0 + 1) * W + xb];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

let count = 0;
for (let z = 0; z <= MAX_Z; z++) {
  const n = 2 ** z;
  for (let x = 0; x < n; x++) {
    fs.mkdirSync(path.join(outDir, String(z), String(x)), { recursive: true });
    for (let y = 0; y < n; y++) {
      const png = new PNG({ width: T, height: T, colorType: 2 });
      for (let j = 0; j < T; j++) {
        const my = Math.PI * (1 - (2 * (y + (j + 0.5) / T)) / n);
        const lat = (Math.atan(Math.sinh(my)) * 180) / Math.PI;
        for (let i = 0; i < T; i++) {
          const lon = ((x + (i + 0.5) / T) / n) * 360 - 180;
          const v = Math.round(elevation(lat, lon)) + 32768;
          const k = (j * T + i) * 4;
          png.data[k] = Math.floor(v / 256);
          png.data[k + 1] = Math.floor(v) % 256;
          png.data[k + 2] = 0; // 1 m precision keeps the tiles compressible
          png.data[k + 3] = 255;
        }
      }
      fs.writeFileSync(path.join(outDir, String(z), String(x), `${y}.png`), PNG.sync.write(png, { colorType: 2, deflateLevel: 9 }));
      count++;
    }
  }
}
console.log(`wrote ${count} tiles to ${outDir}`);
