// 로우폴리 중앙 공원 — 분수대 · 산책로 · 잔디 · 벚꽃/일반 나무 · 벤치 · 꽃밭 · 건물 · 강아지 집 입구
// 반복되는 오브젝트(나무·꽃·풀·울타리)는 InstancedMesh로 묶어 드로우콜을 최소화했다.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  BENCHES, BUILDINGS, FLOWER_BEDS, FOUNTAIN_RADIUS, GROUND_RADIUS, LAMPS, PATH_WIDTH, PLAZA_RADIUS, RADIAL_ANGLES,
  RING_RADIUS, TREES, WORLD_RADIUS, isOnPath, type BuildingDef, PAVILION, pavilionSideAngle, benchLength,
} from '@shared/world';
import { PALETTE, geo, mat } from './lowpoly';
import { lathe, smoothProfile } from './models/sculpt';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { set } from '../store';
import { joinPark } from '../net/socket';
import { local } from './local';

interface Inst { p: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number; c: string }

/** 인스턴스 묶음: 한 지오메트리를 여러 위치/색상으로 한 번에 그린다 */
function Instanced({ geometry, items, smooth = false, noCast = false }: { geometry: THREE.BufferGeometry; items: Inst[]; smooth?: boolean; noCast?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const material = useMemo(() => (smooth ? new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, vertexColors: !!geometry.attributes.color }) : new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true })), [smooth, geometry]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    items.forEach((it, i) => {
      e.set(...(it.r ?? [0, 0, 0]));
      q.setFromEuler(e);
      const s = it.s ?? 1;
      typeof s === 'number' ? sc.set(s, s, s) : sc.set(...s);
      m.compose(v.set(...it.p), q, sc);
      ref.current.setMatrixAt(i, m);
      ref.current.setColorAt(i, col.set(it.c));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} frustumCulled={false} userData={{ noCast }} />;
}

/** 몽실한 나뭇잎·구름 덩어리: 매끈한 구에 큰 혹을 여러 개 붙이고, 아래는 어둡게 위는 밝게 정점 색을 넣음 */
function makePuff(seed: number, bottomShade = 0.78, topShade = 1.06, flatBottom = 0) {
  const g = mergeVertices(new THREE.SphereGeometry(1, 28, 20));
  const r = seeded(seed);
  const bumps = Array.from({ length: 9 }, () => new THREE.Vector3(r() * 2 - 1, r() * 1.4 - 0.4, r() * 2 - 1).normalize());
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let k = 1;
    for (const b of bumps) k += 0.13 * Math.pow(Math.max(0, v.dot(b)), 5);
    v.multiplyScalar(k);
    if (flatBottom && v.y < -flatBottom) v.y = -flatBottom + (v.y + flatBottom) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
    const t = THREE.MathUtils.smoothstep(v.y, -0.9, 0.9);
    const c = bottomShade + (topShade - bottomShade) * t;
    col.push(c, c, c);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** 광장 바닥 타일 텍스처 (파스텔 벽돌) */
function makePlazaTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9cdbb'; g.fillRect(0, 0, S, S);
  const r = seeded(41);
  const rows = 8, cols = 4, th = S / rows, tw = S / cols;
  const palette = ['#f6e2d4', '#f3dccb', '#f8e7db', '#f1d6c6', '#f5dfd2'];
  for (let y = 0; y < rows; y++) {
    for (let x = -1; x < cols + 1; x++) {
      const ox = (y % 2) * tw / 2;
      g.fillStyle = palette[Math.floor(r() * palette.length)];
      const px = x * tw + ox + 3, py = y * th + 3, w = tw - 6, h = th - 6, rr = 6;
      g.beginPath(); g.moveTo(px + rr, py); g.arcTo(px + w, py, px + w, py + h, rr); g.arcTo(px + w, py + h, px, py + h, rr); g.arcTo(px, py + h, px, py, rr); g.arcTo(px, py, px + w, py, rr); g.closePath(); g.fill();
      // 타일 위쪽 하이라이트
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(px + 4, py + 3, w - 8, 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 분수 물줄기 텍스처 (세로 물결 줄무늬, 위아래로 흘러감) */
function makeWaterTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.15)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0.15)');
  g.fillStyle = '#bfeaf7'; g.fillRect(0, 0, 64, 256);
  const r = seeded(5);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.5})`; g.fillRect(r() * 64, r() * 256, 2 + r() * 3, 20 + r() * 50); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function seeded(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

export function World() {
  return (
    <group>
      <Sky />
      <Ground />
      <Paths />
      <Fountain />
      <Trees />
      <Flowers />
      <Benches />
      <Pavilion />
      <Lamps />
      <Fence />
      {BUILDINGS.map((b, i) => <Building key={i} b={b} />)}
      <Clouds />
    </group>
  );
}

function Sky() {
  const g = useMemo(() => {
    const geom = new THREE.SphereGeometry(180, 32, 20);
    // 맑은 하늘: 위는 파스텔 하늘색, 지평선은 하얗게 밝고 아주 살짝 따뜻하게
    const top = new THREE.Color('#7fc4ee'), mid = new THREE.Color('#b9e1f6'), bottom = new THREE.Color('#f4f8f2');
    const pos = geom.attributes.position;
    const colors: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = THREE.MathUtils.clamp(pos.getY(i) / 150, 0, 1);
      if (y < 0.25) c.copy(bottom).lerp(mid, Math.pow(y / 0.25, 0.8));
      else c.copy(mid).lerp(top, Math.pow((y - 0.25) / 0.75, 0.9));
      colors.push(c.r, c.g, c.b);
    }
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geom;
  }, []);
  return (
    <mesh geometry={g} userData={{ noShadow: true }}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}

function Ground() {
  const hills = useMemo<Inst[]>(() => {
    const r = seeded(7);
    const out: Inst[] = [];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + r() * 0.1;
      const d = WORLD_RADIUS + 9 + r() * 14;
      const s = 4 + r() * 6;
      out.push({ p: [Math.sin(a) * d, -s * 0.35, Math.cos(a) * d], r: [0, r() * 3, 0], s: [s * 1.6, s, s * 1.4], c: r() < 0.5 ? '#9fcd86' : '#b3d998' });
    }
    return out;
  }, []);
  const tufts = useMemo<Inst[]>(() => {
    const r = seeded(11);
    const out: Inst[] = [];
    while (out.length < 440) { // 광장 확장에 맞춰 풀 포기도 늘림 (밀도 유지)
      const a = r() * Math.PI * 2, d = 3 + r() * (WORLD_RADIUS - 2);
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (isOnPath(x, z, 0.3)) continue;
      out.push({ p: [x, 0.06, z], r: [0, r() * 3, 0], s: 0.6 + r() * 0.6, c: r() < 0.5 ? PALETTE.grassDark : '#b6db9c' });
    }
    return out;
  }, []);
  return (
    <group>
      <mesh geometry={geo.circle(GROUND_RADIUS, 28)} material={mat(PALETTE.grass)} rotation={[-Math.PI / 2, 0, 0]} />
      <Instanced geometry={geo.dodeca(1)} items={hills} />
      <Instanced geometry={geo.cone(0.08, 0.16, 3)} items={tufts} />
    </group>
  );
}

function Paths() {
  const { plazaGeo, plazaMat } = useMemo(() => {
    const t = makePlazaTexture();
    t.repeat.set(PLAZA_RADIUS * 2 / 2.2, PLAZA_RADIUS * 2 / 2.2); // 타일 묶음 하나가 약 2.2m
    return { plazaGeo: new THREE.CircleGeometry(PLAZA_RADIUS, 64), plazaMat: new THREE.MeshLambertMaterial({ map: t }) };
  }, []);
  return (
    <group>
      {/* 광장 */}
      <mesh geometry={geo.circle(PLAZA_RADIUS + 0.25, 24)} material={mat(PALETTE.pathEdge)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} />
      {/* 광장: 파스텔 벽돌 타일 + 분수 둘레 원형 띠 */}
      <mesh geometry={plazaGeo} material={plazaMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} />
      <mesh geometry={geo.ring(FOUNTAIN_RADIUS + 0.55, FOUNTAIN_RADIUS + 0.95, 48)} material={mat('#e7c3ad')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026, 0]} />
      <mesh geometry={geo.ring(PLAZA_RADIUS - 0.45, PLAZA_RADIUS - 0.15, 64)} material={mat('#e7c3ad')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026, 0]} />
      {/* 순환 산책로 */}
      <mesh geometry={geo.ring(RING_RADIUS - PATH_WIDTH / 2 - 0.2, RING_RADIUS + PATH_WIDTH / 2 + 0.2, 48)} material={mat(PALETTE.pathEdge)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} />
      <mesh geometry={geo.ring(RING_RADIUS - PATH_WIDTH / 2, RING_RADIUS + PATH_WIDTH / 2, 48)} material={mat(PALETTE.path)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} />
      {/* 방사형 산책로 */}
      {RADIAL_ANGLES.map((a, i) => {
        const len = 34 - PLAZA_RADIUS;
        const mid = PLAZA_RADIUS + len / 2;
        return (
          <group key={i} rotation={[0, a, 0]}>
            <mesh geometry={geo.box(PATH_WIDTH + 0.4, 0.02, len)} material={mat(PALETTE.pathEdge)} position={[0, 0.01, mid]} />
            <mesh geometry={geo.box(PATH_WIDTH, 0.03, len)} material={mat(PALETTE.path)} position={[0, 0.02, mid]} />
            {/* 징검 돌 */}
            {Array.from({ length: 9 }).map((_, k) => (
              <mesh key={k} geometry={geo.cyl(0.35, 0.35, 0.03, 6)} material={mat(PALETTE.pathEdge)} position={[(k % 2 ? 0.5 : -0.5), 0.035, PLAZA_RADIUS + 1.5 + k * 3]} />
            ))}
          </group>
        );
      })}
    </group>
  );
}

function Fountain() {
  const spray = useRef<THREE.Group>(null!);
  const ripples = useRef<THREE.Group>(null!);
  const R = FOUNTAIN_RADIUS;
  const parts = useMemo(() => {
    const waterTex = makeWaterTexture();
    const curtainTex = waterTex.clone(); curtainTex.needsUpdate = true; curtainTex.repeat.set(6, 1);
    const jetTex = waterTex.clone(); jetTex.needsUpdate = true; jetTex.repeat.set(2, 1);
    const stone = new THREE.MeshStandardMaterial({ color: '#efe7dc', roughness: 0.85 });
    const stoneDark = new THREE.MeshStandardMaterial({ color: '#dccfbf', roughness: 0.85 });
    const pool = new THREE.MeshStandardMaterial({ color: '#86d3ec', roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.9, emissive: '#4fb6da', emissiveIntensity: 0.18 });
    const curtain = new THREE.MeshStandardMaterial({ map: curtainTex, color: '#dff6fd', transparent: true, opacity: 0.45, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false, emissive: '#bfeaf7', emissiveIntensity: 0.25 });
    const jet = new THREE.MeshStandardMaterial({ map: jetTex, color: '#e8f9ff', transparent: true, opacity: 0.7, roughness: 0.2, depthWrite: false, emissive: '#cdeffb', emissiveIntensity: 0.35 });
    const rings = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
    return {
      stone, stoneDark, pool, curtain, jet, rings, curtainTex, jetTex,
      basin: lathe('fBasin', smoothProfile([[R - 0.2, 0.0], [R + 0.18, 0.0], [R + 0.25, 0.1], [R + 0.2, 0.42], [R + 0.08, 0.58], [R - 0.08, 0.6], [R - 0.2, 0.52], [R - 0.22, 0.2]], 30), 64),
      pillar: lathe('fPillar', smoothProfile([[0.55, 0.3], [0.42, 0.5], [0.3, 0.75], [0.26, 1.2], [0.3, 1.4], [0.42, 1.5]], 24), 40),
      bowl: lathe('fBowl', smoothProfile([[0.3, 1.42], [0.7, 1.5], [1.08, 1.66], [1.2, 1.8], [1.12, 1.86], [0.95, 1.78], [0.2, 1.76]], 28), 56),
      top: lathe('fTop', smoothProfile([[0.24, 1.76], [0.16, 1.95], [0.14, 2.15], [0.22, 2.3], [0.3, 2.42], [0.2, 2.52], [0.02, 2.56]], 24), 32),
      curtainGeo: new THREE.CylinderGeometry(1.19, 1.32, 1.3, 48, 1, true),
      jetGeo: new THREE.CylinderGeometry(0.05, 0.12, 0.75, 16, 1, true),
    };
  }, [R]);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    parts.curtainTex.offset.y -= dt * 0.9;
    parts.jetTex.offset.y += dt * 1.4;
    spray.current.children.forEach((c, i) => {
      const n = spray.current.children.length;
      const k = (t * 0.8 + i / n) % 1;
      const a = (i / n) * Math.PI * 2;
      c.position.set(Math.sin(a) * (0.1 + k * 0.95), 2.95 + Math.sin(k * Math.PI) * 0.45 - k * 1.1, Math.cos(a) * (0.1 + k * 0.95));
      c.scale.setScalar(1 - k * 0.55);
    });
    ripples.current.children.forEach((c, i) => {
      const k = (t * 0.35 + i / 3) % 1;
      c.scale.setScalar(R - 0.9 + k * 0.6);
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - k);
    });
  });
  return (
    <group>
      <mesh geometry={parts.basin} material={parts.stone} />
      <mesh geometry={geo.circle(R - 0.2, 48)} material={parts.pool} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.44, 0]} userData={{ noCast: true }} />
      <group ref={ripples} position={[0, 0.455, 0]}>
        {[0, 1, 2].map((i) => <mesh key={i} geometry={geo.ring(0.96, 1.0, 48)} material={parts.rings[i]} rotation={[-Math.PI / 2, 0, 0]} userData={{ noShadow: true }} />)}
      </group>
      <mesh geometry={parts.pillar} material={parts.stoneDark} />
      <mesh geometry={parts.bowl} material={parts.stone} />
      <mesh geometry={geo.circle(1.06, 40)} material={parts.pool} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.79, 0]} userData={{ noCast: true }} />
      <mesh geometry={parts.top} material={parts.stoneDark} />
      {/* 꼭대기 발바닥 장식 */}
      <group position={[0, 2.62, 0]}>
        <mesh geometry={geo.sphere(0.13, 14, 10)} material={mat('#fdf6ec')} scale={[1.2, 0.85, 1.1]} />
        {[[-0.13, 0.12], [-0.05, 0.19], [0.05, 0.19], [0.13, 0.12]].map(([x, y], i) => <mesh key={i} geometry={geo.sphere(0.05, 10, 8)} material={mat('#fdf6ec')} position={[x, y - 0.02, 0]} />)}
      </group>
      {/* 물줄기: 위로 솟는 분수 + 위 그릇에서 흘러내리는 물 커튼 */}
      <mesh geometry={parts.jetGeo} material={parts.jet} position={[0, 2.85, 0]} userData={{ noShadow: true }} />
      <mesh geometry={parts.curtainGeo} material={parts.curtain} position={[0, 1.18, 0]} userData={{ noShadow: true }} />
      <group ref={spray}>
        {Array.from({ length: 14 }).map((_, i) => <mesh key={i} geometry={geo.sphere(0.06, 8, 6)} material={parts.jet} userData={{ noShadow: true }} />)}
      </group>
    </group>
  );
}

function Trees() {
  const { trunks, foliage, pines } = useMemo(() => {
    const r = seeded(3);
    const trunks: Inst[] = [], foliage: Inst[] = [], pines: Inst[] = [];
    for (const t of TREES) {
      const s = t.scale;
      trunks.push({ p: [t.x, 0.7 * s, t.z], s: [s, s, s], c: PALETTE.trunk });
      if (t.kind === 'pine') {
        [0, 1, 2].forEach((k) => pines.push({ p: [t.x, (1.5 + k * 0.75) * s, t.z], r: [0, t.rot + k, 0], s: [(1.25 - k * 0.3) * s, s, (1.25 - k * 0.3) * s], c: PALETTE.pine[k % 2] }));
      } else {
        const pal = t.kind === 'cherry' ? PALETTE.cherry : PALETTE.leaf;
        const blobs: [number, number, number, number][] = t.kind === 'cherry'
          ? [[0, 2.1, 0, 1.1], [0.75, 1.75, 0.2, 0.75], [-0.7, 1.8, -0.15, 0.8], [0.1, 2.6, -0.3, 0.7]]
          : [[0, 2.0, 0, 1.15], [0.45, 2.55, 0.15, 0.75], [-0.5, 1.7, 0.3, 0.7]];
        blobs.forEach(([x, y, z, sz], k) => {
          const c = Math.cos(t.rot), sn = Math.sin(t.rot);
          foliage.push({ p: [t.x + (x * c - z * sn) * s, y * s, t.z + (x * sn + z * c) * s], r: [0, r() * 6, 0], s: sz * s * 0.95, c: pal[(k + Math.floor(r() * 3)) % pal.length] });
        });
      }
    }
    return { trunks, foliage, pines };
  }, []);
  const shadows = useMemo<Inst[]>(() => TREES.map((t) => ({ p: [t.x, 0.04, t.z], r: [-Math.PI / 2, 0, 0], s: 1.3 * t.scale, c: '#93c07c' })), []);
  // 몽실한 잎 덩어리(아래는 어둡게, 위는 밝게) · 매끈한 원뿔 침엽수
  const puff = useMemo(() => makePuff(13, 0.72, 1.08), []);
  const pineGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(1, 1.3, 12, 3);
    const pos = g.attributes.position;
    const col: number[] = [];
    for (let i = 0; i < pos.count; i++) { const c = 0.8 + 0.28 * THREE.MathUtils.smoothstep(pos.getY(i), -0.65, 0.65); col.push(c, c, c); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, []);
  return (
    <group>
      <Instanced geometry={geo.circle(1, 16)} items={shadows} noCast />
      <Instanced geometry={geo.cyl(0.14, 0.22, 1.4, 8)} items={trunks} />
      <Instanced geometry={puff} items={foliage} smooth />
      <Instanced geometry={pineGeo} items={pines} smooth />
    </group>
  );
}

const HYDRANGEA = ['#b9a6e8', '#a7bdf2', '#f2b6d2', '#f7cfe1', '#cdb9f2', '#fde2a8'];
function Flowers() {
  const { blooms, beds, leaves, daisies } = useMemo(() => {
    const r = seeded(19);
    const blooms: Inst[] = [], beds: Inst[] = [], leaves: Inst[] = [], daisies: Inst[] = [];
    for (const f of FLOWER_BEDS) {
      beds.push({ p: [f.x, 0.03, f.z], r: [-Math.PI / 2, 0, 0], s: f.r, c: '#8fbf79' });
      // 수국 덤불: 잎 덩어리 위에 작은 꽃송이 공을 여러 개 모아 붙임
      const n = Math.round(f.r * 5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.6, d = (0.35 + r() * 0.5) * (f.r - 0.35);
        const cx = f.x + Math.sin(a) * d, cz = f.z + Math.cos(a) * d;
        const color = HYDRANGEA[Math.floor(r() * HYDRANGEA.length)];
        leaves.push({ p: [cx, 0.16, cz], r: [0, r() * 6, 0], s: [0.36, 0.22, 0.36], c: r() < 0.5 ? '#7fb56e' : '#6fa860' });
        for (let k = 0; k < 7; k++) {
          const ka = r() * Math.PI * 2, kd = r() * 0.17;
          blooms.push({ p: [cx + Math.sin(ka) * kd, 0.34 + r() * 0.12, cz + Math.cos(ka) * kd], s: 0.85 + r() * 0.4, c: color });
        }
      }
    }
    // 잔디 위 흩어진 데이지
    while (daisies.length < 380) {
      const a = r() * Math.PI * 2, d = 4 + r() * 30;
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (isOnPath(x, z, 0.4)) continue;
      daisies.push({ p: [x, 0.08, z], r: [r(), r(), r()], s: 0.8, c: r() < 0.7 ? '#ffffff' : '#f6c453' });
    }
    return { blooms, beds, leaves, daisies };
  }, []);
  const bloomGeo = useMemo(() => makePuff(23, 0.85, 1.08), []);
  return (
    <group>
      <Instanced geometry={geo.circle(1, 20)} items={beds} noCast />
      <Instanced geometry={bloomGeo} items={leaves} smooth noCast />
      <Instanced geometry={geo.sphere(0.085, 10, 8)} items={blooms} smooth noCast />
      <Instanced geometry={geo.ico(0.07, 0)} items={daisies} noCast />
    </group>
  );
}

function Benches() {
  const wood = mat(PALETTE.wood), dark = mat(PALETTE.woodDark);
  return (
    <group>
      {BENCHES.map((b, i) => {
        if (b.kind === 'pavilion') return null; // 팔각정 붙박이 의자는 <Pavilion />에서
        const L = benchLength(b);
        const legs = b.seats === 3 ? [-L / 2 + 0.15, 0, L / 2 - 0.15] : [-0.6, 0.6];
        return (
          <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}
            onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); set({ benchMenu: i }); }}
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { document.body.style.cursor = ''; }}>
            <mesh geometry={geo.box(L, 0.08, 0.45)} material={wood} position={[0, 0.42, 0]} />
            <mesh geometry={geo.box(L, 0.32, 0.07)} material={wood} position={[0, 0.66, -0.22]} rotation={[-0.12, 0, 0]} />
            {legs.map((x) => <mesh key={x} geometry={geo.box(0.08, 0.42, 0.4)} material={dark} position={[x, 0.21, 0]} />)}
          </group>
        );
      })}
    </group>
  );
}

/**
 * 멍글 팔각정 — 남서쪽 잔디밭의 정자. 낮은 나무 마루 · 기둥 8개 · 팔각 기와지붕(파스텔 청록) · 7면 안쪽 붙박이 의자(21자리).
 * 광장 쪽 1면은 출입구. 의자를 누르면 벤치처럼 앉을 자리를 고름.
 */
function Pavilion() {
  const P = PAVILION;
  const parts = useMemo(() => {
    const R = P.r;
    const vert = (k: number, r = R) => { const a = pavilionSideAngle(k) + Math.PI / 8; return [Math.sin(a) * r, Math.cos(a) * r] as const; };
    const sides = Array.from({ length: 8 }, (_, k) => {
      const a = pavilionSideAngle(k);
      const apo = R * Math.cos(Math.PI / 8);
      return { k, a, apo, len: 2 * R * Math.sin(Math.PI / 8) };
    });
    return { vert, sides };
  }, []);
  const stone = mat('#ece1d3'), stoneEdge = mat('#d9c9b4'), deck = mat('#e2bf93'), deckLine = mat('#cfa577');
  const pillar = mat('#c97a5a'), beam = mat('#b9684b');
  // 지붕: 팔각정 안·입구에 들어서면 반투명해져 안에 둘러앉은 사람들이 보이게
  const roofMats = useMemo(() => ['#8fbcb0', '#76a597', '#f3e2c7', '#c97a5a'].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, transparent: true, opacity: 1 })), []);
  const [roof, roofDark, eave, finial] = roofMats;
  const tag = useRef<HTMLDivElement>(null);
  useFrame((_, dt) => {
    const near = Math.hypot(local.x - P.x, local.z - P.z) < P.r + 1.6;
    // 안에 들어오면 이름표 숨김 (가까이서 크게 보여 화면 위쪽을 가리지 않게)
    if (tag.current) tag.current.style.display = near ? 'none' : '';
    const want = near ? 0.22 : 1;
    for (const m of roofMats) {
      if (Math.abs(m.opacity - want) < 0.005) continue;
      m.opacity += (want - m.opacity) * Math.min(1, dt * 6);
      m.depthWrite = m.opacity > 0.95;
    }
  });
  const seatWood = mat(PALETTE.wood), seatDark = mat(PALETTE.woodDark);
  const H = 2.7; // 기둥 높이
  const open = (i: number) => { set({ benchMenu: i }); };
  return (
    <group position={[P.x, 0, P.z]}>
      {/* 기단 (돌) · 마루 (나무) */}
      <mesh geometry={geo.cyl(P.r + 0.55, P.r + 0.7, 0.1, 8)} material={stoneEdge} position={[0, 0.03, 0]} rotation={[0, P.rot + Math.PI / 8, 0]} />
      <mesh geometry={geo.cyl(P.r + 0.35, P.r + 0.45, 0.06, 8)} material={stone} position={[0, 0.09, 0]} rotation={[0, P.rot + Math.PI / 8, 0]} />
      <mesh geometry={geo.cyl(P.r + 0.1, P.r + 0.1, 0.04, 8)} material={deck} position={[0, 0.12, 0]} rotation={[0, P.rot + Math.PI / 8, 0]} />
      {/* 마루 널 무늬 */}
      {[-2.4, -1.2, 0, 1.2, 2.4].map((o) => (
        <mesh key={o} geometry={geo.box(0.04, 0.01, 2 * Math.sqrt(Math.max(0, (P.r * 0.92) ** 2 - o * o)))} material={deckLine}
          position={[Math.cos(P.rot) * o, 0.145, -Math.sin(P.rot) * o]} rotation={[0, P.rot, 0]} />
      ))}
      {/* 출입구 계단 */}
      <mesh geometry={geo.box(2.2, 0.08, 0.6)} material={stone} position={[Math.sin(P.rot) * (P.r + 0.75), 0.04, Math.cos(P.rot) * (P.r + 0.75)]} rotation={[0, P.rot, 0]} />
      {/* 기둥 8개 + 위쪽 들보 */}
      {parts.sides.map(({ k }) => {
        const [x, z] = parts.vert(k);
        return <mesh key={`p${k}`} geometry={geo.cyl(0.13, 0.15, H, 8)} material={pillar} position={[x, 0.14 + H / 2, z]} />;
      })}
      {parts.sides.map(({ k, a, apo, len }) => (
        <group key={`s${k}`} rotation={[0, a, 0]}>
          {/* 들보 */}
          <mesh geometry={geo.box(len + 0.2, 0.22, 0.2)} material={beam} position={[0, 0.14 + H - 0.05, apo]} />
          {/* 출입구가 아닌 면: 낮은 난간 + 안쪽 붙박이 의자 */}
          {k !== 0 && <>
            <mesh geometry={geo.box(len - 0.3, 0.07, 0.08)} material={beam} position={[0, 0.78, apo]} />
            {[-0.9, 0, 0.9].map((o) => <mesh key={o} geometry={geo.box(0.06, 0.64, 0.06)} material={beam} position={[o, 0.46, apo]} />)}
          </>}
        </group>
      ))}
      {/* 붙박이 의자 (BENCHES의 'pavilion' 항목 — 좌석·충돌과 같은 위치) */}
      {BENCHES.map((b, i) => b.kind === 'pavilion' && (
        <group key={`b${i}`} position={[b.x - P.x, 0, b.z - P.z]} rotation={[0, b.rot, 0]}
          onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); open(i); }}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = ''; }}>
          <mesh geometry={geo.box(benchLength(b) + 0.35, 0.08, 0.48)} material={seatWood} position={[0, 0.42, 0]} />
          {[-0.9, 0, 0.9].map((x) => <mesh key={x} geometry={geo.box(0.08, 0.3, 0.42)} material={seatDark} position={[x, 0.29, 0]} />)}
        </group>
      ))}
      {/* 지붕: 처마(넓은 판) + 팔각 기와지붕 + 꼭대기 장식 */}
      <group position={[0, 0.14 + H + 0.08, 0]} rotation={[0, P.rot + Math.PI / 8, 0]}>
        <mesh geometry={geo.cyl(P.r + 0.95, P.r + 1.05, 0.14, 8)} material={eave} position={[0, 0, 0]} />
        <mesh geometry={geo.cyl(P.r + 1.15, P.r + 1.2, 0.1, 8)} material={roofDark} position={[0, 0.1, 0]} />
        <mesh geometry={geo.cone(P.r + 1.05, 2.1, 8)} material={roof} position={[0, 1.15, 0]} />
        <mesh geometry={geo.cyl(0.18, 0.28, 0.3, 8)} material={roofDark} position={[0, 2.3, 0]} />
        <mesh geometry={geo.ico(0.22, 0)} material={finial} position={[0, 2.58, 0]} />
      </group>
      <Html position={[0, 0.14 + H + 3.2, 0]} center distanceFactor={22} zIndexRange={[5, 0]}>
        <div ref={tag} className="name-tag" style={{ fontSize: 13, pointerEvents: 'none' }}>🪵 멍글 팔각정 · 다 같이 앉아요</div>
      </Html>
    </group>
  );
}

function Lamps() {
  const post = mat('#5a4a44');
  const glow = useMemo(() => new THREE.MeshLambertMaterial({ color: '#fff1b8', emissive: '#ffd77a', emissiveIntensity: 0.6, flatShading: true }), []);
  return (
    <group>
      {LAMPS.map((l, i) => (
        <group key={i} position={[l.x, 0, l.z]}>
          <mesh geometry={geo.cyl(0.06, 0.09, 2.2, 5)} material={post} position={[0, 1.1, 0]} />
          <mesh geometry={geo.cyl(0.14, 0.2, 0.32, 4)} material={glow} position={[0, 2.35, 0]} />
          <mesh geometry={geo.cone(0.26, 0.22, 4)} material={post} position={[0, 2.62, 0]} />
        </group>
      ))}
    </group>
  );
}

function Fence() {
  const { posts, rails } = useMemo(() => {
    const posts: Inst[] = [], rails: Inst[] = [];
    const R = WORLD_RADIUS + 1.2;
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const a2 = ((i + 1) / n) * Math.PI * 2;
      const gap = (ang: number) => RADIAL_ANGLES.some((ra) => Math.abs(Math.atan2(Math.sin(ang - ra), Math.cos(ang - ra))) < 0.07);
      if (gap(a)) continue;
      posts.push({ p: [Math.sin(a) * R, 0.4, Math.cos(a) * R], c: PALETTE.wood });
      if (gap(a2)) continue;
      const am = (a + a2) / 2;
      const len = 2 * R * Math.sin(Math.PI / n);
      for (const y of [0.35, 0.62]) rails.push({ p: [Math.sin(am) * R, y, Math.cos(am) * R], r: [0, am + Math.PI / 2, 0], s: [len, 1, 1], c: '#c9976a' });
    }
    return { posts, rails };
  }, []);
  return (
    <group>
      <Instanced geometry={geo.box(0.12, 0.8, 0.12)} items={posts} />
      <Instanced geometry={geo.box(1, 0.08, 0.06)} items={rails} />
    </group>
  );
}

function Building({ b }: { b: BuildingDef }) {
  if (b.kind === 'apartment') return <Apartment b={b} />;
  return <SmallBuilding b={b} />;
}

/** 아파트 선택: 로비로 들어가면 호실 안내판(호실 선택·입주)이 열림. 로비에 들어가지 못하면 안내만 (스크린 등 다른 창은 열지 않음) */
function openApartment() { void joinPark('lobby-1'); }

/** 멍글 아파트 1동 — 둥근 모서리의 4층 파스텔 건물, 층마다 4호실 창문·발코니, 1층 로비 입구 */
function Apartment({ b }: { b: BuildingDef }) {
  const FLOORS = 4, FH = 1.55, BASE = 0.3;
  const H = FLOORS * FH;
  const wall = mat(b.wall), band = mat('#f7c9b4'), coral = mat(b.roof), sage = mat('#a9cfa0'), win = mat('#bfe3f5');
  const winWarm = mat('#ffe6a8'), trim = mat('#ffffff'), wood = mat(PALETTE.woodDark), glass = mat('#d6eef7');
  const W = b.w, D = b.d;
  const cols = [-3.6, -1.2, 1.2, 3.6];
  return (
    <group position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}
      // 아파트 건물(보이는 부분)을 누르면 로비로 → 호실 안내판(호실 선택·입주)이 바로 열림
      onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); openApartment(); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
      {/* 기단 */}
      <mesh geometry={geo.box(W + 0.4, BASE, D + 0.4)} material={mat(PALETTE.stoneDark)} position={[0, BASE / 2, 0]} />
      {/* 본체 + 둥근 모서리 기둥 */}
      <mesh geometry={geo.box(W - 1.0, H, D)} material={wall} position={[0, BASE + H / 2, 0]} />
      <mesh geometry={geo.box(W, H, D - 1.0)} material={wall} position={[0, BASE + H / 2, 0]} />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={i} geometry={geo.cyl(0.5, 0.5, H, 10)} material={wall} position={[sx * (W / 2 - 0.5), BASE + H / 2, sz * (D / 2 - 0.5)]} />
      ))}
      {/* 층 띠 */}
      {Array.from({ length: FLOORS }).map((_, f) => (
        <mesh key={f} geometry={geo.box(W + 0.08, 0.12, D + 0.08)} material={f === 0 ? sage : band} position={[0, BASE + f * FH + 0.02, 0]} />
      ))}
      {/* 지붕: 코랄색 둥근 지붕 + 발바닥 간판 */}
      <mesh geometry={geo.box(W + 0.3, 0.3, D + 0.3)} material={coral} position={[0, BASE + H + 0.15, 0]} />
      <mesh geometry={geo.cyl(D / 2 - 0.2, D / 2 - 0.2, W - 1.6, 14)} material={coral} position={[0, BASE + H + 0.3, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.55]} />
      <group position={[0, BASE + H + 1.2, D / 2 - 0.9]}>
        <mesh geometry={geo.cyl(0.75, 0.75, 0.12, 12)} material={mat('#fff8ef')} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={geo.cyl(0.26, 0.26, 0.14, 8)} material={coral} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.12, 0.02]} />
        {[[-0.3, 0.16], [-0.12, 0.35], [0.12, 0.35], [0.3, 0.16]].map(([x, y], i) => (
          <mesh key={i} geometry={geo.cyl(0.09, 0.09, 0.14, 6)} material={coral} rotation={[Math.PI / 2, 0, 0]} position={[x, y, 0.02]} />
        ))}
      </group>
      {/* 앞면: 2~4층은 호실 창문 + 발코니, 1층은 창문 2개 + 로비 입구 */}
      {Array.from({ length: FLOORS }).map((_, f) => cols.map((x, c) => {
        if (f === 0 && (c === 1 || c === 2)) return null;
        const y = BASE + f * FH + FH * 0.55;
        const warm = (f * 4 + c) % 3 === 0;
        return (
          <group key={`${f}-${c}`} position={[x, y, D / 2 + 0.02]}>
            <mesh geometry={geo.box(1.0, 0.85, 0.08)} material={trim} />
            <mesh geometry={geo.box(0.84, 0.7, 0.1)} material={warm ? winWarm : win} />
            <mesh geometry={geo.box(0.06, 0.7, 0.12)} material={trim} />
            {f > 0 && (
              <group position={[0, -0.5, 0.28]}>
                <mesh geometry={geo.box(1.25, 0.08, 0.55)} material={trim} />
                <mesh geometry={geo.box(1.25, 0.3, 0.05)} material={c % 2 ? sage : band} position={[0, 0.17, 0.26]} />
                {/* 화분 */}
                <mesh geometry={geo.cyl(0.08, 0.06, 0.12, 6)} material={mat('#d98c4a')} position={[0.42, 0.1, 0.05]} />
                <mesh geometry={geo.ico(0.1, 0)} material={mat(PALETTE.flower[(f + c) % 5])} position={[0.42, 0.22, 0.05]} />
              </group>
            )}
          </group>
        );
      }))}
      {/* 옆면 창문 */}
      {[-1, 1].map((sx) => Array.from({ length: FLOORS }).map((_, f) => (
        <group key={`${sx}-${f}`} position={[sx * (W / 2 + 0.02), BASE + f * FH + FH * 0.55, 0]} rotation={[0, sx * Math.PI / 2, 0]}>
          <mesh geometry={geo.box(0.9, 0.8, 0.08)} material={trim} />
          <mesh geometry={geo.box(0.74, 0.64, 0.1)} material={win} />
        </group>
      )))}
      {/* 로비 입구: 유리문 + 둥근 차양 + 계단 */}
      <group position={[0, BASE, D / 2]}>
        <mesh geometry={geo.box(2.1, 1.85, 0.1)} material={trim} position={[0, 0.95, 0.03]} />
        <mesh geometry={geo.box(0.9, 1.7, 0.12)} material={glass} position={[-0.47, 0.88, 0.05]} />
        <mesh geometry={geo.box(0.9, 1.7, 0.12)} material={glass} position={[0.47, 0.88, 0.05]} />
        {[-0.08, 0.08].map((x) => <mesh key={x} geometry={geo.box(0.04, 0.4, 0.16)} material={wood} position={[x, 0.9, 0.08]} />)}
        <mesh geometry={geo.cyl(0.6, 0.6, 2.5, 10, )} material={coral} position={[0, 2.05, 0.45]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.45]} />
        {[-1.1, 1.1].map((x) => <mesh key={x} geometry={geo.cyl(0.07, 0.07, 1.9, 6)} material={trim} position={[x, 0.95, 0.75]} />)}
        <mesh geometry={geo.box(2.6, 0.12, 0.6)} material={mat(PALETTE.stone)} position={[0, -0.24, 0.55]} />
        <mesh geometry={geo.box(3.0, 0.12, 0.6)} material={mat(PALETTE.stoneDark)} position={[0, -0.24 - 0.1, 0.95]} />
        {/* 입구 양옆 화단 */}
        {[-1.7, 1.7].map((x) => (
          <group key={x} position={[x, 0, 0.55]}>
            <mesh geometry={geo.box(0.7, 0.35, 0.5)} material={mat('#e2cfae')} position={[0, 0.0, 0]} />
            <mesh geometry={geo.ico(0.32, 0)} material={sage} position={[0, 0.3, 0]} />
          </group>
        ))}
      </group>
      <Html position={[0, BASE + 2.75, D / 2 + 0.6]} center distanceFactor={22} zIndexRange={[5, 0]}>
        {/* 광장에서 보면 이 이름표가 광장 스크린 위에 겹쳐 보임 → 이름표를 누르면 아파트 로비(호실 안내판)로 가고,
            그 터치가 뒤의 스크린(사진 신청 안내)으로 새지 않게 막는다 */}
        <button type="button" className="name-tag" style={{ fontSize: 13, pointerEvents: 'auto', cursor: 'pointer' }} data-testid="apartment-tag"
          onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); openApartment(); }}>🏢 멍글 아파트 1동 · 로비 입구</button>
      </Html>
    </group>
  );
}

function SmallBuilding({ b }: { b: BuildingDef }) {
  const wall = mat(b.wall), roof = mat(b.roof), wood = mat(PALETTE.woodDark), win = mat('#bfe3f5'), trim = mat('#ffffff');
  const h = 2.6;
  // 삼각 지붕: 3각 실린더를 눕혀 사용
  const roofGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
    g.rotateZ(Math.PI / 2);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  return (
    <group position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
      <mesh geometry={geo.box(b.w, 0.25, b.d)} material={mat(PALETTE.stoneDark)} position={[0, 0.12, 0]} />
      <mesh geometry={geo.box(b.w - 0.3, h, b.d - 0.3)} material={wall} position={[0, 0.25 + h / 2, 0]} />
      <mesh geometry={roofGeo} material={roof} position={[0, 0.25 + h + 0.7, 0]} rotation={[0, Math.PI / 2, 0]} scale={[b.w * 0.62, 1.6, b.d * 0.62]} />
      {/* 문 */}
      <mesh geometry={geo.box(1.0, 1.7, 0.1)} material={wood} position={[0, 0.25 + 0.85, b.d / 2 - 0.12]} />
      <mesh geometry={geo.ico(0.06, 0)} material={mat('#f6c453')} position={[0.32, 1.1, b.d / 2 - 0.05]} />
      {/* 창문 */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (b.w / 2 - 1.15), 1.65, b.d / 2 - 0.13]}>
          <mesh geometry={geo.box(0.9, 0.8, 0.06)} material={trim} />
          <mesh geometry={geo.box(0.74, 0.64, 0.08)} material={win} />
        </group>
      ))}
      {b.kind === 'cafe' && (
        // 줄무늬 차양
        <group position={[0, 2.35, b.d / 2]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <mesh key={i} geometry={geo.box((b.w - 0.6) / 6, 0.06, 0.8)} material={mat(i % 2 ? '#fff8ef' : '#f6c453')} position={[-(b.w - 0.6) / 2 + ((b.w - 0.6) / 6) * (i + 0.5), 0, 0.25]} rotation={[0.35, 0, 0]} />
          ))}
        </group>
      )}
      {b.kind === 'shop' && (
        <mesh geometry={geo.box(1.6, 0.4, 0.08)} material={mat('#fff8ef')} position={[0, 2.35, b.d / 2 - 0.08]} />
      )}
    </group>
  );
}

function Clouds() {
  const ref = useRef<THREE.Group>(null!);
  const clouds = useMemo(() => {
    const r = seeded(29);
    return Array.from({ length: 11 }).map(() => ({ x: (r() - 0.5) * 160, y: 26 + r() * 14, z: -45 - r() * 60 + (r() < 0.35 ? 120 : 0), s: 2.6 + r() * 2.6 }));
  }, []);
  const puff = useMemo(() => makePuff(31, 0.86, 1.0, 0.35), []);
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.35, fog: false }), []);
  useFrame((_, dt) => {
    ref.current.children.forEach((c) => { c.position.x += dt * 0.6; if (c.position.x > 90) c.position.x = -90; });
  });
  return (
    <group ref={ref}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={c.s}>
          {([[0, 0, 0, 1.1], [1.15, -0.2, 0.1, 0.8], [-1.1, -0.25, 0.05, 0.78], [0.45, 0.45, -0.1, 0.72], [-0.5, 0.35, 0.15, 0.65]] as const).map(([x, y, z, sc], k) => (
            <mesh key={k} geometry={puff} material={white} position={[x, y, z]} scale={[sc, sc * 0.8, sc * 0.9]} userData={{ noShadow: true }} />
          ))}
        </group>
      ))}
    </group>
  );
}
