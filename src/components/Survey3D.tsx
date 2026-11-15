import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import { heightFor, sampleBicubic } from '../engine';
import type { Heights, HeightGrid, NetworkLink, SiteNode, SurveyLayers, WalkRoute } from '../engine';
import { buildPaths, buildRasters, drawSurvey, smooth } from '../survey/draw';
import { tileCacheFor } from '../survey/tileCache';
import { PALETTE, SIM_COLOR, STATUS_COLOR } from '../theme';
import { safetyCanvas } from './SurveyMap';
import type { SafetyLayer, SimView } from './SurveyMap';

/**
 * The planning area as a rotatable relief block: the cached survey map draped on the bicubic surface,
 * with body curvature applied the same way as the link model, so a straight link that cuts into the
 * terrain here is one the model calls blocked. Vertical exaggeration is display only and scales
 * terrain and antenna heights together, which keeps those intersections true.
 */

interface Props {
  grid: HeightGrid;
  layers: SurveyLayers;
  radiusM: number;
  nodes: SiteNode[];
  labels: Map<string, string>;
  links: NetworkLink[];
  route: string[];
  walk: WalkRoute | null;
  heights: Heights;
  selectedId: string | null;
  onNodeClick: (id: string) => void;
  /** Crew coverage and hazard rasters, draped on the terrain like the survey map's shading. */
  safetyLayer: SafetyLayer | null;
  /** Failure simulation: dead old route in red, newly chosen route in green. */
  sim: SimView | null;
  /**
   * Presentation showcase: each new `seq` sets the vertical exaggeration to `exag` and flies the
   * camera once around the area (one full orbit). Seq 0 means none.
   */
  showcase?: { seq: number; exag: number };
}

/** Seconds for the showcase orbit (one full turn around the area). */
const SHOWCASE_ORBIT_S = 16;

const KM = 1 / 1000;

interface Frame {
  W: number;
  H: number;
  base: number;
  exag: number;
  R: number;
}

/** Grid metres → scene units (km): x east, y up, z south. Curvature drop from the area centre included. */
function toScene(f: Frame, x: number, y: number, z: number): THREE.Vector3 {
  const dx = x - f.W / 2;
  const dy = y - f.H / 2;
  const drop = (dx * dx + dy * dy) / (2 * f.R);
  return new THREE.Vector3(dx * KM, (z - drop - f.base) * f.exag * KM, (f.H / 2 - y) * KM);
}

function Terrain({ grid, frame, texture, overlay }: { grid: HeightGrid; frame: Frame; texture: THREE.Texture | null; overlay: THREE.Texture | null }) {
  const res = Math.min(513, Math.max(257, grid.cols));
  const { surface, skirt } = useMemo(() => {
    const s: [number, number, number] = [0, 0, 0];
    const pos = new Float32Array(res * res * 3);
    const uv = new Float32Array(res * res * 2);
    for (let j = 0; j < res; j++) {
      const y = frame.H * (1 - j / (res - 1));
      for (let i = 0; i < res; i++) {
        const x = (frame.W * i) / (res - 1);
        sampleBicubic(grid, x, y, s);
        const v = toScene(frame, x, y, s[0]);
        const k = j * res + i;
        pos[3 * k] = v.x;
        pos[3 * k + 1] = v.y;
        pos[3 * k + 2] = v.z;
        uv[2 * k] = i / (res - 1);
        uv[2 * k + 1] = 1 - j / (res - 1);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < res - 1; j++) {
      for (let i = 0; i < res - 1; i++) {
        const a = j * res + i;
        idx.push(a, a + res, a + 1, a + 1, a + res, a + res + 1);
      }
    }
    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    surface.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    surface.setIndex(idx);

    // Side walls down to a common floor, for a block-diagram read of depth.
    const ring: number[] = [];
    for (let i = 0; i < res; i++) ring.push(i); // north edge, west → east
    for (let j = 1; j < res; j++) ring.push(j * res + res - 1); // east edge
    for (let i = res - 2; i >= 0; i--) ring.push((res - 1) * res + i); // south edge
    for (let j = res - 2; j > 0; j--) ring.push(j * res); // west edge
    ring.push(0);
    const floor = -0.06 * Math.max(frame.W, frame.H) * KM;
    const wp = new Float32Array(ring.length * 2 * 3);
    const wc = new Float32Array(ring.length * 2 * 3);
    ring.forEach((k, n) => {
      wp.set([pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]], 6 * n);
      wp.set([pos[3 * k], floor, pos[3 * k + 2]], 6 * n + 3);
      // Vertex colours are linear: these read as a dark rust-to-basalt gradient on screen.
      wc.set([0.075, 0.03, 0.017], 6 * n);
      wc.set([0.008, 0.006, 0.005], 6 * n + 3);
    });
    const widx: number[] = [];
    for (let n = 0; n + 1 < ring.length; n++) widx.push(2 * n, 2 * n + 1, 2 * n + 2, 2 * n + 2, 2 * n + 1, 2 * n + 3);
    const skirt = new THREE.BufferGeometry();
    skirt.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    skirt.setAttribute('color', new THREE.BufferAttribute(wc, 3));
    skirt.setIndex(widx);
    return { surface, skirt };
  }, [grid, frame, res]);
  useEffect(
    () => () => {
      surface.dispose();
      skirt.dispose();
    },
    [surface, skirt],
  );
  return (
    <group>
      <mesh geometry={surface}>
        <meshBasicMaterial map={texture} color={texture ? '#ffffff' : '#7a4a33'} toneMapped={false} />
      </mesh>
      {overlay && (
        // Same surface again, carrying the coverage and hazard shading; pulled forward so it never z-fights.
        <mesh geometry={surface} renderOrder={1}>
          <meshBasicMaterial map={overlay} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} toneMapped={false} />
        </mesh>
      )}
      <mesh geometry={skirt}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A screen-facing text label drawn into a canvas texture (constant on-screen size). */
function Label3D({ text, color, position, selected }: { text: string; color: string; position: [number, number, number]; selected: boolean }) {
  const { texture, aspect } = useMemo(() => {
    const pad = 14;
    const font = '500 26px Jost, "Segoe UI", sans-serif';
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = font;
    const label = text.toUpperCase().split('').join(' ');
    const w = Math.ceil(probe.measureText(label).width) + pad * 2;
    const h = 46;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(22,17,14,0.85)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = selected ? '#e8a07e' : 'rgba(236,205,178,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pad, h / 2 + 1);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { texture: t, aspect: w / h };
  }, [text, color, selected]);
  useEffect(() => () => texture.dispose(), [texture]);
  const hgt = 0.032;
  return (
    <sprite position={position} scale={[hgt * aspect, hgt, 1]} center={new THREE.Vector2(0.5, 0)} renderOrder={20}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent toneMapped={false} />
    </sprite>
  );
}

/** Rotate the camera about the target by a fixed step: a button and keyboard alternative to dragging. */
/**
 * One slow full orbit of the camera around the target, then stop. The canvas renders on demand,
 * so this keeps requesting frames only while the orbit runs.
 */
function ShowcaseOrbit({ seq, controls }: { seq: number; controls: MutableRefObject<{ target: THREE.Vector3; update: () => void } | null> }) {
  const { camera, invalidate } = useThree();
  const run = useRef<{ t: number } | null>(null);
  useEffect(() => {
    if (!seq) return;
    run.current = { t: 0 };
    invalidate();
  }, [seq, invalidate]);
  useFrame((_, dt) => {
    const r = run.current;
    if (!r) return;
    const c = controls.current;
    if (!c) {
      invalidate();
      return;
    }
    const step = Math.min(dt, 0.05);
    // Ease in and out over the orbit, so the start and the end do not jerk.
    const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, x));
    const before = ease(r.t / SHOWCASE_ORBIT_S);
    r.t += step;
    const after = ease(r.t / SHOWCASE_ORBIT_S);
    const off = camera.position.clone().sub(c.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += (after - before) * Math.PI * 2;
    camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
    c.update();
    if (r.t < SHOWCASE_ORBIT_S) invalidate();
    else run.current = null;
  });
  return null;
}

function OrbitStep({ signal, controls }: { signal: { n: number; az: number; el: number }; controls: MutableRefObject<{ target: THREE.Vector3; update: () => void } | null> }) {
  const { camera } = useThree();
  useEffect(() => {
    const c = controls.current;
    if (!c || signal.n === 0) return;
    const off = camera.position.clone().sub(c.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta += signal.az;
    sph.phi = Math.min(Math.PI / 2 - 0.05, Math.max(0.08, sph.phi + signal.el));
    camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
    c.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);
  return null;
}

/** Memoised, and renders on demand: frames happen only while the camera moves or the scene changes. */
export const Survey3D = memo(function Survey3D({ active = true, grid, layers, radiusM, nodes, labels, links, route, walk, heights, selectedId, onNodeClick, safetyLayer, sim, showcase }: Props & { active?: boolean }) {
  const [exag, setExag] = useState(showcase?.seq ? showcase.exag : 3);
  // A new showcase request sets the hill height (the slider still works afterwards).
  const showcaseSeq = showcase?.seq ?? 0;
  useEffect(() => {
    if (showcaseSeq && showcase) setExag(showcase.exag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showcaseSeq]);
  const [resetKey, setResetKey] = useState(0);
  const [step, setStep] = useState({ n: 0, az: 0, el: 0 });
  const controls = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  const frame = useMemo<Frame>(() => ({ W: grid.widthM, H: grid.heightM, base: grid.minElevM, exag, R: radiusM }), [grid, exag, radiusM]);

  // Texture: the best complete cache level up to 4096 px; the immediate renderer until one exists.
  const cache = useMemo(() => tileCacheFor(grid, layers), [grid, layers]);
  const [level, setLevel] = useState(() => Math.min(3, cache.completeLevel()));
  useEffect(() => cache.subscribe(() => setLevel(Math.min(3, cache.completeLevel()))), [cache]);
  const texture = useMemo(() => {
    let canvas: HTMLCanvasElement;
    if (level >= 0) canvas = cache.compose(level);
    else {
      canvas = document.createElement('canvas');
      canvas.width = 2048;
      canvas.height = 2048;
      drawSurvey(canvas.getContext('2d')!, grid, buildRasters(grid, layers), buildPaths(layers), { view: { x0: 0, yTop: grid.heightM, S: 2048 / grid.widthM }, dpr: 1, terrain: true, grain: true });
    }
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }, [cache, level, grid, layers]);
  useEffect(() => () => texture.dispose(), [texture]);
  const overlay = useMemo(() => {
    if (!safetyLayer) return null;
    const t = new THREE.CanvasTexture(safetyCanvas(grid, safetyLayer));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [grid, safetyLayer]);
  useEffect(() => () => overlay?.dispose(), [overlay]);

  const ground = (x: number, y: number) => sampleBicubic(grid, x, y)[0];
  const span = Math.max(grid.widthM, grid.heightM) * KM;
  const pinH = span * 0.045;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Large networks: label relays only when selected, so endpoints and base stations stay readable.
  const relayCount = nodes.filter((n) => n.kind === 'relay').length;
  const head = (n: SiteNode) => toScene(frame, n.x, n.y, ground(n.x, n.y) + heightFor(n.kind, heights));
  const routePairs = new Set<string>();
  for (let i = 0; i + 1 < route.length; i++) {
    routePairs.add(`${route[i]}|${route[i + 1]}`);
    routePairs.add(`${route[i + 1]}|${route[i]}`);
  }
  const drape = (pts: { x: number; y: number }[]) => smooth(pts, 3).map((p) => toScene(frame, p.x, p.y, sampleBicubic(grid, p.x, p.y)[0] + 2).add(new THREE.Vector3(0, span * 0.002, 0)));
  const walkPts = useMemo(() => (walk ? drape(walk.points) : null), [walk, frame, grid, span]); // eslint-disable-line react-hooks/exhaustive-deps
  // Failure simulation, as on the survey map: the old routes from the failed node on are dead (red),
  // and once the re-plan arrives the new radio route and crew path are drawn green on top.
  const simSeq = sim?.seq ?? 0;
  const dead = useMemo(() => {
    if (!sim || sim.kind !== 'fail') return null;
    const w = sim.ghostWalk && sim.walkCut >= 0 ? drape(sim.ghostWalk.slice(sim.walkCut)) : null;
    const r = sim.routeCut >= 0 && sim.ghostRoute.length - sim.routeCut > 1 ? sim.ghostRoute.slice(sim.routeCut).map((p) => toScene(frame, p.x, p.y, ground(p.x, p.y) + heights.nodeM)) : null;
    return w || r ? { walk: w, route: r } : null;
  }, [simSeq, frame, grid, heights.nodeM]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = sim?.phase === 'done';
  const routeHeads = route.map((id) => byId.get(id)).filter((n): n is SiteNode => !!n).map(head);

  return (
    <div className="survey3d">
      <Canvas key={resetKey} camera={{ position: [0, span * 0.72, span * 1.25], fov: 40, near: span * 0.001, far: span * 20 }} dpr={[1, 2]} frameloop={active ? 'demand' : 'never'} aria-label="3D relief of the planning area. Drag to rotate, right-drag to pan, scroll to zoom." role="img">
        <color attach="background" args={[PALETTE.ground]} />
        <fog attach="fog" args={[PALETTE.ground, span * 1.6, span * 4]} />
        <Terrain grid={grid} frame={frame} texture={texture} overlay={overlay} />

        {dead?.walk && dead.walk.length > 1 && (
          <>
            <Line points={dead.walk} color={SIM_COLOR.dead} lineWidth={12} transparent opacity={0.45} />
            <Line points={dead.walk} color={SIM_COLOR.dead} lineWidth={3} dashed dashSize={span * 0.008} gapSize={span * 0.006} />
          </>
        )}
        {walkPts && walkPts.length > 1 && (
          <>
            <Line points={walkPts} color={chosen ? SIM_COLOR.chosen : PALETTE.traverse} lineWidth={chosen ? 16 : 9} transparent opacity={chosen ? 0.35 : 0.25} />
            <Line points={walkPts} color={chosen ? SIM_COLOR.chosen : PALETTE.traverse} lineWidth={chosen ? 3.2 : 2.4} dashed={walk?.exceedsLimit} dashSize={span * 0.01} gapSize={span * 0.008} />
          </>
        )}
        {dead?.route && (
          <>
            <Line points={dead.route} color={SIM_COLOR.dead} lineWidth={9} transparent opacity={0.4} />
            <Line points={dead.route} color={SIM_COLOR.dead} lineWidth={2.6} dashed dashSize={span * 0.004} gapSize={span * 0.006} />
          </>
        )}
        {chosen && routeHeads.length > 1 && (
          <>
            <Line points={routeHeads} color={SIM_COLOR.chosen} lineWidth={11} transparent opacity={0.35} />
            <Line points={routeHeads} color={SIM_COLOR.chosen} lineWidth={3} />
          </>
        )}

        {links.map((l) => {
          const a = byId.get(l.a);
          const b = byId.get(l.b);
          if (!a || !b) return null;
          const st = l.result.status;
          const on = routePairs.has(`${l.a}|${l.b}`);
          return (
            <Line
              key={`${l.a}-${l.b}`}
              points={[head(a), head(b)]}
              color={st === 'good' && on ? PALETTE.salmon : STATUS_COLOR[st]}
              lineWidth={on ? 2.8 : 1.8}
              dashed={st !== 'good'}
              dashSize={st === 'fail' ? span * 0.004 : span * 0.012}
              gapSize={span * 0.008}
            />
          );
        })}

        {nodes.map((n) => {
          const end = n.kind === 'A' || n.kind === 'B';
          const col = end ? PALETTE.traverse : n.kind === 'base' ? PALETTE.ice : PALETTE.salmon;
          const g = toScene(frame, n.x, n.y, ground(n.x, n.y));
          const sel = n.id === selectedId;
          return (
            <group key={n.id} position={g} onClick={(e) => (e.stopPropagation(), onNodeClick(n.id))}>
              <mesh position={[0, pinH / 2, 0]}>
                <cylinderGeometry args={[span * 0.0012, span * 0.0012, pinH, 8]} />
                <meshBasicMaterial color={col} transparent opacity={n.enabled ? 0.9 : 0.35} />
              </mesh>
              <mesh position={[0, pinH, 0]}>
                <sphereGeometry args={[span * (end ? 0.006 : 0.0045), 16, 12]} />
                <meshBasicMaterial color={col} transparent opacity={n.enabled ? 1 : 0.4} />
              </mesh>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, span * 0.001, 0]}>
                <ringGeometry args={[span * (sel ? 0.016 : 0.01), span * (sel ? 0.019 : 0.012), 40]} />
                <meshBasicMaterial color={col} transparent opacity={0.8} side={THREE.DoubleSide} />
              </mesh>
              {(n.kind !== 'relay' || sel || relayCount <= 12) && <Label3D text={labels.get(n.id) ?? n.id} color={n.kind === 'relay' ? PALETTE.salmonText : n.kind === 'base' ? PALETTE.iceText : PALETTE.bone} position={[0, pinH * 1.15, 0]} selected={sel} />}
            </group>
          );
        })}

        <OrbitControls
          ref={controls as never}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={span * 0.08}
          maxDistance={span * 3}
          target={[0, 0, 0]}
        />
        <OrbitStep signal={step} controls={controls} />
        <ShowcaseOrbit seq={showcaseSeq} controls={controls} />
      </Canvas>

      <div className="survey3d-bar" role="group" aria-label="3D view controls">
        <label className="exag">
          <span className="cap">Vertical exaggeration {exag}×</span>
          <input type="range" min={1} max={12} step={1} value={exag} onChange={(e) => setExag(Number(e.target.value))} aria-valuetext={`${exag} times`} />
        </label>
        <div className="zoom-group">
          <button type="button" className="bar-btn icon" aria-label="Rotate left" title="Rotate left" onClick={() => setStep((p) => ({ n: p.n + 1, az: -Math.PI / 8, el: 0 }))}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M3 7a4 4 0 1 0 1.2-2.8M3 2v3h3" />
            </svg>
          </button>
          <button type="button" className="bar-btn icon" aria-label="Rotate right" title="Rotate right" onClick={() => setStep((p) => ({ n: p.n + 1, az: Math.PI / 8, el: 0 }))}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M11 7a4 4 0 1 1-1.2-2.8M11 2v3H8" />
            </svg>
          </button>
          <button type="button" className="bar-btn icon" aria-label="Tilt down" title="Tilt toward a top view" onClick={() => setStep((p) => ({ n: p.n + 1, az: 0, el: -0.15 }))}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M3 9l4-4 4 4" />
            </svg>
          </button>
          <button type="button" className="bar-btn icon" aria-label="Tilt up" title="Tilt toward the horizon" onClick={() => setStep((p) => ({ n: p.n + 1, az: 0, el: 0.15 }))}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M3 5l4 4 4-4" />
            </svg>
          </button>
          <button type="button" className="bar-btn" onClick={() => setResetKey((k) => k + 1)}>
            Reset view
          </button>
        </div>
        <span className="cap small">{level >= 0 ? `Texture ${2 ** level * 512} px` : 'Texture loading'}</span>
      </div>
    </div>
  );
});
