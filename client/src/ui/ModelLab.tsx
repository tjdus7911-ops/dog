// 모델 확인용 작업대 (자동 화면 테스트 전용: mungle.e2e=1 + ?lab) — 사람·코기를 여러 각도에서 렌더
import { useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BREED_PRESETS, DEFAULT_HUMAN, HARNESS_COLORS, type DogAvatar } from '@shared/avatar';
import { DogAnim, HumanAnim } from '@shared/protocol';
import { Human, newHumanDriver } from '../game/models/Human';
import { Dog, newDogDriver } from '../game/models/Dog';

const q = new URLSearchParams(location.search);
const VIEW = q.get('view') ?? 'front';
const WHO = q.get('who') ?? 'both';
const human = { ...DEFAULT_HUMAN, ...(q.get('hat') ? { hat: q.get('hat') as typeof DEFAULT_HUMAN.hat } : {}), ...(q.get('hair') ? { hairStyle: q.get('hair') as typeof DEFAULT_HUMAN.hairStyle } : {}) };
const corgi: DogAvatar = { ...BREED_PRESETS[q.get('breed') ?? 'corgi'].dog, harness: HARNESS_COLORS[0] };

function Cam() {
  const { camera } = useThree();
  const views: Record<string, [number[], number[]]> = {
    front: [[0, 0.75, 2.6], [0, 0.6, 0]], three: [[1.7, 0.95, 2.0], [0, 0.55, 0]], side: [[2.6, 0.7, 0], [0, 0.55, 0]],
    back: [[0.3, 0.9, -2.6], [0, 0.6, 0]], face: [[-0.25, 1.05, 1.05], [-0.25, 1.0, 0]], dogface: [[0.42, 0.6, 1.6], [0.42, 0.42, 0.1]],
    dogside: [[1.9, 0.5, 0.15], [0.42, 0.32, 0.15]], dog3: [[1.5, 0.75, 1.2], [0.42, 0.33, 0.1]],
  };
  const [p, t] = views[VIEW] ?? views.front;
  camera.position.set(p[0], p[1], p[2]);
  camera.lookAt(t[0], t[1], t[2]);
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
      {WHO !== 'dog' && <group position={[-0.25, 0, 0]}><Human avatar={human} driver={hd} /></group>}
      {WHO !== 'human' && <group position={[0.42, 0, 0.1]}><Dog avatar={corgi} driver={dd} /></group>}
    </>
  );
}

export default function ModelLab() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#cfe9f4' }}>
      <Canvas shadows dpr={1.5} camera={{ fov: 35, near: 0.05, far: 50 }}>
        <Cam />
        <color attach="background" args={['#d6eef8']} />
        <hemisphereLight args={['#fdf7ee', '#d8e6c4', 1.7]} />
        <directionalLight position={[3, 6, 4]} intensity={2.1} color="#fff1dc" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-radius={4} />
        <ambientLight intensity={0.2} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><circleGeometry args={[6, 40]} /><meshStandardMaterial color="#efd9c8" roughness={0.95} /></mesh>
        <Actors />
      </Canvas>
    </div>
  );
}
