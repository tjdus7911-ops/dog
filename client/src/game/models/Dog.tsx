// 강아지 아바타 컴포넌트 — dogModel 리그를 걷기/달리기/앉기/살피기/인사 동작으로 움직인다.
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DogAvatar } from '@shared/avatar';
import { DogAnim } from '@shared/protocol';
import { createDog } from './dogModel';

export interface DogDriver {
  anim: number;
  phase: number;
  /** 고개 좌우 (주변 살피기) */
  look: number;
}
export const newDogDriver = (): DogDriver => ({ anim: DogAnim.Stand, phase: 0, look: 0 });

export const DOG_SCALE = { small: 0.82, medium: 1, large: 1.2 } as const;
/** 한 걸음(반 주기)당 이동 거리 (scale 1 기준) */
export const DOG_STEP = { walk: 0.19, run: 0.4 };

export function Dog({ avatar, driver, anchorRef }: { avatar: DogAvatar; driver: MutableRefObject<DogDriver>; anchorRef?: MutableRefObject<THREE.Object3D | null> }) {
  const key = JSON.stringify(avatar);
  const rig = useMemo(() => createDog(avatar), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const sm = useRef({ move: 0, run: 0, sit: 0, greet: 0 , lie: 0 });

  useLayoutEffect(() => {
    if (anchorRef) anchorRef.current = rig.anchor;
  }, [rig, anchorRef]);

  useFrame((state, dt) => {
    const d = driver.current;
    const t = state.clock.elapsedTime;
    const s = sm.current;
    const k = 1 - Math.exp(-dt * 9);
    s.move += ((d.anim === DogAnim.Walk || d.anim === DogAnim.Run ? 1 : 0) - s.move) * k;
    s.run += ((d.anim === DogAnim.Run ? 1 : 0) - s.run) * k;
    s.sit += ((d.anim === DogAnim.Sit ? 1 : 0) - s.sit) * (1 - Math.exp(-dt * 6));
    s.greet += ((d.anim === DogAnim.Greet ? 1 : 0) - s.greet) * k;
    s.lie += ((d.anim === DogAnim.Lie ? 1 : 0) - s.lie) * (1 - Math.exp(-dt * 4));

    const p = d.phase;
    const walkAmp = 0.65 * s.move * (1 - s.run);
    const runAmp = 0.9 * s.run;
    // 걷기: 대각선 다리가 같은 위상 / 달리기: 앞·뒷다리 쌍이 함께 (갤럽)
    const [fl, fr, bl, br] = rig.legs;
    fl.rotation.x = Math.sin(p) * walkAmp + Math.sin(p) * runAmp;
    fr.rotation.x = -Math.sin(p) * walkAmp + Math.sin(p + 0.4) * runAmp;
    // 앉기: 뒷다리를 앞으로 접는다
    bl.rotation.x = THREE.MathUtils.lerp(-Math.sin(p) * walkAmp + Math.sin(p + Math.PI) * runAmp, -1.25, s.sit);
    br.rotation.x = THREE.MathUtils.lerp(Math.sin(p) * walkAmp + Math.sin(p + Math.PI + 0.4) * runAmp, -1.25, s.sit);
    fl.rotation.x = THREE.MathUtils.lerp(fl.rotation.x, 0.15, s.sit);
    fr.rotation.x = THREE.MathUtils.lerp(fr.rotation.x, 0.15, s.sit);
    // 엎드리기: 앞다리는 앞으로 쭉, 뒷다리는 접고 몸을 바닥으로
    fl.rotation.x = THREE.MathUtils.lerp(fl.rotation.x, -1.45, s.lie);
    fr.rotation.x = THREE.MathUtils.lerp(fr.rotation.x, -1.45, s.lie);
    bl.rotation.x = THREE.MathUtils.lerp(bl.rotation.x, 1.35, s.lie);
    br.rotation.x = THREE.MathUtils.lerp(br.rotation.x, 1.35, s.lie);

    const bob = Math.abs(Math.sin(p)) * (0.018 * s.move + 0.045 * s.run);
    const hop = s.greet * Math.max(0, Math.sin(t * 9)) * 0.05;
    rig.body.position.y = rig.baseY + bob + hop - s.sit * 0.05 - s.lie * (0.12 + rig.baseY) + Math.sin(t * 3) * 0.004 * (1 + s.lie);
    rig.body.position.z = -s.sit * 0.04;
    rig.body.rotation.x = -s.sit * 0.5 + Math.sin(p * 2) * 0.05 * s.run;

    rig.head.rotation.y = d.look * (1 - s.move) + Math.sin(t * 7) * 0.12 * s.greet;
    rig.head.rotation.x = s.sit * 0.4 - s.run * 0.08 + Math.sin(t * 1.7) * 0.03;
    rig.head.rotation.z = Math.sin(t * 0.9) * 0.06 * (1 - s.move);

    // 꼬리 흔들기 — 반가울수록 빠르게
    const wag = 8 + s.greet * 14 + s.run * 4 - s.lie * 3;
    rig.tail.rotation.y = Math.sin(t * wag) * (0.35 + s.greet * 0.35);
    rig.tongue.visible = s.run > 0.4 || s.greet > 0.4;
  });

  return (
    <group scale={DOG_SCALE[avatar.size]}>
      <primitive object={rig.root} />
    </group>
  );
}
