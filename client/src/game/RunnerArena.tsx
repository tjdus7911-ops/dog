// 광장의 멍글런너 경기장: 발바닥 아치 입구 · 달리는 강아지 조형물 · 간판 · 음표 장식 · TOP 3 안내판
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RUNNER_ARENA } from '@shared/world';
import { BREED_PRESETS, HARNESS_COLORS, type DogAvatar } from '@shared/avatar';
import { DogAnim } from '@shared/protocol';
import { geo, mat } from './lowpoly';
import { Dog, newDogDriver } from './models/Dog';
import { api } from '../lib/api';
import { DEMO } from '../demo';
import { set, useStore } from '../store';

const A = RUNNER_ARENA;
const STATUE: DogAvatar = { ...BREED_PRESETS.corgi.dog, harness: HARNESS_COLORS[0] };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const paint = () => { draw(c.getContext('2d')!); t.needsUpdate = true; };
  paint();
  void document.fonts?.ready.then(paint);
  return { t, paint, c };
}
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** 달리는 자세로 멈춘 웰시코기 조형물 (받침대 위) */
function Statue() {
  const d = useRef(newDogDriver());
  d.current.anim = DogAnim.Run;
  d.current.phase = 1.1;
  return (
    <group>
      <mesh geometry={geo.cyl(0.95, 1.05, 0.5, 18)} material={mat('#fff1dc')} position={[0, 0.25, 0]} castShadow receiveShadow />
      <mesh geometry={geo.cyl(0.98, 0.98, 0.08, 18)} material={mat('#f39a7b')} position={[0, 0.52, 0]} />
      <group position={[0, 0.56, 0]} scale={1.7} rotation={[0, Math.PI / 2, 0]}><Dog avatar={STATUE} driver={d} /></group>
    </group>
  );
}

/** 발바닥 모양 아치 입구 + '멍글런너' 간판 */
function Gate() {
  const sign = useMemo(() => canvasTex(512, 160, (g) => {
    g.clearRect(0, 0, 512, 160);
    rr(g, 6, 6, 500, 148, 60); g.fillStyle = '#fff8ef'; g.fill(); g.lineWidth = 10; g.strokeStyle = '#f39a7b'; g.stroke();
    g.fillStyle = '#f2836b'; g.font = '700 74px Jua, "Gowun Dodum", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('♪ 멍글런너', 256, 74);
    g.fillStyle = '#8b6a55'; g.font = '30px Jua, sans-serif'; g.fillText('Mungle Runner', 256, 126);
  }), []);
  const signMat = useMemo(() => new THREE.MeshBasicMaterial({ map: sign.t, transparent: true, toneMapped: false }), [sign]);
  return (
    <group position={[0, 0, 3.6]}>
      {[-1, 1].map((k) => (
        <group key={k} position={[k * 1.25, 0, 0]}>
          <mesh geometry={geo.cyl(0.2, 0.26, 2.3, 10)} material={mat('#fff1dc')} position={[0, 1.15, 0]} castShadow />
          <mesh geometry={geo.sphere(0.28, 12, 10)} material={mat('#f39a7b')} position={[0, 2.38, 0]} />
        </group>
      ))}
      {/* 아치: 발바닥 패드 + 발가락 4개 */}
      <mesh geometry={geo.torus(1.25, 0.18, Math.PI, 10, 24)} material={mat('#f7b8a4')} position={[0, 2.35, 0]} />
      <group position={[0, 3.55, 0.05]}>
        <mesh geometry={geo.sphere(0.42, 16, 12)} material={mat('#f39a7b')} scale={[1.15, 0.85, 0.5]} castShadow />
        {[[-0.48, 0.42], [-0.17, 0.62], [0.17, 0.62], [0.48, 0.42]].map(([x, y], i) => (
          <mesh key={i} geometry={geo.sphere(0.17, 12, 10)} material={mat('#f39a7b')} position={[x, y, 0]} scale={[1, 1.15, 0.55]} castShadow />
        ))}
      </group>
      <mesh position={[0, 2.62, 0.2]} material={signMat}><planeGeometry args={[2.3, 0.72]} /></mesh>
    </group>
  );
}

/** 음표 장식 기둥 */
function Note({ x, z, color, phase }: { x: number; z: number; color: string; phase: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (g.current) g.current.position.y = 1.55 + Math.sin(clock.elapsedTime * 2 + phase) * 0.08; });
  return (
    <group position={[x - A.x, 0, z - A.z]}>
      <mesh geometry={geo.cyl(0.05, 0.07, 1.3, 6)} material={mat('#e9d8c6')} position={[0, 0.65, 0]} />
      <group ref={g} rotation={[0, phase, 0]}>
        <mesh geometry={geo.sphere(0.2, 12, 10)} material={mat(color)} scale={[1.25, 0.9, 0.7]} rotation={[0, 0, 0.4]} castShadow />
        <mesh geometry={geo.box(0.05, 0.62, 0.05)} material={mat(color)} position={[0.2, 0.3, 0]} />
        <mesh geometry={geo.box(0.26, 0.09, 0.05)} material={mat(color)} position={[0.32, 0.56, 0]} rotation={[0, 0, -0.5]} />
      </group>
    </group>
  );
}

interface TopEntry { rank: number; nickname: string; dogName: string; score: number }
/** 경기장 앞 랭킹 안내판 (벚꽃 산책길 TOP 3) — 누르면 멍글런너 로비 */
function Board() {
  const version = useStore((s) => s.runnerVersion);
  const top = useRef<TopEntry[]>([]);
  const tex = useMemo(() => canvasTex(512, 384, (g) => {
    g.fillStyle = '#fff8ef'; g.fillRect(0, 0, 512, 384);
    g.fillStyle = '#f39a7b'; g.fillRect(0, 0, 512, 84);
    g.fillStyle = '#fff'; g.font = '700 40px Jua, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🏆 멍글런너 TOP 3', 256, 44);
    g.fillStyle = '#8b6a55'; g.font = '26px Jua, sans-serif'; g.fillText('벚꽃 산책길 · 엘리제를 위하여', 256, 116);
    const list = top.current;
    if (!list.length) { g.fillStyle = '#5a4033'; g.font = '30px Jua, sans-serif'; g.fillText('첫 기록에 도전해 보세요!', 256, 240); return; }
    const medal = ['🥇', '🥈', '🥉'];
    list.slice(0, 3).forEach((e, i) => {
      const y = 170 + i * 72;
      g.textAlign = 'left'; g.fillStyle = '#5a4033'; g.font = '34px Jua, sans-serif';
      g.fillText(`${medal[i]} ${e.nickname.slice(0, 8)}`, 30, y);
      g.fillStyle = '#8b6a55'; g.font = '24px Jua, sans-serif'; g.fillText(`🐶 ${e.dogName.slice(0, 8)}`, 34, y + 30);
      g.textAlign = 'right'; g.fillStyle = '#f2836b'; g.font = '36px Jua, sans-serif'; g.fillText(e.score.toLocaleString(), 482, y + 8);
    });
  }), []);
  useEffect(() => {
    if (DEMO) return;
    api<{ top: Record<string, TopEntry[]> }>('/api/runner/summary').then((r) => { top.current = r.top.elise ?? []; tex.paint(); }).catch(() => {});
  }, [version, tex]);
  const m = useMemo(() => new THREE.MeshBasicMaterial({ map: tex.t, toneMapped: false }), [tex]);
  return (
    <group position={[A.board.x - A.x, 0, A.board.z - A.z]} rotation={[0, A.rot - 0.35, 0]}
      onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); set({ runner: true }); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
      {[-0.62, 0.62].map((x) => <mesh key={x} geometry={geo.box(0.1, 1.9, 0.1)} material={mat('#b98559')} position={[x, 0.95, -0.03]} castShadow />)}
      <mesh geometry={geo.box(1.5, 1.16, 0.08)} material={mat('#c99a6b')} position={[0, 1.42, -0.05]} castShadow />
      <mesh position={[0, 1.42, 0.0]} material={m}><planeGeometry args={[1.36, 1.02]} /></mesh>
    </group>
  );
}

export function RunnerArena() {
  return (
    <group position={[A.x, 0, A.z]}>
      <group rotation={[0, A.rot, 0]}>
        {/* 바닥: 크림색 원판 + 코랄 트랙 (레인 3줄) */}
        <mesh geometry={geo.cyl(4.5, 4.6, 0.08, 40)} material={mat('#fff1dc')} position={[0, 0.04, 0]} receiveShadow />
        <mesh geometry={geo.ring(2.2, 3.6, 48)} material={mat('#f7b8a4')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 0]} receiveShadow />
        {[2.65, 3.15].map((r) => <mesh key={r} geometry={geo.ring(r - 0.025, r + 0.025, 64)} material={mat('#fff8ef')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]} />)}
        <Gate />
      </group>
      <Statue />
      {A.notes.map((n, i) => <Note key={i} x={n.x} z={n.z} color={['#f4a6b8', '#b59ad6', '#8fd3e8', '#f6c453'][i]} phase={i * 1.3} />)}
      <Board />
    </group>
  );
}
