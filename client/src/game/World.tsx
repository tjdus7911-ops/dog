// 로우폴리 중앙 공원 — 분수대 · 산책로 · 잔디 · 벚꽃/일반 나무 · 벤치 · 꽃밭 · 건물 · 강아지 집 입구
// 반복되는 오브젝트(나무·꽃·풀·울타리)는 InstancedMesh로 묶어 드로우콜을 최소화했다.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  BENCHES, BUILDINGS, FLOWER_BEDS, FOUNTAIN_RADIUS, GROUND_RADIUS, LAMPS, PATH_WIDTH, PLAZA_RADIUS, RADIAL_ANGLES,
  RING_RADIUS, TREES, WORLD_RADIUS, isOnPath, type BuildingDef,
} from '@shared/world';
import { PALETTE, geo, mat } from './lowpoly';
import { set } from '../store';

interface Inst { p: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number; c: string }

/** 인스턴스 묶음: 한 지오메트리를 여러 위치/색상으로 한 번에 그린다 */
function Instanced({ geometry, items }: { geometry: THREE.BufferGeometry; items: Inst[] }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const material = useMemo(() => new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), []);
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
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} frustumCulled={false} />;
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
      <Lamps />
      <Fence />
      {BUILDINGS.map((b, i) => <Building key={i} b={b} />)}
      <Clouds />
    </group>
  );
}

function Sky() {
  const g = useMemo(() => {
    const geom = new THREE.SphereGeometry(180, 16, 10);
    const top = new THREE.Color('#bfe3f5'), bottom = new THREE.Color('#fff2e3');
    const pos = geom.attributes.position;
    const colors: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = THREE.MathUtils.clamp(pos.getY(i) / 120, 0, 1);
      c.copy(bottom).lerp(top, Math.pow(y, 0.6));
      colors.push(c.r, c.g, c.b);
    }
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geom;
  }, []);
  return (
    <mesh geometry={g}>
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
    while (out.length < 260) {
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
  return (
    <group>
      {/* 광장 */}
      <mesh geometry={geo.circle(PLAZA_RADIUS + 0.25, 24)} material={mat(PALETTE.pathEdge)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} />
      <mesh geometry={geo.circle(PLAZA_RADIUS, 24)} material={mat(PALETTE.path)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} />
      {/* 광장 바닥 패턴 */}
      <mesh geometry={geo.ring(4.2, 4.5, 24)} material={mat(PALETTE.pathEdge)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} />
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
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    spray.current.children.forEach((c, i) => {
      const k = (t * 0.9 + i / spray.current.children.length) % 1;
      const a = (i / spray.current.children.length) * Math.PI * 2;
      c.position.set(Math.sin(a) * k * 1.1, 2.15 + Math.sin(k * Math.PI) * 0.6 - k * 0.7, Math.cos(a) * k * 1.1);
      c.scale.setScalar(1 - k * 0.5);
    });
  });
  const stone = mat(PALETTE.stone), dark = mat(PALETTE.stoneDark), water = mat(PALETTE.water);
  return (
    <group>
      <mesh geometry={geo.cyl(FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.15, 0.55, 10)} material={stone} position={[0, 0.27, 0]} />
      <mesh geometry={geo.cyl(FOUNTAIN_RADIUS - 0.25, FOUNTAIN_RADIUS - 0.25, 0.05, 10)} material={water} position={[0, 0.5, 0]} />
      <mesh geometry={geo.cyl(0.35, 0.5, 1.1, 8)} material={dark} position={[0, 1.0, 0]} />
      <mesh geometry={geo.cyl(1.15, 0.7, 0.32, 9)} material={stone} position={[0, 1.6, 0]} />
      <mesh geometry={geo.cyl(1.0, 1.0, 0.05, 9)} material={water} position={[0, 1.75, 0]} />
      {/* 꼭대기: 발바닥 장식 */}
      <group position={[0, 2.1, 0]}>
        <mesh geometry={geo.cyl(0.18, 0.24, 0.55, 6)} material={dark} />
        <mesh geometry={geo.ico(0.2, 0)} material={mat('#fdf6ec')} position={[0, 0.38, 0]} scale={[1.1, 0.8, 1.1]} />
      </group>
      <group ref={spray}>
        {Array.from({ length: 10 }).map((_, i) => <mesh key={i} geometry={geo.ico(0.07, 0)} material={mat('#c8ecf6')} />)}
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
          foliage.push({ p: [t.x + (x * c - z * sn) * s, y * s, t.z + (x * sn + z * c) * s], r: [r(), r() * 3, r()], s: sz * s, c: pal[(k + Math.floor(r() * 3)) % pal.length] });
        });
      }
    }
    return { trunks, foliage, pines };
  }, []);
  const shadows = useMemo<Inst[]>(() => TREES.map((t) => ({ p: [t.x, 0.04, t.z], r: [-Math.PI / 2, 0, 0], s: 1.3 * t.scale, c: '#93c07c' })), []);
  return (
    <group>
      <Instanced geometry={geo.circle(1, 8)} items={shadows} />
      <Instanced geometry={geo.cyl(0.14, 0.22, 1.4, 5)} items={trunks} />
      <Instanced geometry={geo.ico(1, 0)} items={foliage} />
      <Instanced geometry={geo.cone(1, 1.3, 6)} items={pines} />
    </group>
  );
}

function Flowers() {
  const { blooms, beds } = useMemo(() => {
    const r = seeded(19);
    const blooms: Inst[] = [], beds: Inst[] = [];
    for (const f of FLOWER_BEDS) {
      beds.push({ p: [f.x, 0.03, f.z], r: [-Math.PI / 2, 0, 0], s: f.r, c: '#93c27b' });
      const n = Math.round(f.r * 14);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (f.r - 0.15);
        blooms.push({ p: [f.x + Math.sin(a) * d, 0.16 + r() * 0.08, f.z + Math.cos(a) * d], r: [r(), r(), r()], s: 0.9 + r() * 0.5, c: PALETTE.flower[Math.floor(r() * PALETTE.flower.length)] });
      }
    }
    // 잔디 위 흩어진 데이지
    while (blooms.length < 420) {
      const a = r() * Math.PI * 2, d = 4 + r() * 30;
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (isOnPath(x, z, 0.4)) continue;
      blooms.push({ p: [x, 0.08, z], r: [r(), r(), r()], s: 0.8, c: r() < 0.7 ? '#ffffff' : '#f6c453' });
    }
    return { blooms, beds };
  }, []);
  return (
    <group>
      <Instanced geometry={geo.circle(1, 9)} items={beds} />
      <Instanced geometry={geo.ico(0.07, 0)} items={blooms} />
    </group>
  );
}

function Benches() {
  const wood = mat(PALETTE.wood), dark = mat(PALETTE.woodDark);
  return (
    <group>
      {BENCHES.map((b, i) => (
        <group key={i} position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}
          onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); set({ benchMenu: i }); }}
          onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = ''; }}>
          <mesh geometry={geo.box(1.5, 0.08, 0.45)} material={wood} position={[0, 0.42, 0]} />
          <mesh geometry={geo.box(1.5, 0.32, 0.07)} material={wood} position={[0, 0.66, -0.22]} rotation={[-0.12, 0, 0]} />
          {[-0.6, 0.6].map((x) => <mesh key={x} geometry={geo.box(0.08, 0.42, 0.4)} material={dark} position={[x, 0.21, 0]} />)}
        </group>
      ))}
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

/** 멍글 아파트 1동 — 둥근 모서리의 4층 파스텔 건물, 층마다 4호실 창문·발코니, 1층 로비 입구 */
function Apartment({ b }: { b: BuildingDef }) {
  const FLOORS = 4, FH = 1.55, BASE = 0.3;
  const H = FLOORS * FH;
  const wall = mat(b.wall), band = mat('#f7c9b4'), coral = mat(b.roof), sage = mat('#a9cfa0'), win = mat('#bfe3f5');
  const winWarm = mat('#ffe6a8'), trim = mat('#ffffff'), wood = mat(PALETTE.woodDark), glass = mat('#d6eef7');
  const W = b.w, D = b.d;
  const cols = [-3.6, -1.2, 1.2, 3.6];
  return (
    <group position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
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
        <div className="name-tag" style={{ fontSize: 13 }}>🏢 멍글 아파트 1동 · 로비 입구</div>
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
    return Array.from({ length: 9 }).map(() => ({ x: (r() - 0.5) * 140, y: 22 + r() * 10, z: -40 - r() * 60 + (r() < 0.4 ? 110 : 0), s: 2 + r() * 2.5 }));
  }, []);
  useFrame((_, dt) => {
    ref.current.children.forEach((c) => { c.position.x += dt * 0.6; if (c.position.x > 80) c.position.x = -80; });
  });
  const white = mat('#ffffff');
  return (
    <group ref={ref}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={c.s}>
          <mesh geometry={geo.dodeca(1)} material={white} />
          <mesh geometry={geo.dodeca(0.75)} material={white} position={[1.1, -0.2, 0]} />
          <mesh geometry={geo.dodeca(0.7)} material={white} position={[-1.05, -0.25, 0.1]} />
        </group>
      ))}
    </group>
  );
}
