// 내 아바타 조작 + 강아지 산책 / 다른 사용자 아바타 보간 렌더링
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BUBBLE_RANGE, DogAnim, GRAVITY, HumanAnim, JUMP_VELOCITY, RUN_SPEED, WALK_SPEED, type NetState, type PublicProfile } from '@shared/protocol';
import { resolveCollision } from '@shared/world';
import { AvatarPair, type PairRefs } from './AvatarPair';
import { HUMAN_STEP, newHumanDriver } from './models/Human';
import { DOG_SCALE, DOG_STEP, newDogDriver } from './models/Dog';
import { DogBrain, turnToward } from './dogBrain';
import { input, readMove } from './input';
import { cam } from './CameraRig';
import { local } from './local';
import { rendered, sample } from '../net/remote';
import { sendState } from '../net/socket';
import { openProfile } from '../net/socket';
import { useStore } from '../store';

const TAG_RANGE = 24;

function usePairRefs(): PairRefs {
  return {
    human: useRef<THREE.Group | null>(null),
    dog: useRef<THREE.Group | null>(null),
    humanDriver: useRef(newHumanDriver()),
    dogDriver: useRef(newDogDriver()),
    tag: useRef<HTMLDivElement | null>(null),
  };
}

/** 이동 거리 → 보폭 위상. 걷기/달리기 보폭을 섞어 속도와 다리 움직임을 일치시킨다(발 미끄러짐 방지). */
function advancePhase(phase: number, moved: number, speed: number, walkStep: number, runStep: number) {
  if (!(moved > 1e-6) || !Number.isFinite(speed)) return phase;
  const k = THREE.MathUtils.clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
  const step = THREE.MathUtils.lerp(walkStep, runStep, k);
  return phase + (moved / step) * Math.PI;
}

export function LocalPlayer({ profile }: { profile: PublicProfile }) {
  const refs = usePairRefs();
  const brain = useMemo(() => {
    const b = new DogBrain();
    b.place(local.dogX, local.dogZ, local.dogRot);
    return b;
  }, []);
  const motion = useRef({ speed: 0, sendTimer: 0, lastSent: '', heartbeat: 0, stuck: 0, lastDist: Infinity });
  const dogScale = DOG_SCALE[profile.dog.size];

  useFrame((_, rawDt) => {
    const dt = Math.max(Math.min(rawDt, 0.05), 1e-3);
    const m = motion.current;

    // 서버 스폰/보정 위치 적용
    if (local.teleport) {
      const s = local.teleport;
      local.teleport = null;
      local.x = s[0]; local.z = s[1]; local.rot = s[2];
      brain.place(s[4], s[5], s[6]);
      m.speed = 0;
    }

    // 카메라 기준 이동 방향
    const mv = readMove();
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = -fz, rz = fx;
    let dx = fx * mv.y + rx * mv.x, dz = fz * mv.y + rz * mv.x;
    let mag = Math.min(1, Math.hypot(dx, dz));
    // 바닥 클릭 이동: 직접 조작하면 취소, 도착하거나 막혀서 못 가면 멈춤
    if (mag > 0.05) local.moveTarget = null;
    else if (local.moveTarget) {
      const tx = local.moveTarget.x - local.x, tz = local.moveTarget.z - local.z;
      const dist = Math.hypot(tx, tz);
      if (dist < 0.25) { local.moveTarget = null; m.stuck = 0; m.lastDist = Infinity; }
      else {
        m.stuck = dist < m.lastDist - 0.004 ? 0 : m.stuck + dt;
        m.lastDist = dist;
        if (m.stuck > 0.6) { local.moveTarget = null; m.stuck = 0; m.lastDist = Infinity; }
        else { dx = tx; dz = tz; mag = Math.min(1, dist / 0.6); }
      }
    }
    // 점프 (땅에 있을 때만)
    if (input.jump) {
      input.jump = false;
      if (local.jumpY <= 0) local.jumpV = JUMP_VELOCITY;
    }
    if (local.jumpV !== 0 || local.jumpY > 0) {
      local.jumpV -= GRAVITY * dt;
      local.jumpY += local.jumpV * dt;
      if (local.jumpY <= 0) { local.jumpY = 0; local.jumpV = 0; }
    }
    const target = mag < 0.05 ? 0 : (mv.run ? RUN_SPEED : WALK_SPEED) * Math.max(mag, 0.55);
    m.speed += (target - m.speed) * Math.min(1, dt * (target > m.speed ? 8 : 10));

    const px = local.x, pz = local.z;
    if (mag > 0.05) {
      dx /= mag; dz /= mag;
      local.rot = turnToward(local.rot, Math.atan2(dx, dz), dt * 12);
    }
    if (m.speed > 0.01) {
      // 바라보는 방향으로 이동 (급회전 시 미끄러지지 않도록)
      local.x += Math.sin(local.rot) * m.speed * dt;
      local.z += Math.cos(local.rot) * m.speed * dt;
    }
    [local.x, local.z] = resolveCollision(local.x, local.z, 0.3);
    const moved = Math.hypot(local.x - px, local.z - pz);
    const realSpeed = moved / Math.max(dt, 1e-4);

    const hd = refs.humanDriver.current;
    hd.phase = advancePhase(hd.phase, moved, realSpeed, HUMAN_STEP.walk, HUMAN_STEP.run);
    const now = performance.now();
    const waving = now < local.waveUntil;
    hd.jumpY = local.jumpY;
    hd.anim = local.jumpY > 0 ? HumanAnim.Jump : realSpeed > WALK_SPEED * 1.3 ? HumanAnim.Run : realSpeed > 0.15 ? HumanAnim.Walk : waving ? HumanAnim.Wave : HumanAnim.Idle;
    hd.wave = waving ? 1 : 0;
    local.humanAnim = hd.anim;

    // 강아지
    const others: [number, number, number][] = [];
    rendered.forEach((r, id) => others.push([id, r.dx, r.dz]));
    const dpx = brain.x, dpz = brain.z;
    brain.update(dt, local.x, local.z, local.rot, realSpeed, others, now < local.sitUntil, dogScale);
    const dmoved = Math.hypot(brain.x - dpx, brain.z - dpz);
    const dd = refs.dogDriver.current;
    dd.phase = advancePhase(dd.phase, dmoved, dmoved / Math.max(dt, 1e-4), DOG_STEP.walk * dogScale, DOG_STEP.run * dogScale);
    dd.anim = brain.anim;
    dd.look = brain.look;
    local.dogX = brain.x; local.dogZ = brain.z; local.dogRot = brain.rot; local.dogAnim = brain.anim;

    refs.human.current?.position.set(local.x, 0, local.z);
    refs.human.current?.rotation.set(0, local.rot, 0);
    refs.dog.current?.position.set(brain.x, 0, brain.z);
    refs.dog.current?.rotation.set(0, brain.rot, 0);

    // 네트워크 전송: 10Hz, 변화가 있을 때만 (정지 시 1초마다 상태 유지)
    m.sendTimer += dt; m.heartbeat += dt;
    if (m.sendTimer >= 0.1) {
      m.sendTimer = 0;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const st: NetState = [r2(local.x), r2(local.z), r2(local.rot), hd.anim, r2(brain.x), r2(brain.z), r2(brain.rot), brain.anim];
      const key = st.join(',');
      if (key !== m.lastSent || m.heartbeat > 1) {
        sendState(st);
        m.lastSent = key;
        m.heartbeat = 0;
      }
    }
  });

  return <AvatarPair profile={profile} refs={refs} isMe />;
}

export function RemotePlayer({ profile }: { profile: PublicProfile }) {
  const refs = usePairRefs();
  const prev = useRef<{ x: number; z: number; dx: number; dz: number } | null>(null);
  const jump = useRef({ y: 0, v: 0, lastAnim: 0 });
  const blocked = useStore((s) => s.blocked.some((b) => b.id === profile.id));

  useFrame((_, rawDt) => {
    const dt = Math.max(Math.min(rawDt, 0.05), 1e-3);
    const s = sample(profile.id);
    if (!s || !refs.human.current || !refs.dog.current) return;
    const [x, z, rot, ha, dx, dz, drot, da] = s;
    const p = prev.current ?? { x, z, dx, dz };
    const moved = Math.hypot(x - p.x, z - p.z);
    const dmoved = Math.hypot(dx - p.dx, dz - p.dz);
    prev.current = { x, z, dx, dz };
    const scale = DOG_SCALE[profile.dog.size];

    const hd = refs.humanDriver.current;
    hd.phase = advancePhase(hd.phase, moved, moved / dt, HUMAN_STEP.walk, HUMAN_STEP.run);
    // 점프: 상태가 점프로 바뀌는 순간 같은 궤적으로 재생
    const j = jump.current;
    if (ha === HumanAnim.Jump && j.lastAnim !== HumanAnim.Jump && j.y <= 0) j.v = JUMP_VELOCITY;
    j.lastAnim = ha;
    if (j.v !== 0 || j.y > 0) {
      j.v -= GRAVITY * dt; j.y += j.v * dt;
      if (j.y <= 0) { j.y = 0; j.v = 0; }
    }
    hd.jumpY = j.y;
    hd.anim = ha === HumanAnim.Jump ? (moved / dt > WALK_SPEED * 1.3 ? HumanAnim.Run : moved / dt > 0.15 ? HumanAnim.Walk : HumanAnim.Idle) : ha;
    hd.wave = ha === HumanAnim.Wave ? 1 : 0;
    const dd = refs.dogDriver.current;
    dd.phase = advancePhase(dd.phase, dmoved, dmoved / dt, DOG_STEP.walk * scale, DOG_STEP.run * scale);
    dd.anim = da;
    dd.look += ((da === DogAnim.Look || da === DogAnim.Sit ? Math.sin(performance.now() / 1100) * 0.7 : 0) - dd.look) * Math.min(1, dt * 3);

    refs.human.current.position.set(x, 0, z);
    refs.human.current.rotation.set(0, rot, 0);
    refs.dog.current.position.set(dx, 0, dz);
    refs.dog.current.rotation.set(0, drot, 0);
    rendered.set(profile.id, { x, z, dx, dz, danim: da });

    // 멀리 있는 사용자의 이름표·말풍선은 숨김 (가까운 사용자에게만 말풍선 표시)
    if (refs.tag.current) {
      const dist = Math.hypot(x - local.x, z - local.z);
      refs.tag.current.style.display = dist < Math.max(TAG_RANGE, BUBBLE_RANGE) ? '' : 'none';
      refs.tag.current.dataset.far = String(dist > BUBBLE_RANGE);
    }
  });

  if (blocked) return null;
  return <AvatarPair profile={profile} refs={refs} onSelect={() => openProfile(profile.id)} />;
}
