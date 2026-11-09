// 실내 공간 3D — 아파트 로비 / 개인 집 (방 구조와 가구)
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { UnitInfo } from '@shared/apartment';
import { ROOM_HALF_D, ROOM_HALF_W } from '@shared/home';
import { geo, mat } from './lowpoly';
import { FurnitureModel } from './Furniture';
import { itemKey } from '@shared/home';
import { useStore } from '../store';
import { api } from '../lib/api';

const W = ROOM_HALF_W, D = ROOM_HALF_D;

/** 로비 실내: 따뜻한 원목 바닥, 크림색 벽, 우편함 벽(호실 수만큼), 소파·화분·조명 */
export function LobbyRoom({ units }: { units: UnitInfo[] }) {
  const sorted = [...units].sort((a, b) => b.floor - a.floor || a.unit.localeCompare(b.unit));
  const lamp = useMemo(() => new THREE.MeshLambertMaterial({ color: '#fff1b8', emissive: '#ffd77a', emissiveIntensity: 0.7 }), []);
  return (
    <group>
      <mesh geometry={geo.box(9, 0.1, 7)} material={mat('#d9b48c')} position={[0, -0.05, 0]} />
      {Array.from({ length: 9 }).map((_, i) => <mesh key={i} geometry={geo.box(0.02, 0.105, 7)} material={mat('#c99f76')} position={[-4 + i, -0.045, 0]} />)}
      <mesh geometry={geo.box(9, 4, 0.2)} material={mat('#fff1dc')} position={[0, 2, -3.5]} />
      <mesh geometry={geo.box(0.2, 4, 7)} material={mat('#fde3d6')} position={[-4.5, 2, 0]} />
      <mesh geometry={geo.box(0.2, 4, 7)} material={mat('#e3efdc')} position={[4.5, 2, 0]} />
      <mesh geometry={geo.box(9, 0.5, 0.25)} material={mat('#f7c9b4')} position={[0, 0.25, -3.38]} />
      {/* 러그 */}
      <mesh geometry={geo.circle(1.6, 24)} material={mat('#f4a6b8')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 1.2]} scale={[1.3, 1, 1]} />
      <mesh geometry={geo.circle(1.3, 24)} material={mat('#fac9d5')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 1.2]} scale={[1.3, 1, 1]} />
      {/* 우편함 벽: 입주한 호실은 코랄, 빈 호실은 크림 */}
      <group position={[-2.2, 1.0, -3.36]}>
        <mesh geometry={geo.box(2.6, 2.3, 0.1)} material={mat('#b98559')} position={[0, 0.85, 0]} />
        {sorted.map((u, i) => {
          const r = Math.floor(i / 4), c = i % 4;
          return (
            <group key={u.unit} position={[-0.93 + c * 0.62, 1.75 - r * 0.52, 0.08]}>
              <mesh geometry={geo.box(0.54, 0.44, 0.08)} material={mat(u.resident?.mine ? '#a9cfa0' : u.occupied ? '#f39a7b' : '#fff8ef')} />
              <mesh geometry={geo.box(0.3, 0.04, 0.1)} material={mat('#5a4a44')} position={[0, 0.08, 0.01]} />
            </group>
          );
        })}
      </group>
      {/* 호실 안내판 */}
      <group position={[1.9, 1.9, -3.36]}>
        <mesh geometry={geo.box(2.2, 1.5, 0.08)} material={mat('#fff8ef')} />
        <mesh geometry={geo.box(2.3, 0.18, 0.1)} material={mat('#f39a7b')} position={[0, 0.8, 0]} />
        {Array.from({ length: 4 }).map((_, i) => <mesh key={i} geometry={geo.box(1.8, 0.06, 0.09)} material={mat('#e2cfae')} position={[0, 0.45 - i * 0.3, 0]} />)}
      </group>
      {/* 소파 */}
      <group position={[3.0, 0, 0.2]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh geometry={geo.box(2.0, 0.45, 0.8)} material={mat('#a9cfa0')} position={[0, 0.3, 0]} />
        <mesh geometry={geo.box(2.0, 0.6, 0.22)} material={mat('#97c08d')} position={[0, 0.7, -0.32]} />
        {[-1, 1].map((s) => <mesh key={s} geometry={geo.box(0.22, 0.55, 0.8)} material={mat('#97c08d')} position={[s * 0.95, 0.45, 0]} />)}
        <mesh geometry={geo.box(0.5, 0.35, 0.15)} material={mat('#fde3d6')} position={[-0.5, 0.62, -0.18]} rotation={[-0.2, 0, 0.1]} />
      </group>
      {/* 화분 */}
      {[[-3.8, -2.8], [3.8, -2.8]].map(([x, z]) => (
        <group key={x} position={[x, 0, z]}>
          <mesh geometry={geo.cyl(0.28, 0.22, 0.5, 8)} material={mat('#e98a5e')} position={[0, 0.25, 0]} />
          <mesh geometry={geo.ico(0.55, 1)} material={mat('#8fc27a')} position={[0, 0.95, 0]} />
        </group>
      ))}
      {/* 조명 */}
      {[-1.5, 1.5].map((x) => (
        <group key={x} position={[x, 3.4, -0.5]}>
          <mesh geometry={geo.cyl(0.01, 0.01, 0.8, 4)} material={mat('#5a4a44')} position={[0, 0.4, 0]} />
          <mesh geometry={geo.sphere(0.28, 10, 6, Math.PI / 2)} material={mat('#f39a7b')} />
          <mesh geometry={geo.ico(0.12, 1)} material={lamp} position={[0, -0.05, 0]} />
        </group>
      ))}
    </group>
  );
}


export function HomeRoom() {
  return (
    <group>
      {/* 원목 바닥 */}
      <mesh geometry={geo.box(W * 2, 0.1, D * 2)} material={mat('#e3c39c')} position={[0, -0.05, 0]} />
      {Array.from({ length: 8 }).map((_, i) => <mesh key={i} geometry={geo.box(0.02, 0.102, D * 2)} material={mat('#d2ae85')} position={[-W + (i + 1) * (W * 2) / 9, -0.045, 0]} />)}
      {/* 뒷벽 + 왼쪽 벽 (앞·오른쪽은 열어 둠) */}
      <mesh geometry={geo.box(W * 2 + 0.2, 3.2, 0.2)} material={mat('#fff1dc')} position={[0, 1.6, -D - 0.1]} />
      <mesh geometry={geo.box(0.2, 3.2, D * 2 + 0.2)} material={mat('#fde3d6')} position={[-W - 0.1, 1.6, 0]} />
      <mesh geometry={geo.box(W * 2 + 0.2, 0.22, 0.24)} material={mat('#f7c9b4')} position={[0, 0.11, -D - 0.08]} />
      <mesh geometry={geo.box(0.24, 0.22, D * 2 + 0.2)} material={mat('#f7c9b4')} position={[-W - 0.08, 0.11, 0]} />
      {/* 창문: 밖에 하늘·나무 */}
      <group position={[1.6, 1.85, -D + 0.01]}>
        <mesh geometry={geo.box(1.7, 1.25, 0.06)} material={mat('#ffffff')} />
        <mesh geometry={geo.box(1.5, 1.05, 0.07)} material={mat('#bfe3f7')} />
        <mesh geometry={geo.ico(0.28, 1)} material={mat('#8fc27a')} position={[-0.4, -0.3, 0.05]} />
        <mesh geometry={geo.box(0.05, 1.05, 0.09)} material={mat('#ffffff')} />
        <mesh geometry={geo.box(1.5, 0.05, 0.09)} material={mat('#ffffff')} />
        {[-1, 1].map((s) => <mesh key={s} geometry={geo.box(0.32, 1.35, 0.05)} material={mat('#f4a6b8')} position={[s * 0.95, 0, 0.08]} />)}
      </group>
      {/* 벽 선반 + 발바닥 장식 */}
      <mesh geometry={geo.box(1.2, 0.06, 0.25)} material={mat('#c99a6b')} position={[-W + 0.15, 1.9, -0.6]} rotation={[0, Math.PI / 2, 0]} />
      <mesh geometry={geo.cyl(0.16, 0.16, 0.04, 8)} material={mat('#f39a7b')} position={[-1.8, 2.3, -D + 0.02]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}


/** 지금 있는 집의 가구 (집 정보가 바뀌면 다시 그림) */
export function HomeFurniture() {
  const home = useStore((s) => s.home);
  if (!home) return null;
  return (
    <group>
      {home.layout.map((i) => (
        <group key={itemKey(i)} position={[i.x, 0, i.z]} rotation={[0, i.rot * (Math.PI / 2), 0]}>
          <FurnitureModel type={i.type} n={i.n} photo={home.owner.dogPhoto} />
        </group>
      ))}
    </group>
  );
}

/** 로비: 우편함 벽 색을 실제 입주 현황으로 */
export function LobbySpace() {
  const [units, setUnits] = useState<UnitInfo[]>([]);
  const version = useStore((s) => s.visitRequestsVersion);
  useEffect(() => {
    api<{ buildings: { units: UnitInfo[] }[] }>('/api/apartment').then((d) => setUnits(d.buildings[0]?.units ?? [])).catch(() => {});
  }, [version]);
  return <LobbyRoom units={units} />;
}
