// 장면 조명 — 따뜻한 자연광(해) + 하늘/잔디 반사광 + 부드러운 그림자
// 그림자는 내 캐릭터 주변(약 30m)만 계산하도록 해를 캐릭터를 따라 움직인다 (넓은 공원에서도 선명하고 가벼움).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { local } from './local';
import { isTouchDevice } from './input';

const SUN_DIR = new THREE.Vector3(0.55, 1, 0.42).normalize();

export function Lighting({ indoor, shadows }: { indoor: boolean; shadows: boolean }) {
  const sun = useRef<THREE.DirectionalLight>(null!);
  const { scene } = useThree();
  const target = useMemo(() => new THREE.Object3D(), []);
  const mapSize = isTouchDevice() ? 1024 : 2048;
  useEffect(() => { scene.add(target); return () => { scene.remove(target); }; }, [scene, target]);
  useFrame(() => {
    const s = sun.current;
    if (!s) return;
    // 그림자 텍셀 크기 단위로 맞춰 움직여 그림자 가장자리가 떨리지 않게
    const step = 28 / mapSize;
    const x = Math.round(local.x / step) * step, z = Math.round(local.z / step) * step;
    target.position.set(x, 0, z);
    s.position.set(x + SUN_DIR.x * 30, SUN_DIR.y * 30, z + SUN_DIR.z * 30);
    s.target = target;
  });
  // 실내: 천장 없는 오픈형 방이라 위·사방에서 고르게 들어오는 밝은 간접광 위주 (해는 약하게 → 그림자가 짙지 않게),
  //       창문(뒷벽) 쪽에서 들어오는 따뜻한 자연광을 하나 더해 창가가 밝게
  return (
    <>
      <hemisphereLight args={[indoor ? '#fffaf2' : '#fdf3e4', indoor ? '#f4e6d4' : '#cfe3bb', indoor ? 2.05 : 1.55]} />
      <directionalLight ref={sun} intensity={indoor ? 0.95 : 2.15} color={indoor ? '#fff4e2' : '#fff0d6'}
        castShadow={shadows} shadow-mapSize={[mapSize, mapSize]} shadow-bias={-0.0006} shadow-normalBias={0.03}
        shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14} shadow-camera-near={1} shadow-camera-far={70} />
      {/* 반대편에서 오는 하늘빛 — 그림자 쪽이 너무 어둡지 않게 (실내는 창문 쪽 자연광) */}
      {indoor
        ? <directionalLight position={[1.5, 7, -10]} intensity={0.55} color="#fff6e8" />
        : <directionalLight position={[-12, 8, -10]} intensity={0.45} color="#cfe6ff" />}
      <ambientLight intensity={indoor ? 0.42 : 0.18} />
    </>
  );
}

/** 하위 오브젝트에 그림자 설정: 키 큰 물체는 그림자를 드리우고, 모든 바닥·물체는 그림자를 받음 */
export function ShadowFlags({ children, cast = true }: { children: React.ReactNode; cast?: boolean }) {
  const ref = useRef<THREE.Group>(null!);
  useEffect(() => {
    const box = new THREE.Box3();
    const apply = () => ref.current?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.noShadow) return;
      m.receiveShadow = true;
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.copy(g.boundingBox!);
      const h = (box.max.y - box.min.y) * (m as THREE.Object3D).scale.y;
      m.castShadow = cast && h > 0.25 && !m.userData.noCast;
    });
    apply();
    const id = window.setTimeout(apply, 1500); // 늦게 붙는 오브젝트(스크린·게시판 등)
    return () => window.clearTimeout(id);
  });
  return <group ref={ref}>{children}</group>;
}
