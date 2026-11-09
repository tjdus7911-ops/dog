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

// ---------------------------------------------------------------- 애견카페 · 애견샵
const SW = 4.5, SD = 3.5;
/** 카페·샵 공용 실내 껍데기: 바닥·뒷벽·옆벽·간판 */
function ShopShell({ floor, wall, side, sign }: { floor: string; wall: string; side: string; sign: string }) {
  return (
    <group>
      <mesh geometry={geo.box(SW * 2, 0.1, SD * 2)} material={mat(floor)} position={[0, -0.05, 0]} />
      <mesh geometry={geo.box(SW * 2, 4, 0.2)} material={mat(wall)} position={[0, 2, -SD]} />
      <mesh geometry={geo.box(0.2, 4, SD * 2)} material={mat(side)} position={[-SW, 2, 0]} />
      <mesh geometry={geo.box(0.2, 4, SD * 2)} material={mat(side)} position={[SW, 2, 0]} />
      <mesh geometry={geo.box(SW * 2, 0.4, 0.25)} material={mat(sign)} position={[0, 0.2, -SD + 0.12]} />
    </group>
  );
}
const Pendant = ({ x, z, color }: { x: number; z: number; color: string }) => {
  const glow = useMemo(() => new THREE.MeshLambertMaterial({ color: '#fff1b8', emissive: '#ffd77a', emissiveIntensity: 0.7 }), []);
  return (
    <group position={[x, 3.2, z]}>
      <mesh geometry={geo.cyl(0.01, 0.01, 0.9, 4)} material={mat('#5a4a44')} position={[0, 0.45, 0]} />
      <mesh geometry={geo.cone(0.3, 0.3, 8)} material={mat(color)} />
      <mesh geometry={geo.ico(0.1, 1)} material={glow} position={[0, -0.14, 0]} />
    </group>
  );
};

/** 멍글 애견카페: 카운터(커피머신·케이크 진열), 동그란 테이블 3개와 의자, 강아지 물그릇·방석 */
export function CafeSpace() {
  return (
    <group>
      <ShopShell floor="#e3c39c" wall="#fbe9d4" side="#e3efdc" sign="#8fb88a" />
      {/* 메뉴판 */}
      <group position={[0, 2.5, -SD + 0.12]}>
        <mesh geometry={geo.box(3.2, 1.1, 0.06)} material={mat('#4f5b4c')} />
        {[0, 1, 2].map((i) => <mesh key={i} geometry={geo.box(2.4 - i * 0.4, 0.06, 0.07)} material={mat('#fff8ef')} position={[-0.2, 0.3 - i * 0.28, 0]} />)}
        <mesh geometry={geo.cyl(0.16, 0.16, 0.05, 8)} material={mat('#f39a7b')} position={[1.25, 0.2, 0.03]} rotation={[Math.PI / 2, 0, 0]} />
      </group>
      {/* 카운터 */}
      <group position={[0, 0, -2.5]}>
        <mesh geometry={geo.box(3.6, 1.0, 0.8)} material={mat('#c99a6b')} position={[0, 0.5, 0]} />
        <mesh geometry={geo.box(3.8, 0.08, 0.95)} material={mat('#fff6e8')} position={[0, 1.04, 0]} />
        <mesh geometry={geo.box(0.5, 0.5, 0.4)} material={mat('#9a9aa2')} position={[-1.2, 1.33, -0.1]} />
        <mesh geometry={geo.cyl(0.07, 0.06, 0.12, 8)} material={mat('#ffffff')} position={[-1.2, 1.14, 0.12]} />
        {/* 케이크 진열장 */}
        <mesh geometry={geo.box(1.1, 0.5, 0.6)} material={mat('#e6f3f5')} position={[0.9, 1.33, 0]} />
        {[0.6, 0.9, 1.2].map((x, i) => <mesh key={x} geometry={geo.cyl(0.11, 0.11, 0.14, 8)} material={mat(['#f4a6b8', '#f6c453', '#fff6e8'][i])} position={[x, 1.2, 0]} />)}
      </group>
      {/* 테이블 + 의자 */}
      {[[-2.4, 0.2], [0.2, -0.6], [2.6, 0.6]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh geometry={geo.cyl(0.08, 0.12, 0.7, 6)} material={mat('#a8794f')} position={[0, 0.35, 0]} />
          <mesh geometry={geo.cyl(0.5, 0.5, 0.06, 12)} material={mat('#fff6e8')} position={[0, 0.72, 0]} />
          <mesh geometry={geo.cyl(0.07, 0.06, 0.12, 8)} material={mat(['#f39a7b', '#a9cfa0', '#f4a6b8'][i])} position={[0.12, 0.81, 0.05]} />
          {[0, Math.PI].map((r) => (
            <group key={r} rotation={[0, r + 0.3, 0]}>
              <mesh geometry={geo.cyl(0.2, 0.2, 0.08, 8)} material={mat('#f7c9b4')} position={[0, 0.42, 0.75]} />
              <mesh geometry={geo.cyl(0.04, 0.04, 0.4, 5)} material={mat('#a8794f')} position={[0, 0.2, 0.75]} />
            </group>
          ))}
        </group>
      ))}
      {/* 강아지 코너: 방석·물그릇 */}
      <group position={[-3.6, 0, 2.4]}>
        <mesh geometry={geo.cyl(0.5, 0.55, 0.14, 12)} material={mat('#f4a6b8')} position={[0, 0.07, 0]} />
        <mesh geometry={geo.cyl(0.2, 0.15, 0.1, 12)} material={mat('#8fd3e8')} position={[0.8, 0.05, 0.1]} />
      </group>
      <mesh geometry={geo.ico(0.5, 1)} material={mat('#8fc27a')} position={[3.9, 0.9, -3.0]} />
      <mesh geometry={geo.cyl(0.28, 0.22, 0.5, 8)} material={mat('#e98a5e')} position={[3.9, 0.25, -3.0]} />
      {[-2, 0, 2].map((x) => <Pendant key={x} x={x} z={0} color="#8fb88a" />)}
    </group>
  );
}

/** 멍글 애견샵: 진열대(사료·장난감), 계산 카운터(선물 받기) */
export function ShopSpace() {
  return (
    <group>
      <ShopShell floor="#f3e1c6" wall="#fff6e8" side="#fde3d6" sign="#f4a6b8" />
      {/* 왼쪽 벽 진열대 */}
      <group position={[-3.6, 0, -0.6]}>
        <mesh geometry={geo.box(0.7, 2.2, 2.8)} material={mat('#c99a6b')} position={[0, 1.1, 0]} />
        {[0.5, 1.2, 1.9].map((y, r) => [-1, 0, 1].map((k) => (
          <mesh key={`${r}${k}`} geometry={geo.box(0.4, 0.4, 0.55)} material={mat(['#f39a7b', '#a9cfa0', '#f6c453', '#8fd3e8'][(r + k + 3) % 4])} position={[0.25, y, k * 0.85]} />
        )))}
      </group>
      {/* 뒷벽 장난감 진열대 */}
      <group position={[-1.2, 0, -2.6]}>
        <mesh geometry={geo.box(2.4, 1.1, 0.6)} material={mat('#e3c39c')} position={[0, 0.55, 0]} />
        {[-0.8, -0.3, 0.2, 0.7].map((x, i) => <mesh key={x} geometry={geo.ico(0.14, 1)} material={mat(['#d7ea6f', '#f4a6b8', '#8fd3e8', '#f39a7b'][i])} position={[x, 1.25, 0]} />)}
      </group>
      {/* 계산 카운터 (선물 받는 곳) */}
      <group position={[2.2, 0, -2.4]}>
        <mesh geometry={geo.box(2.6, 1.0, 0.9)} material={mat('#f7c9b4')} position={[0, 0.5, 0]} />
        <mesh geometry={geo.box(2.7, 0.08, 1.0)} material={mat('#fff6e8')} position={[0, 1.04, 0]} />
        <mesh geometry={geo.box(0.4, 0.3, 0.3)} material={mat('#5a4a44')} position={[0.7, 1.23, 0]} />
        {/* 선물 상자 */}
        <group position={[-0.6, 1.24, 0]}>
          <mesh geometry={geo.box(0.36, 0.3, 0.36)} material={mat('#f39a7b')} />
          <mesh geometry={geo.box(0.38, 0.06, 0.08)} material={mat('#fff6e8')} position={[0, 0.0, 0]} />
          <mesh geometry={geo.box(0.08, 0.32, 0.38)} material={mat('#fff6e8')} />
        </group>
      </group>
      {/* 바닥 발바닥 매트 */}
      <mesh geometry={geo.circle(1.1, 20)} material={mat('#fde3d6')} rotation={[-Math.PI / 2, 0, 0]} position={[0.6, 0.01, 1.4]} />
      {[-2, 0.5, 3].map((x) => <Pendant key={x} x={x} z={0.4} color="#f4a6b8" />)}
    </group>
  );
}
