// Builds Terrarium-encoded XYZ (Web Mercator) elevation tiles for the Moon globe from the
// NASA SVS "CGI Moon Kit" LOLA displacement map (ldem_16_uint.tif, 16 px/deg, public domain):
//   https://svs.gsfc.nasa.gov/4720
// DN is unsigned half-metres with 20000 = the 1737.4 km reference radius.
// Usage: node scripts/build-moon-tiles.mjs <path/to/ldem_16_uint.tif>
import fs from 'node:fs';
import path from 'node:path';
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';

const src = process.argv[2];
const outDir = path.resolve('public/moon-terrain');
const MAX_Z = 4;
const T = 256;

const tiff = await fromFile(src);
const img = await tiff.getImage();
const W = img.getWidth();
const H = img.getHeight();
const [dn] = await img.readRasters();
console.log(`source ${W}x${H}`);

// Bilinear sample in metres. Column 0 is lon -180, row 0 is lat +90; pixels are cell-centred.
function elevation(latDeg, lonDeg) {
  const fx = ((lonDeg + 180) / 360) * W - 0.5;
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
  return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty - 20000) / 2;
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
