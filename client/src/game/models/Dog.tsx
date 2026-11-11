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
  /** 멍글런너 자세 (0~1): 도약 전·착지 때 몸 낮춤 / 공중 / 숙여 미끄러지기 */
  crouch: number;
  air: number;
  slide: number;
  /**
   * 멍글런너 '삐끗' (0~1, 부드럽게 들어왔다 빠짐) — 장애물에 부딪혔을 때 짧게 휘청이는 동작
   * tripKind 0: 뛰기 실패(앞발이 걸려 몸이 앞으로 쏠림) · 1: 숙이기 실패(고개 움츠림·도리도리) · 2: 옆 충돌(옆으로 기우뚱)
   */
  trip: number;
  tripKind: number;
  /** 삐끗이 시작된 뒤 지난 시간 (ms) — 흔들림이 점점 잦아들게 */
  tripT: number;
  /** 옆 충돌 때 기우는 방향 (-1 / 1) */
  tripSide: number;
  /** 귀 처짐 (0~1, 실수했을 때 살짝) — 귀 관절이 있는 강아지만 */
  earDown: number;
  /** 달리면서 꼬리를 세게 흔드는 시간 (추월 성공 등, performance.now 기준 ms) */
  wagUntil: number;
}
export const newDogDriver = (): DogDriver => ({ anim: DogAnim.Stand, phase: 0, look: 0, happyUntil: 0, crouch: 0, air: 0, slide: 0, trip: 0, tripKind: 0, tripT: 0, tripSide: 1, earDown: 0, wagUntil: 0 });

export const DOG_SCALE = { small: 0.82, medium: 1, large: 1.2 } as const;
/** 한 걸음(반 주기)당 이동 거리 (scale 1 기준) */
export const DOG_STEP = { walk: 0.19, run: 0.42 };
/** 멍글런너 숙이기: 몸통을 내리는 높이 (다리 길이 보정값과 별개로 — 배가 거의 바닥에 닿을 만큼) */
const DUCK_DROP = 0.105;

/** harness: 산책용 목줄 세트 착용 (집 안에서는 false — 모델을 새로 만들지 않고 그 부분만 숨김) */
export function Dog({ avatar, driver, anchorRef, earBones, harness = true }: { avatar: DogAvatar; driver: MutableRefObject<DogDriver>; anchorRef?: MutableRefObject<THREE.Object3D | null>; earBones?: boolean; harness?: boolean }) {
  const key = JSON.stringify(avatar);
  const rig = useMemo(() => createDog(avatar, { earBones }), [key, earBones]); // eslint-disable-line react-hooks/exhaustive-deps
  const sm = useRef({ move: 0, run: 0, sit: 0, greet: 0, lie: 0, poop: 0, happy: 0, sleep: 0, wag: 0 });

  useLayoutEffect(() => {
    if (anchorRef) anchorRef.current = rig.anchor;
  }, [rig, anchorRef]);
  // 그리기 전에 바로 반영 → 공간을 옮길 때 깜빡이거나 두 개로 보이지 않음
  useLayoutEffect(() => {
    if (rig.harness) rig.harness.visible = harness;
  }, [rig, harness]);

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
    s.wag += ((performance.now() < d.wagUntil ? 1 : 0) - s.wag) * (1 - Math.exp(-dt * 8));

    const p = d.phase;
    const walkAmp = 0.65 * s.move * (1 - s.run);
    const runAmp = 0.55 * s.run;
    // 걷기: 대각선 다리가 같은 위상
    // 달리기: 작은 강아지의 '통통' 갤럽 — 앞다리 두 개, 뒷다리 두 개가 살짝 엇갈려 차례로 땅을 디딤.
    // 다리를 앞으로 내딛는 동작은 빠르게, 땅을 밀어내는 동작은 천천히(비대칭)라 허우적거리지 않는다.
    const stride = (x: number) => Math.sin(x) + 0.18 * Math.sin(2 * x);
    const [fl, fr, bl, br] = rig.legs;
    fl.rotation.x = Math.sin(p) * walkAmp + stride(p) * runAmp;
    fr.rotation.x = -Math.sin(p) * walkAmp + stride(p + 0.5) * runAmp;
    // 앉기: 뒷다리를 앞으로 접는다
    bl.rotation.x = THREE.MathUtils.lerp(-Math.sin(p) * walkAmp + stride(p + Math.PI + 0.2) * runAmp * 0.9, -1.25, s.sit);
    br.rotation.x = THREE.MathUtils.lerp(Math.sin(p) * walkAmp + stride(p + Math.PI + 0.7) * runAmp * 0.9, -1.25, s.sit);
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

    // 몸 반동: 걷기는 한 걸음마다 살짝, 달리기는 한 주기에 한 번 부드럽게 (과하게 튀지 않게)
    const bob = Math.abs(Math.sin(p)) * 0.018 * s.move * (1 - s.run) + (1 - Math.cos(p * 2)) * 0.5 * 0.014 * s.run;
    const runPitch = Math.sin(p * 2 + 0.6) * 0.035 * s.run;
    const hop = s.greet * Math.max(0, Math.sin(t * 9)) * 0.05;
    // 쓰다듬기 반응: 살짝 몸을 낮추고 꼬리를 세차게, 고개를 들어 기대며 좌우로 비빈다
    const happyHop = s.happy * Math.max(0, Math.sin(t * 6)) * 0.018;
    rig.body.position.y = rig.baseY + bob + hop + happyHop - s.sit * 0.05 - s.lie * (0.12 + rig.baseY) - s.poop * 0.025 - s.happy * 0.015 + Math.sin(t * 3) * 0.004 * (1 + s.lie);
    rig.body.position.z = -s.sit * 0.04 - s.poop * 0.02;
    rig.body.rotation.x = -s.sit * 0.5 - s.poop * 0.3 + runPitch;

    rig.head.rotation.y = d.look * (1 - s.move) * (1 - s.happy) + Math.sin(t * 7) * 0.12 * s.greet + Math.sin(t * 3.2) * 0.22 * s.happy;
    // 달릴 때 머리는 몸 기울기를 되돌려 거의 고정 (시선이 흔들리지 않게)
    rig.head.rotation.x = s.sit * 0.4 + s.poop * 0.22 - s.happy * 0.32 - s.run * 0.06 - runPitch * 0.85 + Math.sin(t * 1.7) * 0.03 * (1 - s.run);
    rig.head.rotation.z = Math.sin(t * 0.9) * 0.06 * (1 - s.move) + Math.sin(t * 3.2) * 0.12 * s.happy;

    // 꼬리 흔들기 — 반가울수록 빠르게 (배변 중에는 꼬리를 들고 가만히)
    const wag = 8 + s.greet * 14 + s.happy * 16 - s.lie * 3;
    // 달릴 때 꼬리는 발걸음에 맞춰 아주 살짝만
    rig.tail.rotation.y = (Math.sin(t * wag) * (0.35 + Math.max(s.greet, s.happy) * 0.35) * (1 - s.run * 0.75) + Math.sin(p) * 0.12 * s.run) * (1 - s.poop);
    rig.tail.rotation.x = s.poop * 0.6;
    // 신나서 꼬리 흔들기 (달리는 중에도 보이게 크고 빠르게, 짧게)
    if (s.wag > 0.01) { rig.tail.rotation.y += Math.sin(t * 22) * 0.5 * s.wag; rig.tail.rotation.x -= 0.25 * s.wag; }
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
    // 멍글런너: 도약 준비·착지(몸 낮춤) → 공중(앞다리 접고 뒷다리 뻗기) / 숙이기(바닥에 납작 엎드리기) / 삐끗(헛디뎌 휘청)
    const head0 = (rig.head.userData.p0 ??= rig.head.position.clone()) as THREE.Vector3;
    rig.head.position.copy(head0);
    fl.rotation.z = 0; fr.rotation.z = 0; // 뒷다리 z는 배변 자세에서 정함
    if (d.crouch > 0.001) {
      rig.body.position.y -= d.crouch * 0.035;
      bl.rotation.x = THREE.MathUtils.lerp(bl.rotation.x, -0.45, d.crouch);
      br.rotation.x = THREE.MathUtils.lerp(br.rotation.x, -0.45, d.crouch);
      fl.rotation.x = THREE.MathUtils.lerp(fl.rotation.x, 0.25, d.crouch);
      fr.rotation.x = THREE.MathUtils.lerp(fr.rotation.x, 0.25, d.crouch);
    }
    if (d.air > 0.001) {
      fl.rotation.x = THREE.MathUtils.lerp(fl.rotation.x, -0.75, d.air);
      fr.rotation.x = THREE.MathUtils.lerp(fr.rotation.x, -0.6, d.air);
      bl.rotation.x = THREE.MathUtils.lerp(bl.rotation.x, 0.75, d.air);
      br.rotation.x = THREE.MathUtils.lerp(br.rotation.x, 0.6, d.air);
    }
    if (d.slide > 0.001) {
      // 숙이기: 낮은 장애물 밑을 지나가려고 바닥에 납작 엎드린 자세 (모델을 통째로 내리거나 찌그러뜨리지 않고 관절로)
      // (예전에는 몸 낮춤이 '다리 길이 보정값'에 비례해서, 짧은 다리 강아지는 몸이 전혀 내려가지 않았음)
      const k = d.slide;
      // 달리기 반동·몸 흔들림은 숙인 만큼 지움 → 숙인 채 들썩이지 않음
      rig.body.position.y -= (bob + hop) * k;
      rig.body.rotation.x -= runPitch * k;
      // 몸통(가슴·배·엉덩이)을 함께 바닥 가까이: 배가 거의 닿게, 앞쪽이 아주 조금 더 낮게
      rig.body.position.y -= k * (DUCK_DROP + rig.baseY);
      rig.body.rotation.x += k * 0.05;
      // 앞다리: 앞으로 쭉 뻗어 바닥을 짚음 · 뒷다리: 뒤로 쭉 뻗음 · 네 다리를 양옆으로 벌려 뒤에서 봐도 납작하게
      fl.rotation.x = THREE.MathUtils.lerp(fl.rotation.x, -1.45, k);
      fr.rotation.x = THREE.MathUtils.lerp(fr.rotation.x, -1.45, k);
      bl.rotation.x = THREE.MathUtils.lerp(bl.rotation.x, 1.4, k);
      br.rotation.x = THREE.MathUtils.lerp(br.rotation.x, 1.4, k);
      fl.rotation.z = 0.2 * k; fr.rotation.z = -0.2 * k;
      bl.rotation.z = THREE.MathUtils.lerp(bl.rotation.z, 0.32, k); br.rotation.z = THREE.MathUtils.lerp(br.rotation.z, -0.32, k);
      // 머리: 목을 앞으로 빼며 바닥 가까이 확 낮추고 턱을 당김 (좌우로 두리번거리지 않음)
      rig.head.position.y -= 0.13 * k;
      rig.head.position.z += 0.07 * k;
      rig.head.rotation.x = THREE.MathUtils.lerp(rig.head.rotation.x, 0.2, k);
      rig.head.rotation.y *= 1 - k; rig.head.rotation.z *= 1 - k;
      // 꼬리: 흔들지 않고 뒤로 낮게 눕힘
      rig.tail.rotation.y *= 1 - k;
      rig.tail.rotation.x = THREE.MathUtils.lerp(rig.tail.rotation.x, -0.55, k);
    }
    // 멍글런너 삐끗: 앞발을 헛디뎌 몸이 앞으로 푹 쏠리고 좌우로 휘청 → 귀·꼬리가 흔들림 → 곧바로 달리기로 복귀
    // (달리기의 일정한 리듬, 숙이기의 납작한 자세와 한눈에 구별되게)
    const tk = d.trip > 0.001 ? d.trip : 0;
    const te = d.tripT / 1000;
    const settle = Math.max(0, 1 - te / 0.45);
    const wob = Math.sin(te * 24) * settle; // 빠르게 잦아드는 휘청임
    if (tk > 0) {
      const lurch = Math.sin(Math.min(1, te / 0.16) * (Math.PI / 2)); // 처음 0.16초에 앞으로 쏠림
      rig.body.rotation.x += 0.42 * lurch * tk;
      rig.body.position.z += 0.06 * lurch * tk;
      rig.body.position.y -= 0.04 * tk;
      rig.body.rotation.z += wob * 0.3 * tk;
      // 앞발 헛디딤: 한 발은 앞으로 허우적, 다른 발은 꺾여 접힘 (번갈아 엇갈림)
      fl.rotation.x = THREE.MathUtils.lerp(fl.rotation.x, -0.95 + wob * 0.55, tk);
      fr.rotation.x = THREE.MathUtils.lerp(fr.rotation.x, 0.8 - wob * 0.55, tk);
      fl.rotation.z += 0.14 * wob * tk; fr.rotation.z += 0.14 * wob * tk;
      // 뒷다리는 버팀
      bl.rotation.x = THREE.MathUtils.lerp(bl.rotation.x, -0.35, tk * 0.8);
      br.rotation.x = THREE.MathUtils.lerp(br.rotation.x, -0.15, tk * 0.8);
      // 머리: 놀라서 들렸다가 흔들림
      rig.head.rotation.x -= 0.3 * tk;
      rig.head.rotation.z += wob * 0.22 * tk;
      if (d.tripKind === 1) {
        // 숙이기 실패(막대에 머리를 부딪힘): 고개가 뒤로 젖혀지고 몸이 한 번 더 움츠러듦
        rig.head.rotation.x -= 0.2 * tk;
        rig.head.rotation.y += Math.sin(te * 30) * 0.22 * tk * settle;
        rig.body.position.y -= 0.025 * tk;
      } else if (d.tripKind === 2) {
        // 옆 충돌: 부딪힌 반대쪽으로 크게 기우뚱, 다리가 엇박자로 버팀
        rig.body.rotation.z += d.tripSide * 0.26 * tk;
        for (const leg of rig.legs) leg.rotation.z += d.tripSide * 0.2 * tk;
        rig.head.rotation.z -= d.tripSide * 0.14 * tk;
      }
      // 꼬리: 놀라서 빠르게 파닥
      rig.tail.rotation.y += Math.sin(te * 32) * 0.7 * tk * settle;
      rig.tail.rotation.x = THREE.MathUtils.lerp(rig.tail.rotation.x, -0.1, tk);
    }
    // 귀: 달릴 때 살짝 들썩 · 실수하면 처짐 · 숙이면 뒤로 착 젖혀짐 · 삐끗하면 파닥 (귀 관절이 있을 때만)
    for (let i = 0; i < rig.ears.length; i++) {
      const ear = rig.ears[i], base = ear.userData.baseRot as [number, number, number];
      const side = ear.name === 'earL' ? 1 : -1;
      const flap = Math.sin(p * 2 + 0.8) * 0.07 * s.run * (1 - d.slide);
      const tripFlap = tk > 0 ? Math.sin(te * 38 + side) * 0.45 * tk * settle : 0;
      ear.rotation.set(
        base[0] - 0.45 * d.earDown + flap - 1.0 * d.slide + tripFlap,
        base[1],
        base[2] - side * (0.4 * d.earDown + 0.3 * d.slide) + tripFlap * 0.5 * side,
      );
    }
    // 눈 감기: 쓰다듬기를 받을 때(기분 좋게) · 잠잘 때
    rig.lids.visible = s.happy > 0.5 || d.anim === DogAnim.Sleep;
  });

  return (
    <group scale={DOG_SCALE[avatar.size]}>
      <primitive object={rig.root} />
    </group>
  );
}
