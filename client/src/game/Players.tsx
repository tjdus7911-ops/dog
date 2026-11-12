// 내 아바타 조작 + 강아지 산책 / 다른 사용자 아바타 보간 렌더링
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BUBBLE_RANGE, DogAnim, GRAVITY, HumanAnim, JUMP_VELOCITY, RUN_SPEED, WALK_SPEED, type NetState, type PublicProfile } from '@shared/protocol';
import { SEAT_BY_ID, SEAT_REACH } from '@shared/world';
import { space } from './space';
import { AvatarPair, type PairRefs } from './AvatarPair';
import { HUMAN_STEP, newHumanDriver } from './models/Human';
import { DOG_SCALE, DOG_STEP, newDogDriver } from './models/Dog';
import { DogBrain, turnToward } from './dogBrain';
import { input, readMove } from './input';
import { cam } from './CameraRig';
import { local } from './local';
import { rendered, sample } from '../net/remote';
import { leaveSeat, sendState, sitOnSeat } from '../net/socket';
import { openProfile } from '../net/socket';
import { get, useStore } from '../store';
import { petLow } from './fx';
import { furn, stepFurnitureGoal, stopDogTask, stopFurniture } from './furniture';
import { spotHeight } from '@shared/home';
import { SEAT_HEIGHT } from '@shared/world';

const TAG_RANGE = 24;

function usePairRefs(): PairRefs {
  return {
    human: useRef<THREE.Group | null>(null),
    dog: useRef<THREE.Group | null>(null),
    humanDriver: useRef(newHumanDriver()),
    dogDriver: useRef(newDogDriver()),
    tag: useRef<HTMLDivElement | null>(null),
    zzz: useRef<HTMLDivElement | null>(null),
    dogZzz: useRef<HTMLDivElement | null>(null),
    blob: useRef<THREE.Mesh | null>(null),
  };
}

/** 이동 거리 → 보폭 위상. 걷기/달리기 보폭을 섞어 속도와 다리 움직임을 일치시킨다(발 미끄러짐 방지). */
function advancePhase(phase: number, moved: number, speed: number, walkStep: number, runStep: number) {
  if (!(moved > 1e-6) || !Number.isFinite(speed)) return phase;
  const k = THREE.MathUtils.clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
  const step = THREE.MathUtils.lerp(walkStep, runStep, k);
  return phase + (moved / step) * Math.PI;
}

/** 벤치에서 일어나기 (버튼·이동 입력 공통) */
export function standUp() {
  const id = local.seated;
  if (!id) return;
  const seat = SEAT_BY_ID.get(id);
  local.seated = null;
  local.seatGoal = null;
  if (seat && Math.hypot(local.x - seat.x, local.z - seat.z) < 0.3) { local.x = seat.frontX; local.z = seat.frontZ; }
  void leaveSeat();
}

export function LocalPlayer({ profile }: { profile: PublicProfile }) {
  const refs = usePairRefs();
  const brain = useMemo(() => {
    const b = new DogBrain();
    b.place(local.dogX, local.dogZ, local.dogRot);
    return b;
  }, []);
  const motion = useRef({ speed: 0, sendTimer: 0, lastSent: '', heartbeat: 0, stuck: 0, lastDist: Infinity, sitPending: false, detour: 0, detourSide: 1 });
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

    // 서버가 시작한 배변 / 쓰다듬기를 받음 → 강아지 행동
    if (local.poopStart) { brain.startPoop(Math.max(500, 2600 - (performance.now() - local.poopStart))); local.poopStart = 0; }
    if (local.petHold) { brain.hold(1900, local.petHold.x, local.petHold.z); local.petHold = null; }
    // 쓰다듬기·줍기·버리기 동작 중에는 제자리에서 대상 쪽을 바라봄 (이동 입력 무시)
    const act = local.action && performance.now() < local.action.until ? local.action : null;
    if (!act) local.action = null;

    // 카메라 기준 이동 방향
    const mv = act ? { x: 0, y: 0, run: false } : readMove();
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = -fz, rz = fx;
    let dx = fx * mv.y + rx * mv.x, dz = fz * mv.y + rz * mv.x;
    let mag = Math.min(1, Math.hypot(dx, dz));
    // 벤치에 앉아 있는 중: 이동 입력(키·조이스틱·바닥 클릭·점프)이 들어오면 일어난다
    let seat = local.seated ? SEAT_BY_ID.get(local.seated) ?? null : null;
    // 집 가구(소파·침대)를 쓰는 중: 이동 입력이 들어오면 가구 앞으로 일어남
    stepFurnitureGoal();
    if (furn.use && (mag > 0.05 || local.moveTarget || input.jump)) { input.jump = false; stopFurniture(); }
    const fu = furn.use;
    if (seat && (mag > 0.05 || local.moveTarget || input.jump)) {
      input.jump = false;
      local.x = seat.frontX; local.z = seat.frontZ;
      standUp();
      seat = null;
    }
    // 앉으러 가는 중: 좌석 앞에 도착하면 서버에 자리 요청 (직접 움직이면 취소)
    if (local.seatGoal && !seat) {
      const goal = SEAT_BY_ID.get(local.seatGoal);
      if (!goal || mag > 0.05) local.seatGoal = null;
      else if (!m.sitPending) {
        const dFront = Math.hypot(goal.frontX - local.x, goal.frontZ - local.z);
        const dSeat = Math.hypot(goal.x - local.x, goal.z - local.z);
        if (dFront < 0.45 || (!local.moveTarget && dSeat < SEAT_REACH - 0.4)) {
          m.sitPending = true;
          local.moveTarget = null;
          const id = goal.id;
          sitOnSeat(id).then((ok) => {
            m.sitPending = false;
            if (local.seatGoal !== id) return;
            local.seatGoal = null;
            if (ok) local.seated = id;
          });
        } else if (!local.moveTarget) local.seatGoal = null; // 막혀서 못 감
      }
    }
    // 바닥 클릭 이동: 직접 조작하면 취소, 도착하거나 막혀서 못 가면 멈춤
    if (mag > 0.05) { local.moveTarget = null; local.moveVia = []; }
    else if (!local.moveTarget && local.moveVia.length) local.moveVia = []; // 다른 곳에서 이동이 취소됨
    if (local.moveTarget && mag <= 0.05) {
      const tx = local.moveTarget.x - local.x, tz = local.moveTarget.z - local.z;
      const dist = Math.hypot(tx, tz);
      // 거쳐 가는 지점: 조금 넓게 도착 처리하고 다음 지점으로
      if (local.moveVia.length && dist < 0.45) { local.moveTarget = local.moveVia.shift()!; m.stuck = 0; m.lastDist = Infinity; m.detour = 0; }
      else if (dist < 0.25) { local.moveTarget = null; m.stuck = 0; m.lastDist = Infinity; m.detour = 0; }
      else {
        // 장애물(가로등·나무 등)에 막히면 옆으로 비켜 돌아가 보고, 그래도 못 가면 멈춘다
        const progressed = dist < m.lastDist - 0.004;
        m.stuck = progressed ? Math.max(0, m.stuck - dt * 0.5) : m.stuck + dt;
        m.lastDist = dist;
        if (m.detour > 0) m.detour -= dt;
        else if (m.stuck > 0.3) { m.detour = 0.7; m.detourSide = -m.detourSide; }
        if (m.stuck > 3) { local.moveTarget = null; local.moveVia = []; m.stuck = 0; m.lastDist = Infinity; m.detour = 0; }
        else {
          dx = tx; dz = tz;
          if (m.detour > 0) {
            const ang = 1.1 * m.detourSide, c = Math.cos(ang), sn = Math.sin(ang);
            [dx, dz] = [dx * c + dz * sn, -dx * sn + dz * c];
          }
          mag = Math.min(1, dist / 0.6);
        }
      }
    }
    // 점프 (땅에 있을 때만)
    if (input.jump) {
      input.jump = false;
      if (!input.locked && local.jumpY <= 0) local.jumpV = JUMP_VELOCITY; // 채팅 중에는 점프하지 않음
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
    if (act) {
      m.speed = 0;
      local.rot = turnToward(local.rot, Math.atan2(act.faceX - local.x, act.faceZ - local.z), dt * 10);
    }
    if (m.speed > 0.01) {
      // 바라보는 방향으로 이동 (급회전 시 미끄러지지 않도록)
      local.x += Math.sin(local.rot) * m.speed * dt;
      local.z += Math.cos(local.rot) * m.speed * dt;
    }
    if (seat) {
      // 좌석에 고정 (벤치 충돌 판정은 적용하지 않음)
      local.x = seat.x; local.z = seat.z;
      local.rot = turnToward(local.rot, seat.rot, dt * 10);
      m.speed = 0;
    } else if (fu) {
      // 가구 자리에 고정 (가구 충돌 판정 없이 정확한 자리·방향)
      local.x = fu.human.x; local.z = fu.human.z;
      local.rot = turnToward(local.rot, fu.human.rot, dt * 10);
      m.speed = 0; local.jumpY = 0; local.jumpV = 0;
    } else [local.x, local.z] = space.collide(local.x, local.z, 0.3);
    const moved = Math.hypot(local.x - px, local.z - pz);
    const realSpeed = moved / Math.max(dt, 1e-4);

    const hd = refs.humanDriver.current;
    hd.phase = advancePhase(hd.phase, moved, realSpeed, HUMAN_STEP.walk, HUMAN_STEP.run);
    const now = performance.now();
    const waving = now < local.waveUntil;
    hd.jumpY = local.jumpY;
    hd.petLow = act?.petLow ?? hd.petLow;
    hd.bag = local.bag;
    hd.anim = act ? act.anim : seat ? HumanAnim.Sit : fu ? (fu.action === 'sit' ? HumanAnim.Sit : fu.action === 'sleep' ? HumanAnim.Sleep : HumanAnim.Lie) : local.jumpY > 0 ? HumanAnim.Jump : realSpeed > WALK_SPEED * 1.3 ? HumanAnim.Run : realSpeed > 0.15 ? HumanAnim.Walk : waving ? HumanAnim.Wave : HumanAnim.Idle;
    hd.wave = waving ? 1 : 0;
    local.humanAnim = hd.anim;

    // 강아지
    const others: [number, number, number][] = [];
    rendered.forEach((r, id) => others.push([id, r.dx, r.dz]));
    const dpx = brain.x, dpz = brain.z;
    // 강아지 혼자 쉬는 중(강아지 침대): 보호자가 멀리 가면 따라옴
    if (furn.dog && Math.hypot(local.x - furn.dog.spot.x, local.z - furn.dog.spot.z) > 5) stopDogTask();
    const dogSpot = fu?.dog ?? (furn.dog ? { ...furn.dog.spot, mode: furn.dog.mode } : null);
    brain.update(dt, local.x, local.z, local.rot, realSpeed, others, now < local.sitUntil, dogScale,
      seat ? { x: seat.dogX, z: seat.dogZ, rot: seat.dogRot } : dogSpot);
    const dmoved = Math.hypot(brain.x - dpx, brain.z - dpz);
    const dd = refs.dogDriver.current;
    dd.phase = advancePhase(dd.phase, dmoved, dmoved / Math.max(dt, 1e-4), DOG_STEP.walk * dogScale, DOG_STEP.run * dogScale);
    dd.anim = brain.anim;
    dd.look = brain.look;
    local.dogX = brain.x; local.dogZ = brain.z; local.dogRot = brain.rot; local.dogAnim = brain.anim;

    // 가구 위 높이: 소파는 앉는 자세 기준(벤치 높이)과의 차이만큼, 침대는 매트리스 높이
    const hy = fu ? (fu.action === 'sit' ? fu.human.y - SEAT_HEIGHT : fu.human.y) : 0;
    const dy = dogSpot && dogSpot.y > 0 ? dogSpot.y * Math.max(0, 1 - Math.hypot(brain.x - dogSpot.x, brain.z - dogSpot.z) / 0.35) : 0;
    refs.human.current?.position.set(local.x, hy, local.z);
    if (refs.blob?.current) refs.blob.current.visible = !fu;
    refs.human.current?.rotation.set(0, local.rot, 0);
    refs.dog.current?.position.set(brain.x, dy, brain.z);
    if (refs.zzz.current) refs.zzz.current.style.display = hd.anim === HumanAnim.Sleep ? '' : 'none';
    if (refs.dogZzz.current) refs.dogZzz.current.style.display = brain.anim === DogAnim.Sleep ? '' : 'none';
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

  return <AvatarPair profile={profile} refs={refs} isMe onSelectDog={() => useStore.setState({ dogMenu: profile.id, furnMenu: null })} />;
}

export function RemotePlayer({ profile }: { profile: PublicProfile }) {
  const refs = usePairRefs();
  const prev = useRef<{ x: number; z: number; dx: number; dz: number } | null>(null);
  const jump = useRef({ y: 0, v: 0, lastAnim: 0 });
  const blocked = useStore((s) => s.blocked.some((b) => b.id === profile.id));
  const bag = useStore((s) => !!s.bags[profile.id]);
  useEffect(() => { refs.humanDriver.current.bag = bag; }, [bag, refs.humanDriver]);
  const layout = useStore((s) => s.home?.layout);

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
    hd.petLow = petLow.get(profile.id) ?? 0.6;
    const dd = refs.dogDriver.current;
    dd.phase = advancePhase(dd.phase, dmoved, dmoved / dt, DOG_STEP.walk * scale, DOG_STEP.run * scale);
    dd.anim = da;
    dd.look += ((da === DogAnim.Look || da === DogAnim.Sit || da === DogAnim.Lie ? Math.sin(performance.now() / 1100) * 0.7 : 0) - dd.look) * Math.min(1, dt * 3);

    // 집 가구 위(소파·침대·강아지 침대)에 앉거나 누워 있으면 그 자리 높이로
    const furnPose = ha === HumanAnim.Sit || ha === HumanAnim.Lie || ha === HumanAnim.Sleep;
    const hh = layout && furnPose ? spotHeight(layout, x, z, 'human', undefined, get().home?.tier ?? 1) : 0;
    const hy = hh > 0 ? (ha === HumanAnim.Sit ? hh - SEAT_HEIGHT : hh) : 0;
    const dogPose = da === DogAnim.Sit || da === DogAnim.Lie || da === DogAnim.Sleep;
    const dy = layout && dogPose ? spotHeight(layout, dx, dz, 'dog', undefined, get().home?.tier ?? 1) : 0;
    refs.human.current.position.set(x, hy, z);
    if (refs.blob?.current) refs.blob.current.visible = hh === 0;
    refs.human.current.rotation.set(0, rot, 0);
    refs.dog.current.position.set(dx, dy, dz);
    if (refs.zzz.current) refs.zzz.current.style.display = ha === HumanAnim.Sleep ? '' : 'none';
    if (refs.dogZzz.current) refs.dogZzz.current.style.display = da === DogAnim.Sleep ? '' : 'none';
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
  return <AvatarPair profile={profile} refs={refs} onSelect={() => openProfile(profile.id)} onSelectDog={() => useStore.setState({ dogMenu: profile.id, furnMenu: null })} />;
}
