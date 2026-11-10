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
  /** 쓰다듬을 강아지 높이에 맞춘 숙임 정도 (0: 큰 강아지 ~ 1: 작은 강아지) */
  petLow: number;
  /** 배변봉투를 들고 있는지 (왼손) */
  bag: boolean;
}

export const newHumanDriver = (): HumanDriver => ({ anim: HumanAnim.Idle, phase: 0, wave: 0, leash: true, jumpY: 0, petLow: 0.6, bag: false });

/** 왼손에 드는 배변봉투 (묶은 매듭 + 동그란 봉투) */
function makeBag() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#9fd3a8', roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat);
  body.scale.set(1, 1.15, 0.9);
  body.position.y = -0.08;
  const knot = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.05, 6), mat);
  knot.position.y = -0.015;
  knot.rotation.x = Math.PI;
  const ear1 = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), mat);
  ear1.position.set(0.018, 0.012, 0);
  const ear2 = ear1.clone(); ear2.position.x = -0.018;
  for (const m of [body, knot, ear1, ear2]) { m.castShadow = true; g.add(m); }
  g.name = 'bag';
  return g;
}

/** 한 걸음(반 주기)당 이동 거리 — 다리 길이에 맞춘 값 */
export const HUMAN_STEP = { walk: 0.34, run: 0.6 };
/** 앉을 때 몸을 들어 올리는 높이 (엉덩이가 벤치 좌석 위에 오도록) */
export const SIT_LIFT = 0.17;

export function Human({ avatar, driver, handRef }: { avatar: HumanAvatar; driver: MutableRefObject<HumanDriver>; handRef?: MutableRefObject<THREE.Object3D | null> }) {
  const key = JSON.stringify(avatar);
  const rig = useMemo(() => createHuman(avatar), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const sm = useRef({ walk: 0, run: 0, wave: 0, air: 0, sit: 0, pet: 0, scoop: 0, toss: 0, tossT: 0, lie: 0 });
  const bag = useMemo(makeBag, []);

  useLayoutEffect(() => {
    if (handRef) handRef.current = rig.hand;
  }, [rig, handRef]);
  // 배변봉투는 왼손 끝에 매단다
  useLayoutEffect(() => {
    bag.position.set(0.05, -0.25, 0.02);
    rig.armL.add(bag);
    return () => { rig.armL.remove(bag); };
  }, [rig, bag]);

  useFrame((state, dt) => {
    const d = driver.current;
    const t = state.clock.elapsedTime;
    const s = sm.current;
    const k = 1 - Math.exp(-dt * 10);
    s.walk += ((d.anim === HumanAnim.Walk || d.anim === HumanAnim.Run ? 1 : 0) - s.walk) * k;
    s.run += ((d.anim === HumanAnim.Run ? 1 : 0) - s.run) * k;
    s.wave += ((d.anim === HumanAnim.Wave || d.wave > 0 ? 1 : 0) - s.wave) * k;
    s.air += ((d.jumpY > 0.02 ? 1 : 0) - s.air) * (1 - Math.exp(-dt * 16));
    s.sit += ((d.anim === HumanAnim.Sit ? 1 : 0) - s.sit) * (1 - Math.exp(-dt * 7));
    const k2 = 1 - Math.exp(-dt * 8);
    s.pet += ((d.anim === HumanAnim.Pet ? 1 : 0) - s.pet) * k2;
    s.scoop += ((d.anim === HumanAnim.Scoop ? 1 : 0) - s.scoop) * k2;
    s.toss += ((d.anim === HumanAnim.Toss ? 1 : 0) - s.toss) * k2;
    s.tossT = d.anim === HumanAnim.Toss ? s.tossT + dt : 0;
    bag.visible = d.bag;
    s.lie += ((d.anim === HumanAnim.Lie || d.anim === HumanAnim.Sleep ? 1 : 0) - s.lie) * (1 - Math.exp(-dt * 6));
    rig.lids.visible = d.anim === HumanAnim.Sleep;

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
    rig.root.position.y = d.jumpY + s.sit * SIT_LIFT;
    // 벤치에 앉기: 엉덩이를 좌석 높이로, 다리는 앞으로 뻗고 손은 무릎 위에 (발을 살짝 까딱)
    if (s.sit > 0.01) {
      const kick = Math.sin(t * 2.4) * 0.08;
      rig.legL.rotation.x = THREE.MathUtils.lerp(rig.legL.rotation.x, -1.4 + kick, s.sit);
      rig.legR.rotation.x = THREE.MathUtils.lerp(rig.legR.rotation.x, -1.4 - kick, s.sit);
      rig.armL.rotation.x = THREE.MathUtils.lerp(rig.armL.rotation.x, -0.55, s.sit);
      rig.armR.rotation.x = THREE.MathUtils.lerp(rig.armR.rotation.x, -0.6, s.sit);
      rig.torso.rotation.x = THREE.MathUtils.lerp(rig.torso.rotation.x, -0.06, s.sit);
      rig.body.position.y *= 1 - s.sit;
    }
    // 숙여서 쓰다듬기 / 배변 줍기: 무릎을 굽혀 몸을 낮추고 상체를 숙여 왼손을 아래로 뻗는다
    const crouch = Math.max(s.pet * (0.35 + d.petLow * 0.65), s.scoop);
    if (crouch > 0.01) {
      rig.root.position.y -= crouch * 0.17;
      rig.legL.rotation.x = THREE.MathUtils.lerp(rig.legL.rotation.x, -0.95, crouch);
      rig.legR.rotation.x = THREE.MathUtils.lerp(rig.legR.rotation.x, 0.85, crouch);
      rig.torso.rotation.x = THREE.MathUtils.lerp(rig.torso.rotation.x, 0.38, crouch);
      rig.head.rotation.x = THREE.MathUtils.lerp(rig.head.rotation.x, 0.05, crouch);
      rig.body.position.y *= 1 - crouch;
    }
    if (s.pet > 0.01) {
      // 머리를 쓰다듬는 손: 강아지 크기에 맞춰 뻗는 각도를 바꾸고 앞뒤로 살살
      const reach = THREE.MathUtils.lerp(-1.45, -0.95, d.petLow);
      rig.armL.rotation.x = THREE.MathUtils.lerp(rig.armL.rotation.x, reach + Math.sin(t * 7) * 0.16, s.pet);
      rig.armL.rotation.z = THREE.MathUtils.lerp(rig.armL.rotation.z, 0.12, s.pet);
    }
    if (s.scoop > 0.01) {
      rig.armL.rotation.x = THREE.MathUtils.lerp(rig.armL.rotation.x, -0.75 + Math.sin(t * 5) * 0.08, s.scoop);
      rig.armL.rotation.z = THREE.MathUtils.lerp(rig.armL.rotation.z, 0.05, s.scoop);
    }
    if (s.toss > 0.01) {
      // 휴지통에 넣기: 앞으로 들어 올렸다가 아래로 툭
      const swingT = Math.min(1, s.tossT / 0.6);
      const arm = swingT < 0.5 ? THREE.MathUtils.lerp(0, -1.5, swingT * 2) : THREE.MathUtils.lerp(-1.5, -0.9, (swingT - 0.5) * 2);
      rig.armL.rotation.x = THREE.MathUtils.lerp(rig.armL.rotation.x, arm, s.toss);
      rig.torso.rotation.x = THREE.MathUtils.lerp(rig.torso.rotation.x, 0.18, s.toss);
    }
    // 침대에 눕기: 발을 기준으로 등을 대고 눕는다 (머리는 베개 쪽 -z), 팔은 몸 옆, 잠잘 때는 숨쉬기만
    if (s.lie > 0.01) {
      rig.root.rotation.x = -Math.PI / 2 * s.lie;
      rig.root.position.y = THREE.MathUtils.lerp(rig.root.position.y, 0.13, s.lie);
      rig.legL.rotation.x = THREE.MathUtils.lerp(rig.legL.rotation.x, 0, s.lie);
      rig.legR.rotation.x = THREE.MathUtils.lerp(rig.legR.rotation.x, 0, s.lie);
      rig.armL.rotation.x = THREE.MathUtils.lerp(rig.armL.rotation.x, 0.05, s.lie);
      rig.armR.rotation.x = THREE.MathUtils.lerp(rig.armR.rotation.x, 0.05, s.lie);
      rig.armL.rotation.z = THREE.MathUtils.lerp(rig.armL.rotation.z, 0.18, s.lie);
      rig.armR.rotation.z = THREE.MathUtils.lerp(rig.armR.rotation.z, -0.18, s.lie);
      rig.torso.rotation.x = THREE.MathUtils.lerp(rig.torso.rotation.x, 0, s.lie);
      rig.body.position.y = Math.sin(t * (d.anim === HumanAnim.Sleep ? 1.3 : 2)) * 0.006;
      rig.head.rotation.z = THREE.MathUtils.lerp(rig.head.rotation.z, d.anim === HumanAnim.Sleep ? 0.28 : 0.05, s.lie);
      rig.head.rotation.x = THREE.MathUtils.lerp(rig.head.rotation.x, 0, s.lie);
    } else rig.root.rotation.x = 0;
    if (s.air > 0.01) {
      rig.legL.rotation.x = THREE.MathUtils.lerp(rig.legL.rotation.x, -0.55, s.air);
      rig.legR.rotation.x = THREE.MathUtils.lerp(rig.legR.rotation.x, 0.35, s.air);
      rig.armL.rotation.z = THREE.MathUtils.lerp(rig.armL.rotation.z, 1.1, s.air);
      if (!d.leash) rig.armR.rotation.z = THREE.MathUtils.lerp(rig.armR.rotation.z, -1.1, s.air);
    }
  });

  return <primitive object={rig.root} />;
}
