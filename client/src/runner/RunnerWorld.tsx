// 멍글런너 3D 공간 v2 — 파스텔 강아지 레이싱 테마파크 (시안)
// 원칙
// - 게임 판정·트랙 구조(트랙마다 3레인, 트랙 간격)·장애물·강아지는 그대로. 배경과 트랙 꾸밈만 바꾼다.
// - 반복 소품은 '색이 들어간 한 덩어리 모양'(정점 색)으로 합쳐 InstancedMesh 하나로 그린다 → 소품 종류당 그리기 1번.
// - 같은 소품도 위치·크기·회전·밀도를 씨앗 난수로 다르게 (같은 모양이 줄지어 반복되지 않게).
// - 가까운 소품은 달리는 속도로 지나가고(속도감), 먼 언덕·관람차·구름은 거의 움직이지 않음(깊이감).
// - 큰 텍스처를 쓰지 않음 (로고판 글씨만 작은 캔버스 텍스처 1장).
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { countIn } from '@shared/runner';
import { AHEAD_MS, LANE_W, sceneNow, type PlayGame } from './RunnerPlay';

export const PARK_SKY = '#cdeefc';
export const PARK_FOG = '#eef4ee';

// ---------------------------------------------------------------- 모양 만들기 (정점 색으로 합치기)
type V3 = [number, number, number];
interface Piece { g: THREE.BufferGeometry; c: string; p?: V3; s?: V3 | number; r?: V3 }
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
function build(pieces: Piece[]): THREE.BufferGeometry {
  const list = pieces.map(({ g, c, p = [0, 0, 0], s = 1, r = [0, 0, 0] }) => {
    const x = (g.index ? g.toNonIndexed() : g.clone());
    x.deleteAttribute('uv');
    const sc = typeof s === 'number' ? [s, s, s] : s;
    tmpM.compose(tmpV.set(...p), tmpQ.setFromEuler(tmpE.set(...r)), tmpS.set(sc[0], sc[1], sc[2]));
    x.applyMatrix4(tmpM);
    const col = new THREE.Color(c);
    const n = x.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    x.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return x;
  });
  const out = mergeGeometries(list, false)!;
  out.computeBoundingSphere();
  return out;
}
const S = (r: number, w = 18, h = 14) => new THREE.SphereGeometry(r, w, h);
const C = (rt: number, rb: number, h: number, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
const CAP = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 4, 12);
const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
const vcTint = new THREE.MeshLambertMaterial({ vertexColors: true, color: '#ffffff' });

/** 씨앗 난수 (항상 같은 배치) */
function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

// 소품 모양
const paw = (c: string, y = 0): Piece[] => [
  { g: S(0.2, 16, 8), c, p: [0, y, 0.06], s: [1.15, 0.12, 0.95] },
  ...[[-0.2, -0.16], [-0.08, -0.27], [0.08, -0.27], [0.2, -0.16]].map(([x, z]) => ({ g: S(0.075, 12, 6), c, p: [x, y, z] as V3, s: [1, 0.14, 1.15] as V3 })),
];
const GEO = {
  curb: () => build([{ g: CAP(0.11, 0.78), c: '#ffffff', p: [0, 0.06, 0], r: [Math.PI / 2, 0, 0] }]),
  dash: () => build([{ g: CAP(0.045, 0.7), c: '#ffffff', p: [0, 0.012, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.25] }]),
  paw: () => build(paw('#f6c9b4', 0.008)),
  star: () => build([{ g: new THREE.CircleGeometry(0.16, 5), c: '#ffd86b', p: [0, 0.012, 0], r: [-Math.PI / 2, 0, Math.PI / 10] }]),
  fence: () => build([
    ...[-0.62, 0, 0.62].map((z) => ({ g: CAP(0.045, 0.42), c: '#fff7ea', p: [0, 0.3, z] as V3 })),
    ...[-0.62, 0, 0.62].map((z) => ({ g: S(0.06, 10, 8), c: '#ffd1dc', p: [0, 0.6, z] as V3 })),
    { g: CAP(0.03, 1.3), c: '#fff7ea', p: [0, 0.42, 0], r: [Math.PI / 2, 0, 0] },
    { g: CAP(0.03, 1.3), c: '#fff7ea', p: [0, 0.22, 0], r: [Math.PI / 2, 0, 0] },
  ]),
  bush: () => build([{ g: S(0.42), c: '#9fd89a', s: [1.2, 0.8, 1] }, { g: S(0.3), c: '#b5e4a8', p: [0.36, 0.06, 0.1] }, { g: S(0.26), c: '#8fcf8f', p: [-0.32, 0.02, -0.08] }, { g: S(0.07, 8, 6), c: '#ffb3c7', p: [0.15, 0.32, 0.22] }, { g: S(0.06, 8, 6), c: '#ffffff', p: [-0.2, 0.28, 0.2] }]),
  treeMint: () => build([{ g: C(0.1, 0.15, 1.3, 10), c: '#c89a72', p: [0, 0.65, 0] }, { g: S(0.85), c: '#a6dfa6', p: [0, 1.75, 0] }, { g: S(0.6), c: '#bde9b4', p: [0.5, 2.1, 0.2] }, { g: S(0.55), c: '#93d39a', p: [-0.45, 1.95, -0.2] }, { g: S(0.45), c: '#c9efbf', p: [0.05, 2.45, -0.1] }]),
  treePink: () => build([{ g: C(0.1, 0.15, 1.2, 10), c: '#c89a72', p: [0, 0.6, 0] }, { g: S(0.8), c: '#ffc9d8', p: [0, 1.65, 0] }, { g: S(0.58), c: '#ffd9e3', p: [0.45, 2.0, 0.15] }, { g: S(0.5), c: '#ffb7cb', p: [-0.42, 1.85, -0.15] }]),
  treeLemon: () => build([{ g: C(0.09, 0.13, 1.0, 10), c: '#c89a72', p: [0, 0.5, 0] }, { g: S(0.62), c: '#fff0a8', p: [0, 1.35, 0], s: [1, 1.15, 1] }, { g: S(0.42), c: '#ffe68a', p: [0, 1.95, 0] }]),
  flower: () => build([{ g: S(0.075, 10, 6), c: '#ffffff', p: [0, 0.16, 0] }, { g: S(0.035, 8, 6), c: '#ffd86b', p: [0, 0.2, 0.05] }, { g: C(0.012, 0.012, 0.16, 5), c: '#7cc27c', p: [0, 0.08, 0] }]),
  balloon: () => build([{ g: S(0.2), c: '#ffffff', p: [0, 0, 0], s: [1, 1.18, 1] }, { g: new THREE.ConeGeometry(0.045, 0.06, 8), c: '#ffffff', p: [0, -0.25, 0], r: [Math.PI, 0, 0] }, { g: C(0.006, 0.006, 1.3, 4), c: '#ffffff', p: [0, -0.92, 0] }]),
  flag: () => build([{ g: new THREE.ConeGeometry(0.16, 0.34, 3), c: '#ffffff', r: [Math.PI, 0, 0], s: [1, 1, 0.12] }]),
  pole: () => build([{ g: C(0.04, 0.05, 2.5, 10), c: '#fff7ea', p: [0, 1.25, 0] }, { g: S(0.09, 12, 8), c: '#ffd86b', p: [0, 2.55, 0] }]),
  sign: () => build([
    { g: C(0.05, 0.06, 1.0, 10), c: '#d8b08a', p: [0, 0.5, 0] },
    { g: new THREE.BoxGeometry(0.85, 0.5, 0.08), c: '#fff7ea', p: [0, 1.15, 0] },
    { g: CAP(0.04, 0.84), c: '#ffb7cb', p: [0, 1.42, 0], r: [0, 0, Math.PI / 2] },
    ...paw('#f39a7b').map((x) => ({ ...x, p: [x.p![0], (x.p![2]) * 0.9 + 1.12, 0.05] as V3, r: [Math.PI / 2, 0, 0] as V3, s: x.s })),
  ]),
  statue: () => build([
    { g: C(0.55, 0.62, 0.35, 20), c: '#e9e3f5', p: [0, 0.175, 0] },
    { g: C(0.5, 0.5, 0.06, 20), c: '#d6ccef', p: [0, 0.37, 0] },
    { g: S(0.36), c: '#fffaf2', p: [0, 0.72, 0], s: [1, 1.1, 1.05] },
    { g: S(0.3), c: '#fffaf2', p: [0, 1.22, 0.12] },
    { g: S(0.13), c: '#fffaf2', p: [0, 1.15, 0.38], s: [1, 0.8, 1] },
    { g: S(0.045, 8, 6), c: '#7a6157', p: [0, 1.2, 0.5] },
    { g: S(0.13), c: '#f4d7b8', p: [-0.24, 1.42, 0.05], s: [0.6, 1.2, 0.5], r: [0, 0, 0.5] },
    { g: S(0.13), c: '#f4d7b8', p: [0.24, 1.42, 0.05], s: [0.6, 1.2, 0.5], r: [0, 0, -0.5] },
    { g: S(0.1), c: '#fffaf2', p: [-0.15, 0.48, 0.3] }, { g: S(0.1), c: '#fffaf2', p: [0.15, 0.48, 0.3] },
    { g: CAP(0.06, 0.25), c: '#fffaf2', p: [0, 0.75, -0.38], r: [0.9, 0, 0] },
    { g: new THREE.TorusGeometry(0.2, 0.035, 8, 20), c: '#ff9fb5', p: [0, 1.0, 0.1], r: [Math.PI / 2.4, 0, 0] },
  ]),
  stone: () => build(paw('#f2e4d4', 0.02).map((x) => ({ ...x, s: typeof x.s === 'number' ? x.s : [x.s![0] * 2.2, x.s![1] * 2, x.s![2] * 2.2] as V3, p: [x.p![0] * 2.2, x.p![1], x.p![2] * 2.2] as V3 }))),
};

// ---------------------------------------------------------------- 지나가는 소품 (속도에 맞춰 순환)
interface Item { x: number; z: number; s: number; ry: number; y?: number; col?: string; bob?: number }
/** span(m) 길이 고리 위에 놓인 소품: 앞쪽(-z)에서 나타나 강아지 뒤(+z)로 지나감 */
function Scroll({ game, geo, items, span, material = vc, shadow = false }: { game: PlayGame; geo: THREE.BufferGeometry; items: Item[]; span: number; material?: THREE.Material; shadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const o = useMemo(() => new THREE.Object3D(), []);
  const colored = useRef(false);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const dist = (Math.max(0, sceneNow(game)) / 1000) * game.course.speed;
    const t = clock.elapsedTime;
    items.forEach((it, i) => {
      const z = -((((it.z - dist) % span) + span) % span) + 12;
      o.position.set(it.x, (it.y ?? 0) + (it.bob ? Math.sin(t * 1.6 + i * 1.3) * it.bob : 0), z);
      o.rotation.set(0, it.ry + (it.bob ? Math.sin(t + i) * 0.15 : 0), 0);
      o.scale.setScalar(it.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (!colored.current && it.col) m.setColorAt(i, new THREE.Color(it.col));
    });
    colored.current = true;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, material, items.length]} frustumCulled={false} castShadow={shadow} receiveShadow={false} />;
}
/** 움직이지 않는 먼 배경 소품 */
function Static({ geo, items, material = vc }: { geo: THREE.BufferGeometry; items: Item[]; material?: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useMemo(() => null, []);
  const o = useMemo(() => new THREE.Object3D(), []);
  return (
    <instancedMesh ref={(m) => {
      (ref as React.MutableRefObject<THREE.InstancedMesh | null>).current = m;
      if (!m) return;
      items.forEach((it, i) => { o.position.set(it.x, it.y ?? 0, it.z); o.rotation.set(0, it.ry, 0); o.scale.setScalar(it.s); o.updateMatrix(); m.setMatrixAt(i, o.matrix); if (it.col) m.setColorAt(i, new THREE.Color(it.col)); });
      m.instanceMatrix.needsUpdate = true;
    }} args={[geo, material, items.length]} frustumCulled={false} />
  );
}

const PASTEL = ['#ffb7cb', '#bfe3ff', '#fff0a0', '#c9b8f2', '#b8ecd0', '#ffd1b0'];
const FLOWER_COL = ['#ffd1dc', '#ffffff', '#fff0a0', '#d9c8ff', '#ffc4a8', '#bfe3ff'];
const SPAN = 72;

// ---------------------------------------------------------------- 먼 배경: 하늘·언덕·관람차·텐트·구름
function SkyDome() {
  const g = useMemo(() => {
    const s = new THREE.SphereGeometry(140, 24, 16);
    const pos = s.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const top = new THREE.Color('#9fd8f6'), mid = new THREE.Color('#d6f0fb'), bot = new THREE.Color('#fff3ea');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 140;
      const c = y > 0.25 ? mid.clone().lerp(top, Math.min(1, (y - 0.25) / 0.6)) : bot.clone().lerp(mid, Math.max(0, (y + 0.05) / 0.3));
      col.set([c.r, c.g, c.b], i * 3);
    }
    s.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return s;
  }, []);
  return <mesh geometry={g}><meshBasicMaterial vertexColors side={THREE.BackSide} fog={false} depthWrite={false} /></mesh>;
}
function FerrisWheel({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  const wheel = useRef<THREE.Group>(null);
  const cabins = useRef<THREE.Group>(null);
  const n = 10, R = 5;
  const ring = useMemo(() => build([
    { g: new THREE.TorusGeometry(R, 0.16, 8, 48), c: '#ffffff' },
    { g: new THREE.TorusGeometry(R * 0.55, 0.1, 8, 36), c: '#ffd1dc' },
    ...Array.from({ length: n }, (_, i) => ({ g: C(0.05, 0.05, R * 2, 6), c: '#ffffff', r: [0, 0, (i / n) * Math.PI] as V3 })),
    { g: S(0.5), c: '#ffd86b', s: [1, 1, 0.6] },
  ]), []);
  const cab = useMemo(() => build([{ g: S(0.42), c: '#ffffff', s: [1, 0.9, 0.9] }, { g: C(0.5, 0.5, 0.08, 16), c: '#ffffff', p: [0, 0.38, 0] }]), []);
  const legs = useMemo(() => build([
    { g: C(0.14, 0.2, R + 1.2, 10), c: '#fff7ea', p: [-1.6, (R + 1.2) / 2, 0], r: [0, 0, -0.28] },
    { g: C(0.14, 0.2, R + 1.2, 10), c: '#fff7ea', p: [1.6, (R + 1.2) / 2, 0], r: [0, 0, 0.28] },
  ]), []);
  useFrame((_, dt) => {
    if (wheel.current) wheel.current.rotation.z += dt * 0.12;
    const a = wheel.current?.rotation.z ?? 0;
    cabins.current?.children.forEach((c, i) => { const t = a + (i / n) * Math.PI * 2; c.position.set(Math.cos(t) * R, Math.sin(t) * R - 0.5, 0.3); });
  });
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh geometry={legs} material={vc} />
      <group position={[0, R + 1.2, 0]}>
        <group ref={wheel}><mesh geometry={ring} material={vc} /></group>
        <group ref={cabins}>{Array.from({ length: n }, (_, i) => <mesh key={i} geometry={cab} material={new THREE.MeshLambertMaterial({ vertexColors: true, color: PASTEL[i % PASTEL.length] })} />)}</group>
      </group>
    </group>
  );
}
function Tent({ x, z, s = 1, a = '#ffb7cb' }: { x: number; z: number; s?: number; a?: string }) {
  const g = useMemo(() => {
    const seg = 12;
    const parts: Piece[] = [];
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      parts.push({ g: new THREE.CylinderGeometry(1.6, 1.6, 1.6, seg, 1, true, th, (Math.PI * 2) / seg), c: i % 2 ? '#ffffff' : a, p: [0, 0.8, 0] });
      parts.push({ g: new THREE.ConeGeometry(2.1, 1.8, seg, 1, true, th, (Math.PI * 2) / seg), c: i % 2 ? a : '#ffffff', p: [0, 2.5, 0] });
    }
    parts.push({ g: C(0.03, 0.03, 0.8, 5), c: '#ffffff', p: [0, 3.75, 0] }, { g: new THREE.ConeGeometry(0.2, 0.35, 3), c: '#ffd86b', p: [0.18, 4.0, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.15] });
    return build(parts);
  }, [a]);
  return <mesh geometry={g} material={new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })} position={[x, 0, z]} scale={s} />;
}
function FarScenery({ midX, span }: { midX: number; span: number }) {
  const hill = useMemo(() => build([{ g: S(1, 28, 14), c: '#ffffff', s: [1, 1, 1] }]), []);
  const cloud = useMemo(() => build([{ g: S(1.2), c: '#ffffff' }, { g: S(0.9), c: '#ffffff', p: [1.2, -0.15, 0] }, { g: S(0.8), c: '#ffffff', p: [-1.15, -0.2, 0.1] }, { g: S(0.7), c: '#fdfbff', p: [0.4, 0.55, 0] }]), []);
  const tree = useMemo(() => GEO.treeMint(), []);
  const hills: Item[] = useMemo(() => {
    const r = rng(7); const out: Item[] = [];
    for (let i = 0; i < 9; i++) out.push({ x: midX - 70 + i * 17.5 + r() * 6, z: -78 - r() * 10, s: 14 + r() * 8, ry: 0, y: -8, col: ['#b9e6bc', '#c9eec5', '#acdcb5'][i % 3] });
    for (let i = 0; i < 7; i++) out.push({ x: midX - 55 + i * 18 + r() * 5, z: -60 - r() * 6, s: 8 + r() * 5, ry: 0, y: -5.2, col: ['#c5ecc0', '#d5f2cc'][i % 2] });
    return out;
  }, [midX]);
  const trees: Item[] = useMemo(() => { const r = rng(21); return Array.from({ length: 26 }, (_, i) => ({ x: midX - 60 + r() * 120, z: -50 - r() * 16, s: 1.2 + r() * 1.2, ry: r() * 6 })).filter((t) => Math.abs(t.x - midX) > span / 2 + 9); }, [midX, span]);
  const clouds = useRef<THREE.Group>(null);
  const cl: Item[] = useMemo(() => { const r = rng(5); return Array.from({ length: 8 }, (_, i) => ({ x: midX - 60 + i * 16 + r() * 8, z: -85 - r() * 15, y: 14 + r() * 8, s: 2 + r() * 1.6, ry: 0 })); }, [midX]);
  useFrame((_, dt) => { if (clouds.current) { clouds.current.position.x += dt * 0.35; if (clouds.current.position.x > 16) clouds.current.position.x = -16; } });
  return (
    <group>
      <Static geo={hill} items={hills} material={vcTint} />
      <Static geo={tree} items={trees} />
      <group ref={clouds}><Static geo={cloud} items={cl} material={new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.25 })} /></group>
      <FerrisWheel x={midX - 30 - span / 2} z={-62} s={1.35} />
      <Tent x={midX + 24 + span / 2} z={-48} s={1.5} />
      <Tent x={midX + 33 + span / 2} z={-58} s={1.2} a="#bfe3ff" />
      <Tent x={midX - 20 - span / 2} z={-44} s={1.1} a="#c9b8f2" />
    </group>
  );
}

// ---------------------------------------------------------------- 출발·결승 게이트
function textTexture(title: string, sub: string, goal: boolean) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 160;
  const g = cv.getContext('2d')!;
  g.fillStyle = goal ? '#fff7ea' : '#fff7ea';
  g.beginPath(); g.roundRect(6, 6, 500, 148, 60); g.fill();
  g.lineWidth = 8; g.strokeStyle = goal ? '#ffd86b' : '#ffb7cb'; g.stroke();
  g.fillStyle = '#f2836b';
  g.font = '700 70px "Jua", "Gaegu", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(title, 256, sub ? 70 : 82);
  if (sub) { g.fillStyle = '#a58d80'; g.font = '600 26px system-ui, sans-serif'; g.fillText(sub, 256, 128); }
  // 발바닥 장식
  const pawAt = (x: number, y: number, r: number) => { g.fillStyle = '#ffb7cb'; g.beginPath(); g.ellipse(x, y + r * 0.35, r, r * 0.8, 0, 0, Math.PI * 2); g.fill(); [[-0.9, -0.55], [-0.32, -1.05], [0.32, -1.05], [0.9, -0.55]].forEach(([dx, dy]) => { g.beginPath(); g.ellipse(x + dx * r, y + dy * r, r * 0.34, r * 0.42, 0, 0, Math.PI * 2); g.fill(); }); };
  pawAt(52, 86, 18); pawAt(460, 86, 18);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function Gate({ game, xs, goal }: { game: PlayGame; xs: number[]; goal?: boolean }) {
  const edge = LANE_W * 1.5;
  const L = Math.min(...xs) - edge - 0.7, R = Math.max(...xs) + edge + 0.7;
  const W = R - L, cx = (L + R) / 2, H = goal ? 4.6 : 4.1;
  const tex = useMemo(() => textTexture(goal ? 'GOAL!' : '멍글런너', goal ? '' : 'MUNGLE RUNNER', !!goal), [goal]);
  const pillar = useMemo(() => build([
    ...Array.from({ length: 8 }, (_, i) => ({ g: C(0.3, 0.3, H / 8, 18), c: i % 2 ? '#ffffff' : goal ? '#ffd86b' : '#ffb7cb', p: [0, (i + 0.5) * (H / 8), 0] as V3 })),
    { g: S(0.42), c: goal ? '#ffd86b' : '#ffb7cb', p: [0, H + 0.3, 0] },
    { g: new THREE.ConeGeometry(0.28, 0.5, 3), c: '#bfe3ff', p: [0.28, H + 1.0, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.14] },
    { g: C(0.025, 0.025, 0.9, 5), c: '#ffffff', p: [0, H + 0.85, 0] },
  ]), [H, goal]);
  const beam = useMemo(() => build([
    { g: CAP(0.24, W - 0.5), c: goal ? '#fff0a0' : '#ffd1dc', r: [0, 0, Math.PI / 2] },
    ...(goal ? Array.from({ length: Math.round(W / 0.5) }, (_, i) => ({ g: new THREE.BoxGeometry(0.5, 0.25, 0.06), c: i % 2 ? '#5a4033' : '#ffffff', p: [-W / 2 + 0.25 + i * 0.5, -0.42, 0.18] as V3 })) : []),
  ]), [W, goal]);
  const bulbs = useRef<THREE.InstancedMesh>(null);
  const lamps = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const nB = Math.round(W / 0.55);
  const ci = useMemo(() => countIn(game.song), [game.song]);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = bulbs.current;
    const t = clock.elapsedTime;
    if (m) {
      for (let i = 0; i < nB; i++) {
        o.position.set(-W / 2 + 0.3 + (i * (W - 0.6)) / Math.max(1, nB - 1), 0.33, 0.2);
        o.scale.setScalar(Math.floor(t * 3 + i) % 2 ? 1 : 0.7);
        o.updateMatrix(); m.setMatrixAt(i, o.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
    // 카운트다운 신호등 (출발 게이트): 3 · 2 · 1에 하나씩 켜지고, 출발! 에 모두 민트로
    if (!goal) {
      const now = game.player.now();
      lamps.current.forEach((l, i) => { if (!l) return; l.color.set(now >= ci.go ? '#7fe0b0' : now >= ci.ticks[i] ? ['#ff9fb5', '#ffd86b', '#ffd86b'][i] : '#e8ddd6'); });
    }
  });
  return (
    <group position={[cx, 0, 0]}>
      {[-W / 2, W / 2].map((x) => <mesh key={x} geometry={pillar} material={vc} position={[x, 0, 0]} castShadow />)}
      <group position={[0, H, 0]}>
        <mesh geometry={beam} material={vc} />
        <instancedMesh ref={bulbs} args={[S(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff5c2', toneMapped: false }), nB]} frustumCulled={false} />
        <mesh position={[0, 0.95, 0.05]}>
          <planeGeometry args={[Math.min(W * 0.6, 3.6), Math.min(W * 0.6, 3.6) * (160 / 512)]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} />
        </mesh>
        {!goal && [0, 1, 2].map((i) => (
          <mesh key={i} position={[(i - 1) * 0.42, -0.62, 0.12]}>
            <circleGeometry args={[0.15, 20]} />
            <meshBasicMaterial ref={(mm) => { lamps.current[i] = mm; }} color="#e8ddd6" toneMapped={false} />
          </mesh>
        ))}
      </group>
      {goal && <Balloons x={-W / 2 - 0.4} />}
      {goal && <Balloons x={W / 2 + 0.4} />}
    </group>
  );
}
function Balloons({ x }: { x: number }) {
  const g = useMemo(() => GEO.balloon(), []);
  const items: Item[] = useMemo(() => [0, 1, 2, 3, 4].map((i) => ({ x: x + Math.cos(i * 1.3) * 0.35, z: Math.sin(i * 1.3) * 0.3, y: 2.6 + (i % 3) * 0.35, s: 1.1, ry: 0, col: PASTEL[i] })), [x]);
  return <Static geo={g} items={items} material={vcTint} />;
}

/** 결승선 통과 축하: 색종이 + 반짝이 (결승선이 강아지를 지나는 순간부터 약 3초) */
function Confetti({ game, finishT, xs }: { game: PlayGame; finishT: number; xs: number[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = 220;
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2, W = Math.max(...xs) - Math.min(...xs) + 6;
  const data = useMemo(() => { const r = rng(11); return Array.from({ length: n }, () => ({ x: midX + (r() - 0.5) * W, vx: (r() - 0.5) * 1.2, vy: 2.5 + r() * 3, z: -1 - r() * 3, ph: r() * 6, col: PASTEL[Math.floor(r() * PASTEL.length)] })); }, [midX, W]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const colored = useRef(false);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const e = (sceneNow(game) - finishT) / 1000;
    m.visible = e > 0 && e < 3.6;
    if (!m.visible) return;
    data.forEach((d, i) => {
      if (!colored.current) m.setColorAt(i, new THREE.Color(d.col));
      const y = 4.4 + d.vy * e - 2.6 * e * e;
      o.position.set(d.x + d.vx * e + Math.sin(clock.elapsedTime * 3 + d.ph) * 0.15, Math.max(0.05, y), d.z);
      o.rotation.set(clock.elapsedTime * 4 + d.ph, d.ph, clock.elapsedTime * 3);
      o.scale.setScalar(0.08);
      o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    });
    colored.current = true;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[new THREE.PlaneGeometry(1, 1.4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), n]} frustumCulled={false} visible={false} />;
}

// ---------------------------------------------------------------- 공간 전체
export function ThemePark({ game, xs }: { game: PlayGame; xs: number[] }) {
  const minX = Math.min(...xs), maxX = Math.max(...xs), midX = (minX + maxX) / 2, span = maxX - minX;
  const edge = LANE_W * 1.5;
  const outL = minX - edge - 0.3, outR = maxX + edge + 0.3;
  const sorted = [...xs].sort((a, b) => a - b);
  const dividers = sorted.slice(1).map((x, i) => (x + sorted[i]) / 2);
  const g = useMemo(() => ({
    curb: GEO.curb(), dash: GEO.dash(), paw: GEO.paw(), star: GEO.star(), fence: GEO.fence(), bush: GEO.bush(),
    trees: [GEO.treeMint(), GEO.treePink(), GEO.treeLemon()], flower: GEO.flower(), balloon: GEO.balloon(), flag: GEO.flag(), pole: GEO.pole(), sign: GEO.sign(), statue: GEO.statue(), stone: GEO.stone(),
  }), []);
  // 배치 (씨앗 난수: 위치·크기·회전·밀도가 자연스럽게 다르게)
  const L = useMemo(() => {
    const r = rng(42);
    const side = (k: number, d: number) => (k ? outR + d : outL - d);
    const curbs: Item[][] = [[], []];
    for (const x of xs) for (const k of [-1, 1]) for (let i = 0; i < 72; i++) curbs[i % 2].push({ x: x + k * (edge + 0.12), z: i * 1.0, s: 1, ry: 0 });
    const dashes: Item[] = [], paws: Item[] = [], stars: Item[] = [];
    for (const x of xs) {
      for (let i = 0; i < 30; i++) for (const k of [-0.5, 0.5]) dashes.push({ x: x + k * LANE_W, z: i * 2.4, s: 1, ry: 0 });
      // 발바닥 자국: 레인 가운데를 번갈아 걸어간 것처럼
      for (let i = 0; i < 24; i++) paws.push({ x: x + ((i % 3) - 1) * LANE_W + (i % 2 ? 0.18 : -0.18), z: i * 3.0 + (i % 2) * 0.45, s: 0.9, ry: Math.PI });
      for (let i = 0; i < 18; i++) for (const k of [-1, 1]) stars.push({ x: x + k * (edge - 0.22), z: i * 4 + (k > 0 ? 2 : 0), s: 0.9, ry: r() * 2 });
    }
    const fence: Item[] = [];
    for (let i = 0; i < 46; i++) for (const k of [0, 1]) fence.push({ x: side(k, 0.55), z: i * 1.56, s: 1, ry: 0 });
    const bush: Item[] = [], trees: Item[][] = [[], [], []], flowers: Item[] = [], stones: Item[] = [];
    for (const k of [0, 1]) {
      // 덤불: 울타리 바로 바깥, 띄엄띄엄
      for (let z = 0; z < SPAN; z += 2.2 + r() * 3.2) bush.push({ x: side(k, 1.1 + r() * 0.6), z, s: 0.6 + r() * 0.5, ry: r() * 6 });
      // 나무: 바깥으로 갈수록 듬성듬성, 크기 다양 (가까운 줄은 시야를 가리지 않게 낮고 작게)
      for (let z = 0; z < SPAN; z += 3 + r() * 4) { const d = 2.6 + r() * 3; trees[Math.floor(r() * 3)].push({ x: side(k, d), z, s: 0.75 + r() * 0.35, ry: r() * 6 }); }
      for (let z = 0; z < SPAN; z += 4 + r() * 5) { const d = 6.5 + r() * 9; trees[Math.floor(r() * 3)].push({ x: side(k, d), z, s: 1 + r() * 0.7, ry: r() * 6 }); }
      // 꽃밭: 무리 지어
      for (let z = 1; z < SPAN; z += 5 + r() * 6) {
        const cx = side(k, 1.9 + r() * 3.5), n = 6 + Math.floor(r() * 8), col = FLOWER_COL[Math.floor(r() * FLOWER_COL.length)], col2 = FLOWER_COL[Math.floor(r() * FLOWER_COL.length)];
        for (let j = 0; j < n; j++) flowers.push({ x: cx + (r() - 0.5) * 1.4, z: z + (r() - 0.5) * 1.6, s: 0.8 + r() * 0.6, ry: r() * 6, col: j % 3 ? col : col2 });
      }
      for (let z = 3; z < SPAN; z += 9 + r() * 8) stones.push({ x: side(k, 1.6 + r() * 1.2), z, s: 0.8 + r() * 0.3, ry: r() * 6 });
    }
    // 트랙 사이 칸막이 (함께 달리기): 낮은 꽃 화단
    for (const dx of dividers) for (let z = 0; z < SPAN; z += 0.9) { flowers.push({ x: dx + (r() - 0.5) * 0.3, z, s: 0.75, ry: r() * 6, col: FLOWER_COL[Math.floor(r() * FLOWER_COL.length)] }); }
    for (const dx of dividers) for (let z = 0; z < SPAN; z += 1.8) bush.push({ x: dx, z, s: 0.42, ry: r() * 6 });
    // 표지판 · 깃대 · 풍선 · 강아지 조형물
    const signs: Item[] = [], poles: Item[] = [], flags: Item[] = [], balloons: Item[] = [], statues: Item[] = [];
    for (let z = 6; z < SPAN; z += 18 + r() * 8) signs.push({ x: side(z % 2 > 1 ? 1 : 0, 0.95), z, s: 0.9, ry: z % 2 > 1 ? -0.5 : 0.5 });
    for (const k of [0, 1]) {
      for (let i = 0; i < 9; i++) {
        const z = i * 8 + (k ? 4 : 0);
        poles.push({ x: side(k, 0.25), z, s: 1, ry: 0 });
        // 다음 깃대까지 늘어진 삼각 깃발 줄
        for (let j = 1; j < 8; j++) flags.push({ x: side(k, 0.25), z: z + j, y: 2.4 - Math.sin((j / 8) * Math.PI) * 0.35, s: 0.55, ry: Math.PI / 2, col: PASTEL[(i + j) % PASTEL.length] });
      }
      for (let z = 10 + (k ? 13 : 0); z < SPAN; z += 26) for (let j = 0; j < 4; j++) balloons.push({ x: side(k, 0.9) + Math.cos(j * 1.6) * 0.25, z: z + Math.sin(j * 1.6) * 0.25, y: 1.7 + (j % 2) * 0.3, s: 1, ry: 0, bob: 0.07, col: PASTEL[(j + Math.floor(z)) % PASTEL.length] });
    }
    for (let z = 16; z < SPAN; z += 36) for (const k of [0, 1]) statues.push({ x: side(k, 3.4), z: z + k * 18, s: 1.25, ry: k ? -0.6 : 0.6 });
    return { curbs, dashes, paws, stars, fence, bush, trees, flowers, stones, signs, poles, flags, balloons, statues };
  }, [xs, outL, outR, edge, dividers]);

  const goal = useRef<THREE.Group>(null);
  const start = useRef<THREE.Group>(null);
  const finishT = game.chart.duration - 1600;
  const speed = game.course.speed;
  useFrame(() => {
    const now = sceneNow(game);
    const dist = (Math.max(0, now) / 1000) * speed;
    if (goal.current) { goal.current.position.z = -((finishT - now) / 1000) * speed; goal.current.visible = finishT - now < AHEAD_MS * 3; }
    if (start.current) { start.current.position.z = dist + (game.multi ? 0.7 : -1.2); start.current.visible = dist < 40; }
  });
  const flowerMat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  return (
    <group>
      <SkyDome />
      {/* 잔디 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[midX, -0.02, -40]} receiveShadow>
        <planeGeometry args={[200 + span, 200]} />
        <meshLambertMaterial color="#bfe8b8" />
      </mesh>
      <FarScenery midX={midX} span={span} />
      {/* 트랙: 크림 바닥 + 가운데 레인만 살짝 진하게 (레인 구분) */}
      {xs.map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, -40]} receiveShadow>
            <planeGeometry args={[edge * 2 + 0.2, 140]} />
            <meshLambertMaterial color={x === 0 || xs.length === 1 ? '#fde9dc' : '#f9e6dc'} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, -40]} receiveShadow>
            <planeGeometry args={[LANE_W * 0.98, 140]} />
            <meshLambertMaterial color="#f9d9c6" />
          </mesh>
        </group>
      ))}
      <Scroll game={game} geo={g.curb} items={L.curbs[0]} span={72} material={new THREE.MeshLambertMaterial({ vertexColors: true, color: '#ffb7cb' })} />
      <Scroll game={game} geo={g.curb} items={L.curbs[1]} span={72} />
      <Scroll game={game} geo={g.dash} items={L.dashes} span={72} />
      <Scroll game={game} geo={g.paw} items={L.paws} span={72} />
      <Scroll game={game} geo={g.star} items={L.stars} span={72} />
      {/* 주변 */}
      <Scroll game={game} geo={g.fence} items={L.fence} span={71.76} />
      <Scroll game={game} geo={g.bush} items={L.bush} span={SPAN} />
      {L.trees.map((it, i) => <Scroll key={i} game={game} geo={g.trees[i]} items={it} span={SPAN} shadow />)}
      <Scroll game={game} geo={g.flower} items={L.flowers} span={SPAN} material={flowerMat} />
      <Scroll game={game} geo={g.stone} items={L.stones} span={SPAN} />
      <Scroll game={game} geo={g.sign} items={L.signs} span={SPAN} />
      <Scroll game={game} geo={g.pole} items={L.poles} span={72} />
      <Scroll game={game} geo={g.flag} items={L.flags} span={72} material={vcTint} />
      <Scroll game={game} geo={g.balloon} items={L.balloons} span={SPAN} material={vcTint} />
      <Scroll game={game} geo={g.statue} items={L.statues} span={SPAN} shadow />
      {/* 출발·결승 */}
      <group ref={start}><Gate game={game} xs={xs} /></group>
      <group ref={goal} visible={false}><Gate game={game} xs={xs} goal /></group>
      <Confetti game={game} finishT={finishT} xs={xs} />
    </group>
  );
}
