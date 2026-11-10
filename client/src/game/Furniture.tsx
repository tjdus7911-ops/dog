// 집 가구 — 마을과 같은 로우폴리 스타일의 작은 가구 모델들
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { geo, mat } from './lowpoly';
import type { PlacedItem } from '@shared/home';

const C = {
  wood: '#c99a6b', woodDark: '#a8794f', cream: '#fff6e8', coral: '#f39a7b', coralSoft: '#f7c9b4',
  sage: '#a9cfa0', sageDark: '#8fbf86', pink: '#f4a6b8', yellow: '#f6c453', white: '#ffffff',
};

const LAMP_GLOW = new THREE.MeshLambertMaterial({ color: '#fff1b8', emissive: '#ffd77a', emissiveIntensity: 0.8 });

/**
 * 액자용 사진 텍스처 (없으면 null)
 * 3D 텍스처는 512px 이하로 줄여 GPU 메모리를 아끼고(크게 보기는 원본 사용), 같은 사진은 한 번만 읽는다.
 */
const imgCache = new Map<string, Promise<HTMLCanvasElement>>();
function loadSmall(url: string) {
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const k = Math.min(1, 512 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        res(c);
      };
      img.onerror = () => { imgCache.delete(url); rej(new Error('load')); };
      img.src = url;
    });
    imgCache.set(url, p);
  }
  return p;
}
function usePhoto(url: string | null) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) { setTex(null); return; }
    let alive = true;
    loadSmall(url).then((c) => {
      if (!alive) return;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      setTex(t);
    }).catch(() => alive && setTex(null));
    return () => { alive = false; };
  }, [url]);
  useEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

/**
 * 사진을 액자 칸(가로/세로 비율 frameAspect)에 꽉 차게(cover) 맞추고, 확대(z)·위치(x,y)를 적용.
 * 보이는 영역이 항상 사진 안쪽이 되도록 잘라서 액자 테두리 밖으로 튀어나오지 않는다.
 */
function applyFit(t: THREE.Texture, frameAspect: number, fit: { z: number; x: number; y: number } = { z: 1, x: 0, y: 0 }) {
  const img = t.image as { width: number; height: number };
  const ia = img.width / img.height;
  let rx = 1, ry = 1;
  if (ia > frameAspect) rx = frameAspect / ia; else ry = ia / frameAspect;
  const z = Math.max(1, fit.z);
  rx /= z; ry /= z;
  t.repeat.set(rx, ry);
  t.offset.set(((1 - rx) / 2) * (1 + THREE.MathUtils.clamp(fit.x, -1, 1)), ((1 - ry) / 2) * (1 - THREE.MathUtils.clamp(fit.y, -1, 1)));
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
}

/** 액자 디자인별 치수: 테두리(바깥) · 사진 칸 · 색 */
const FRAME_LOOK = {
  wood: { w: 0.78, h: 0.66, pw: 0.64, ph: 0.52, color: C.wood, inner: '#fde3d6' },
  white: { w: 0.78, h: 0.66, pw: 0.54, ph: 0.42, color: '#fbfaf7', inner: '#fffaf3' },
  pink: { w: 0.8, h: 0.68, pw: 0.6, ph: 0.48, color: '#f6b9c8', inner: '#fde7ee' },
  round: { w: 0.72, h: 0.72, pw: 0.56, ph: 0.56, color: '#e9c48f', inner: '#fdf1df' },
  polaroid: { w: 0.62, h: 0.74, pw: 0.52, ph: 0.52, color: '#ffffff', inner: '#f3efe8' },
} as const;
export type FrameLook = keyof typeof FRAME_LOOK;

export function PhotoFrame({ photo, style = 'wood', fit, scale = 1, onOpen }: {
  photo: string | null; style?: FrameLook; fit?: { z: number; x: number; y: number }; scale?: number; onOpen?: () => void;
}) {
  const base = usePhoto(photo);
  const L = FRAME_LOOK[style] ?? FRAME_LOOK.wood;
  // 액자마다 확대·위치가 다르므로 텍스처를 복제해 각자 맞춤 (이미지 데이터는 공유)
  const tex = useMemo(() => (base ? base.clone() : null), [base]);
  useEffect(() => { if (tex) applyFit(tex, L.pw / L.ph, fit); }, [tex, L.pw, L.ph, fit?.z, fit?.x, fit?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => tex?.dispose(), [tex]);
  const photoMat = useMemo(() => (tex ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : null), [tex]);
  const handlers = onOpen ? {
    onClick: (e: any) => { if (e.delta > 8) return; e.stopPropagation(); onOpen(); },
    onPointerOver: (e: any) => { e.stopPropagation(); document.body.style.cursor = 'zoom-in'; },
    onPointerOut: () => { document.body.style.cursor = ''; },
  } : {};
  const round = style === 'round';
  const polaroid = style === 'polaroid';
  const photoY = polaroid ? 0.06 : 0;
  return (
    <group scale={scale}>
      {/* 이젤형 받침: 어디에 둬도 세워지도록 */}
      <mesh geometry={geo.box(0.06, 1.1, 0.06)} material={mat(C.woodDark)} position={[-0.25, 0.55, -0.08]} rotation={[0.18, 0, 0]} />
      <mesh geometry={geo.box(0.06, 1.1, 0.06)} material={mat(C.woodDark)} position={[0.25, 0.55, -0.08]} rotation={[0.18, 0, 0]} />
      <mesh geometry={geo.box(0.05, 1.0, 0.05)} material={mat(C.woodDark)} position={[0, 0.5, -0.32]} rotation={[-0.35, 0, 0]} />
      <group position={[0, 1.0, 0]} rotation={[-0.12, 0, 0]} {...handlers}>
        {round ? (
          <>
            <mesh geometry={geo.cyl(L.w / 2, L.w / 2, 0.06, 28)} material={mat(L.color)} rotation={[Math.PI / 2, 0, 0]} />
            <mesh geometry={geo.torus(L.w / 2 - 0.02, 0.03, Math.PI * 2, 6, 28)} material={mat('#d9ad6f')} position={[0, 0, 0.03]} />
            <mesh geometry={geo.circle(L.pw / 2, 40)} position={[0, 0, 0.034]} material={photoMat ?? mat(L.inner)} />
          </>
        ) : (
          <>
            <mesh geometry={geo.box(L.w, L.h, polaroid ? 0.025 : 0.06)} material={mat(L.color)} />
            {style === 'white' && <mesh geometry={geo.box(L.w - 0.1, L.h - 0.1, 0.01)} position={[0, 0, 0.032]} material={mat('#fffaf3')} />}
            {style === 'pink' && (
              // 파스텔 핑크: 위쪽 리본 하트
              <group position={[0, L.h / 2 + 0.02, 0.02]}>
                <mesh geometry={geo.sphere(0.05, 10, 8)} material={mat('#f28ca6')} position={[-0.035, 0, 0]} />
                <mesh geometry={geo.sphere(0.05, 10, 8)} material={mat('#f28ca6')} position={[0.035, 0, 0]} />
                <mesh geometry={geo.cone(0.07, 0.08, 10)} material={mat('#f28ca6')} position={[0, -0.05, 0]} rotation={[Math.PI, 0, 0]} />
              </group>
            )}
            <mesh geometry={geo.box(L.pw, L.ph, 0.012)} position={[0, photoY, polaroid ? 0.02 : 0.038]} material={photoMat ?? mat(L.inner)} />
            {polaroid && <mesh geometry={geo.box(0.22, 0.03, 0.005)} position={[0.12, -0.29, 0.016]} material={mat('#e7ded2')} />}
          </>
        )}
        {!photoMat && (
          // 사진이 없으면 발바닥 그림
          <group position={[0, photoY - 0.03, 0.05]}>
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
export function FurnitureModel({ type, n, photo, item, onOpen }: { type: string; n: number; photo: string | null; item?: PlacedItem; onOpen?: (url: string) => void }) {
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
      {
        // 액자마다 따로 건 사진 (없으면 강아지 대표 사진)
        const url = item?.photo ?? photo;
        return <PhotoFrame photo={url} style={item?.style} fit={item?.fit} scale={item?.scale ?? 1} onOpen={onOpen && url ? () => onOpen(url) : undefined} />;
      }
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
    // ---- 애견샵 가구 ----
    case 'doghouse':
      return (
        <group>
          <mesh geometry={geo.box(0.9, 0.7, 0.9)} material={mat(C.cream)} position={[0, 0.35, 0]} />
          {[-1, 1].map((s) => <mesh key={s} geometry={geo.box(0.62, 0.06, 1.0)} material={mat(C.coral)} position={[s * 0.24, 0.86, 0]} rotation={[0, 0, -s * 0.72]} />)}
          <mesh geometry={geo.box(0.4, 0.46, 0.04)} material={mat('#5a4a44')} position={[0, 0.25, 0.455]} />
          <mesh geometry={geo.cyl(0.2, 0.2, 0.04, 10)} material={mat('#5a4a44')} position={[0, 0.48, 0.455]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={geo.box(0.36, 0.1, 0.05)} material={mat(C.yellow)} position={[0, 0.82, 0.46]} />
        </group>
      );
    case 'toybox':
      return (
        <group>
          <mesh geometry={geo.box(0.7, 0.42, 0.5)} material={mat(C.sage)} position={[0, 0.21, 0]} />
          <mesh geometry={geo.box(0.74, 0.06, 0.54)} material={mat(C.sageDark)} position={[0, 0.44, 0]} />
          <mesh geometry={geo.ico(0.12, 1)} material={mat('#d7ea6f')} position={[-0.16, 0.52, 0.02]} />
          <mesh geometry={geo.ico(0.1, 1)} material={mat(C.pink)} position={[0.14, 0.52, -0.05]} />
          <mesh geometry={geo.cyl(0.03, 0.03, 0.3, 6)} material={mat(C.cream)} position={[0.05, 0.56, 0.1]} rotation={[0, 0, 1.2]} />
        </group>
      );
    case 'cushion':
      return (
        <group position={[0, 0.08, 0]}>
          {[-1, 1].map((s) => <mesh key={s} geometry={geo.cyl(0.22, 0.24, 0.14, 12)} material={mat(n % 2 ? '#f7c9b4' : C.pink)} position={[s * 0.15, 0, -0.08]} />)}
          <mesh geometry={geo.box(0.36, 0.14, 0.36)} material={mat(n % 2 ? '#f7c9b4' : C.pink)} position={[0, 0, 0.1]} rotation={[0, Math.PI / 4, 0]} />
        </group>
      );
    case 'treatjar':
      return (
        <group>
          <mesh geometry={geo.cyl(0.18, 0.18, 0.4, 10)} material={mat('#e6f3f5')} position={[0, 0.2, 0]} />
          <mesh geometry={geo.cyl(0.2, 0.2, 0.08, 10)} material={mat(C.coral)} position={[0, 0.44, 0]} />
          {[0, 1, 2].map((i) => <mesh key={i} geometry={geo.box(0.16, 0.05, 0.06)} material={mat('#d9a35f')} position={[Math.sin(i * 2) * 0.07, 0.1 + i * 0.08, Math.cos(i * 2) * 0.07]} rotation={[0, i, 0.3]} />)}
        </group>
      );
    default:
      return <mesh geometry={geo.box(0.4, 0.4, 0.4)} material={mat(C.cream)} position={[0, 0.2, 0]} />;
  }
}
