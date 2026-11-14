import type { HeightGrid } from '../types';

/** Build a grid by sampling an elevation function. Used by the synthetic sources and by tests. */
export function gridFromFunction(
  cols: number,
  rows: number,
  widthM: number,
  heightM: number,
  elevation: (x: number, y: number) => number,
): HeightGrid {
  const data = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < rows; r++) {
    const y = (r / (rows - 1)) * heightM;
    for (let c = 0; c < cols; c++) {
      const x = (c / (cols - 1)) * widthM;
      const e = elevation(x, y);
      data[r * cols + c] = e;
      if (e < min) min = e;
      if (e > max) max = e;
    }
  }
  return { cols, rows, widthM, heightM, data, minElevM: min, maxElevM: max };
}

/** Bilinear elevation lookup in metres. Coordinates outside the grid are clamped to its edge. */
export function sampleElevation(grid: HeightGrid, x: number, y: number): number {
  const { cols, rows, data } = grid;
  let fx = (x / grid.widthM) * (cols - 1);
  let fy = (y / grid.heightM) * (rows - 1);
  if (fx < 0) fx = 0;
  else if (fx > cols - 1) fx = cols - 1;
  if (fy < 0) fy = 0;
  else if (fy > rows - 1) fy = rows - 1;
  const c0 = Math.min(Math.floor(fx), cols - 2);
  const r0 = Math.min(Math.floor(fy), rows - 2);
  const tx = fx - c0;
  const ty = fy - r0;
  const i = r0 * cols + c0;
  const a = data[i];
  const b = data[i + 1];
  const c = data[i + cols];
  const d = data[i + cols + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function cellSizeM(grid: HeightGrid): number {
  return Math.min(grid.widthM / (grid.cols - 1), grid.heightM / (grid.rows - 1));
}

export function inBounds(grid: HeightGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= grid.widthM && y <= grid.heightM;
}

const cr = (t: number, out: Float64Array) => {
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = (-t3 + 2 * t2 - t) / 2;
  out[1] = (3 * t3 - 5 * t2 + 2) / 2;
  out[2] = (-3 * t3 + 4 * t2 + t) / 2;
  out[3] = (t3 - t2) / 2;
};
const crd = (t: number, out: Float64Array) => {
  const t2 = t * t;
  out[0] = (-3 * t2 + 4 * t - 1) / 2;
  out[1] = (9 * t2 - 10 * t) / 2;
  out[2] = (-9 * t2 + 8 * t + 1) / 2;
  out[3] = (3 * t2 - 2 * t) / 2;
};
const WX = new Float64Array(4);
const WY = new Float64Array(4);
const DX = new Float64Array(4);
const DY = new Float64Array(4);

/**
 * Catmull-Rom bicubic elevation and its slope at (x, y) metres. Passes through every grid sample like
 * bilinear, but with continuous slope, so shading and contours drawn from it have no grid creases.
 * Display use only; the link model keeps bilinear sampling. Returns [z, dz/dx, dz/dy] (metres, m/m).
 */
export function sampleBicubic(grid: HeightGrid, x: number, y: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const { cols, rows, data } = grid;
  const cx = grid.widthM / (cols - 1);
  const cy = grid.heightM / (rows - 1);
  let fx = x / cx;
  let fy = y / cy;
  if (fx < 0) fx = 0;
  else if (fx > cols - 1) fx = cols - 1;
  if (fy < 0) fy = 0;
  else if (fy > rows - 1) fy = rows - 1;
  const c1 = Math.min(Math.floor(fx), cols - 2);
  const r1 = Math.min(Math.floor(fy), rows - 2);
  cr(fx - c1, WX);
  crd(fx - c1, DX);
  cr(fy - r1, WY);
  crd(fy - r1, DY);
  let z = 0;
  let gx = 0;
  let gy = 0;
  for (let j = 0; j < 4; j++) {
    const r = Math.min(rows - 1, Math.max(0, r1 - 1 + j)) * cols;
    let rowZ = 0;
    let rowD = 0;
    for (let i = 0; i < 4; i++) {
      const v = data[r + Math.min(cols - 1, Math.max(0, c1 - 1 + i))];
      rowZ += WX[i] * v;
      rowD += DX[i] * v;
    }
    z += WY[j] * rowZ;
    gx += WY[j] * rowD;
    gy += DY[j] * rowZ;
  }
  out[0] = z;
  out[1] = gx / cx;
  out[2] = gy / cy;
  return out;
}
