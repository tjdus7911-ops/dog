// 사람 아바타 컴포넌트 — humanModel 빌더로 만든 리그를 공통 애니메이션으로 움직인다.
// 추후 GLB 모델로 교체할 때도 HumanDriver 인터페이스만 유지하면 된다.
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HumanAvatar } from '@shared/avatar';
import { HumanAnim } from '@shared/protocol';
import { createHuman } from './humanModel';

export interface HumanDriver {
  anim: number;
  /** 보폭 위상 (이동 거리 기반 — 발 미끄러짐 방지) */
  phase: number;
  /** 0~1 인사 동작 가중치 */
  wave: number;
  /** 목줄을 쥐고 있는지 */
  leash: boolean;
  /** 점프 높이 (0이면 땅 위) */
  jumpY: number;
}

export const newHumanDriver = (): HumanDriver => ({ anim: HumanAnim.Idle, phase: 0, wave: 0, leash: true, jumpY: 0 });

/** 한 걸음(반 주기)당 이동 거리 — 다리 길이에 맞춘 값 */
export const HUMAN_STEP = { walk: 0.34, run: 0.6 };

export function Human({ avatar, driver, handRef }: { avatar: HumanAvatar; driver: MutableRefObject<HumanDriver>; handRef?: MutableRefObject<THREE.Object3D | null> }) {
  const key = JSON.stringify(avatar);
  const rig = useMemo(() => createHuman(avatar), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const sm = useRef({ walk: 0, run: 0, wave: 0, air: 0 });

  useLayoutEffect(() => {
    if (handRef) handRef.current = rig.hand;
  }, [rig, handRef]);

  useFrame((state, dt) => {
    const d = driver.current;
    const t = state.clock.elapsedTime;
    const s = sm.current;
    const k = 1 - Math.exp(-dt * 10);
    s.walk += ((d.anim === HumanAnim.Walk || d.anim === HumanAnim.Run ? 1 : 0) - s.walk) * k;
    s.run += ((d.anim === HumanAnim.Run ? 1 : 0) - s.run) * k;
    s.wave += ((d.anim === HumanAnim.Wave || d.wave > 0 ? 1 : 0) - s.wave) * k;
    s.air += ((d.jumpY > 0.02 ? 1 : 0) - s.air) * (1 - Math.exp(-dt * 16));

    const swing = Math.sin(d.phase);
    const legAmp = 0.6 + s.run * 0.3;
    const armAmp = 0.5 + s.run * 0.45;
    rig.legL.rotation.x = swing * legAmp * s.walk;
    rig.legR.rotation.x = -swing * legAmp * s.walk;
    rig.armL.rotation.x = -swing * armAmp * s.walk;
    // 오른손(목줄)은 흔들림을 줄이고 살짝 앞으로
    const hold = d.leash ? 1 : 0;
    rig.armR.rotation.x = swing * armAmp * s.walk * (1 - hold * 0.6) - hold * 0.4;
    rig.armR.rotation.z = -0.08 - hold * 0.1;

    if (s.wave > 0.01) {
      rig.armL.rotation.z = THREE.MathUtils.lerp(0.08, 2.5, s.wave);
      rig.armL.rotation.x = THREE.MathUtils.lerp(rig.armL.rotation.x, Math.sin(t * 12) * 0.35, s.wave);
    } else rig.armL.rotation.z = 0.08;

    // 몸 반동 · 달릴 때 앞으로 기울기 · 숨쉬기 · 고개 까딱
    rig.body.position.y = Math.abs(Math.cos(d.phase)) * (0.03 + s.run * 0.035) * s.walk + Math.sin(t * 2.2) * 0.006 * (1 - s.walk);
    rig.torso.rotation.x = s.run * 0.16;
    rig.head.rotation.z = Math.sin(t * 1.3) * 0.04 * (1 - s.walk) + s.wave * Math.sin(t * 6) * 0.06;
    rig.head.rotation.x = -s.run * 0.12 + Math.sin(d.phase * 2) * 0.03 * s.walk;

    // 점프: 몸 전체를 띄우고 다리는 살짝 접고 팔은 위로
    rig.root.position.y = d.jumpY;
    if (s.air > 0.01) {
      rig.legL.rotation.x = THREE.MathUtils.lerp(rig.legL.rotation.x, -0.55, s.air);
      rig.legR.rotation.x = THREE.MathUtils.lerp(rig.legR.rotation.x, 0.35, s.air);
      rig.armL.rotation.z = THREE.MathUtils.lerp(rig.armL.rotation.z, 1.1, s.air);
      if (!d.leash) rig.armR.rotation.z = THREE.MathUtils.lerp(rig.armR.rotation.z, -1.1, s.air);
    }
  });

  return <primitive object={rig.root} />;
}
