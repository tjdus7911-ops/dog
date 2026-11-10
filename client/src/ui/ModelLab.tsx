// 모델 확인용 작업대 (자동 화면 테스트 전용: mungle.e2e=1 + ?lab) — 사람·코기를 여러 각도에서 렌더
import { useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BREED_PRESETS, DEFAULT_HUMAN, HARNESS_COLORS, type DogAvatar } from '@shared/avatar';
import { DogAnim, HumanAnim } from '@shared/protocol';
import { Human, newHumanDriver } from '../game/models/Human';
import { Dog, newDogDriver } from '../game/models/Dog';
import { Lighting } from '../game/Lighting';

const q = new URLSearchParams(location.search);
const VIEW = q.get('view') ?? 'front';
const WHO = q.get('who') ?? 'both';
const human = { ...DEFAULT_HUMAN, ...(q.get('hat') ? { hat: q.get('hat') as typeof DEFAULT_HUMAN.hat } : {}), ...(q.get('skin') ? { skin: '#' + q.get('skin') } : {}), ...(q.get('hair') ? { hairStyle: q.get('hair') as typeof DEFAULT_HUMAN.hairStyle } : {}) };
const corgi: DogAvatar = { ...BREED_PRESETS[q.get('breed') ?? 'corgi'].dog, harness: HARNESS_COLORS[0] };

function Cam() {
  const { camera } = useThree();
  // 대상별 거리·높이: 사람은 키 약 1.3, 강아지는 약 0.65
  const human = WHO === 'human';
  const both = WHO === 'both';
  const ty = human ? 0.62 : both ? 0.55 : 0.33;
  const d = human ? 2.7 : both ? 3.2 : 1.6;
  const eye = ty + (human ? 0.12 : 0.1);
  const dirs: Record<string, [number, number]> = { front: [0, 1], side: [1, 0], back: [0, -1], three: [0.7, 0.72], face: [0, 1] };
  const [x, z] = dirs[VIEW] ?? dirs.front;
  const k = VIEW === 'face' ? 0.42 : 1;
  const fy = VIEW === 'face' ? (human ? 1.0 : 0.42) : ty;
  camera.position.set(x * d * k, (VIEW === 'face' ? fy + 0.03 : eye), z * d * k);
  camera.lookAt(0, fy, 0);
  return null;
}

function Actors() {
  const hd = useRef(newHumanDriver()), dd = useRef(newDogDriver());
  hd.current.leash = false;
  const walk = q.has('walk');
  useFrame((_, dt) => {
    hd.current.anim = walk ? HumanAnim.Walk : HumanAnim.Idle; hd.current.phase += walk ? dt * 7 : 0;
    dd.current.anim = walk ? DogAnim.Walk : DogAnim.Stand; dd.current.phase += walk ? dt * 11 : 0;
  });
  return (
    <>
      {WHO !== 'dog' && <group position={[WHO === 'both' ? -0.3 : 0, 0, 0]}><Human avatar={human} driver={hd} /></group>}
      {WHO !== 'human' && <group position={[WHO === 'both' ? 0.45 : 0, 0, 0]} rotation={[0, WHO === 'dog' ? 0 : -0.3, 0]}><Dog avatar={corgi} driver={dd} /></group>}
    </>
  );
}

export default function ModelLab() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#cfe9f4' }}>
      <Canvas shadows dpr={1.5} camera={{ fov: 35, near: 0.05, far: 50 }}>
        <Cam />
        <color attach="background" args={['#d6eef8']} />
        {/* 게임 공원과 같은 조명 + 광장 바닥색 */}
        <Lighting indoor={false} shadows />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><circleGeometry args={[6, 40]} /><meshLambertMaterial color="#f3dccb" /></mesh>
        <Actors />
      </Canvas>
    </div>
  );
}
