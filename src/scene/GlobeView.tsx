import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as R3FTiles from '3d-tiles-renderer/r3f';
import * as TilePlugins from '3d-tiles-renderer/plugins';
import { Line } from '@react-three/drei';
import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import {
  BODIES,
  geoToGrid,
  gridToGeo,
  sampleElevation,
  satelliteGeometry,
} from '../engine';
import type {
  BodyId,
  CoverageMap,
  GeoNode,
  HeightGrid,
  NetworkLink,
  PlanningArea,
  Satellite,
  StationBackhaul,
  SurveyLayers,
} from '../engine';
import { buildPaths, buildRasters, drawSurvey } from '../survey/draw';
import type { GeoPoint } from '../engine/terrain/geo';
import { onRoute } from '../links';
import type { FlyTarget } from '../state/store';
import { COVERAGE_COLOR, NODE_COLOR, SAT_COLOR, STATUS_COLOR } from '../theme';

// The library's type declarations trail its runtime exports, so these are bound loosely.
/* eslint-disable @typescript-eslint/no-explicit-any */
const { EastNorthUpFrame, GlobeControls, TilesPlugin, TilesRenderer, TilesRendererContext } = R3FTiles as any;
const { GeneratedSurfacePlugin, TerrariumMeshPlugin, TilesFadePlugin, UpdateOnChangePlugin, XYZTilesOverlay } = TilePlugins as any;

/**
 * Whole-body globe with streamed imagery and real relief, plus the planning overlay for the
 * auto-fitted area. Rendering only: link calculations use the regional elevation grid.
 */

export interface GlobeSource {
  imagery: { url: string; projection: 'EPSG:3857' | 'EPSG:4326'; levels: number };
  terrain: { url: string; maxZoom: number };
  credit: string;
  /** Planning-patch relief (Moon and Mars): which elevation source it shows, for the view badge. */
  reliefLabel: string;
  /** Zoom of the EPSG:4326 imagery tiles sampled to colour the planning patch (the layer's finest level). */
  albedoZoom: number;
  /** Patch colour when no imagery tile is available, and the darker end of the elevation tint. */
  albedoFallback: [number, number, number];
  /** Dashed planning-area outline colour. */
  accent: string;
}

export const GLOBE_SOURCES: Record<BodyId, GlobeSource> = {
  earth: {
    imagery: { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg', projection: 'EPSG:3857', levels: 15 },
    terrain: { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', maxZoom: 13 },
    credit: 'Imagery: Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0, contains modified Copernicus Sentinel data). Elevation: Mapzen Terrain Tiles on AWS (SRTM, GMTED, ETOPO1 and others).',
    reliefLabel: 'streamed relief',
    albedoZoom: 0,
    albedoFallback: [110, 120, 110],
    accent: '#8fd6c2',
  },
  moon: {
    imagery: { url: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg', projection: 'EPSG:4326', levels: 8 },
    // Kept for reference; the lunar globe streams imagery onto a smooth sphere instead (see GlobeView).
    terrain: { url: `${import.meta.env.BASE_URL}moon-terrain/{z}/{x}/{y}.png`, maxZoom: 4 },
    credit:
      'Imagery: LRO WAC global mosaic (NASA/GSFC/Arizona State University) via NASA Moon Trek. Planning elevation: LRO LOLA global DEM, 118 m (USGS Astrogeology / NASA GSFC).',
    reliefLabel: 'LOLA 118 m',
    albedoZoom: 8,
    albedoFallback: [118, 116, 112],
    accent: '#c9c2b8',
  },
  mars: {
    // Viking MDIM 2.1 colour mosaic, 232 m/px, served by NASA Mars Trek as EPSG:4326 tiles, zoom 0–7.
    imagery: { url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg', projection: 'EPSG:4326', levels: 8 },
    // Kept for reference; like the Moon, the Martian globe is imagery on a smooth sphere.
    terrain: { url: `${import.meta.env.BASE_URL}mars-terrain/{z}/{x}/{y}.png`, maxZoom: 4 },
    credit:
      'Imagery: Viking MDIM 2.1 colour mosaic (NASA/JPL/USGS) via NASA Mars Trek. Planning elevation: HRSC + MOLA blended DEM, 200 m (USGS Astrogeology, ESA/DLR/FU Berlin, NASA GSFC).',
    reliefLabel: 'HRSC + MOLA 200 m',
    albedoZoom: 7,
    albedoFallback: [150, 98, 70],
    accent: '#f0b08e',
  },
};

/** Bundled low-resolution base maps, pre-reprojected to equirectangular, shown while tiles stream. */
export const BASE_TEXTURE: Record<BodyId, string> = {
  earth: `${import.meta.env.BASE_URL}base/earth.jpg`,
  moon: `${import.meta.env.BASE_URL}base/moon.jpg`,
  mars: `${import.meta.env.BASE_URL}base/mars.jpg`,
};

/** Sets the reference sphere before the surface is generated. The library defaults to WGS84. */
class BodyRadiusPlugin {
  name = 'BODY_RADIUS_PLUGIN';
  priority = -1000;
  radius: number | null;
  constructor({ radius = null }: { radius?: number | null } = {}) {
    this.radius = radius;
  }
  init(tiles: { ellipsoid: { radius: THREE.Vector3 } }) {
    if (this.radius) tiles.ellipsoid.radius.setScalar(this.radius);
  }
}

function starfield(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, c.width, c.height);
  let seed = 1234567;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 2600; i++) {
    const y = Math.acos(2 * rnd() - 1) / Math.PI;
    const b = rnd();
    ctx.fillStyle = `rgba(${220 + rnd() * 35}, ${225 + rnd() * 30}, 255, ${0.25 + b * b * 0.75})`;
    const r = b > 0.97 ? 1.6 : b > 0.8 ? 1.1 : 0.7;
    ctx.beginPath();
    ctx.arc(rnd() * c.width, y * c.height, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Background() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const t = starfield();
    scene.background = t;
    return () => {
      scene.background = null;
      t.dispose();
    };
  }, [scene]);
  return null;
}

const ATMOSPHERE = {
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV;
    void main() { float rim = pow(clamp(0.78 + dot(vN, vV), 0.0, 1.0), 5.0); gl_FragColor = vec4(0.35, 0.62, 1.0, 1.0) * rim * 0.9; }`,
};

/** The bundled base map: something recognisable before the first imagery tile lands. */
function BaseGlobe({ body, radiusM }: { body: BodyId; radiusM: number }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    const tex = new THREE.TextureLoader().load(BASE_TEXTURE[body], (t) => {
      if (!alive) return;
      t.colorSpace = THREE.SRGBColorSpace;
      // three's sphere UVs run the opposite way round from an equirectangular image.
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.x = -1;
      t.offset.x = 1;
      setTexture(t);
    });
    return () => {
      alive = false;
      tex.dispose();
    };
  }, [body]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return (
    <mesh>
      <sphereGeometry args={[radiusM * 0.9992, 128, 80]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

const LABEL_FONT = "600 26px 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

function makeLabelTexture(text: string, color: string, ring: boolean) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = LABEL_FONT;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  const h = 44;
  canvas.width = w;
  canvas.height = h;
  ctx.font = LABEL_FONT;
  ctx.fillStyle = 'rgba(8, 11, 16, 0.88)';
  ctx.strokeStyle = ring ? '#f5b942' : color;
  ctx.lineWidth = ring ? 5 : 2.5;
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: w / h };
}

/** Constant-screen-size text label drawn in the scene (no DOM overlay). */
function Label({ text, color, position, dim, ring }: { text: string; color: string; position: [number, number, number]; dim?: boolean; ring?: boolean }) {
  const viewportH = useThree((s) => s.size.height);
  const tex = useMemo(() => makeLabelTexture(text, color, !!ring), [text, color, ring]);
  useEffect(() => () => tex.texture.dispose(), [tex]);
  const s = (20 / Math.max(200, viewportH)) * 2 * Math.tan((40 * Math.PI) / 360);
  return (
    <sprite position={position} scale={[s * tex.aspect, s, 1]} center={[0.5, -0.35]} renderOrder={30}>
      <spriteMaterial map={tex.texture} sizeAttenuation={false} depthTest={false} transparent opacity={dim ? 0.55 : 1} />
    </sprite>
  );
}

export interface GlobeViewProps {
  /**
   * False while the globe is hidden (another view, or a presentation slide covers it): the render
   * loop stops completely. When true it renders on demand, only when the camera, tiles or props change.
   */
  active: boolean;
  body: BodyId;
  area: PlanningArea | null;
  grid: HeightGrid | null;
  nodes: GeoNode[];
  labels: Map<string, string>;
  links: NetworkLink[];
  route: string[];
  criticalIds: string[];
  satellites: Satellite[];
  stations: StationBackhaul[];
  coverage: CoverageMap | null;
  /** Survey layers (channels, contours, steep ground) and the walking route, draped over the planning area. */
  survey?: { layers: SurveyLayers; walk: { x: number; y: number }[] | null } | null;
  /** Vertical exaggeration of the streamed relief. Display only. */
  reliefScale: number;
  selectedId: string | null;
  fly: FlyTarget | null;
  resetSignal: number;
  onSurfaceClick: (lat: number, lon: number) => void;
  onNodeClick: (id: string) => void;
  onCameraCentre: (p: GeoPoint) => void;
  /** Called once when the first surface tile has streamed in. */
  onFirstTiles?: () => void;
}

/** Imagery tiles for the planning patch, cached so moving the area does not refetch the same square. */
const albedoCache = new Map<string, Promise<ImageData | null>>();

function albedoTile(body: BodyId, z: number, x: number, y: number): Promise<ImageData | null> {
  const url = GLOBE_SOURCES[body].imagery.url.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));
  let p = albedoCache.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${BODIES[body].name} imagery tile failed (HTTP ${res.status})`);
      const bmp = await createImageBitmap(await res.blob());
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height);
    })().catch(() => null);
    albedoCache.set(url, p);
  }
  return p;
}

/**
 * An albedo patch for the area, sampled from the same NASA Trek tiles the globe streams (LRO WAC on
 * the Moon, Viking MDIM on Mars). Only a few hundred metres per pixel, so it supplies colour, not
 * detail; the hillshade supplies detail.
 */
async function albedoPatch(body: BodyId, area: PlanningArea): Promise<ImageData | null> {
  const res = 768;
  const R = BODIES[body].radiusM;
  const src = GLOBE_SOURCES[body];
  const { sizeM } = area;
  // Bounding box of the local square; the small rotation is ignored.
  const corners = [
    gridToGeo(area, 0, 0, R),
    gridToGeo(area, sizeM, 0, R),
    gridToGeo(area, 0, sizeM, R),
    gridToGeo(area, sizeM, sizeM, R),
  ];
  const lonW = Math.min(...corners.map((p) => p.lon));
  const lonE = Math.max(...corners.map((p) => p.lon));
  const latS = Math.min(...corners.map((p) => p.lat));
  const latN = Math.max(...corners.map((p) => p.lat));
  const z = src.albedoZoom;
  const tiles = 2 ** z;
  const tx0 = Math.max(0, Math.floor(((lonW + 180) / 360) * tiles));
  const tx1 = Math.min(tiles - 1, Math.floor(((lonE + 180) / 360) * tiles));
  const ty0 = Math.max(0, Math.floor(((90 - latN) / 180) * tiles));
  const ty1 = Math.min(tiles - 1, Math.floor(((90 - latS) / 180) * tiles));
  const loaded = new Map<string, ImageData>();
  const requests: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      requests.push(
        albedoTile(body, z, tx, ty).then((img) => {
          if (img) loaded.set(`${tx}/${ty}`, img);
        }),
      );
    }
  }
  await Promise.all(requests);
  if (loaded.size === 0) return null;

  const canvas = new OffscreenCanvas(res, res);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(res, res);
  const px = 256 * tiles;
  for (let j = 0; j < res; j++) {
    // Row 0 is the south edge, matching the relief texture and mesh UVs.
    const lat = latS + ((j + 0.5) / res) * (latN - latS);
    for (let i = 0; i < res; i++) {
      const lon = lonW + ((i + 0.5) / res) * (lonE - lonW);
      const gx = ((lon + 180) / 360) * px;
      const gy = ((90 - lat) / 180) * px;
      const tx = Math.min(tiles - 1, Math.floor(gx / 256));
      const ty = Math.min(tiles - 1, Math.floor(gy / 256));
      const tile = loaded.get(`${tx}/${ty}`);
      const k = (j * res + i) * 4;
      if (tile) {
        // Bilinear: at 8–20 km this is only a handful of source pixels, and nearest-neighbour blocks.
        const fx = Math.min(255, Math.max(0, gx - tx * 256 - 0.5));
        const fy = Math.min(255, Math.max(0, gy - ty * 256 - 0.5));
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(255, x0 + 1);
        const y1 = Math.min(255, y0 + 1);
        const ax = fx - x0;
        const ay = fy - y0;
        const i00 = (y0 * 256 + x0) * 4;
        const i10 = (y0 * 256 + x1) * 4;
        const i01 = (y1 * 256 + x0) * 4;
        const i11 = (y1 * 256 + x1) * 4;
        for (let c = 0; c < 3; c++) {
          const top = tile.data[i00 + c] * (1 - ax) + tile.data[i10 + c] * ax;
          const bottom = tile.data[i01 + c] * (1 - ax) + tile.data[i11 + c] * ax;
          img.data[k + c] = top * (1 - ay) + bottom * ay;
        }
      } else {
        [img.data[k], img.data[k + 1], img.data[k + 2]] = src.albedoFallback;
      }
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return img;
}

/**
 * Shaded-relief texture for the planning area from its own elevation grid. The global relief for
 * the Moon and Mars stops at 16 px/deg (~1.9 km on the Moon, ~3.7 km on Mars), so at planning zoom
 * the smooth globe is too coarse to read; this draws the much finer planning grid (LOLA 118 m,
 * HRSC + MOLA 200 m) as a hillshade. Display only, but it is the same data the link calculations
 * use, and it is not vertically exaggerated.
 */
function reliefTexture(grid: HeightGrid, albedo: ImageData | null, tint: [number, number, number]): THREE.CanvasTexture {
  const res = 768;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(res, res);
  const span = Math.max(1, grid.maxElevM - grid.minElevM);
  const cell = Math.max(grid.widthM / Math.max(1, grid.cols - 1), grid.heightM / Math.max(1, grid.rows - 1));
  // Sun from the north-west at about 40°, the usual convention for planetary shaded relief.
  const light = new THREE.Vector3(-0.5, 0.5, 0.72).normalize();
  for (let j = 0; j < res; j++) {
    // Canvas row 0 is the south edge: the texture is uploaded with flipY = false to match the mesh UVs.
    const y = ((j + 0.5) / res) * grid.heightM;
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res) * grid.widthM;
      const e = sampleElevation(grid, x, y);
      const gx = (sampleElevation(grid, x + cell, y) - sampleElevation(grid, x - cell, y)) / (2 * cell);
      const gy = (sampleElevation(grid, x, y + cell) - sampleElevation(grid, x, y - cell)) / (2 * cell);
      // Amplify the slope a little: 118–200 m data is subtle at this scale.
      const n = new THREE.Vector3(-gx * 2.2, -gy * 2.2, 1).normalize();
      const shade = Math.max(0.06, Math.min(1.15, 0.5 + (n.dot(light) - 0.72) * 2.2));
      const t = (e - grid.minElevM) / span;
      const k = (j * res + i) * 4;
      // A quiet border so the fine grid reads as an inset against the coarse globe imagery.
      const border = Math.min((i + 0.5) / res, 1 - (i + 0.5) / res, (j + 0.5) / res, 1 - (j + 0.5) / res);
      const rim = border < 0.012 ? 0.82 : 1;
      const lightMul = 0.55 + 0.85 * shade;
      if (albedo) {
        img.data[k] = albedo.data[k] * lightMul * rim;
        img.data[k + 1] = albedo.data[k + 1] * lightMul * rim;
        img.data[k + 2] = albedo.data[k + 2] * lightMul * rim;
      } else {
        img.data[k] = tint[0] * (1 + 0.46 * t) * shade * rim;
        img.data[k + 1] = tint[1] * (1 + 0.46 * t) * shade * rim;
        img.data[k + 2] = tint[2] * (1 + 0.46 * t) * shade * rim;
      }
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The planning grid drawn as a lit, albedo-coloured patch over the smooth Moon or Mars globe. */
function PlanetRelief({
  body,
  grid,
  area,
  size,
  radiusM,
  centreElev,
}: {
  body: BodyId;
  grid: HeightGrid;
  area: PlanningArea;
  size: number;
  radiusM: number;
  centreElev: number;
}) {
  // Sit just above the streamed globe surface; the streamed globe tiles are far coarser here.
  const lift = Math.max(30, size * 0.0004) + 2;
  const [albedo, setAlbedo] = useState<ImageData | null>(null);
  useEffect(() => {
    let alive = true;
    setAlbedo(null);
    albedoPatch(body, area)
      .then((img) => {
        if (alive) setAlbedo(img);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, area.centre.lat, area.centre.lon, area.sizeM]);
  const geometry = useMemo(() => {
    const n = Math.min(256, Math.max(2, grid.cols));
    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * size;
        const y = (j / (n - 1)) * size;
        const e = sampleElevation(grid, x, y);
        const dx = x - size / 2;
        const dy = y - size / 2;
        const drop = (dx * dx + dy * dy) / (2 * radiusM);
        const k = (j * n + i) * 3;
        pos[k] = dx;
        pos[k + 1] = dy;
        pos[k + 2] = e - centreElev - drop + lift;
        const t = (j * n + i) * 2;
        uv[t] = i / (n - 1);
        uv[t + 1] = j / (n - 1);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [grid, size, radiusM, lift]);
  const texture = useMemo(() => reliefTexture(grid, albedo, GLOBE_SOURCES[body].albedoFallback), [grid, albedo, body]);
  // The patch deliberately ignores the coarse globe's depth buffer, so it must discard itself when
  // it is on the far side of the body. Otherwise it would shine through the planet when spinning.
  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ map: texture, depthTest: false, toneMapped: false });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPatchWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvPatchWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPatchWorld;')
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\nif (dot(normalize(vPatchWorld), normalize(cameraPosition - vPatchWorld)) < 0.02) discard;',
        );
    };
    return m;
  }, [texture]);
  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
      material.dispose();
    },
    [geometry, texture, material],
  );
  return <mesh geometry={geometry} material={material} renderOrder={2} />;
}

/**
 * The survey layers (old drainage channels, contours, steep-ground hatching, walking route) drawn into a
 * transparent texture and draped over the planning area, slightly above the relief patch. Every body.
 */
function SurveyOverlay({
  grid,
  survey,
  size,
  radiusM,
  centreElev,
}: {
  grid: HeightGrid;
  survey: NonNullable<GlobeViewProps['survey']>;
  size: number;
  radiusM: number;
  centreElev: number;
}) {
  const lift = Math.max(30, size * 0.0004) + 4;
  const geometry = useMemo(() => {
    const n = Math.min(256, Math.max(2, grid.cols));
    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * size;
        const y = (j / (n - 1)) * size;
        const dx = x - size / 2;
        const dy = y - size / 2;
        const k = (j * n + i) * 3;
        pos[k] = dx;
        pos[k + 1] = dy;
        pos[k + 2] = sampleElevation(grid, x, y) - centreElev - (dx * dx + dy * dy) / (2 * radiusM) + lift;
        uv[(j * n + i) * 2] = i / (n - 1);
        uv[(j * n + i) * 2 + 1] = j / (n - 1);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }, [grid, size, radiusM, centreElev, lift]);

  const rasters = useMemo(() => buildRasters(grid, survey.layers), [grid, survey.layers]);
  const paths = useMemo(() => buildPaths(survey.layers), [survey.layers]);
  const texture = useMemo(() => {
    const res = 1536;
    const canvas = document.createElement('canvas');
    canvas.width = res;
    canvas.height = res;
    const ctx = canvas.getContext('2d')!;
    // North at the top of the canvas; flipY (the default) puts it at v = 1, the north edge of the patch.
    drawSurvey(ctx, grid, rasters, paths, { view: { x0: 0, yTop: grid.heightM, S: res / grid.widthM }, dpr: 1, terrain: false, grain: false, walk: survey.walk, lineScale: 2.6 });
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [grid, rasters, paths, survey.walk]);

  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPatchWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvPatchWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPatchWorld;')
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\nif (dot(normalize(vPatchWorld), normalize(cameraPosition - vPatchWorld)) < 0.02) discard;',
        );
    };
    return m;
  }, [texture]);
  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
      material.dispose();
    },
    [geometry, texture, material],
  );
  return <mesh geometry={geometry} material={material} renderOrder={3} />;
}

/** Everything tied to the fitted planning area: boundary, links, nodes, coverage and backhaul. */
function AreaScene({
  body,
  area,
  grid,
  nodes,
  labels,
  links,
  route,
  criticalIds,
  satellites,
  stations,
  coverage,
  survey,
  selectedId,
  onNodeClick,
}: Pick<
  GlobeViewProps,
  'body' | 'area' | 'grid' | 'nodes' | 'labels' | 'links' | 'route' | 'criticalIds' | 'satellites' | 'stations' | 'coverage' | 'survey' | 'selectedId' | 'onNodeClick'
> & { radiusM: number }) {
  const R = BODIES[body].radiusM;
  const size = area?.sizeM ?? 0;
  const accent = GLOBE_SOURCES[body].accent;

  const centreElev = useMemo(() => {
    if (!grid || !area) return 0;
    return sampleElevation(grid, area.sizeM / 2, area.sizeM / 2);
  }, [grid, area]);

  const { localOf, groundOf } = useMemo(() => {
    const lift = size > 0 ? Math.max(30, size * 0.0004) : 0;
    const localOf = (x: number, y: number): [number, number, number] => {
      const e = x - size / 2;
      const n = y - size / 2;
      const drop = (e * e + n * n) / (2 * R);
      const elev = grid ? sampleElevation(grid, x, y) : centreElev;
      return [e, n, elev - centreElev - drop + lift];
    };
    const groundOf = (x: number, y: number) => (grid ? sampleElevation(grid, x, y) : centreElev);
    return { localOf, groundOf };
  }, [grid, size, R, centreElev]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const gridPos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    if (!area) return m;
    for (const n of nodes) m.set(n.id, geoToGrid(area, n, R));
    return m;
  }, [nodes, area, R]);

  const mast = Math.max(120, size * 0.012);

  const headOf = (id: string): [number, number, number] | null => {
    const p = gridPos.get(id);
    if (!p) return null;
    const g = localOf(p.x, p.y);
    const kind = byId.get(id)?.kind;
    return [g[0], g[1], g[2] + mast * (kind === 'base' ? 1.6 : 1)];
  };

  const satPos = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    if (!area) return m;
    const centre = { x: size / 2, y: size / 2, altM: 0 };
    for (const sat of satellites) {
      const g = satelliteGeometry(R, centre, sat);
      if (g.elevationDeg <= 0) continue;
      const el = (Math.max(10, g.elevationDeg) * Math.PI) / 180;
      const az = (g.azimuthDeg * Math.PI) / 180;
      const d = size * 0.85;
      m.set(sat.id, [Math.sin(az) * Math.cos(el) * d, Math.cos(az) * Math.cos(el) * d, Math.sin(el) * d + size * 0.05]);
    }
    return m;
  }, [satellites, area, R, size]);

  if (!area) return null;

  const boundary = [-1, 1, 1, -1].map((k, i) => {
    const corners: [number, number][] = [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
    ];
    const [x, y] = corners[i];
    const g = localOf(x, y);
    void k;
    return [g[0], g[1], g[2] + mast * 0.05] as [number, number, number];
  });
  boundary.push(boundary[0]);

  const coverageMesh = (() => {
    if (!coverage) return null;
    const n = coverage.res;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const c = new THREE.Color();
    const ramp = [new THREE.Color(COVERAGE_COLOR.none), new THREE.Color(COVERAGE_COLOR.marginal), new THREE.Color(COVERAGE_COLOR.good)];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * size;
        const y = ((j + 0.5) / n) * size;
        const g = localOf(x, y);
        const k = (j * n + i) * 3;
        pos[k] = g[0];
        pos[k + 1] = g[1];
        pos[k + 2] = g[2] + mast * 0.05;
        c.copy(ramp[coverage.cells[j * n + i]]);
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  })();

  return (
    <EastNorthUpFrame lat={(area.centre.lat * Math.PI) / 180} lon={(area.centre.lon * Math.PI) / 180} height={centreElev}>
      {body !== 'earth' && grid && <PlanetRelief body={body} grid={grid} area={area} size={size} radiusM={R} centreElev={centreElev} />}
      {grid && survey && <SurveyOverlay grid={grid} survey={survey} size={size} radiusM={R} centreElev={centreElev} />}
      <Line points={boundary} color={accent} lineWidth={1.5} dashed dashSize={size * 0.012} gapSize={size * 0.008} transparent opacity={0.9} depthTest={false} renderOrder={8} />
      {coverage && coverageMesh && (
        <mesh geometry={coverageMesh} renderOrder={5}>
          <meshBasicMaterial vertexColors transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}

      {links.map((l) => {
        const a = headOf(l.a);
        const b = headOf(l.b);
        if (!a || !b) return null;
        const isRoute = onRoute(l, route);
        const fail = l.result.status === 'fail';
        return (
          <Line
            key={`${l.a}|${l.b}`}
            points={[a, b]}
            color={STATUS_COLOR[l.result.status]}
            lineWidth={isRoute ? 4 : fail ? 1.5 : 2}
            dashed={fail}
            dashSize={size * 0.012}
            gapSize={size * 0.009}
            transparent
            opacity={isRoute ? 1 : fail ? 0.6 : 0.5}
            depthTest={false}
            renderOrder={9}
          />
        );
      })}

      {stations.map((st) => {
        const from = headOf(st.stationId);
        const target = st.chosen && satPos.get(st.chosen.satId);
        if (!from || !target) return null;
        return (
          <Line key={`up-${st.stationId}`} points={[from, target]} color={SAT_COLOR} lineWidth={1.5} dashed dashSize={size * 0.02} gapSize={size * 0.012} transparent opacity={0.8} depthTest={false} renderOrder={9} />
        );
      })}

      {satellites.map((sat) => {
        const pos = satPos.get(sat.id);
        if (!pos) return null;
        const used = stations.some((s) => s.chosen?.satId === sat.id);
        return (
          <group key={sat.id} position={pos}>
            <mesh rotation={[0.4, 0.6, 0]}>
              <octahedronGeometry args={[size * 0.013]} />
              <meshBasicMaterial color={SAT_COLOR} transparent opacity={used ? 1 : 0.4} depthTest={false} />
            </mesh>
            <Label text={sat.name.replace(' (illustrative)', '')} color={SAT_COLOR} position={[0, size * 0.03, 0]} dim={!used} />
          </group>
        );
      })}

      {nodes.map((n) => {
        const p = gridPos.get(n.id);
        if (!p) return null;
        const g = localOf(p.x, p.y);
        const h = mast * (n.kind === 'base' ? 1.6 : 1);
        const selected = selectedId === n.id;
        const color = n.enabled ? NODE_COLOR[n.kind] : '#5d6573';
        const r = Math.max(40, size * (n.kind === 'relay' ? 0.0035 : 0.005));
        return (
          <group
            key={n.id}
            position={g}
            onClick={(e) => {
              if (e.delta > 5) return;
              e.stopPropagation();
              // Keep the globe picker from also placing/moving a node underneath this one.
              e.nativeEvent?.stopImmediatePropagation?.();
              onNodeClick(n.id);
            }}
          >
            <mesh position={[0, h / 2, 0]} renderOrder={3}>
              <cylinderGeometry args={[r * 0.2, r * 0.2, h, 8]} />
              <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[0, h, 0]} renderOrder={3}>
              {n.kind === 'base' ? <coneGeometry args={[r * 1.3, r * 2, 4]} /> : <sphereGeometry args={[r, 18, 12]} />}
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={n.enabled ? 0.5 : 0} transparent opacity={n.enabled ? 1 : 0.55} />
            </mesh>
            {selected && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, size * 0.002, 0]} renderOrder={6}>
                <ringGeometry args={[r * 2, r * 2.7, 32]} />
                <meshBasicMaterial color="#ffffff" depthTest={false} transparent />
              </mesh>
            )}
            <Label
              text={`${labels.get(n.id) ?? ''}${n.enabled ? '' : ' (off)'}`}
              color={NODE_COLOR[n.kind]}
              position={[0, h + r, 0]}
              dim={!n.enabled}
              ring={criticalIds.includes(n.id)}
            />
          </group>
        );
      })}
    </EastNorthUpFrame>
  );
}

interface RigProps {
  radiusM: number;
  fly: FlyTarget | null;
  resetSignal: number;
  onCameraCentre: (p: GeoPoint) => void;
  onFirstTiles?: () => void;
}

/** Camera: globe controls, fly-to animation, reset, and the surface point at the view centre. */
function CameraRig({ radiusM, fly, resetSignal, onCameraCentre, onFirstTiles }: RigProps) {
  const tiles = useContext(TilesRendererContext) as any;
  const { camera, gl } = useThree();
  const invalidate = useThree((st) => st.invalidate);
  const controls = useRef<any>(null);
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; t: number } | null>(null);
  const lastCentre = useRef(0);
  const reported = useRef(false);
  const trailing = useRef(0);

  const start = useMemo(
    () => new THREE.Vector3(radiusM * 3.1, radiusM * 0.9, radiusM * 0.6),
    [radiusM],
  );

  const surfacePoint = (lat: number, lon: number, height: number) => {
    if (!tiles) return null;
    const p = new THREE.Vector3();
    tiles.ellipsoid.getCartographicToPosition((lat * Math.PI) / 180, (lon * Math.PI) / 180, height, p);
    p.applyMatrix4(tiles.group.matrixWorld);
    return p;
  };

  const flyTo = (lat: number, lon: number, heightM: number) => {
    const surface = surfacePoint(lat, lon, 0);
    if (!surface || !tiles) return;
    const normal = surface.clone().normalize();
    const east = new THREE.Vector3(-normal.y, normal.x, 0).normalize();
    // Close enough that a 5–60 km planning area fills the viewport, but never inside the
    // surface tiles (the controls keep a similar minimum distance).
    const dist = Math.max(radiusM * 0.0009, heightM * 1.35);
    const to = surface.clone().addScaledVector(normal, dist).addScaledVector(east, dist * 0.42);
    anim.current = { from: camera.position.clone(), to, target: surface, up: normal.clone(), t: 0 };
    if (controls.current) controls.current.enabled = false;
    invalidate();
  };

  useEffect(() => {
    if (fly) flyTo(fly.lat, fly.lon, fly.heightM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly?.seq]);

  useEffect(() => {
    if (!resetSignal) return;
    anim.current = { from: camera.position.clone(), to: start.clone(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), t: 0 };
    if (controls.current) controls.current.enabled = false;
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);
  useEffect(() => () => window.clearTimeout(trailing.current), []);

  useFrame((_, dt) => {
    const a = anim.current;
    if (a) {
      // The canvas renders on demand: keep asking for frames until the flight lands.
      invalidate();
      a.t = Math.min(1, a.t + Math.min(dt, 0.1) / 1.4);
      const k = a.t * a.t * (3 - 2 * a.t);
      camera.position.lerpVectors(a.from, a.to, k);
      camera.up.copy(a.up);
      camera.lookAt(a.target);
      if (a.t >= 1) {
        anim.current = null;
        camera.up.set(0, 1, 0);
        if (controls.current) {
          controls.current.enabled = true;
          controls.current.update?.();
        }
      }
    }
    if (!tiles) return;
    const now = performance.now();
    if (now - lastCentre.current < 600) {
      // Frames stop when the camera rests, so schedule one more to report where it came to rest.
      window.clearTimeout(trailing.current);
      trailing.current = window.setTimeout(() => invalidate(), 650);
      return;
    }
    lastCentre.current = now;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const local = ray.ray.clone().applyMatrix4(tiles.group.matrixWorld.clone().invert());
    const hit = tiles.ellipsoid.intersectRay(local, new THREE.Vector3());
    if (!hit) return;
    const c = tiles.ellipsoid.getPositionToCartographic(hit, {}) as { lat: number; lon: number };
    onCameraCentre({ lat: THREE.MathUtils.radToDeg(c.lat), lon: THREE.MathUtils.radToDeg(c.lon) });
    if (!reported.current) {
      reported.current = true;
      onFirstTiles?.();
    }
  });

  return <GlobeControls ref={controls} enableDamping minDistance={radiusM * 0.0006} maxDistance={radiusM * 12} />;
}

/** Click-to-place on the globe. Tries the loaded surface first, then the reference sphere. */
function SurfacePicker({ radiusM, onPick, lastNodeClick }: { radiusM: number; onPick: (lat: number, lon: number) => void; lastNodeClick: MutableRefObject<number> }) {
  const tiles = useContext(TilesRendererContext) as any;
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!down || !tiles || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      if (performance.now() - lastNodeClick.current < 400) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);

      let local: THREE.Vector3 | null = null;
      const hits = ray.intersectObjects(tiles.group.children, true);
      for (const h of hits) {
        const obj = h.object as THREE.Mesh;
        if ((obj as any).isSprite || (obj as any).isLine || obj.type === 'Line2') continue;
        local = tiles.group.worldToLocal(h.point.clone());
        break;
      }
      if (!local) {
        const ref = ray.ray.clone().applyMatrix4(tiles.group.matrixWorld.clone().invert());
        local = tiles.ellipsoid.intersectRay(ref, new THREE.Vector3());
      }
      if (!local) return;
      const c = tiles.ellipsoid.getPositionToCartographic(local, {}) as { lat: number; lon: number };
      void radiusM;
      onPick(THREE.MathUtils.radToDeg(c.lat), THREE.MathUtils.radToDeg(c.lon));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, tiles, onPick, radiusM, lastNodeClick]);
  return null;
}

/**
 * Keep streamed tiles instead of evicting them: the library's default LRU cache is sized for low
 * memory use, so zooming back into an area re-downloads it. These limits trade memory for no re-fetch.
 */
function TileCacheBoost() {
  const tiles = useContext(TilesRendererContext) as any;
  useEffect(() => {
    const lru = tiles?.lruCache;
    if (!lru) return;
    lru.minSize = 4000;
    lru.maxSize = 12000;
    if ('minBytesSize' in lru) lru.minBytesSize = 1.0 * 2 ** 30;
    if ('maxBytesSize' in lru) lru.maxBytesSize = 2.0 * 2 ** 30;
    if ('unloadPercent' in lru) lru.unloadPercent = 0.05;
  }, [tiles]);
  return null;
}

/** Draw one frame when the globe becomes visible again (frameloop 'never' → 'demand' alone does not). */
function WakeOnShow({ active }: { active: boolean }) {
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate]);
  return null;
}

/** Memoised: App re-renders often, the globe only needs to when its own inputs change. */
export const GlobeView = memo(GlobeViewImpl);

function GlobeViewImpl(props: GlobeViewProps) {
  const { active, body, area, grid, reliefScale, fly, resetSignal, nodes, labels, links, route, criticalIds, satellites, stations, coverage, selectedId } = props;
  const R = BODIES[body].radiusM;
  // Earth keeps the library's WGS84 ellipsoid; the Moon and Mars use a sphere of the body radius.
  const radiusArgs = useMemo(() => ({ radius: body === 'earth' ? null : R }), [body, R]);
  const src = GLOBE_SOURCES[body];
  const overlay = useMemo(() => new XYZTilesOverlay({ url: src.imagery.url, projection: src.imagery.projection, levels: src.imagery.levels }), [src]);
  const terrainArgs = useMemo(
    () => ({
      url: src.terrain.url,
      maxZoom: src.terrain.maxZoom,
      overlay,
      applyOverlayTexture: true,
      heightScale: reliefScale,
    }),
    // heightScale is updated live below; rebuilding the plugin would reload every tile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [src, overlay],
  );
  // The bundled global relief for the Moon and Mars stops at 16 px/deg, which is too coarse to
  // displace a convincing globe. Stream imagery on a smooth sphere instead; the planning patch
  // carries the fine elevation (LOLA, HRSC + MOLA).
  const sphereSurfaceArgs = useMemo(() => ({ overlay, projection: 'ellipsoid', applyOverlayTexture: true }), [overlay]);

  const lastNodeClick = useRef(0);

  return (
    <Canvas
      key={body}
      camera={{ position: [R * 3.1, R * 0.9, R * 0.6], fov: 40, near: R * 0.0004, far: R * 40 }}
      dpr={[1, 2]}
      frameloop={active ? 'demand' : 'never'}
      style={{ cursor: 'crosshair' }}
      aria-label={`Interactive globe of the ${BODIES[body].name}. Click the surface to place endpoints and relays, drag to spin, scroll to zoom.`}
      role="img"
    >
      <WakeOnShow active={active} />
      <Background />
      <ambientLight intensity={body === 'earth' ? 1.5 : 0.9} />
      <directionalLight position={[R * 5, R * 2.5, R * 3]} intensity={body === 'earth' ? 2.2 : 3.2} />
      <TilesRenderer group={{ rotation: [-Math.PI / 2, 0, 0] }}>
        <TilesPlugin plugin={BodyRadiusPlugin} args={radiusArgs} />
        {body === 'earth' ? (
          <TilesPlugin plugin={TerrariumMeshPlugin} args={terrainArgs} heightScale={reliefScale} />
        ) : (
          <TilesPlugin plugin={GeneratedSurfacePlugin} args={sphereSurfaceArgs} />
        )}
        <TileCacheBoost />
        <TilesPlugin plugin={TilesFadePlugin} />
        <TilesPlugin plugin={UpdateOnChangePlugin} />
        <CameraRig
          radiusM={R}
          fly={fly}
          resetSignal={resetSignal}
          onCameraCentre={props.onCameraCentre}
          onFirstTiles={props.onFirstTiles}
        />
        <SurfacePicker radiusM={R} onPick={props.onSurfaceClick} lastNodeClick={lastNodeClick} />
        <BaseGlobe body={body} radiusM={R} />
        <AreaScene
          body={body}
          radiusM={R}
          area={area}
          grid={grid}
          nodes={nodes}
          labels={labels}
          links={links}
          route={route}
          criticalIds={criticalIds}
          satellites={satellites}
          stations={stations}
          coverage={coverage}
          survey={props.survey}
          selectedId={selectedId}
          onNodeClick={(id) => {
            lastNodeClick.current = performance.now();
            props.onNodeClick(id);
          }}
        />
        {body === 'earth' && (
          <mesh>
            <sphereGeometry args={[R * 1.02, 96, 64]} />
            <shaderMaterial args={[ATMOSPHERE]} side={THREE.BackSide} blending={THREE.AdditiveBlending} transparent depthWrite={false} />
          </mesh>
        )}
      </TilesRenderer>
    </Canvas>
  );
}
