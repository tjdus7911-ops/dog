// 아바타 3D 미리보기 무대 — 로우폴리 미니 정원 위에 사람과 강아지, 드래그로 360도 회전
import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { DogAvatar, HumanAvatar } from '@shared/avatar';
import { DogAnim, HumanAnim } from '@shared/protocol';
import { Human, newHumanDriver } from '../game/models/Human';
import { Dog, newDogDriver } from '../game/models/Dog';
import { geo, mat } from '../game/lowpoly';

export type StageFocus = 'both' | 'human' | 'dog';

const FOCUS: Record<StageFocus, { target: [number, number, number]; dist: number }> = {
  both: { target: [0.05, 0.62, 0], dist: 3.3 },
  human: { target: [-0.3, 0.82, 0], dist: 2.2 },
  dog: { target: [0.45, 0.4, 0.15], dist: 2.05 },
};

function Actors({ human, dog, walking }: { human: HumanAvatar; dog: DogAvatar; walking: boolean }) {
  const hd = useRef(newHumanDriver());
  const dd = useRef(newDogDriver());
  hd.current.leash = false;
  useFrame((state, dt) => {
    hd.current.anim = walking ? HumanAnim.Walk : HumanAnim.Idle;
    hd.current.phase += walking ? dt * 7 : 0;
    dd.current.anim = walking ? DogAnim.Walk : DogAnim.Stand;
    dd.current.phase += walking ? dt * 11 : 0;
    dd.current.look = walking ? 0 : Math.sin(state.clock.elapsedTime * 0.8) * 0.35;
  });
  return (
    <>
      <group position={[-0.3, 0, 0]} rotation={[0, 0.15, 0]}><Human avatar={human} driver={hd} /></group>
      <group position={[0.5, 0, 0.18]} rotation={[0, -0.45, 0]}><Dog avatar={dog} driver={dd} /></group>
    </>
  );
}

/** 배경 소품: 나무, 울타리, 꽃, 구름 (모두 로우폴리 지오메트리) */
function Garden() {
  const flowers = useMemo(() => {
    const out: { p: [number, number, number]; c: string }[] = [];
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = 1.1 + r() * 1.6;
      out.push({ p: [Math.sin(a) * d, 0.06, Math.cos(a) * d], c: r() < 0.6 ? '#ffffff' : '#f6c453' });
    }
    return out;
  }, []);
  const cloud = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => { cloud.current.position.x = 1.2 + Math.sin(clock.elapsedTime * 0.15) * 0.4; });
  return (
    <group>
      <mesh geometry={geo.cyl(3.2, 3.4, 0.25, 18)} material={mat('#a9d38f')} position={[0, -0.125, 0]} />
      <mesh geometry={geo.cyl(3.4, 3.1, 0.35, 18)} material={mat('#c9a27a')} position={[0, -0.42, 0]} />
      {/* 나무 */}
      <group position={[-2.2, 0, -2.0]}>
        <mesh geometry={geo.cyl(0.11, 0.17, 1.2, 6)} material={mat('#9b6a45')} position={[0, 0.6, 0]} />
        <mesh geometry={geo.ico(0.75, 1)} material={mat('#8fc27a')} position={[0, 1.55, 0]} />
        <mesh geometry={geo.ico(0.5, 1)} material={mat('#7cb36b')} position={[0.45, 1.25, 0.2]} />
      </group>
      {/* 울타리 */}
      <group position={[1.6, 0, -1.4]} rotation={[0, -0.5, 0]}>
        {[-0.6, 0, 0.6].map((x) => <mesh key={x} geometry={geo.box(0.1, 0.62, 0.1)} material={mat('#b98559')} position={[x, 0.31, 0]} />)}
        {[0.22, 0.45].map((y) => <mesh key={y} geometry={geo.box(1.4, 0.07, 0.06)} material={mat('#c9976a')} position={[0, y, 0]} />)}
      </group>
      {flowers.map((f, i) => (
        <group key={i} position={f.p}>
          <mesh geometry={geo.ico(0.055, 0)} material={mat(f.c)} />
          <mesh geometry={geo.ico(0.025, 0)} material={mat(f.c === '#ffffff' ? '#f6c453' : '#f39a7b')} position={[0, 0.03, 0]} />
        </group>
      ))}
      {Array.from({ length: 20 }).map((_, i) => {
        const a = i * 2.4, d = 0.9 + (i % 5) * 0.45;
        return <mesh key={i} geometry={geo.cone(0.05, 0.14, 3)} material={mat('#8fc27a')} position={[Math.sin(a) * d, 0.07, Math.cos(a) * d]} />;
      })}
      <group ref={cloud} position={[1.2, 2.5, -2.6]} scale={0.45}>
        <mesh geometry={geo.dodeca(1)} material={mat('#ffffff')} />
        <mesh geometry={geo.dodeca(0.75)} material={mat('#ffffff')} position={[1.1, -0.2, 0]} />
        <mesh geometry={geo.dodeca(0.7)} material={mat('#ffffff')} position={[-1.05, -0.25, 0.1]} />
      </group>
    </group>
  );
}

function CameraFocus({ focus, controls }: { focus: StageFocus; controls: React.MutableRefObject<OrbitImpl | null> }) {
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const last = useRef<StageFocus | null>(null);
  const animT = useRef(0);
  useFrame(({ camera }, dt) => {
    const c = controls.current;
    if (!c) return;
    if (last.current !== focus) { last.current = focus; animT.current = 1.2; }
    if (animT.current <= 0) return;
    animT.current -= dt;
    const f = FOCUS[focus];
    const k = 1 - Math.exp(-dt * 6);
    c.target.lerp(tmp.set(...f.target), k);
    // 현재 방향은 유지하고 거리만 맞춤
    const dir = camera.position.clone().sub(c.target).normalize();
    const want = tmp.copy(c.target).addScaledVector(dir, f.dist);
    camera.position.lerp(want, k);
    c.update();
  });
  return null;
}

export function AvatarStage({ human, dog, walking, focus }: { human: HumanAvatar; dog: DogAvatar; walking: boolean; focus: StageFocus }) {
  const controls = useRef<OrbitImpl | null>(null);
  return (
    <Canvas camera={{ position: [0.6, 1.05, 3.25], fov: 36 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#bfe3f7']} />
      <fog attach="fog" args={['#d9effa', 6, 14]} />
      <hemisphereLight args={['#fffaf2', '#efe2cc', 2.1]} />
      <directionalLight position={[2, 4, 5]} intensity={1.15} color="#fff6e8" />
      <Garden />
      <Actors human={human} dog={dog} walking={walking} />
      <OrbitControls ref={controls as never} enablePan={false} enableDamping minDistance={1.2} maxDistance={5}
        minPolarAngle={0.6} maxPolarAngle={1.62} target={FOCUS.both.target} />
      <CameraFocus focus={focus} controls={controls} />
    </Canvas>
  );
}
