// 산책 상호작용 3D 오브젝트: 배변 · 산책로 휴지통 · 쓰다듬기 하트
import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BINS } from '@shared/world';
import type { PoopInfo } from '@shared/protocol';
import { geo, mat } from './lowpoly';
import { binOpenAt, hearts } from './fx';
import { useStore } from '../store';

// ---------- 배변 ----------
const poopMat = new THREE.MeshStandardMaterial({ color: '#8b5a3a', roughness: 0.55, metalness: 0 });
const poopGeo = new THREE.SphereGeometry(1, 12, 9);

function Poop({ p, mine }: { p: PoopInfo; mine: boolean }) {
  const icon = useRef<HTMLDivElement>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    if (icon.current) icon.current.style.transform = `translate(-50%, calc(-100% + ${Math.sin(t * 5) * 3}px))`;
  });
  return (
    <group position={[p.x, 0, p.z]}>
      {/* 동그랗게 세 번 말린 모양 */}
      <mesh geometry={poopGeo} material={poopMat} position={[0, 0.045, 0]} scale={[0.1, 0.05, 0.1]} castShadow />
      <mesh geometry={poopGeo} material={poopMat} position={[0.005, 0.1, 0]} scale={[0.072, 0.042, 0.072]} castShadow />
      <mesh geometry={poopGeo} material={poopMat} position={[0.01, 0.145, 0.003]} scale={[0.04, 0.035, 0.04]} castShadow />
      {mine && (
        <>
          {/* 내 강아지 배변: 바닥 표시 + 아이콘 */}
          <mesh ref={ring} geometry={geo.ring(0.2, 0.26, 28)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <meshBasicMaterial color="#f39a7b" transparent opacity={0.75} depthWrite={false} />
          </mesh>
          <Html position={[0, 0.5, 0]} zIndexRange={[15, 5]} style={{ pointerEvents: 'none' }}>
            <div ref={icon} className="name-tag !text-[11px] !px-2 !py-0.5 whitespace-nowrap" style={{ transform: 'translate(-50%, -100%)' }}>💩 치워 주세요</div>
          </Html>
        </>
      )}
    </group>
  );
}

export function Poops() {
  const poops = useStore((s) => s.poops);
  const me = useStore((s) => s.me?.id);
  return <>{Object.values(poops).map((p) => <Poop key={p.id} p={p} mine={p.ownerId === me} />)}</>;
}

// ---------- 휴지통 (뚜껑이 열렸다 닫힘) ----------
export function Bin({ id, x, z, rot }: { id: string; x: number; z: number; rot: number }) {
  const lid = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!lid.current) return;
    const at = binOpenAt.get(id);
    const t = at ? (performance.now() - at) / 1000 : 9;
    // 0.25초 동안 열리고 0.7초 머문 뒤 닫힘
    const open = t < 0.25 ? t / 0.25 : t < 0.95 ? 1 : t < 1.3 ? 1 - (t - 0.95) / 0.35 : 0;
    lid.current.rotation.x = -open * 1.15;
  });
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <mesh geometry={geo.cyl(0.25, 0.21, 0.66, 12)} material={mat('#7fb07a')} position={[0, 0.33, 0]} castShadow receiveShadow />
      <mesh geometry={geo.cyl(0.255, 0.255, 0.07, 12)} material={mat('#6a9b66')} position={[0, 0.58, 0]} />
      <mesh geometry={geo.cyl(0.215, 0.215, 0.05, 12)} material={mat('#6a9b66')} position={[0, 0.025, 0]} />
      {/* 앞면 발바닥 표시 */}
      <group position={[0, 0.36, 0.245]}>
        <mesh geometry={geo.circle(0.1, 16)} material={mat('#fff8ef')} />
        <mesh geometry={geo.circle(0.04, 10)} material={mat('#8b6a55')} position={[0, -0.02, 0.002]} scale={[1.1, 0.9, 1]} />
        {[-0.045, -0.015, 0.015, 0.045].map((dx, i) => (
          <mesh key={i} geometry={geo.circle(0.016, 8)} material={mat('#8b6a55')} position={[dx, 0.035 + (i === 1 || i === 2 ? 0.015 : 0), 0.002]} />
        ))}
      </group>
      {/* 뚜껑: 뒤쪽 경첩 기준으로 열림 */}
      <group ref={lid} position={[0, 0.62, -0.25]}>
        <mesh geometry={geo.cyl(0.27, 0.27, 0.06, 12)} material={mat('#f6c453')} position={[0, 0.03, 0.25]} castShadow />
        <mesh geometry={geo.box(0.12, 0.05, 0.05)} material={mat('#e3ae3c')} position={[0, 0.08, 0.25]} />
      </group>
      {/* 옆에 배변봉투 걸이 */}
      <mesh geometry={geo.cyl(0.02, 0.02, 0.85, 6)} material={mat('#c8b9a8')} position={[0.36, 0.425, 0]} />
      <mesh geometry={geo.box(0.12, 0.16, 0.07)} material={mat('#9fd3a8')} position={[0.36, 0.72, 0.04]} castShadow />
    </group>
  );
}

export function Bins() {
  return <>{BINS.map((b) => <Bin key={b.id} {...b} />)}</>;
}

// ---------- 쓰다듬기 하트 ----------
function heartGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(-0.15, -0.35, -0.6, -0.1, -0.55, 0.22);
  s.bezierCurveTo(-0.5, 0.52, -0.12, 0.55, 0, 0.3);
  s.bezierCurveTo(0.12, 0.55, 0.5, 0.52, 0.55, 0.22);
  s.bezierCurveTo(0.6, -0.1, 0.15, -0.35, 0, -0.5);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 2, curveSegments: 10 });
  g.center();
  return g;
}
const POOL = 16;
const HEART_MS = 1300;

export function Hearts() {
  const g = useMemo(heartGeometry, []);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useMemo(() => Array.from({ length: POOL }, () => new THREE.MeshBasicMaterial({ color: '#ff7f9d', transparent: true, depthWrite: false })), []);
  useFrame(({ camera }) => {
    const now = performance.now();
    // 끝난 하트 정리
    for (let i = hearts.length - 1; i >= 0; i--) if (now - hearts[i].t0 > HEART_MS) hearts.splice(i, 1);
    let n = 0;
    for (const h of hearts) {
      const k = (now - h.t0) / HEART_MS;
      if (k < 0 || n >= POOL) continue;
      const m = meshes.current[n++];
      if (!m) continue;
      m.visible = true;
      m.position.set(h.x + h.dx * k * 2 + Math.sin(k * 9) * 0.04, h.y + k * 0.75, h.z);
      m.quaternion.copy(camera.quaternion);
      const pop = k < 0.15 ? k / 0.15 : 1;
      m.scale.setScalar(0.14 * pop);
      (m.material as THREE.MeshBasicMaterial).opacity = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
    }
    for (let i = n; i < POOL; i++) if (meshes.current[i]) meshes.current[i]!.visible = false;
  });
  return (
    <>
      {mats.map((m, i) => <mesh key={i} ref={(el) => { meshes.current[i] = el; }} geometry={g} material={m} visible={false} renderOrder={5} />)}
    </>
  );
}
