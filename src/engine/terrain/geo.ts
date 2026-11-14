/** Spherical geodesy for placing a local metre grid on a body. Angles in degrees at the API. */

const D2R = Math.PI / 180;

export interface GeoPoint {
  lat: number;
  lon: number;
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Local east/north offsets (metres) from a site centre to latitude/longitude, using an azimuthal
 * equidistant mapping on a sphere. Unlike a simple "degrees per metre" scaling this stays valid
 * at the poles. Distortion across a few tens of km is far below the terrain data resolution.
 */
export function localToGeo(centre: GeoPoint, east: number, north: number, radiusM: number): GeoPoint {
  const d = Math.hypot(east, north) / radiusM;
  if (d === 0) return { lat: centre.lat, lon: wrapLon(centre.lon) };
  const az = Math.atan2(east, north);
  const p0 = centre.lat * D2R;
  const sinLat = Math.sin(p0) * Math.cos(d) + Math.cos(p0) * Math.sin(d) * Math.cos(az);
  const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
  const lon = centre.lon * D2R + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(p0), Math.cos(d) - Math.sin(p0) * sinLat);
  return { lat: lat / D2R, lon: wrapLon(lon / D2R) };
}

/** Great-circle distance in metres. */
export function geoDistanceM(a: GeoPoint, b: GeoPoint, radiusM: number): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Web Mercator fractional tile coordinates at a zoom level. */
export function geoToTile(p: GeoPoint, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, p.lat)) * D2R);
  return { x: ((p.lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

/** Elevation in metres from a Terrarium-encoded RGB pixel. */
export function terrariumToMetres(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function formatGeo(p: GeoPoint): string {
  const ns = p.lat >= 0 ? 'N' : 'S';
  const ew = p.lon >= 0 ? 'E' : 'W';
  return `${Math.abs(p.lat).toFixed(3)}°${ns}, ${Math.abs(p.lon).toFixed(3)}°${ew}`;
}

/** Inverse of localToGeo: east/north metres of a point from a site centre (azimuthal equidistant). */
export function geoToLocal(centre: GeoPoint, p: GeoPoint, radiusM: number): { east: number; north: number } {
  const p0 = centre.lat * D2R;
  const p1 = p.lat * D2R;
  const dl = (p.lon - centre.lon) * D2R;
  const cosC = Math.sin(p0) * Math.sin(p1) + Math.cos(p0) * Math.cos(p1) * Math.cos(dl);
  const c = Math.acos(Math.max(-1, Math.min(1, cosC)));
  if (c < 1e-12) return { east: 0, north: 0 };
  const az = Math.atan2(Math.sin(dl) * Math.cos(p1), Math.cos(p0) * Math.sin(p1) - Math.sin(p0) * Math.cos(p1) * Math.cos(dl));
  const d = c * radiusM;
  return { east: d * Math.sin(az), north: d * Math.cos(az) };
}
