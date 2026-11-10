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
  /** 쓰다듬기를 받아 기뻐하는 시간 (performance.now 기준 ms) */
  happyUntil: number;
}
export const newDogDriver = (): DogDriver => ({ anim: DogAnim.Stand, phase: 0, look: 0, happyUntil: 0 });

export const DOG_SCALE = { small: 0.82, medium: 1, large: 1.2 } as const;
/** 한 걸음(반 주기)당 이동 거리 (scale 1 기준) */
export const DOG_STEP = { walk: 0.19, run: 0.4 };

export function Dog({ avatar, driver, anchorRef }: { avatar: DogAvatar; driver: MutableRefObject<DogDriver>; anchorRef?: MutableRefObject<THREE.Object3D | null> }) {
  const key = JSON.stringify(avatar);
  const rig = useMemo(() => createDog(avatar), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const sm = useRef({ move: 0, run: 0, sit: 0, greet: 0, lie: 0, poop: 0, happy: 0, sleep: 0 });

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
    s.lie += ((d.anim === DogAnim.Lie || d.anim === DogAnim.Sleep ? 1 : 0) - s.lie) * (1 - Math.exp(-dt * 4));
    s.sleep += ((d.anim === DogAnim.Sleep ? 1 : 0) - s.sleep) * (1 - Math.exp(-dt * 3));
    s.poop += ((d.anim === DogAnim.Poop ? 1 : 0) - s.poop) * (1 - Math.exp(-dt * 6));
    s.happy += ((performance.now() < d.happyUntil ? 1 : 0) - s.happy) * (1 - Math.exp(-dt * 6));

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

    // 배변 자세: 뒷다리를 앞으로 벌려 접고 엉덩이를 낮추며 꼬리를 든다 (앞다리는 버팀)
    // (앉기와 비슷하지만 엉덩이는 바닥에서 살짝 띄우고, 앞다리는 몸 기울기만큼 되돌려 바닥을 짚게)
    bl.rotation.x = THREE.MathUtils.lerp(bl.rotation.x, -0.85, s.poop);
    br.rotation.x = THREE.MathUtils.lerp(br.rotation.x, -0.85, s.poop);
    bl.rotation.z = s.poop * 0.18; br.rotation.z = -s.poop * 0.18;
    fl.rotation.x = THREE.MathUtils.lerp(fl.rotation.x, 0.3, s.poop);
    fr.rotation.x = THREE.MathUtils.lerp(fr.rotation.x, 0.3, s.poop);

    const bob = Math.abs(Math.sin(p)) * (0.018 * s.move + 0.045 * s.run);
    const hop = s.greet * Math.max(0, Math.sin(t * 9)) * 0.05;
    // 쓰다듬기 반응: 살짝 몸을 낮추고 꼬리를 세차게, 고개를 들어 기대며 좌우로 비빈다
    const happyHop = s.happy * Math.max(0, Math.sin(t * 6)) * 0.018;
    rig.body.position.y = rig.baseY + bob + hop + happyHop - s.sit * 0.05 - s.lie * (0.12 + rig.baseY) - s.poop * 0.025 - s.happy * 0.015 + Math.sin(t * 3) * 0.004 * (1 + s.lie);
    rig.body.position.z = -s.sit * 0.04 - s.poop * 0.02;
    rig.body.rotation.x = -s.sit * 0.5 - s.poop * 0.3 + Math.sin(p * 2) * 0.05 * s.run;

    rig.head.rotation.y = d.look * (1 - s.move) * (1 - s.happy) + Math.sin(t * 7) * 0.12 * s.greet + Math.sin(t * 3.2) * 0.22 * s.happy;
    rig.head.rotation.x = s.sit * 0.4 + s.poop * 0.22 - s.happy * 0.32 - s.run * 0.08 + Math.sin(t * 1.7) * 0.03;
    rig.head.rotation.z = Math.sin(t * 0.9) * 0.06 * (1 - s.move) + Math.sin(t * 3.2) * 0.12 * s.happy;

    // 꼬리 흔들기 — 반가울수록 빠르게 (배변 중에는 꼬리를 들고 가만히)
    const wag = 8 + s.greet * 14 + s.happy * 16 + s.run * 4 - s.lie * 3;
    rig.tail.rotation.y = Math.sin(t * wag) * (0.35 + Math.max(s.greet, s.happy) * 0.35) * (1 - s.poop);
    rig.tail.rotation.x = s.poop * 0.6;
    rig.tongue.visible = (s.run > 0.4 || s.greet > 0.4 || s.happy > 0.5) && s.sleep < 0.3;
    // 잠자기: 엎드린 채 몸을 살짝 옆으로 말고, 고개를 꼬리 쪽으로 돌려 내려놓고, 꼬리는 몸에 붙임 (천천히 숨쉬기)
    if (s.sleep > 0.01) {
      rig.body.rotation.z = s.sleep * 0.38;
      rig.body.rotation.y = s.sleep * 0.22;
      rig.body.position.y += Math.sin(t * 1.4) * 0.006 * s.sleep;
      rig.head.rotation.y = THREE.MathUtils.lerp(rig.head.rotation.y, 0.95, s.sleep);
      rig.head.rotation.x = THREE.MathUtils.lerp(rig.head.rotation.x, 0.42, s.sleep);
      rig.head.rotation.z = THREE.MathUtils.lerp(rig.head.rotation.z, 0.25, s.sleep);
      rig.tail.rotation.y = THREE.MathUtils.lerp(rig.tail.rotation.y, 1.1, s.sleep);
      rig.tail.rotation.x = THREE.MathUtils.lerp(rig.tail.rotation.x, -0.5, s.sleep);
    } else { rig.body.rotation.z = 0; rig.body.rotation.y = 0; }
    // 눈 감기: 쓰다듬기를 받을 때(기분 좋게) · 잠잘 때
    rig.lids.visible = s.happy > 0.5 || d.anim === DogAnim.Sleep;
  });

  return (
    <group scale={DOG_SCALE[avatar.size]}>
      <primitive object={rig.root} />
    </group>
  );
}
