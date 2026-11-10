// 모델 확인용 작업대 (자동 화면 테스트 전용: mungle.e2e=1 + ?lab) — 사람·코기를 여러 각도에서 렌더
import { useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BREED_PRESETS, DEFAULT_HUMAN, HARNESS_COLORS, type DogAvatar } from '@shared/avatar';
import { DogAnim, HumanAnim } from '@shared/protocol';
import { Human, newHumanDriver } from '../game/models/Human';
import { Dog, newDogDriver } from '../game/models/Dog';
import { Lighting } from '../game/Lighting';
import { Bin, Hearts } from '../game/Interact3D';
import { binOpenAt, hearts } from '../game/fx';

const q = new URLSearchParams(location.search);
const VIEW = q.get('view') ?? 'front';
const WHO = q.get('who') ?? 'both';
const human = { ...DEFAULT_HUMAN, ...(q.get('hat') ? { hat: q.get('hat') as typeof DEFAULT_HUMAN.hat } : {}), ...(q.get('skin') ? { skin: '#' + q.get('skin') } : {}), ...(q.get('hair') ? { hairStyle: q.get('hair') as typeof DEFAULT_HUMAN.hairStyle } : {}) };
const corgi: DogAvatar = { ...BREED_PRESETS[q.get('breed') ?? 'corgi'].dog, harness: HARNESS_COLORS[0], ...(q.get('size') ? { size: q.get('size') as DogAvatar['size'] } : {}) };
// 동작 확인: act=pet|scoop|toss (사람) · dog=poop|happy (강아지) · bag=1 (배변봉투) · low=0~1 (쓰다듬는 높이)
const ACT = q.get('act');
const DOGACT = q.get('dog');
const HUMAN_ANIM: Record<string, number> = { pet: HumanAnim.Pet, scoop: HumanAnim.Scoop, toss: HumanAnim.Toss, lie: HumanAnim.Lie, sleep: HumanAnim.Sleep, sit: HumanAnim.Sit };

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
  const hg = useRef<any>(null);
  hd.current.leash = false;
  const walk = q.has('walk');
  hd.current.bag = q.has('bag');
  hd.current.petLow = Number(q.get('low') ?? 0.62);
  const lastHeart = useRef(0);
  useFrame((_, dt) => {
    hd.current.anim = ACT ? HUMAN_ANIM[ACT] ?? 0 : walk ? HumanAnim.Walk : HumanAnim.Idle; hd.current.phase += walk ? dt * 7 : 0;
    dd.current.anim = DOGACT === 'poop' ? DogAnim.Poop : DOGACT === 'sleep' ? DogAnim.Sleep : DOGACT === 'lie' ? DogAnim.Lie : DOGACT === 'run' ? DogAnim.Run : walk ? DogAnim.Walk : DogAnim.Stand; dd.current.phase += walk ? dt * 11 : 0;
    // 멍글런너 자세 확인: dog=run, ph=다리 위상(고정), crouch/air/slide=0~1
    if (q.has('ph')) dd.current.phase = Number(q.get('ph'));
    dd.current.crouch = Number(q.get('crouch') ?? 0); dd.current.air = Number(q.get('air') ?? 0); dd.current.slide = Number(q.get('slide') ?? 0);
    if (q.has('bin')) binOpenAt.set('lab', performance.now() - 500);
    if (q.has('lids')) { const r = (g: { traverse: (f: (o: { name: string; visible: boolean }) => void) => void } | null) => g?.traverse((o) => { if (o.name === 'lids') o.visible = true; }); r(hg.current); }
    if (DOGACT === 'happy') {
      dd.current.happyUntil = performance.now() + 1000;
      if (performance.now() - lastHeart.current > 700) { lastHeart.current = performance.now(); hearts.push({ x: 0.45, y: 0.5, z: 0, t0: performance.now(), dx: 0.08 }); }
    }
  });
  return (
    <>
      {WHO !== 'dog' && <group ref={hg} position={[WHO === 'both' ? -0.3 : 0, 0, 0]} rotation={[0, ACT === 'pet' && WHO === 'both' ? Math.PI / 2 : 0, 0]}><Human avatar={human} driver={hd} /></group>}
      {WHO !== 'human' && <group position={[WHO === 'both' ? (ACT === 'pet' ? 0.32 : 0.45) : 0, 0, 0]} rotation={[0, WHO === 'dog' ? 0 : ACT === 'pet' ? -Math.PI / 2 : -0.3, 0]}><Dog avatar={corgi} driver={dd} /></group>}
      {q.has('bin') && <Bin id="lab" x={0.42} z={0.35} rot={-Math.PI / 2} />}
      <Hearts />
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
