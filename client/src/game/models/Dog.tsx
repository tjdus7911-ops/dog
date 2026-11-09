// 로우폴리 강아지 — 미리 만든 파츠(귀·꼬리·주둥이·무늬·체형)를 조합하는 방식
// AI 분석이 연결되면 분석 결과(DogAvatar)를 그대로 넣어 같은 렌더러로 표시한다.
import { useRef, type MutableRefObject, type Ref } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DogAvatar } from '@shared/avatar';
import { DogAnim } from '@shared/protocol';
import { geo, mat } from '../lowpoly';

export interface DogDriver {
  anim: number;
  phase: number;
  /** 고개 좌우 (주변 살피기) */
  look: number;
}
export const newDogDriver = (): DogDriver => ({ anim: DogAnim.Stand, phase: 0, look: 0 });

export const DOG_SCALE = { small: 0.78, medium: 1, large: 1.22 } as const;
/** 한 걸음(반 주기)당 이동 거리 (scale 1 기준) */
export const DOG_STEP = { walk: 0.2, run: 0.42 };

export function Dog({ avatar, driver, anchorRef }: { avatar: DogAvatar; driver: MutableRefObject<DogDriver>; anchorRef?: Ref<THREE.Object3D> }) {
  const root = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const tail = useRef<THREE.Group>(null!);
  const legs = [useRef<THREE.Group>(null!), useRef<THREE.Group>(null!), useRef<THREE.Group>(null!), useRef<THREE.Group>(null!)];
  const tongue = useRef<THREE.Mesh>(null!);
  const sm = useRef({ move: 0, run: 0, sit: 0, greet: 0 });

  useFrame((state, dt) => {
    const d = driver.current;
    const t = state.clock.elapsedTime;
    const s = sm.current;
    const k = 1 - Math.exp(-dt * 9);
    const moving = d.anim === DogAnim.Walk || d.anim === DogAnim.Run;
    s.move += ((moving ? 1 : 0) - s.move) * k;
    s.run += ((d.anim === DogAnim.Run ? 1 : 0) - s.run) * k;
    s.sit += ((d.anim === DogAnim.Sit ? 1 : 0) - s.sit) * (1 - Math.exp(-dt * 6));
    s.greet += ((d.anim === DogAnim.Greet ? 1 : 0) - s.greet) * k;

    const p = d.phase;
    const walkAmp = 0.6 * s.move * (1 - s.run);
    const runAmp = 0.85 * s.run;
    // 걷기: 대각선 다리가 같은 위상 / 달리기: 앞다리·뒷다리 쌍이 함께 (갤럽)
    const fl = Math.sin(p) * walkAmp + Math.sin(p) * runAmp;
    const fr = -Math.sin(p) * walkAmp + Math.sin(p + 0.4) * runAmp;
    const bl = -Math.sin(p) * walkAmp + Math.sin(p + Math.PI) * runAmp;
    const br = Math.sin(p) * walkAmp + Math.sin(p + Math.PI + 0.4) * runAmp;
    legs[0].current.rotation.x = fl;
    legs[1].current.rotation.x = fr;
    // 앉기: 뒷다리를 접는다
    legs[2].current.rotation.x = THREE.MathUtils.lerp(bl, -1.35, s.sit);
    legs[3].current.rotation.x = THREE.MathUtils.lerp(br, -1.35, s.sit);

    const bob = Math.abs(Math.sin(p)) * (0.02 * s.move + 0.05 * s.run);
    const hop = s.greet * Math.max(0, Math.sin(t * 9)) * 0.06;
    body.current.position.y = bob + hop - s.sit * 0.06;
    body.current.rotation.x = -s.sit * 0.55 + Math.sin(p * 2) * 0.05 * s.run;
    root.current.position.y = 0;

    // 고개: 주변 살피기 / 앉았을 때 들기
    head.current.rotation.y = d.look * (1 - s.move) + Math.sin(t * 7) * 0.12 * s.greet;
    head.current.rotation.x = s.sit * 0.45 - s.run * 0.1;

    // 꼬리 흔들기 — 반가울수록(인사·달리기) 빠르게
    const wagSpeed = 8 + s.greet * 14 + s.run * 4;
    tail.current.rotation.y = Math.sin(t * wagSpeed) * (0.35 + s.greet * 0.35);
    tongue.current.visible = s.run > 0.4 || s.greet > 0.4;
  });

  const a = avatar;
  const coat = mat(a.coat);
  const sec = mat(a.secondary);
  const dark = mat('#2e2420');
  const long = a.fur === 'long';
  const snoutLen = a.snout === 'short' ? 0.08 : a.snout === 'medium' ? 0.13 : 0.18;
  const muzzleMat = a.pattern === 'mask' || a.pattern === 'socks' ? sec : coat;
  const legMat = coat;
  const pawMat = a.pattern === 'socks' || a.pattern === 'mask' ? sec : coat;
  const scale = DOG_SCALE[a.size];

  return (
    <group ref={root} scale={scale}>
      <group ref={body}>
        {/* 몸통 */}
        <mesh geometry={geo.ico(0.2, long ? 1 : 0)} material={coat} position={[0, 0.34, 0]} scale={long ? [1.05, 0.98, 1.55] : [0.92, 0.88, 1.55]} />
        {a.pattern === 'saddle' && <mesh geometry={geo.ico(0.18, 0)} material={sec} position={[0, 0.42, -0.02]} scale={[0.92, 0.55, 1.4]} />}
        {a.pattern === 'patch' && <mesh geometry={geo.ico(0.09, 0)} material={sec} position={[0.12, 0.38, -0.05]} scale={[0.6, 1, 1.3]} />}
        {(a.pattern === 'mask' || a.pattern === 'socks') && <mesh geometry={geo.ico(0.12, 0)} material={sec} position={[0, 0.3, 0.2]} scale={[0.95, 1, 0.7]} />}
        {/* 하네스 */}
        <mesh geometry={geo.torus(0.165, 0.025, Math.PI * 2, 3, 7)} material={mat(a.harness)} position={[0, 0.35, 0.1]} scale={[1, 1.05, 1]} />
        <mesh geometry={geo.box(0.08, 0.04, 0.12)} material={mat(a.harness)} position={[0, 0.51, 0.06]} />
        <object3D ref={anchorRef} position={[0, 0.54, 0.06]} />

        {/* 다리: 앞(0,1) 뒤(2,3) */}
        {[[-0.09, 0.2], [0.09, 0.2], [-0.09, -0.2], [0.09, -0.2]].map(([x, z], i) => (
          <group key={i} ref={legs[i]} position={[x, 0.28, z]}>
            <mesh geometry={geo.box(long ? 0.1 : 0.08, 0.2, long ? 0.1 : 0.08)} material={legMat} position={[0, -0.1, 0]} />
            <mesh geometry={geo.box(0.09, 0.06, 0.11)} material={pawMat} position={[0, -0.25, 0.015]} />
          </group>
        ))}

        {/* 꼬리 */}
        <group ref={tail} position={[0, 0.42, -0.3]}>
          {a.tail === 'curl' && <mesh geometry={geo.torus(0.07, 0.035, Math.PI * 1.6, 4, 6)} material={coat} position={[0, 0.08, -0.02]} rotation={[0, Math.PI / 2, 0.6]} />}
          {a.tail === 'straight' && <mesh geometry={geo.cyl(0.02, 0.035, 0.24, 5)} material={a.pattern === 'saddle' ? mat(a.coat) : coat} position={[0, 0.08, -0.08]} rotation={[-0.75, 0, 0]} />}
          {a.tail === 'fluffy' && <mesh geometry={geo.ico(0.07, 0)} material={coat} position={[0, 0.1, -0.08]} scale={[0.9, 0.9, 1.8]} rotation={[-0.8, 0, 0]} />}
          {a.tail === 'short' && <mesh geometry={geo.ico(0.045, 0)} material={coat} position={[0, 0.02, -0.03]} />}
        </group>

        {/* 머리 */}
        <group ref={head} position={[0, 0.56, 0.27]}>
          <mesh geometry={geo.ico(0.16, long ? 1 : 0)} material={coat} scale={long ? [1.18, 1.08, 1.05] : [1.05, 1, 1]} />
          {a.pattern === 'patch' && <mesh geometry={geo.ico(0.07, 0)} material={sec} position={[-0.09, 0.05, 0.08]} scale={[0.7, 1, 0.5]} />}
          {/* 주둥이 */}
          <mesh geometry={geo.box(0.13, 0.1, snoutLen)} material={muzzleMat} position={[0, -0.05, 0.12 + snoutLen / 2]} />
          <mesh geometry={geo.box(0.06, 0.045, 0.04)} material={dark} position={[0, -0.02, 0.13 + snoutLen]} />
          <mesh ref={tongue} geometry={geo.box(0.05, 0.015, 0.06)} material={mat('#f28b9b')} position={[0, -0.1, 0.1 + snoutLen]} rotation={[0.5, 0, 0]} />
          {/* 눈 */}
          {[-1, 1].map((s) => <mesh key={s} geometry={geo.box(0.035, 0.045, 0.02)} material={dark} position={[s * 0.065, 0.03, 0.145]} />)}
          {/* 귀 */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.11, 0.1, -0.02]}>
              {a.ear === 'pointy' && <mesh geometry={geo.cone(0.055, 0.14, 3)} material={a.pattern === 'patch' && s < 0 ? sec : coat} position={[0, 0.06, 0]} rotation={[0, 0, -s * 0.2]} />}
              {a.ear === 'floppy' && <mesh geometry={geo.box(0.05, long ? 0.2 : 0.16, 0.1)} material={a.pattern === 'patch' && s < 0 ? sec : a.pattern === 'saddle' ? sec : coat} position={[s * 0.04, -0.08, 0]} rotation={[0, 0, s * 0.25]} />}
              {a.ear === 'fold' && <mesh geometry={geo.box(0.08, 0.04, 0.08)} material={a.pattern === 'patch' && s < 0 ? sec : coat} position={[s * 0.01, 0.03, 0.03]} rotation={[0.5, 0, -s * 0.3]} />}
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}
