import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Suspense, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { useSlide } from '../kit';

/**
 * Hardware slide: the two PCBs as real 3D models, each turning slowly on its own turntable.
 *
 * The models are KiCad 10 GLB exports (`kicad-cli pcb export glb` with tracks, pads, silkscreen and
 * soldermask; part models from the KiCad 10 library), compressed with glTF-Transform
 * (`optimize --compress meshopt`). They live in public/hw/. See docs/PRESENTATION.md to regenerate.
 * Rendering runs only while the slide is the current one; thumbnails get a still placeholder.
 */

const BASE = import.meta.env.BASE_URL;
export const HW_MODELS = { node: `${BASE}hw/relay-node.glb`, base: `${BASE}hw/base-station.glb` };

/**
 * What to add around an exported board. All of it is illustrative, built here, not part of the PCB
 * file. (The base station's part colours are baked into its GLB by scripts/recolor-pcb-glb.mjs:
 * the optimised file has no per-part nodes left to recolour at runtime.)
 */
export interface BoardDressing {
  /** Antenna connector positions, model metres as exported by KiCad (x, board-top y, z). */
  antennas?: [number, number, number][];
  /** The antenna connectors are edge-mount (antenna leaves the board edge, then bends up). */
  edgeMount?: boolean;
  /** Antenna length in metres (model units). */
  antennaM?: number;
  /** A simple box enclosure (see-through walls) with a solar panel as its lid; antennas exit through it. */
  shell?: boolean;
}

const matCache = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = make()));
  return m;
}

/** Rubber-duck antenna: connector nut along local +x, a hinge, then the whip standing up (+y). */
function makeAntenna(lengthM: number, hinged: boolean): THREE.Group {
  const g = new THREE.Group();
  const gold = mat('ant-gold', () => new THREE.MeshStandardMaterial({ color: '#d8b25a', metalness: 0.85, roughness: 0.3 }));
  const black = mat('ant-black', () => new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.6, metalness: 0.1 }));
  const r = lengthM * 0.035;
  if (hinged) {
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, r * 2.2, 6), gold);
    nut.rotation.z = Math.PI / 2;
    nut.position.x = r * 1.1;
    const knee = new THREE.Mesh(new THREE.SphereGeometry(r * 1.15, 16, 12), black);
    knee.position.x = r * 2.6;
    g.add(nut, knee);
  } else {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 1.2, r * 1.6, 16), gold);
    base.position.y = r * 0.8;
    g.add(base);
  }
  const x0 = hinged ? r * 2.6 : 0;
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r, lengthM, 20), black);
  whip.position.set(x0, lengthM / 2 + (hinged ? 0 : r * 1.6), 0);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 16, 10), black);
  tip.position.set(x0, lengthM + (hinged ? 0 : r * 1.6), 0);
  g.add(whip, tip);
  return g;
}

let cellTexture: THREE.CanvasTexture | null = null;
/** Solar cell pattern: blue cells, silver busbars and fingers. */
function solarTexture(): THREE.CanvasTexture {
  if (cellTexture) return cellTexture;
  const W = 1024;
  const H = 512;
  const cols = 8;
  const rows = 4;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#c9ced8';
  x.fillRect(0, 0, W, H);
  const gap = 6;
  const cw = (W - gap * (cols + 1)) / cols;
  const ch = (H - gap * (rows + 1)) / rows;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const x0 = gap + i * (cw + gap);
      const y0 = gap + j * (ch + gap);
      const grad = x.createLinearGradient(x0, y0, x0 + cw, y0 + ch);
      grad.addColorStop(0, '#1d3f9e');
      grad.addColorStop(1, '#0b1b52');
      x.fillStyle = grad;
      x.fillRect(x0, y0, cw, ch);
      x.strokeStyle = 'rgba(190,205,235,0.18)';
      x.lineWidth = 1;
      for (let f = y0 + 6; f < y0 + ch; f += 7) {
        x.beginPath();
        x.moveTo(x0, f);
        x.lineTo(x0 + cw, f);
        x.stroke();
      }
      x.fillStyle = 'rgba(215,222,236,0.85)';
      x.fillRect(x0 + cw * 0.3 - 1.5, y0, 3, ch);
      x.fillRect(x0 + cw * 0.7 - 1.5, y0, 3, ch);
    }
  cellTexture = new THREE.CanvasTexture(c);
  cellTexture.colorSpace = THREE.SRGBColorSpace;
  cellTexture.anisotropy = 8;
  return cellTexture;
}

/** Flat solar panel centred on the origin, cells facing +y: an aluminium frame and the cell sheet. */
function makeSolar(widthM: number, depthM: number): THREE.Group {
  const g = new THREE.Group();
  const t = Math.max(0.0015, Math.min(widthM, depthM) * 0.025);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(widthM, t, depthM), mat('solar-frame', () => new THREE.MeshStandardMaterial({ color: '#b9bec8', metalness: 0.8, roughness: 0.35 })));
  frame.position.y = t / 2;
  // The cell pattern is 2:1; turn it a quarter for a panel that is deeper than wide.
  const turned = depthM > widthM;
  const cellMat = mat(turned ? 'solar-cells-turned' : 'solar-cells', () => {
    let map = solarTexture();
    if (turned) {
      map = map.clone();
      map.center.set(0.5, 0.5);
      map.rotation = Math.PI / 2;
      map.needsUpdate = true;
    }
    return new THREE.MeshStandardMaterial({ map, metalness: 0.35, roughness: 0.28 });
  });
  const cells = new THREE.Mesh(new THREE.PlaneGeometry(widthM * 0.95, depthM * 0.93), cellMat);
  cells.rotation.x = -Math.PI / 2;
  cells.position.y = t + 0.0002;
  g.add(frame, cells);
  g.userData.thickness = t;
  return g;
}

/** The moving parts of an enclosure, driven by the open/close loop in `Board`. */
interface ShellParts {
  lid: THREE.Object3D;
  lidY: number;
  /** How far the lid rises when open, model metres. */
  lift: number;
  wallMat: THREE.MeshStandardMaterial;
  edgeMat: THREE.LineBasicMaterial;
  /** The lid's own materials (per board), faded while open. */
  lidMats: THREE.Material[];
}
const WALL_OPACITY = 0.13;
const EDGE_OPACITY = 0.75;

/**
 * Box enclosure around the board: see-through walls and floor with light edges, and a solar panel
 * as the lid. Returns the enclosure's outer box (model space) and its moving parts.
 */
function makeShell(root: THREE.Object3D, board: THREE.Box3): { box: THREE.Box3; parts: ShellParts } {
  const size = board.getSize(new THREE.Vector3());
  const m = 0.07 * Math.max(size.x, size.z); // side clearance
  const shell = new THREE.Box3(
    new THREE.Vector3(board.min.x - m, board.min.y - 0.35 * m, board.min.z - m),
    new THREE.Vector3(board.max.x + m, board.max.y + 0.4 * m, board.max.z + m),
  );
  const s = shell.getSize(new THREE.Vector3());
  const c = shell.getCenter(new THREE.Vector3());
  // Walls and floor: an open-top box, drawn as one see-through box minus the lid (the panel covers it).
  const geo = new THREE.BoxGeometry(s.x, s.y, s.z);
  geo.clearGroups();
  // BoxGeometry face order: +x, −x, +y, −y, +z, −z, 6 indices × 2 triangles each.
  for (const face of [0, 1, 3, 4, 5]) geo.addGroup(face * 6, 6, 0);
  // Per board (not cached): their opacity animates.
  const wallMat = new THREE.MeshStandardMaterial({ color: '#aab4c0', transparent: true, opacity: WALL_OPACITY, roughness: 0.15, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: '#dfe5ee', transparent: true, opacity: EDGE_OPACITY });
  const walls = new THREE.Mesh(geo, wallMat);
  walls.position.copy(c);
  walls.renderOrder = 2;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x, s.y, s.z)), edgeMat);
  edges.position.copy(c);
  const lid = makeSolar(s.x, s.z);
  lid.position.set(c.x, shell.max.y, c.z);
  // Give this lid its own transparent copies of the panel materials, so it can fade on its own.
  const lidMats: THREE.Material[] = [];
  lid.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = (mesh.material as THREE.Material).clone();
    m.transparent = true;
    mesh.material = m;
    lidMats.push(m);
  });
  root.add(walls, edges, lid);
  const parts: ShellParts = { lid, lidY: lid.position.y, lift: 0.22 * Math.max(s.x, s.z), wallMat, edgeMat, lidMats };
  shell.max.y += lid.userData.thickness as number;
  return { box: shell, parts };
}

/** Shell with a solar lid, and antennas on the antenna connectors exiting through it (model space, board normal +y). */
function dress(root: THREE.Object3D, board: THREE.Box3, d: BoardDressing): ShellParts | null {
  root.updateMatrixWorld(true);
  const top = board.min.y + 0.0016;
  const shell = d.shell ? makeShell(root, board) : null;
  const outer = shell?.box ?? board;
  if (d.antennas) {
    for (const [ax, ay, az] of d.antennas) {
      const p = new THREE.Vector3(ax, ay, az);
      const edgeMount = !!d.edgeMount;
      const ant = makeAntenna(d.antennaM ?? 0.12, edgeMount);
      if (edgeMount) {
        // Leave through the enclosure wall nearest the connector, then bend up.
        const edges = [
          { d: outer.max.x - p.x, rot: 0 },
          { d: p.x - outer.min.x, rot: Math.PI },
          { d: outer.max.z - p.z, rot: -Math.PI / 2 },
          { d: p.z - outer.min.z, rot: Math.PI / 2 },
        ].sort((a, b) => a.d - b.d);
        const out = new THREE.Vector3(Math.cos(edges[0].rot), 0, -Math.sin(edges[0].rot));
        ant.position.set(p.x, top + 0.002, p.z).addScaledVector(out, Math.max(0, edges[0].d));
        ant.rotation.y = edges[0].rot;
      } else if (shell) {
        // Vertical connector: the whip stands on the lid above it, and rises with the lid.
        const lid = shell.parts.lid;
        ant.position.set(p.x - lid.position.x, lid.userData.thickness as number, p.z - lid.position.z);
        lid.add(ant);
        continue;
      } else {
        ant.position.set(p.x, top + 0.001, p.z);
      }
      root.add(ant);
    }
  }
  return shell?.parts ?? null;
}

/** Open/close loop, seconds: closed, opening, open, closing. */
const CYCLE = { closed: 3, opening: 1.6, open: 3.6, closing: 1.6 };
const CYCLE_S = CYCLE.closed + CYCLE.opening + CYCLE.open + CYCLE.closing;
const smooth = (x: number) => x * x * (3 - 2 * x);
/** 0 = closed box, 1 = lid lifted and walls faded, so the PCB shows. */
function openness(t: number): number {
  const u = t % CYCLE_S;
  if (u < CYCLE.closed) return 0;
  if (u < CYCLE.closed + CYCLE.opening) return smooth((u - CYCLE.closed) / CYCLE.opening);
  if (u < CYCLE.closed + CYCLE.opening + CYCLE.open) return 1;
  return 1 - smooth((u - CYCLE.closed - CYCLE.opening - CYCLE.open) / CYCLE.closing);
}

/** One board: centred, laid flat, dressed, scaled to fit while turning, tilted toward the camera. */
function Board({ url, size, speed, phase, dressing }: { url: string; size: number; speed: number; phase: number; dressing?: BoardDressing }) {
  // false: no Draco (it would fetch a decoder from a CDN); true: meshopt, decoded locally.
  const { scene } = useGLTF(url, false, true);
  const { model, parts, scale } = useMemo(() => {
    const root = scene.clone(true);
    const board = new THREE.Box3().setFromObject(root);
    const dims = board.getSize(new THREE.Vector3());
    const centre = board.getCenter(new THREE.Vector3());
    const parts = dressing && dims.y <= dims.x && dims.y <= dims.z ? dress(root, board, dressing) : null;
    root.position.sub(centre);
    // KiCad exports the board in its own plane; lay it flat whichever axis is thinnest.
    const wrap = new THREE.Group();
    wrap.add(root);
    if (dims.z < dims.y && dims.z < dims.x) wrap.rotation.x = -Math.PI / 2;
    else if (dims.x < dims.y && dims.x < dims.z) wrap.rotation.z = Math.PI / 2;
    // Fit by the widest horizontal reach from the turning axis (board, antennas and panel), so
    // nothing leaves the frame at any turn angle.
    wrap.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(wrap);
    const reach = Math.max(...[all.min.x, all.max.x].flatMap((x) => [all.min.z, all.max.z].map((z) => Math.hypot(x, z))));
    const outer = new THREE.Group();
    outer.add(wrap);
    const scale = size / (2 * reach);
    outer.scale.setScalar(scale);
    return { model: outer, parts, scale };
    // Keyed by content: slides re-render with fresh option objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, size, JSON.stringify(dressing)]);
  const spin = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const clock = useRef(0);
  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05);
    if (spin.current) spin.current.rotation.y += step * speed;
    if (!parts) return;
    // Starts closed each time the slide comes up (frames only run while it is current).
    clock.current += step;
    const e = openness(clock.current);
    parts.lid.position.y = parts.lidY + e * parts.lift;
    parts.wallMat.opacity = WALL_OPACITY * (1 - 0.8 * e);
    parts.edgeMat.opacity = EDGE_OPACITY * (1 - 0.65 * e);
    // The lid rises and fades to a ghost, so the whole board shows beneath it.
    const lidOpacity = 1 - 0.86 * e;
    for (const m of parts.lidMats) {
      m.opacity = lidOpacity;
      m.depthWrite = lidOpacity > 0.99;
    }
    // Tilt down to look at the board while open; nudge down so the raised lid stays in frame.
    if (tilt.current) {
      tilt.current.rotation.x = 0.3 + 0.26 * e;
      tilt.current.position.y = -0.2 * e * parts.lift * scale;
    }
  });
  return (
    // Closed, a shallow tilt shows the box and its lid; open, it tilts down onto the board.
    <group ref={tilt} rotation={[0.3, 0, 0]}>
      <group ref={spin} rotation={[0, phase, 0]}>
        <primitive object={model} />
      </group>
    </group>
  );
}

function Turntable({ url, active, phase, dressing }: { url: string; active: boolean; phase: number; dressing?: BoardDressing }) {
  return (
    <Canvas
      className="pz-hw-canvas"
      frameloop={active ? 'always' : 'never'}
      // The stage is scaled with a CSS transform: measure the layout size, not the scaled box.
      resize={{ offsetSize: true }}
      dpr={[1, 2]}
      camera={{ position: [0, 0.35, 2.6], fov: 32, near: 0.01, far: 50 }}
      gl={{ antialias: true, alpha: true }}
    >
      <hemisphereLight args={['#fff4e8', '#2a1a12', 1.1]} />
      <directionalLight position={[2.5, 4, 3]} intensity={2.2} />
      <directionalLight position={[-3, 1.5, -2]} intensity={0.9} color="#e8a07e" />
      {/* Soft fill from below so the back of the solar panel reads as metal, not a black slab. */}
      <directionalLight position={[0, -3, 1]} intensity={0.6} color="#cfd6e4" />
      <Suspense fallback={null}>
        <Board url={url} size={1.6} speed={0.35} phase={phase} dressing={dressing} />
      </Suspense>
    </Canvas>
  );
}

export interface HardwareItem {
  url: string;
  name: ReactNode;
  specs: ReactNode;
  detail: ReactNode;
  dressing?: BoardDressing;
}

export function HardwareShowcase({ items }: { items: HardwareItem[] }) {
  const { active, thumbnail } = useSlide();
  return (
    <div className="pz-hw" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((it, i) => (
        <figure key={i} className="pz-hw-item">
          <div className="pz-hw-stage">{thumbnail ? <div className="pz-hw-placeholder" aria-hidden="true" /> : <Turntable url={it.url} active={active} phase={i * 1.3} dressing={it.dressing} />}</div>
          <figcaption>
            <p className="pz-hw-name">{it.name}</p>
            <p className="pz-hw-specs">{it.specs}</p>            <p className="pz-hw-detail">{it.detail}</p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
