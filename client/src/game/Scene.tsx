import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { useState } from 'react';
import { World } from './World';
import { HomeFurniture, HomeRoom, LobbySpace } from './Interiors';
import { BigScreen } from './BigScreen';
import { CameraRig } from './CameraRig';
import { ClickToMove } from './ClickToMove';
import { LocalPlayer, RemotePlayer } from './Players';
import { useStore } from '../store';

export function Scene() {
  const me = useStore((s) => s.me);
  const players = useStore((s) => s.players);
  const park = useStore((s) => s.park);
  const kind = park?.kind ?? 'park';
  const [dpr, setDpr] = useState(1.5);
  return (
    <Canvas
      dpr={dpr}
      camera={{ fov: 50, near: 0.3, far: 400, position: [0, 6, 18] }}
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true /* 사진 촬영 */ }}
      // 그림자맵은 사용하지 않음 (로우폴리 스타일 + 모바일 성능)
      shadows={false}
    >
      {/* 성능에 따라 해상도 자동 조절 */}
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(Math.min(2, window.devicePixelRatio))} />
      <AdaptiveDpr pixelated={false} />
      <color attach="background" args={[kind === 'park' ? '#e6f2f4' : '#fff4e8']} />
      {kind === 'park' && <fog attach="fog" args={['#eaf3ee', 42, 120]} />}
      <hemisphereLight args={['#fffaf2', '#efe2cc', 1.9]} />
      <directionalLight position={[18, 30, 12]} intensity={1.25} color="#fff6e8" />
      <ambientLight intensity={0.25} />
      {/* 지금 있는 장소의 공간만 그림 (다른 장소의 아바타·사물은 없음) */}
      {kind === 'park' && <><World /><BigScreen /></>}
      {kind === 'lobby' && <LobbySpace />}
      {kind === 'home' && <><HomeRoom /><HomeFurniture /></>}
      <CameraRig />
      <ClickToMove key={park?.id ?? 'none'} />
      {me && park && <LocalPlayer key={`${park.id}-${me.id}-${JSON.stringify(me.human)}-${JSON.stringify(me.dog)}`} profile={me} />}
      {Object.values(players).map((p) => <RemotePlayer key={p.id} profile={p} />)}
    </Canvas>
  );
}
