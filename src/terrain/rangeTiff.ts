import type { EquirectRaster } from '../engine/terrain/real';

/**
 * Minimal reader for large, uncompressed, single-band 16-bit (Big)TIFF mosaics stored one row per
 * strip, read with HTTP range requests. Only the bytes inside the requested window are fetched,
 * one small request per row, instead of whole rows.
 */

async function range(url: string, start: number, length: number): Promise<DataView> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`Range request failed (HTTP ${res.status}).`);
  const buf = await res.arrayBuffer();
  if (res.status === 200 && buf.byteLength > length) throw new Error('Server ignored the range request.');
  return new DataView(buf);
}

interface Header {
  width: number;
  height: number;
  dataOffset: number;
  littleEndian: boolean;
  scale: number;
  noData: number | null;
}

async function readHeader(url: string): Promise<Header> {
  const h = await range(url, 0, 16);
  const le = h.getUint16(0) === 0x4949;
  const big = h.getUint16(2, le) === 43;
  const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, le));
  const ifd = big ? u64(h, 8) : h.getUint32(4, le);
  const entry = big ? 20 : 12;
  const d = await range(url, ifd, (big ? 8 : 2) + entry * 48);
  const count = big ? u64(d, 0) : d.getUint16(0, le);
  const tags = new Map<number, { type: number; n: number; valueAt: number }>();
  for (let i = 0; i < count; i++) {
    const o = (big ? 8 : 2) + i * entry;
    if (o + entry > d.byteLength) break;
    tags.set(d.getUint16(o, le), { type: d.getUint16(o + 2, le), n: big ? u64(d, o + 4) : d.getUint32(o + 4, le), valueAt: o + (big ? 12 : 8) });
  }
  const size: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 16: 8 };
  const scalar = (tag: number): number => {
    const t = tags.get(tag);
    if (!t) throw new Error(`TIFF tag ${tag} missing.`);
    if (t.type === 3) return d.getUint16(t.valueAt, le);
    if (t.type === 4) return d.getUint32(t.valueAt, le);
    if (t.type === 16) return u64(d, t.valueAt);
    throw new Error(`Unsupported TIFF tag type ${t.type}.`);
  };
  const text = async (tag: number): Promise<string | null> => {
    const t = tags.get(tag);
    if (!t) return null;
    const inline = big ? 8 : 4;
    const bytes = t.n * (size[t.type] ?? 1);
    const v = bytes <= inline ? new DataView(d.buffer, t.valueAt, bytes) : await range(url, big ? u64(d, t.valueAt) : d.getUint32(t.valueAt, le), bytes);
    return new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).replace(/\0+$/, '');
  };

  const width = scalar(256);
  const height = scalar(257);
  if (scalar(258) !== 16 || scalar(259) !== 1 || (tags.has(277) && scalar(277) !== 1)) throw new Error('Expected an uncompressed single-band 16-bit TIFF.');
  if (scalar(278) !== 1) throw new Error('Expected one row per strip.');
  const signed = tags.has(339) && scalar(339) === 2;
  if (!signed) throw new Error('Expected signed 16-bit samples.');

  // First strip offset; strips must be contiguous so row y starts at dataOffset + y * width * 2.
  const so = tags.get(273)!;
  const soType = size[so.type];
  const soAt = big ? u64(d, so.valueAt) : d.getUint32(so.valueAt, le);
  const readOff = async (i: number) => {
    const v = await range(url, soAt + i * soType, soType);
    return soType === 8 ? Number(v.getBigUint64(0, le)) : v.getUint32(0, le);
  };
  const [first, last] = await Promise.all([readOff(0), readOff(height - 1)]);
  if (last !== first + (height - 1) * width * 2) throw new Error('TIFF rows are not stored contiguously.');

  const meta = (await text(42112)) ?? '';
  const scale = Number(/role="scale">\s*([-\d.eE]+)/.exec(meta)?.[1] ?? 1);
  const nd = await text(42113);
  return { width, height, dataOffset: first, littleEndian: le, scale, noData: nd ? Number(nd) : null };
}

/** Columns per cached block. One block of one row is one small range request (4 KB). */
const BLOCK = 2048;

/** Open a global simple-cylindrical mosaic whose left edge is at westDeg and top edge at +90°. */
export async function openRangeTiff(url: string, westDeg: number): Promise<EquirectRaster> {
  const hdr = await readHeader(url);
  // Row blocks already downloaded (or in flight), keyed by "row:block". Reused across areas.
  const cache = new Map<string, Promise<Int16Array>>();

  const block = (y: number, b: number): Promise<Int16Array> => {
    const key = `${y}:${b}`;
    let p = cache.get(key);
    if (!p) {
      const x0 = b * BLOCK;
      const w = Math.min(BLOCK, hdr.width - x0);
      p = range(url, hdr.dataOffset + (y * hdr.width + x0) * 2, w * 2).then((v) => {
        const out = new Int16Array(w);
        for (let i = 0; i < w; i++) {
          const s = v.getInt16(i * 2, hdr.littleEndian);
          out[i] = s === hdr.noData ? 0 : s;
        }
        return out;
      });
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    return p;
  };

  return {
    width: hdr.width,
    height: hdr.height,
    westDeg,
    scale: hdr.scale,
    async readRows(rows, x0, x1, onProgress) {
      const b0 = Math.floor(x0 / BLOCK);
      const b1 = Math.floor((x1 - 1) / BLOCK);
      const jobs: { y: number; b: number }[] = [];
      for (const y of rows) for (let b = b0; b <= b1; b++) jobs.push({ y, b });
      const out = new Map<number, Int16Array>();
      for (const y of rows) out.set(y, new Int16Array(x1 - x0));
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const { y, b } = jobs[next++];
          const data = await block(y, b);
          const row = out.get(y)!;
          const from = Math.max(x0, b * BLOCK);
          const to = Math.min(x1, b * BLOCK + data.length);
          for (let x = from; x < to; x++) row[x - x0] = data[x - b * BLOCK];
          onProgress?.(++done, jobs.length);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      return out;
    },
  };
}
