import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { useState } from 'react';
import { World } from './World';
import { CameraRig } from './CameraRig';
import { LocalPlayer, RemotePlayer } from './Players';
import { useStore } from '../store';

export function Scene() {
  const me = useStore((s) => s.me);
  const players = useStore((s) => s.players);
  const [dpr, setDpr] = useState(1.5);
  return (
    <Canvas
      dpr={dpr}
      camera={{ fov: 50, near: 0.3, far: 400, position: [0, 6, 18] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      // 그림자맵은 사용하지 않음 (로우폴리 스타일 + 모바일 성능)
      shadows={false}
    >
      {/* 성능에 따라 해상도 자동 조절 */}
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(Math.min(2, window.devicePixelRatio))} />
      <AdaptiveDpr pixelated={false} />
      <color attach="background" args={['#e6f2f4']} />
      <fog attach="fog" args={['#eaf3ee', 42, 120]} />
      <hemisphereLight args={['#fff7ea', '#e8d6b8', 1.5]} />
      <directionalLight position={[18, 30, 12]} intensity={1.5} color="#fff3dd" />
      <ambientLight intensity={0.25} />
      <World />
      <CameraRig />
      {me && <LocalPlayer key={`${me.id}-${JSON.stringify(me.human)}-${JSON.stringify(me.dog)}`} profile={me} />}
      {Object.values(players).map((p) => <RemotePlayer key={p.id} profile={p} />)}
    </Canvas>
  );
}
