// 집 가구 — 마을과 같은 로우폴리 스타일의 작은 가구 모델들
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { geo, mat } from './lowpoly';

const C = {
  wood: '#c99a6b', woodDark: '#a8794f', cream: '#fff6e8', coral: '#f39a7b', coralSoft: '#f7c9b4',
  sage: '#a9cfa0', sageDark: '#8fbf86', pink: '#f4a6b8', yellow: '#f6c453', white: '#ffffff',
};

const LAMP_GLOW = new THREE.MeshLambertMaterial({ color: '#fff1b8', emissive: '#ffd77a', emissiveIntensity: 0.8 });

/** 강아지 사진 텍스처 (없으면 null) */
function usePhoto(url: string | null) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) { setTex(null); return; }
    let alive = true;
    new THREE.TextureLoader().load(url, (t) => { if (!alive) return; t.colorSpace = THREE.SRGBColorSpace; setTex(t); }, undefined, () => setTex(null));
    return () => { alive = false; };
  }, [url]);
  return tex;
}

function PhotoFrame({ photo, alt }: { photo: string | null; alt: boolean }) {
  const tex = usePhoto(photo);
  const photoMat = useMemo(() => (tex ? new THREE.MeshBasicMaterial({ map: tex }) : null), [tex]);
  return (
    <group>
      {/* 이젤형 액자: 어디에 둬도 세워지도록 */}
      <mesh geometry={geo.box(0.06, 1.1, 0.06)} material={mat(C.woodDark)} position={[-0.25, 0.55, -0.08]} rotation={[0.18, 0, 0]} />
      <mesh geometry={geo.box(0.06, 1.1, 0.06)} material={mat(C.woodDark)} position={[0.25, 0.55, -0.08]} rotation={[0.18, 0, 0]} />
      <mesh geometry={geo.box(0.05, 1.0, 0.05)} material={mat(C.woodDark)} position={[0, 0.5, -0.32]} rotation={[-0.35, 0, 0]} />
      <group position={[0, 1.0, 0]} rotation={[-0.12, 0, 0]}>
        <mesh geometry={geo.box(0.78, 0.66, 0.06)} material={mat(alt ? C.coral : C.wood)} />
        <mesh geometry={geo.box(0.64, 0.52, 0.02)} position={[0, 0, 0.035]} material={photoMat ?? mat('#fde3d6')} />
        {!photoMat && (
          // 사진이 없으면 발바닥 그림
          <group position={[0, -0.03, 0.05]}>
            <mesh geometry={geo.cyl(0.09, 0.09, 0.01, 8)} material={mat(C.coral)} rotation={[Math.PI / 2, 0, 0]} />
            {[[-0.11, 0.08], [-0.04, 0.14], [0.04, 0.14], [0.11, 0.08]].map(([x, y], i) => (
              <mesh key={i} geometry={geo.cyl(0.035, 0.035, 0.01, 6)} material={mat(C.coral)} rotation={[Math.PI / 2, 0, 0]} position={[x, y, 0]} />
            ))}
          </group>
        )}
      </group>
    </group>
  );
}

/** 가구 한 개 (원점 = 바닥 중심) */
export function FurnitureModel({ type, n, photo }: { type: string; n: number; photo: string | null }) {
  switch (type) {
    case 'dogbed':
      return (
        <group>
          <mesh geometry={geo.cyl(0.55, 0.6, 0.14, 14)} material={mat(C.coral)} position={[0, 0.07, 0]} />
          <mesh geometry={geo.torus(0.45, 0.13, Math.PI * 2, 6, 16)} material={mat(C.coralSoft)} position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={geo.cyl(0.42, 0.42, 0.06, 14)} material={mat(C.cream)} position={[0, 0.17, 0]} />
        </group>
      );
    case 'sofa':
      return (
        <group>
          <mesh geometry={geo.box(1.7, 0.42, 0.75)} material={mat(C.sage)} position={[0, 0.3, 0]} />
          <mesh geometry={geo.box(1.7, 0.6, 0.22)} material={mat(C.sageDark)} position={[0, 0.7, -0.28]} />
          {[-1, 1].map((s) => <mesh key={s} geometry={geo.box(0.22, 0.5, 0.75)} material={mat(C.sageDark)} position={[s * 0.84, 0.42, 0]} />)}
          <mesh geometry={geo.box(0.42, 0.32, 0.12)} material={mat(C.pink)} position={[-0.42, 0.62, -0.14]} rotation={[-0.2, 0, 0.12]} />
          <mesh geometry={geo.box(0.42, 0.32, 0.12)} material={mat(C.yellow)} position={[0.42, 0.62, -0.14]} rotation={[-0.2, 0, -0.12]} />
          {[[-0.7, -0.25], [0.7, -0.25], [-0.7, 0.25], [0.7, 0.25]].map(([x, z], i) => <mesh key={i} geometry={geo.cyl(0.04, 0.03, 0.1, 5)} material={mat(C.woodDark)} position={[x, 0.05, z]} />)}
        </group>
      );
    case 'table':
      return (
        <group>
          <mesh geometry={geo.cyl(0.5, 0.5, 0.07, 14)} material={mat(C.wood)} position={[0, 0.48, 0]} />
          <mesh geometry={geo.cyl(0.06, 0.08, 0.45, 6)} material={mat(C.woodDark)} position={[0, 0.23, 0]} />
          <mesh geometry={geo.cyl(0.25, 0.28, 0.04, 10)} material={mat(C.woodDark)} position={[0, 0.02, 0]} />
          <mesh geometry={geo.cyl(0.07, 0.06, 0.1, 8)} material={mat(C.white)} position={[0.15, 0.56, 0.05]} />
          <mesh geometry={geo.sphere(0.09, 8, 5, Math.PI / 2)} material={mat(C.yellow)} position={[-0.16, 0.52, -0.08]} />
        </group>
      );
    case 'rug':
      return (
        <group>
          <mesh geometry={geo.circle(1.0, 24)} material={mat(C.pink)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} scale={[1.3, 1, 1]} />
          <mesh geometry={geo.circle(0.78, 24)} material={mat('#fac9d5')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]} scale={[1.3, 1, 1]} />
          <mesh geometry={geo.circle(0.4, 18)} material={mat(C.cream)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} scale={[1.3, 1, 1]} />
        </group>
      );
    case 'frame':
      return <PhotoFrame photo={photo} alt={n % 2 === 1} />;
    case 'plant':
      return (
        <group>
          <mesh geometry={geo.cyl(0.22, 0.17, 0.36, 8)} material={mat(n % 2 ? '#f6c453' : '#e98a5e')} position={[0, 0.18, 0]} />
          <mesh geometry={geo.ico(0.36, 1)} material={mat('#8fc27a')} position={[0, 0.65, 0]} />
          <mesh geometry={geo.ico(0.22, 1)} material={mat('#7cb36b')} position={[0.15, 0.9, 0.05]} />
        </group>
      );
    case 'lamp':
      return (
        <group>
          <mesh geometry={geo.cyl(0.18, 0.2, 0.05, 10)} material={mat(C.woodDark)} position={[0, 0.03, 0]} />
          <mesh geometry={geo.cyl(0.03, 0.03, 1.3, 6)} material={mat('#5a4a44')} position={[0, 0.68, 0]} />
          <mesh geometry={geo.cyl(0.18, 0.3, 0.32, 10)} material={mat(C.cream)} position={[0, 1.42, 0]} />
          <mesh geometry={geo.ico(0.1, 1)} material={LAMP_GLOW} position={[0, 1.33, 0]} />
        </group>
      );
    case 'shelf':
      return (
        <group>
          <mesh geometry={geo.box(1.1, 1.5, 0.38)} material={mat(C.wood)} position={[0, 0.75, 0]} />
          {[0.38, 0.85, 1.3].map((y) => <mesh key={y} geometry={geo.box(0.98, 0.35, 0.3)} material={mat(C.woodDark)} position={[0, y, 0.05]} />)}
          {[0.38, 0.85, 1.3].map((y, r) => [-0.35, -0.2, -0.08, 0.15, 0.3].map((x, i) => (
            <mesh key={`${y}-${i}`} geometry={geo.box(0.1, 0.28 - (i % 2) * 0.05, 0.22)} material={mat([C.coral, C.sage, C.yellow, C.pink, '#8fd3e8'][(i + r) % 5])} position={[x, y - 0.02, 0.09]} />
          )))}
        </group>
      );
    case 'ball':
      return (
        <group>
          <mesh geometry={geo.ico(0.13, 1)} material={mat(n % 2 ? '#8fd3e8' : '#d7ea6f')} position={[0, 0.13, 0]} />
          <mesh geometry={geo.torus(0.13, 0.012, Math.PI * 2, 4, 12)} material={mat(C.white)} position={[0, 0.13, 0]} rotation={[0.6, 0, 0]} />
        </group>
      );
    case 'bone':
      return (
        <group position={[0, 0.06, 0]}>
          <mesh geometry={geo.cyl(0.04, 0.04, 0.3, 6)} material={mat(C.cream)} rotation={[0, 0, Math.PI / 2]} />
          {[-1, 1].map((s) => [-1, 1].map((t) => <mesh key={`${s}${t}`} geometry={geo.ico(0.055, 0)} material={mat(C.cream)} position={[s * 0.16, 0, t * 0.04]} />))}
        </group>
      );
    case 'bowl':
      return (
        <group>
          <mesh geometry={geo.cyl(0.2, 0.15, 0.1, 12)} material={mat(C.coral)} position={[0, 0.05, 0]} />
          <mesh geometry={geo.cyl(0.16, 0.16, 0.02, 12)} material={mat('#b8703a')} position={[0, 0.09, 0]} />
        </group>
      );
    default:
      return <mesh geometry={geo.box(0.4, 0.4, 0.4)} material={mat(C.cream)} position={[0, 0.2, 0]} />;
  }
}
