// SD 비율(큰 머리 · 작은 몸) 로우폴리 사람 아바타 — 파츠 조합식
// 모든 캐릭터가 같은 뼈대(파츠 피벗)를 공유하므로 걷기/달리기/인사 애니메이션을 공통으로 쓴다.
// 추후 GLB 모델로 교체할 때도 HumanDriver 인터페이스만 유지하면 된다.
import { useRef, type MutableRefObject, type Ref } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HumanAvatar } from '@shared/avatar';
import { HumanAnim } from '@shared/protocol';
import { geo, mat } from '../lowpoly';

export interface HumanDriver {
  anim: number;
  /** 보폭 위상 (이동 거리 기반 — 발 미끄러짐 방지) */
  phase: number;
  /** 0~1 인사 동작 가중치 */
  wave: number;
  /** 목줄을 쥐고 있는지 */
  leash: boolean;
}

export const newHumanDriver = (): HumanDriver => ({ anim: HumanAnim.Idle, phase: 0, wave: 0, leash: true });

/** 한 걸음(반 주기)당 이동 거리 — 다리 길이에 맞춘 값 */
export const HUMAN_STEP = { walk: 0.36, run: 0.62 };

const EYE = '#3a2a22';
const CHEEK = '#f6a9a0';

export function Human({ avatar, driver, handRef }: { avatar: HumanAvatar; driver: MutableRefObject<HumanDriver>; handRef?: Ref<THREE.Object3D> }) {
  const body = useRef<THREE.Group>(null!);
  const torso = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Group>(null!);
  const legL = useRef<THREE.Group>(null!);
  const legR = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const smooth = useRef({ walk: 0, run: 0, wave: 0 });

  useFrame((state, dt) => {
    const d = driver.current;
    const t = state.clock.elapsedTime;
    const sm = smooth.current;
    const k = 1 - Math.exp(-dt * 10);
    sm.walk += ((d.anim === HumanAnim.Walk || d.anim === HumanAnim.Run ? 1 : 0) - sm.walk) * k;
    sm.run += ((d.anim === HumanAnim.Run ? 1 : 0) - sm.run) * k;
    sm.wave += ((d.anim === HumanAnim.Wave || d.wave > 0 ? 1 : 0) - sm.wave) * k;

    const swing = Math.sin(d.phase);
    const legAmp = 0.55 + sm.run * 0.35;
    const armAmp = 0.45 + sm.run * 0.5;
    legL.current.rotation.x = swing * legAmp * sm.walk;
    legR.current.rotation.x = -swing * legAmp * sm.walk;
    armL.current.rotation.x = -swing * armAmp * sm.walk;
    // 오른손은 목줄을 쥐고 있어 흔들림을 줄이고 앞으로 살짝 내민다
    const leashHold = d.leash ? 1 : 0;
    armR.current.rotation.x = swing * armAmp * sm.walk * (1 - leashHold * 0.6) - leashHold * 0.45;
    armR.current.rotation.z = -0.12 - leashHold * 0.12;

    // 인사(왼팔 들어 흔들기)
    if (sm.wave > 0.01) {
      armL.current.rotation.z = THREE.MathUtils.lerp(0.12, 2.6, sm.wave);
      armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, Math.sin(t * 12) * 0.35, sm.wave);
    } else armL.current.rotation.z = 0.12;

    // 몸통 상하 반동 & 달리기 시 앞으로 기울기
    const bob = Math.abs(Math.cos(d.phase)) * (0.035 + sm.run * 0.04) * sm.walk;
    const breathe = Math.sin(t * 2.2) * 0.008 * (1 - sm.walk);
    body.current.position.y = bob + breathe;
    torso.current.rotation.x = sm.run * 0.18;
    head.current.rotation.z = Math.sin(t * 1.3) * 0.03 * (1 - sm.walk);
    head.current.rotation.x = -sm.run * 0.1;
  });

  const a = avatar;
  const skin = mat(a.skin);
  const hair = mat(a.hairColor);
  const top = mat(a.topColor);
  const bottom = mat(a.bottomColor);
  const shoe = mat(a.shoeColor);
  const legColor = a.bottom === 'pants' ? bottom : skin;

  return (
    <group ref={body}>
      {/* 다리 (엉덩이 피벗) */}
      {[-1, 1].map((side) => (
        <group key={side} ref={side < 0 ? legL : legR} position={[side * 0.09, 0.36, 0]}>
          <mesh geometry={geo.box(0.12, 0.3, 0.13)} material={legColor} position={[0, -0.15, 0]} />
          {a.bottom === 'shorts' && <mesh geometry={geo.box(0.135, 0.12, 0.145)} material={bottom} position={[0, -0.04, 0]} />}
          <mesh geometry={geo.box(0.14, 0.08, 0.2)} material={shoe} position={[0, -0.31, 0.03]} />
        </group>
      ))}
      <group ref={torso} position={[0, 0.36, 0]}>
        {/* 골반 / 하의 */}
        {a.bottom === 'skirt'
          ? <mesh geometry={geo.cyl(0.17, 0.24, 0.2, 7)} material={bottom} position={[0, 0.02, 0]} />
          : <mesh geometry={geo.box(0.32, 0.12, 0.2)} material={bottom} position={[0, 0.04, 0]} />}
        {/* 상체 */}
        <mesh geometry={geo.box(0.34, 0.3, 0.22)} material={top} position={[0, 0.24, 0]} />
        {a.top === 'hoodie' && <mesh geometry={geo.box(0.3, 0.12, 0.08)} material={top} position={[0, 0.36, -0.12]} />}
        {a.top === 'hoodie' && <mesh geometry={geo.box(0.16, 0.08, 0.02)} material={mat('#ffffff')} position={[0, 0.17, 0.115]} />}
        {a.top === 'jacket' && <mesh geometry={geo.box(0.06, 0.28, 0.02)} material={mat('#fff8ef')} position={[0, 0.24, 0.115]} />}
        {a.accessory === 'backpack' && (
          <group position={[0, 0.25, -0.16]}>
            <mesh geometry={geo.box(0.26, 0.28, 0.12)} material={mat('#c98f62')} />
            <mesh geometry={geo.box(0.18, 0.1, 0.03)} material={mat('#e6b47a')} position={[0, -0.05, -0.07]} />
          </group>
        )}
        {/* 팔 (어깨 피벗) */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? armR : armL} position={[side * 0.21, 0.36, 0]}>
            <mesh geometry={geo.box(0.1, 0.26, 0.11)} material={top} position={[0, -0.12, 0]} />
            <mesh geometry={geo.ico(0.06, 0)} material={skin} position={[0, -0.28, 0]} />
            {side < 0 && <object3D ref={handRef} position={[0, -0.3, 0.02]} />}
          </group>
        ))}
        {/* 머리 — SD 비율: 몸통보다 큰 머리 */}
        <group ref={head} position={[0, 0.66, 0]}>
          <mesh geometry={geo.ico(0.3, 1)} material={skin} scale={[1, 0.94, 0.92]} />
          {/* 얼굴 */}
          {[-1, 1].map((s) => (
            <group key={s}>
              <mesh geometry={geo.box(0.05, 0.08, 0.02)} material={mat(EYE)} position={[s * 0.1, -0.01, 0.265]} />
              <mesh geometry={geo.box(0.06, 0.03, 0.01)} material={mat(CHEEK)} position={[s * 0.16, -0.08, 0.245]} />
            </group>
          ))}
          <mesh geometry={geo.box(0.05, 0.015, 0.01)} material={mat('#c76f5f')} position={[0, -0.1, 0.27]} />
          <Hair style={a.hairStyle} m={hair} />
          {a.hat === 'cap' && (
            <group position={[0, 0.1, 0]}>
              <mesh geometry={geo.sphere(0.315, 8, 4, Math.PI / 2)} material={mat(a.hatColor)} />
              <mesh geometry={geo.box(0.34, 0.03, 0.2)} material={mat(a.hatColor)} position={[0, 0.0, 0.3]} rotation={[0.12, 0, 0]} />
              <mesh geometry={geo.ico(0.035, 0)} material={mat(a.hatColor)} position={[0, 0.31, 0]} />
            </group>
          )}
          {a.hat === 'beanie' && (
            <group position={[0, 0.08, 0]}>
              <mesh geometry={geo.sphere(0.32, 8, 4, Math.PI / 2)} material={mat(a.hatColor)} />
              <mesh geometry={geo.cyl(0.325, 0.325, 0.07, 8)} material={mat('#fff8ef')} position={[0, 0.01, 0]} />
              <mesh geometry={geo.ico(0.07, 0)} material={mat('#fff8ef')} position={[0, 0.33, 0]} />
            </group>
          )}
          {a.accessory === 'glasses' && (
            <group position={[0, -0.01, 0.275]}>
              {[-1, 1].map((s) => <mesh key={s} geometry={geo.torus(0.06, 0.012, Math.PI * 2, 3, 8)} material={mat('#5a4033')} position={[s * 0.1, 0, 0]} />)}
              <mesh geometry={geo.box(0.08, 0.012, 0.01)} material={mat('#5a4033')} />
            </group>
          )}
        </group>
      </group>
      {/* 발밑 그림자 */}
    </group>
  );
}

function Hair({ style, m }: { style: HumanAvatar['hairStyle']; m: THREE.Material }) {
  return (
    <group>
      {/* 공통: 머리 윗부분과 뒷머리, 앞머리 */}
      <mesh geometry={geo.sphere(0.32, 8, 4, Math.PI * 0.55)} material={m} position={[0, 0.02, -0.02]} />
      <mesh geometry={geo.box(0.42, 0.12, 0.08)} material={m} position={[0, 0.16, 0.22]} rotation={[-0.4, 0, 0]} />
      {style === 'short' && <mesh geometry={geo.box(0.5, 0.26, 0.18)} material={m} position={[0, -0.02, -0.18]} />}
      {style === 'bob' && (
        <>
          <mesh geometry={geo.box(0.56, 0.36, 0.3)} material={m} position={[0, -0.06, -0.12]} />
          {[-1, 1].map((s) => <mesh key={s} geometry={geo.box(0.09, 0.32, 0.22)} material={m} position={[s * 0.27, -0.1, 0.06]} />)}
        </>
      )}
      {style === 'long' && (
        <>
          <mesh geometry={geo.box(0.56, 0.62, 0.22)} material={m} position={[0, -0.2, -0.16]} />
          {[-1, 1].map((s) => <mesh key={s} geometry={geo.box(0.09, 0.42, 0.2)} material={m} position={[s * 0.27, -0.16, 0.04]} />)}
        </>
      )}
      {style === 'bun' && (
        <>
          <mesh geometry={geo.box(0.5, 0.28, 0.2)} material={m} position={[0, -0.02, -0.17]} />
          <mesh geometry={geo.ico(0.12, 0)} material={m} position={[0, 0.33, -0.1]} />
        </>
      )}
      {style === 'spiky' && (
        <>
          <mesh geometry={geo.box(0.5, 0.22, 0.18)} material={m} position={[0, 0.0, -0.18]} />
          {[-0.16, 0, 0.16].map((x, i) => (
            <mesh key={i} geometry={geo.cone(0.08, 0.2, 4)} material={m} position={[x, 0.33, 0.02 - i * 0.04]} rotation={[-0.3, 0, x * -1.5]} />
          ))}
        </>
      )}
    </group>
  );
}
