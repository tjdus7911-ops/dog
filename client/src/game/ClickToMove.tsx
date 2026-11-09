// 바닥 클릭(탭)으로 이동 — 공원 바닥 전체를 덮는 보이지 않는 판으로 클릭 위치를 받아 목적지로 정한다.
// 아바타를 누르면 그쪽 클릭 처리(프로필 열기)가 먼저 실행되고, 드래그(카메라 회전)는 무시한다.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WORLD_RADIUS, resolveCollision } from '@shared/world';
import { local } from './local';
import { input } from './input';

export function ClickToMove() {
  const marker = useRef<THREE.Group>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const hitMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }), []);
  const dotMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f4776a', transparent: true, opacity: 0.85, depthWrite: false }), []);

  useFrame(({ clock }) => {
    const t = local.moveTarget;
    marker.current.visible = !!t;
    if (!t) return;
    marker.current.position.set(t.x, 0.06, t.z);
    const k = 1 + Math.sin(clock.elapsedTime * 6) * 0.12;
    ring.current.scale.set(k, k, k);
  });

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={hitMat}
        onClick={(e) => {
          if (e.delta > 8) return; // 카메라를 돌린 드래그는 이동으로 보지 않음
          if (input.locked) return; // 모바일 채팅 중에는 이동하지 않음
          e.stopPropagation();
          const [x, z] = resolveCollision(e.point.x, e.point.z, 0.3);
          local.moveTarget = { x, z };
        }}
      >
        <circleGeometry args={[WORLD_RADIUS + 2, 48]} />
      </mesh>
      <group ref={marker} visible={false}>
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} material={ringMat}>
          <ringGeometry args={[0.28, 0.38, 32]} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} material={dotMat}>
          <circleGeometry args={[0.12, 20]} />
        </mesh>
      </group>
    </>
  );
}
