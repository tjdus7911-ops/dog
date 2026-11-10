import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { useRef, useState } from 'react';
import { World } from './World';
import { CafeSpace, HomeFurniture, HomeRoom, LobbySpace, ShopSpace } from './Interiors';
import { BigScreen } from './BigScreen';
import { CameraRig } from './CameraRig';
import { ClickToMove } from './ClickToMove';
import { LocalPlayer, RemotePlayer } from './Players';
import { useStore } from '../store';
import { Lighting, ShadowFlags } from './Lighting';
import { Bins, Hearts, Poops } from './Interact3D';
import { RunnerArena } from './RunnerArena';

export function Scene() {
  const me = useStore((s) => s.me);
  const players = useStore((s) => s.players);
  const park = useStore((s) => s.park);
  const kind = park?.kind ?? 'park';
  const [dpr, setDpr] = useState(1.5);
  // 성능이 부족하면 해상도를 먼저 낮추고, 그래도 부족하면 그림자를 끔
  const [shadows, setShadows] = useState(true);
  const declines = useRef(0);
  return (
    <Canvas
      dpr={dpr}
      camera={{ fov: 50, near: 0.3, far: 400, position: [0, 6, 18] }}
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true /* 사진 촬영 */ }}
      // 부드러운 그림자 (PCF soft) — 캐릭터 주변만 계산
      shadows="soft"
    >
      {/* 성능에 따라 해상도 자동 조절 */}
      <PerformanceMonitor onDecline={() => { setDpr(1); if (++declines.current >= 2) setShadows(false); }} onIncline={() => setDpr(Math.min(2, window.devicePixelRatio))} />
      <AdaptiveDpr pixelated={false} />
      <color attach="background" args={[kind === 'park' ? '#d7eef8' : '#fff4e8']} />
      {kind === 'park' && <fog attach="fog" args={['#e4f2f4', 55, 150]} />}
      <Lighting indoor={kind !== 'park'} shadows={shadows} />
      {/* 지금 있는 장소의 공간만 그림 (다른 장소의 아바타·사물은 없음) */}
      <ShadowFlags key={kind} cast={kind === 'park'}>
        {kind === 'park' && <><World /><BigScreen /><Bins /><Poops /><RunnerArena /></>}
        {kind === 'lobby' && <LobbySpace />}
        {kind === 'home' && <><HomeRoom /><HomeFurniture /></>}
        {kind === 'cafe' && <CafeSpace />}
        {kind === 'shop' && <ShopSpace />}
      </ShadowFlags>
      <Hearts />
      <CameraRig />
      <ClickToMove key={park?.id ?? 'none'} />
      {me && park && <LocalPlayer key={`${park.id}-${me.id}-${JSON.stringify(me.human)}-${JSON.stringify(me.dog)}`} profile={me} />}
      {Object.values(players).map((p) => <RemotePlayer key={p.id} profile={p} />)}
    </Canvas>
  );
}
