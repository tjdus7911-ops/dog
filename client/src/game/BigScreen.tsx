// 광장 대형 스크린 + 포토존 (3D). 스크린 내용은 서버의 승인된 콘텐츠를 캔버스 텍스처로 그려 자동으로 넘긴다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BIG_SCREEN, PHOTO_ZONE } from '@shared/world';
import type { ScreenSlide } from '@shared/screen';
import { api } from '../lib/api';
import { set, useStore } from '../store';
import { geo, mat } from './lowpoly';
import { DEMO } from '../demo';

const TW = 1024, TH = 568;
const SLIDE_MS = 6000;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const chars = Array.from(text);
  let line = '', lines = 0;
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (g.measureText(test).width > maxW && line) {
      g.fillText(lines === maxLines - 1 ? line.slice(0, -1) + '…' : line, x, y + lines * lineH);
      lines++; line = chars[i];
      if (lines >= maxLines) return;
    } else line = test;
  }
  if (line) g.fillText(line, x, y + lines * lineH);
}

/** 슬라이드 한 장을 캔버스에 그리기 */
function draw(g: CanvasRenderingContext2D, s: ScreenSlide | null, img: HTMLImageElement | null, idx: number, total: number) {
  const font = (w: string, size: number) => `${w} ${size}px Jua, "Gowun Dodum", sans-serif`;
  g.fillStyle = '#fff6ec'; g.fillRect(0, 0, TW, TH);
  if (!s) {
    g.fillStyle = '#f39a7b'; g.font = font('400', 64); g.textAlign = 'center';
    g.fillText('🐾 멍글마을 광장 스크린', TW / 2, 220);
    g.fillStyle = '#7a5a4b'; g.font = font('400', 36);
    g.fillText(DEMO ? '게임 서버에서 이웃들의 강아지가 소개돼요' : '우리 강아지 사진을 올려 보세요!', TW / 2, 310);
    g.font = font('400', 28); g.fillStyle = '#a3857a';
    g.fillText(DEMO ? '' : '눌러서 신청 · 운영자 확인 후 이 화면에 소개돼요', TW / 2, 370);
    g.textAlign = 'left';
    return;
  }
  // 왼쪽 사진
  const px = 36, py = 36, pw = 470, ph = TH - 72;
  g.save(); roundRect(g, px, py, pw, ph, 28); g.clip();
  if (img && img.complete && img.naturalWidth) {
    const sc = Math.max(pw / img.naturalWidth, ph / img.naturalHeight);
    const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
    g.drawImage(img, px + (pw - w) / 2, py + (ph - h) / 2, w, h);
  } else { g.fillStyle = s.kind === 'notice' ? '#e3efdc' : '#fde3d6'; g.fillRect(px, py, pw, ph); g.font = font('400', 160); g.textAlign = 'center'; g.fillStyle = '#f39a7b'; g.fillText(s.kind === 'notice' ? '📢' : '🐶', px + pw / 2, py + ph / 2 + 55); g.textAlign = 'left'; }
  g.restore();
  // 오른쪽 내용
  const x = 540, w = TW - x - 40;
  g.fillStyle = s.kind === 'notice' ? '#a9cfa0' : '#f39a7b';
  g.font = font('400', 30);
  const lw = g.measureText(s.label).width + 40;
  roundRect(g, x, 50, lw, 52, 26); g.fill();
  g.fillStyle = '#ffffff'; g.fillText(s.label, x + 20, 87);
  g.fillStyle = '#5a4033'; g.font = font('400', 52);
  wrap(g, s.title, x, 175, w, 62, 2);
  g.fillStyle = '#7a5a4b'; g.font = font('400', 32);
  wrap(g, s.text, x, 310, w, 42, 3);
  g.fillStyle = '#a3857a'; g.font = font('400', 28);
  g.fillText(s.kind === 'notice' ? '멍글마을 운영팀' : `${s.author}${s.dogName ? ` · 🐶 ${s.dogName}` : ''}`, x, TH - 70);
  // 페이지 점
  for (let i = 0; i < total; i++) { g.fillStyle = i === idx ? '#f39a7b' : '#ead8c8'; g.beginPath(); g.arc(x + i * 26 + 8, TH - 36, 7, 0, Math.PI * 2); g.fill(); }
}

export function BigScreen() {
  const version = useStore((s) => s.screenVersion);
  const [slides, setSlides] = useState<ScreenSlide[]>([]);
  const idx = useRef(0);
  const last = useRef(0);
  const imgs = useRef(new Map<string, HTMLImageElement>());
  const { canvas, tex } = useMemo(() => {
    const c = document.createElement('canvas'); c.width = TW; c.height = TH;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return { canvas: c, tex: t };
  }, []);
  const screenMat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), [tex]);

  useEffect(() => {
    if (DEMO) return;
    api<{ slides: ScreenSlide[] }>('/api/screen').then((r) => { setSlides(r.slides); idx.current = 0; last.current = 0; }).catch(() => setSlides([]));
  }, [version]);

  const repaint = () => {
    const s = slides[idx.current % Math.max(1, slides.length)] ?? null;
    let img: HTMLImageElement | null = null;
    if (s?.image) {
      img = imgs.current.get(s.image) ?? null;
      if (!img) {
        img = new Image(); img.src = s.image; img.onload = () => repaint();
        imgs.current.set(s.image, img);
      }
    }
    draw(canvas.getContext('2d')!, s, img, idx.current % Math.max(1, slides.length), slides.length);
    tex.needsUpdate = true;
  };
  // 글꼴이 늦게 로드되면 다시 그림
  useEffect(() => { repaint(); void document.fonts?.ready.then(() => repaint()); }, [slides]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 1000;
    if (slides.length > 1 && t - last.current > SLIDE_MS) { last.current = t; idx.current = (idx.current + 1) % slides.length; repaint(); }
  });

  const S = BIG_SCREEN;
  return (
    <group position={[S.x, 0, S.z]}>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * S.postX, 0, 0]}>
          <mesh geometry={geo.cyl(0.16, 0.22, S.y, 8)} material={mat('#b98559')} position={[0, S.y / 2, 0]} />
          <mesh geometry={geo.cyl(0.32, 0.36, 0.25, 8)} material={mat('#c3b9ab')} position={[0, 0.12, 0]} />
        </group>
      ))}
      <group position={[0, S.y + S.h / 2 - 0.2, 0]}
        onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); set({ screenDetail: slides[idx.current % Math.max(1, slides.length)] ?? 'empty' }); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
        <mesh geometry={geo.box(S.w + 0.4, S.h + 0.4, 0.3)} material={mat('#f39a7b')} />
        <mesh geometry={geo.box(S.w + 0.12, S.h + 0.12, 0.32)} material={mat('#fff8ef')} />
        <mesh position={[0, 0, 0.17]} material={screenMat}><planeGeometry args={[S.w, S.h]} /></mesh>
        {/* 지붕 장식: 발바닥 */}
        <mesh geometry={geo.cyl(0.32, 0.32, 0.12, 10)} material={mat('#f39a7b')} position={[0, S.h / 2 + 0.45, 0]} rotation={[Math.PI / 2, 0, 0]} />
        {[[-0.36, 0.2], [-0.13, 0.42], [0.13, 0.42], [0.36, 0.2]].map(([x, y], i) => (
          <mesh key={i} geometry={geo.cyl(0.11, 0.11, 0.12, 8)} material={mat('#f39a7b')} position={[x, S.h / 2 + 0.45 + y, 0]} rotation={[Math.PI / 2, 0, 0]} />
        ))}
      </group>
      <PhotoZone />
    </group>
  );
}

/** 포토존 배경판 (광장 좌표 기준이므로 스크린 그룹 밖 위치로 보정) */
function PhotoZone() {
  const P = PHOTO_ZONE;
  return (
    <group position={[P.x - BIG_SCREEN.x, 0, P.z - BIG_SCREEN.z]} rotation={[0, P.rot, 0]}>
      <mesh geometry={geo.box(2.6, 2.0, 0.18)} material={mat('#fde3d6')} position={[0, 1.35, 0]} />
      <mesh geometry={geo.box(2.8, 0.14, 0.24)} material={mat('#f39a7b')} position={[0, 2.4, 0]} />
      {[-1.3, 1.3].map((x) => <mesh key={x} geometry={geo.cyl(0.08, 0.1, 2.4, 6)} material={mat('#b98559')} position={[x, 1.2, -0.05]} />)}
      {/* 하트·발바닥 장식 */}
      <group position={[0, 1.55, 0.11]}>
        {[-0.18, 0.18].map((x) => <mesh key={x} geometry={geo.cyl(0.26, 0.26, 0.06, 12)} material={mat('#f4a6b8')} position={[x, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} />)}
        <mesh geometry={geo.cone(0.43, 0.5, 4)} material={mat('#f4a6b8')} position={[0, -0.24, 0]} rotation={[Math.PI, 0, Math.PI / 4]} scale={[1, 1, 0.14]} />
      </group>
      {[[-0.95, 0.75], [0.95, 0.75], [-0.95, 2.0], [0.95, 2.0]].map(([x, y], i) => (
        <mesh key={i} geometry={geo.cyl(0.11, 0.11, 0.05, 8)} material={mat(['#f6c453', '#a9cfa0', '#8fd3e8', '#f39a7b'][i])} position={[x, y, 0.11]} rotation={[Math.PI / 2, 0, 0]} />
      ))}
      <mesh geometry={geo.circle(1.3, 20)} material={mat('#f7c9b4')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 1.3]} />
    </group>
  );
}
