// 멍글런너 플레이 화면 — 음악 재생 시각을 기준으로 장애물·판정·강아지 움직임을 맞춘다.
// 코스: 벚꽃 산책길 (분홍 산책길 3레인 · 흰 울타리 · 벚꽃나무 · 가로등 · 화단 · 꽃잎 · 골인 아치)
// 모바일 성능: 반복 소품은 InstancedMesh로 한 번에 그리고, 매 프레임 위치만 갱신한다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { DogAnim, HumanAnim } from '@shared/protocol';
import type { DogAvatar, HumanAvatar } from '@shared/avatar';
import {
  DUCK_MS, JUMP_MS, judgeRun, type Chart, type CourseInfo, type Grade, type JudgeEvent, type Obstacle, type RunResult, type RunnerAction, type RunnerInput, type Song,
} from '@shared/runner';
import { Dog, DOG_SCALE, DOG_STEP, newDogDriver } from '../game/models/Dog';
import { Human, newHumanDriver } from '../game/models/Human';
import { geo, mat } from '../game/lowpoly';
import { Lighting } from '../game/Lighting';
import { isTouchDevice } from '../game/input';
import type { MusicPlayer } from './music';

export const LANE_W = 1.35;
const AHEAD_MS = 4200; // 앞쪽에 보이는 시간 (속도가 느려진 만큼 멀리)
/** 출발 전 카운트다운 (사람이 강아지를 응원) */
export const COUNTDOWN_S = 3.2;
/** 달리기 다리 동작 최대 빠르기 (초당 주기) — 속도가 올라가도 허우적거리지 않게 */
const MAX_GAIT_HZ = 2.9;

export interface PlayGame {
  chart: Chart; song: Song; course: CourseInfo; player: MusicPlayer;
  inputs: RunnerInput[]; calib: number; sfx: boolean; paused: boolean; ended: boolean;
  /** 화면 표시용 최신 판정 결과 */
  live: RunResult | null;
  lastEvent: { e: JudgeEvent; at: number; points: number } | null;
  stumbleAt: number;
}

export const GRADE_LABEL: Record<Grade, string> = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
export const GRADE_COLOR: Record<Grade, string> = { perfect: '#f2836b', great: '#f6a94a', good: '#7fb07a', miss: '#9a8b80' };
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const smooth01 = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- 장애물 (종류별로 피하는 방법이 한눈에 보이게)
const NEED_COLOR = { jump: '#f6c453', duck: '#8fc7e8', left: '#f39a7b', right: '#f39a7b', side: '#f39a7b' } as const;
function ObstacleModel({ o }: { o: Obstacle }) {
  const cue = NEED_COLOR[o.need];
  return (
    <group>
      {/* 박자 표시: 장애물 바닥의 빛나는 띠가 강아지에 닿는 순간이 박자 */}
      <mesh geometry={geo.box(LANE_W * 3.05, 0.02, 0.2)} position={[0, 0.02, 0]}>
        <meshBasicMaterial color={cue} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      {o.kind === 'log' && (
        // 낮은 통나무 → 뛰기
        <group position={[0, 0.17, 0]}>
          <mesh geometry={geo.cyl(0.17, 0.17, LANE_W * 2.9, 12)} material={mat('#c48a5a')} rotation={[0, 0, Math.PI / 2]} castShadow />
          {[-1, 1].map((k) => <mesh key={k} geometry={geo.cyl(0.15, 0.15, 0.02, 12)} material={mat('#f0d3a8')} rotation={[0, 0, Math.PI / 2]} position={[k * LANE_W * 1.45 + k * 0.01, 0, 0]} />)}
          <mesh geometry={geo.cyl(0.06, 0.06, 0.06, 8)} material={mat('#f0d3a8')} position={[-0.7, 0.16, 0]} />
          <mesh geometry={geo.sphere(0.09, 8, 6)} material={mat('#8fc27a')} position={[0.55, 0.17, 0]} />
        </group>
      )}
      {o.kind === 'ribbon' && (
        // 높은 발바닥 막대 → 숙이기 (아래가 비어 있음)
        <group>
          {[-1, 1].map((k) => (
            <group key={k} position={[k * LANE_W * 1.55, 0, 0]}>
              <mesh geometry={geo.box(0.16, 1.05, 0.16)} material={mat('#f6d2a9')} position={[0, 0.52, 0]} castShadow />
              <mesh geometry={geo.sphere(0.12, 10, 8)} material={mat('#f39a7b')} position={[0, 1.08, 0]} />
            </group>
          ))}
          <mesh geometry={geo.box(LANE_W * 3.1, 0.2, 0.12)} material={mat('#f6d2a9')} position={[0, 0.82, 0]} castShadow />
          <group position={[0, 0.82, 0.07]}>
            <mesh geometry={geo.cyl(0.24, 0.24, 0.04, 20)} material={mat('#fff8ef')} rotation={[Math.PI / 2, 0, 0]} />
            <mesh geometry={geo.sphere(0.075, 10, 8)} material={mat('#f39a7b')} position={[0, -0.04, 0.02]} scale={[1.15, 0.9, 0.4]} />
            {[[-0.09, 0.06], [-0.03, 0.11], [0.03, 0.11], [0.09, 0.06]].map(([x, y], i) => <mesh key={i} geometry={geo.sphere(0.032, 8, 6)} material={mat('#f39a7b')} position={[x, y, 0.02]} scale={[1, 1.1, 0.4]} />)}
          </group>
        </group>
      )}
      {o.kind === 'pot' && o.blocked.map((l) => (
        // 꽃 화단 상자 → 좌우로 피하기
        <group key={l} position={[l * LANE_W, 0, 0]}>
          <mesh geometry={geo.box(0.95, 0.42, 0.62)} material={mat('#c99a6b')} position={[0, 0.21, 0]} castShadow />
          <mesh geometry={geo.box(1.0, 0.07, 0.67)} material={mat('#b07a4f')} position={[0, 0.44, 0]} />
          {[-0.3, 0, 0.3].map((x, i) => (
            <group key={i} position={[x, 0.55, (i % 2) * 0.1 - 0.05]}>
              <mesh geometry={geo.sphere(0.16, 8, 6)} material={mat('#8fc27a')} />
              <mesh geometry={geo.sphere(0.09, 8, 6)} material={mat(['#b59ad6', '#f7b8c8', '#c9b3ec'][i])} position={[0.04, 0.12, 0.05]} />
            </group>
          ))}
        </group>
      ))}
      {o.kind === 'fence' && o.blocked.map((l) => (
        // 흰 울타리 → 화살표가 있는 빈 레인으로
        <group key={l} position={[l * LANE_W, 0, 0]}>
          <mesh geometry={geo.box(LANE_W * 0.94, 0.08, 0.07)} material={mat('#ffffff')} position={[0, 0.3, 0]} castShadow />
          <mesh geometry={geo.box(LANE_W * 0.94, 0.08, 0.07)} material={mat('#ffffff')} position={[0, 0.56, 0]} castShadow />
          {[-0.5, -0.17, 0.17, 0.5].map((x) => (
            <group key={x} position={[x * LANE_W * 0.86, 0, 0]}>
              <mesh geometry={geo.box(0.12, 0.76, 0.06)} material={mat('#fff8ef')} position={[0, 0.38, 0.02]} castShadow />
              <mesh geometry={geo.cone(0.085, 0.14, 4)} material={mat('#fff8ef')} position={[0, 0.82, 0.02]} rotation={[0, Math.PI / 4, 0]} />
            </group>
          ))}
        </group>
      ))}
      {/* 피할 레인 화살표 */}
      {o.safe.map((l) => (
        <mesh key={`a${l}`} geometry={geo.cone(0.17, 0.32, 3)} position={[l * LANE_W, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.92} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- 코스 소품 (인스턴싱)
/** 반복 소품: 같은 모양을 count개 그려 놓고 매 프레임 위치(z)만 순환 */
function useLoop(count: number, spacing: number) {
  return (i: number, dist: number, offset = 0) => {
    const span = count * spacing;
    return -(((i * spacing + offset - dist) % span) + span) % span + 8;
  };
}
type Part = { geo: THREE.BufferGeometry; color: string; at: [number, number, number]; scale?: [number, number, number] };
function Instanced({ parts, count, spacing, xOf, game, offset = 0, rot = false }: {
  parts: Part[]; count: number; spacing: number; xOf: (i: number) => number; game: PlayGame; offset?: number; rot?: boolean;
}) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const z = useLoop(count, spacing);
  useFrame(() => {
    const dist = (Math.max(0, game.player.now()) / 1000) * game.course.speed;
    parts.forEach((p, k) => {
      const m = refs.current[k];
      if (!m) return;
      for (let i = 0; i < count; i++) {
        tmp.position.set(xOf(i) + p.at[0], p.at[1], z(i, dist, offset) + p.at[2]);
        tmp.rotation.set(0, rot ? i * 1.7 : 0, 0);
        tmp.scale.set(...(p.scale ?? [1, 1, 1]));
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    });
  });
  return <>{parts.map((p, k) => <instancedMesh key={k} ref={(el) => { refs.current[k] = el; }} args={[p.geo, mat(p.color), count]} castShadow={false} frustumCulled={false} />)}</>;
}

/** 골인·출발 아치 (분홍 아치 + 발바닥, 골인은 체크무늬 깃발 띠) */
function Arch({ goal }: { goal?: boolean }) {
  return (
    <group>
      {[-1, 1].map((k) => (
        <group key={k} position={[k * 2.55, 0, 0]}>
          <mesh geometry={geo.cyl(0.2, 0.24, 2.4, 10)} material={mat('#fff1dc')} position={[0, 1.2, 0]} />
          <mesh geometry={geo.sphere(0.27, 10, 8)} material={mat('#f39a7b')} position={[0, 2.45, 0]} />
        </group>
      ))}
      <mesh geometry={geo.torus(2.55, 0.2, Math.PI, 8, 28)} material={mat('#f7b8c8')} position={[0, 2.4, 0]} />
      {/* 가로 띠: 출발은 분홍, 골인은 체크무늬 */}
      <group position={[0, 3.3, 0.05]}>
        {Array.from({ length: 12 }, (_, i) => (
          <group key={i}>
            <mesh geometry={geo.box(0.3, 0.25, 0.06)} material={mat(goal ? (i % 2 ? '#5a4033' : '#ffffff') : (i % 2 ? '#f39a7b' : '#fff1dc'))} position={[(i - 5.5) * 0.3, 0.125, 0]} />
            <mesh geometry={geo.box(0.3, 0.25, 0.06)} material={mat(goal ? (i % 2 ? '#ffffff' : '#5a4033') : (i % 2 ? '#fff1dc' : '#f39a7b'))} position={[(i - 5.5) * 0.3, -0.125, 0]} />
          </group>
        ))}
      </group>
      <group position={[0, 4.95, 0.05]}>
        <mesh geometry={geo.sphere(0.45, 14, 10)} material={mat('#f39a7b')} scale={[1.15, 0.85, 0.45]} />
        {[[-0.5, 0.45], [-0.18, 0.66], [0.18, 0.66], [0.5, 0.45]].map(([x, y], i) => <mesh key={i} geometry={geo.sphere(0.18, 10, 8)} material={mat('#f39a7b')} position={[x, y, 0]} scale={[1, 1.15, 0.5]} />)}
      </group>
    </group>
  );
}

function CherryWalk({ game }: { game: PlayGame }) {
  const speed = game.course.speed;
  const petals = useRef<THREE.InstancedMesh>(null);
  const goal = useRef<THREE.Group>(null);
  const start = useRef<THREE.Group>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const petalData = useMemo(() => Array.from({ length: 60 }, (_, i) => ({ x: ((i * 37) % 100) / 100 * 11 - 5.5, y: ((i * 53) % 100) / 100 * 4, z: ((i * 71) % 100) / 100, r: i })), []);
  const finishT = game.chart.duration - 1600;
  // 반복 소품 모양
  const tree: Part[] = useMemo(() => [
    { geo: geo.cyl(0.13, 0.18, 1.4, 6), color: '#a87450', at: [0, 0.7, 0] },
    { geo: geo.ico(0.95, 1), color: '#f7b8c8', at: [0, 1.85, 0] },
    { geo: geo.ico(0.68, 1), color: '#fac9d5', at: [0.5, 2.15, 0.15] },
    { geo: geo.ico(0.6, 1), color: '#f4a6b8', at: [-0.45, 2.05, -0.2] },
  ], []);
  const lamp: Part[] = useMemo(() => [
    { geo: geo.cyl(0.05, 0.07, 1.9, 6), color: '#7a5f52', at: [0, 0.95, 0] },
    { geo: geo.box(0.3, 0.32, 0.3), color: '#fff3c4', at: [0, 2.0, 0] },
    { geo: geo.cone(0.26, 0.2, 4), color: '#7a5f52', at: [0, 2.26, 0] },
    { geo: geo.box(0.18, 0.5, 0.02), color: '#f4a6b8', at: [0.16, 1.45, 0.06] },
  ], []);
  const fence: Part[] = useMemo(() => [
    { geo: geo.box(0.09, 0.62, 0.09), color: '#ffffff', at: [0, 0.31, 0] },
    { geo: geo.box(0.06, 0.07, 1.5), color: '#ffffff', at: [0, 0.48, -0.75] },
    { geo: geo.box(0.06, 0.07, 1.5), color: '#ffffff', at: [0, 0.24, -0.75] },
  ], []);
  const bed: Part[] = useMemo(() => [
    { geo: geo.sphere(0.32, 8, 6), color: '#8fc27a', at: [0, 0.18, 0], scale: [1.3, 0.6, 1] },
    { geo: geo.sphere(0.09, 8, 6), color: '#f7b8c8', at: [-0.15, 0.36, 0.05] },
    { geo: geo.sphere(0.09, 8, 6), color: '#ffffff', at: [0.12, 0.34, -0.08] },
    { geo: geo.sphere(0.09, 8, 6), color: '#b59ad6', at: [0.02, 0.38, 0.14] },
  ], []);
  const dashes: Part[] = useMemo(() => [{ geo: geo.box(0.07, 0.012, 1.0), color: '#fffaf2', at: [0, 0.012, 0] }], []);
  const beats = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const now = game.player.now();
    const dist = (Math.max(0, now) / 1000) * speed;
    // 박자선: 실제 음악 박자 위치 (마디 첫 박은 조금 더 진하게)
    let k = 0;
    for (const t of game.song.beats) {
      const dt = t * 1000 - now;
      if (dt < -300 || dt > AHEAD_MS) continue;
      const m = beats.current[k++];
      if (!m) break;
      m.visible = true;
      m.position.z = -(dt / 1000) * speed;
    }
    for (; k < beats.current.length; k++) if (beats.current[k]) beats.current[k]!.visible = false;
    if (goal.current) { goal.current.position.z = -((finishT - now) / 1000) * speed; goal.current.visible = finishT - now < AHEAD_MS * 2.5; }
    if (start.current) { start.current.position.z = dist - 1.2; start.current.visible = dist < 30; }
    if (petals.current) {
      const t = clock.elapsedTime;
      petalData.forEach((p, i) => {
        const z = -((((p.z * 34 - dist * 0.9) % 34) + 34) % 34) + 6;
        tmp.position.set(p.x + Math.sin(t * 0.8 + p.r) * 0.3, ((p.y - t * 0.45) % 4 + 4) % 4 + 0.15, z);
        tmp.rotation.set(t + p.r, p.r, t * 0.7);
        tmp.scale.setScalar(0.065);
        tmp.updateMatrix();
        petals.current!.setMatrixAt(i, tmp.matrix);
      });
      petals.current.instanceMatrix.needsUpdate = true;
    }
  });
  const edge = LANE_W * 1.5;
  return (
    <group>
      {/* 잔디 · 분홍 산책길 · 길 가장자리 */}
      <mesh geometry={geo.box(70, 0.1, 140)} material={mat('#bfe0a5')} position={[0, -0.06, -50]} receiveShadow />
      <mesh geometry={geo.box(edge * 2 + 0.3, 0.03, 140)} material={mat('#f6cfd6')} position={[0, 0.0, -50]} receiveShadow />
      {[-1, 1].map((k) => <mesh key={k} geometry={geo.box(0.22, 0.07, 140)} material={mat('#f4a6b8')} position={[k * (edge + 0.15), 0.03, -50]} />)}
      {/* 레인 구분 점선 (2줄) */}
      <Instanced game={game} parts={dashes} count={18} spacing={2.2} xOf={(i) => (i % 2 ? 0.5 : -0.5) * LANE_W} />
      {Array.from({ length: 16 }, (_, i) => (
        <mesh key={i} ref={(m) => { beats.current[i] = m; }} geometry={geo.box(edge * 2, 0.006, 0.05)} visible={false}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.5} toneMapped={false} />
        </mesh>
      ))}
      {/* 흰 울타리 · 가로등 · 벚꽃나무 · 작은 화단 (양옆) */}
      <Instanced game={game} parts={fence} count={44} spacing={1.5} xOf={(i) => (i % 2 ? 1 : -1) * (edge + 0.75)} />
      <Instanced game={game} parts={lamp} count={10} spacing={6} offset={1.5} xOf={(i) => (i % 2 ? 1 : -1) * (edge + 0.45)} />
      <Instanced game={game} parts={tree} count={20} spacing={3.4} xOf={(i) => (i % 2 ? 1 : -1) * (edge + 2.1 + (i % 3) * 0.9)} rot />
      <Instanced game={game} parts={bed} count={12} spacing={5} offset={2.6} xOf={(i) => (i % 2 ? 1 : -1) * (edge + 1.25)} rot />
      <instancedMesh ref={petals} args={[undefined, undefined, petalData.length]} frustumCulled={false}>
        <circleGeometry args={[1, 5]} />
        <meshBasicMaterial color="#fac9d5" side={THREE.DoubleSide} toneMapped={false} />
      </instancedMesh>
      <group ref={start}><Arch /></group>
      <group ref={goal} visible={false}><Arch goal /></group>
    </group>
  );
}

function Obstacles({ game }: { game: PlayGame }) {
  const obs = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const now = game.player.now();
    const done = new Map(game.live?.events.map((e) => [e.id, e]) ?? []);
    game.chart.obstacles.forEach((o, i) => {
      const g = obs.current[i];
      if (!g) return;
      const dt = o.t - now;
      g.visible = dt < AHEAD_MS && dt > -900;
      if (!g.visible) return;
      g.position.z = -(dt / 1000) * game.course.speed;
      // 피한 장애물은 지나간 뒤 작게 사라짐
      const ev = done.get(o.id);
      g.scale.setScalar(ev && ev.grade !== 'miss' && dt < 0 ? Math.max(0.01, 1 + dt / 380) : 1);
    });
  });
  return <>{game.chart.obstacles.map((o, i) => <group key={o.id} ref={(g) => { obs.current[i] = g; }} visible={false}><ObstacleModel o={o} /></group>)}</>;
}

// ---------------------------------------------------------------- 출발 전 응원하는 보호자
function Cheer({ game, human }: { game: PlayGame; human: HumanAvatar }) {
  const g = useRef<THREE.Group>(null);
  const d = useRef(newHumanDriver());
  const [on, setOn] = useState(true);
  d.current.leash = false;
  useFrame(() => {
    d.current.anim = HumanAnim.Wave; d.current.wave = 1;
    // 달리기 화면에서는 강아지만: 음악이 시작되면 사라짐
    if (on && game.player.now() > 150) setOn(false);
  });
  if (!on) return null;
  return (
    <group ref={g} position={[LANE_W * 0.95, 0, -0.9]} rotation={[0, -0.45, 0]}>
      <Human avatar={human} driver={d} />
      <Html position={[0, 1.75, 0]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
        <div className="panel !rounded-2xl px-3 py-1.5 font-display text-sm whitespace-nowrap pop">🐾 멍글런너 출발!</div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------- 내 강아지 (달리기·점프·숙이기·비틀거림)
const JUMP_CROUCH = 70; // 도약 전 살짝 몸 낮추기 (ms)
const JUMP_H = 0.55;
function Runner({ game, avatar }: { game: PlayGame; avatar: DogAvatar }) {
  const g = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const d = useRef(newDogDriver());
  const st = useRef({ x: 0, tilt: 0, lastNow: 0 });
  const scale = DOG_SCALE[avatar.size];
  const { camera, size } = useThree();
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = game.player.now();
    const live = game.live;
    const drv = d.current;
    const s = st.current;
    // 레인 (부드럽게 옮겨 감)
    let lane = 0;
    for (const l of live?.lanes ?? []) { if (l.t <= now) lane = l.lane; else break; }
    const prevX = s.x;
    s.x += (lane * LANE_W - s.x) * Math.min(1, dt * 12);
    // 받아들여진 점프·숙이기 입력 중 지금 진행 중인 것
    const last = (list: number[] | undefined, len: number) => { if (!list) return undefined; for (let i = list.length - 1; i >= 0; i--) if (list[i] <= now) return now < list[i] + len + 120 ? list[i] : undefined; return undefined; };
    const j = last(live?.jumps, JUMP_MS);
    const dk = last(live?.ducks, DUCK_MS);
    // 점프: 몸 낮추기(70ms) → 공중(포물선) → 착지 때 살짝 눌림(120ms)
    let jy = 0, crouch = 0, air = 0;
    if (j !== undefined) {
      const e = now - j;
      if (e < JUMP_CROUCH) crouch = e / JUMP_CROUCH;
      else if (e < JUMP_MS) { const k = (e - JUMP_CROUCH) / (JUMP_MS - JUMP_CROUCH); jy = 4 * JUMP_H * k * (1 - k); air = Math.sin(k * Math.PI); }
      else crouch = 1 - (e - JUMP_MS) / 120;
    }
    // 숙이기: 부드럽게 낮췄다가(앞 25%) 미끄러지고 → 원래 자세로(뒤 25%)
    let slide = 0;
    if (dk !== undefined) { const k = (now - dk) / DUCK_MS; slide = k < 0.25 ? smooth01(k / 0.25) : k < 0.75 ? 1 : smooth01((1 - k) / 0.25); }
    const stumbleK = now - game.stumbleAt;
    const stumble = stumbleK >= 0 && stumbleK < 520 ? Math.sin((stumbleK / 520) * Math.PI) : 0;
    drv.crouch += (crouch - drv.crouch) * Math.min(1, dt * 30);
    drv.air += (air - drv.air) * Math.min(1, dt * 20);
    drv.slide += (slide - drv.slide) * Math.min(1, dt * 25);
    const running = now >= 0 && !game.ended;
    drv.anim = game.ended ? DogAnim.Greet : running ? DogAnim.Run : DogAnim.Stand;
    // 다리 빠르기: 실제 달리는 속도로 계산하되 최대 MAX_GAIT_HZ로 제한, 공중·미끄러질 땐 천천히
    if (!game.paused && running) {
      const hz = Math.min(MAX_GAIT_HZ, game.course.speed / (DOG_STEP.run * scale * 2));
      drv.phase += dt * hz * Math.PI * 2 * (1 - drv.air * 0.7) * (1 - drv.slide * 0.8) * (1 - stumble * 0.5);
    }
    if (g.current) {
      g.current.position.set(s.x, jy, 0);
      s.tilt += ((-(s.x - prevX) / Math.max(dt, 1e-3)) * 0.05 - s.tilt) * Math.min(1, dt * 10);
      // 비틀거림: 좌우로 살짝 흔들림 (카메라는 그대로)
      g.current.rotation.set(-air * 0.12 * (jy > 0 && now - (j ?? 0) < JUMP_MS / 2 ? 1 : -1), Math.PI + Math.sin(stumbleK / 60) * 0.18 * stumble, s.tilt + Math.sin(stumbleK / 45) * 0.12 * stumble);
    }
    if (shadow.current) { shadow.current.position.x = s.x; shadow.current.scale.setScalar(1 - jy * 0.5); }
    // 카메라: 강아지 뒤에서 일정한 높이로 따라감 (점프·착지·비틀거림에 흔들리지 않음, 레인 이동만 부드럽게)
    const portrait = size.height > size.width;
    const cam = camera as THREE.PerspectiveCamera;
    const fov = portrait ? 56 : 48;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (portrait) { cam.position.set(s.x * 0.45, 2.25, 3.55); cam.lookAt(s.x * 0.6, 0.5, -6); }
    else { cam.position.set(s.x * 0.45, 2.2, 3.9); cam.lookAt(s.x * 0.6, 0.45, -7); }
  });
  return (
    <>
      <group ref={g}><Dog avatar={avatar} driver={d} /></group>
      <mesh ref={shadow} geometry={geo.circle(0.32 * scale, 16)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <meshBasicMaterial color="#4a3b2a" transparent opacity={0.14} depthWrite={false} />
      </mesh>
    </>
  );
}

/** 매 프레임 판정 계산 (서버와 같은 judgeRun) → 새 판정에 효과음·비틀거림 */
function Judge({ game, onEnd }: { game: PlayGame; onEnd: () => void }) {
  const seen = useRef(0);
  useFrame(() => {
    if (game.ended) return;
    const now = game.player.now();
    const prevScore = game.live?.score ?? 0;
    const r = judgeRun(game.chart, game.inputs, now);
    game.live = r;
    if (seen.current < r.events.length) {
      const e = r.events[r.events.length - 1];
      seen.current = r.events.length;
      game.lastEvent = { e, at: performance.now(), points: r.score - prevScore };
      if (game.sfx) game.player.blip(e.grade);
      if (e.grade === 'miss' && !e.pass) game.stumbleAt = game.chart.obstacles[e.id].t + 60;
    }
    if (now >= game.chart.duration) { game.ended = true; onEnd(); }
  });
  return null;
}

// ---------------------------------------------------------------- 화면 + 조작
export function RunnerPlay({ game, avatar, human, best, onEnd, onQuit, onRetry }: {
  game: PlayGame; avatar: DogAvatar; human: HumanAvatar | null; best: number | null; onEnd: () => void; onQuit: () => void; onRetry: () => void;
}) {
  const [, force] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = isTouchDevice();
  // 자동 화면 테스트(mungle.e2e)에서만: 진행 중인 게임 상태를 노출해 박자에 맞춘 입력을 검증
  useEffect(() => {
    const w = window as unknown as { __mungleTest?: Record<string, unknown> };
    if (w.__mungleTest) w.__mungleTest.runnerGame = game;
    return () => { if (w.__mungleTest?.runnerGame === game) delete w.__mungleTest.runnerGame; };
  }, [game]);
  // HUD는 초당 15번 갱신 (3D는 매 프레임)
  useEffect(() => { const id = window.setInterval(() => force((x) => x + 1), 66); return () => window.clearInterval(id); }, []);
  const act = (a: RunnerAction) => {
    if (game.paused || game.ended) return;
    game.inputs.push({ t: Math.round(game.player.now() - game.calib), a });
  };
  const togglePause = async () => {
    if (game.ended) return;
    // 일시정지: 오디오 시계를 멈추므로 재개 후에도 음악·장애물·판정 시각이 그대로 맞음
    if (game.paused) { await game.player.resume(); game.paused = false; setPaused(false); }
    else { game.paused = true; setPaused(true); await game.player.pause(); }
  };
  useEffect(() => {
    const map: Record<string, RunnerAction> = {
      ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', ArrowUp: 'J', KeyW: 'J', Space: 'J',
      ArrowDown: 'D', KeyS: 'D', ControlLeft: 'D', ControlRight: 'D',
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); void togglePause(); return; }
      const a = map[e.code];
      if (!a) return;
      e.preventDefault();
      if (!e.repeat) act(a);
    };
    window.addEventListener('keydown', down);
    // 다른 앱으로 전환하면 자동 일시정지
    const vis = () => { if (document.hidden && !game.paused) void togglePause(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('keydown', down); document.removeEventListener('visibilitychange', vis); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const now = game.player.now();
  const r = game.live;
  const playEnd = game.chart.duration - 1600;
  const prog = Math.max(0, Math.min(1, now / playEnd));
  const ev = game.lastEvent && performance.now() - game.lastEvent.at < 560 ? game.lastEvent : null;
  const countdown = now < 0 ? Math.ceil(-now / 1000) : 0;
  // 모바일 조작 버튼: 한 줄 4개, 화면 너비에 맞춰 같은 크기 (멀티터치: pointerdown 즉시 실행)
  const Btn = ({ a, label, icon }: { a: RunnerAction; label: string; icon: string }) => (
    <button aria-label={label} data-testid={`rb-${a}`}
      className="aspect-square w-full max-w-[min(86px,19vh)] mx-auto rounded-full bg-[#fff8ef] border-[3px] border-white shadow-[0_4px_12px_rgba(90,64,51,.2)] flex flex-col items-center justify-center touch-none select-none active:scale-95 active:bg-[#fde3d6]"
      onPointerDown={(e) => { e.preventDefault(); act(a); }} onContextMenu={(e) => e.preventDefault()}>
      <span className="font-display leading-none text-[#e2604f]" style={{ fontSize: 'min(8vw, 30px)' }}>{icon}</span>
      <span className="font-display leading-none mt-0.5 text-cocoa" style={{ fontSize: 'min(3vw, 12px)' }}>{label}</span>
    </button>
  );
  return (
    <div className="absolute inset-0 bg-[#fde9e4] select-none overflow-hidden flex flex-col" data-testid="runner-play">
      {/* 3D 화면: 모바일은 조작 버튼 줄 위쪽까지만 (버튼이 강아지를 가리지 않게) */}
      <div className="relative flex-1 min-h-0">
      <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 50, near: 0.1, far: 120, position: [0, 2.5, 4.4] }} gl={{ antialias: true }}>
        <color attach="background" args={['#fde4ea']} />
        <fog attach="fog" args={['#fde4ea', 20, 52]} />
        <Lighting indoor={false} shadows={!touch} />
        <CherryWalk game={game} />
        <Obstacles game={game} />
        {human && <Cheer game={game} human={human} />}
        <Runner game={game} avatar={avatar} />
        <Judge game={game} onEnd={onEnd} />
      </Canvas>
      </div>
      {/* 상단: 일시정지 · 곡 제목 · 진행 바 · 남은 시간 / 콤보 · 점수 */}
      <div className="absolute inset-x-0 top-0 px-3 pt-[calc(10px+var(--safe-t,0px))] pointer-events-none">
        <div className="flex items-center gap-2">
          <button className="w-11 h-11 rounded-full bg-[#b9a6e6] text-white shadow pointer-events-auto text-lg shrink-0" onClick={() => void togglePause()} aria-label="일시정지">⏸</button>
          <div className="flex-1 min-w-0">
            <div className="font-display text-sm text-cocoa truncate">🎵 {game.course.title} - {game.course.composer}</div>
            <div className="h-2 rounded-full bg-white/70 overflow-hidden mt-1"><div className="h-full bg-[#f39a7b]" style={{ width: `${prog * 100}%` }} /></div>
          </div>
          <div className="rounded-full bg-[#5a4033aa] text-white text-xs px-2.5 py-1 tabular-nums shrink-0" data-testid="runner-time">{mmss(Math.max(0, now))} / {mmss(playEnd)}</div>
        </div>
        <div className="flex items-start justify-between mt-2">
          <div className="leading-none">
            <div className="font-display text-[13px] text-[#e2604f] tracking-wide drop-shadow-[0_1px_0_#fff]">COMBO</div>
            <div className="font-display text-4xl text-[#f6a94a] drop-shadow-[0_2px_0_#fff] tabular-nums">{r?.combo ?? 0}</div>
          </div>
          <div className="text-right">
            <div className="rounded-full bg-[#5a403399] text-white font-display text-xl px-3 py-0.5 tabular-nums" data-testid="runner-score">{(r?.score ?? 0).toLocaleString()}</div>
            <div className="text-[11px] text-cocoa-soft mt-0.5">내 최고 {best !== null ? best.toLocaleString() : '—'}</div>
          </div>
        </div>
      </div>
      {/* 판정: 잠깐 떴다가 사라짐 (화면 위쪽, 작게) */}
      {ev && (
        <div key={game.lastEvent!.at} className="absolute left-1/2 top-[22%] -translate-x-1/2 text-center pointer-events-none judge-pop" data-testid="runner-judge">
          <div className="font-display text-3xl md:text-4xl drop-shadow-[0_2px_0_#fff]" style={{ color: GRADE_COLOR[ev.e.grade] }}>{GRADE_LABEL[ev.e.grade]}</div>
          {ev.points > 0 && <div className="font-display text-lg text-[#f6a94a] drop-shadow-[0_1px_0_#fff]">+{ev.points}</div>}
          {ev.e.pass && <div className="text-[11px] text-cocoa-soft">박자에 맞춰 움직여야 점수가 나요</div>}
        </div>
      )}
      {countdown > 0 && !paused && (
        <div className="absolute left-1/2 top-[30%] -translate-x-1/2 text-center pointer-events-none">
          <div key={countdown} className="font-display text-6xl text-white drop-shadow-[0_3px_0_#f39a7b] pop">{countdown}</div>
          <div className="panel !rounded-2xl px-4 py-2 mt-2 text-sm">빛나는 띠가 강아지에 닿는 <b>박자</b>에 맞춰 조작!</div>
        </div>
      )}
      {/* 조작: 모바일은 한 줄 4버튼 (← 뛰기 숙이기 →), PC는 하단 안내 */}
      {touch ? (
        <div className="shrink-0 px-3 pt-2 pb-[calc(8px+var(--safe-b))] bg-[linear-gradient(#f3d9d6,#fbe7e2)] border-t-2 border-white/70">
          <div className="mx-auto max-w-[460px] grid grid-cols-4 gap-2" data-testid="runner-controls">
            <Btn a="L" label="왼쪽" icon="←" /><Btn a="J" label="뛰기" icon="↑" /><Btn a="D" label="숙이기" icon="↓" /><Btn a="R" label="오른쪽" icon="→" />
          </div>
        </div>
      ) : (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 name-tag !text-xs !px-3 !py-1.5 opacity-90 whitespace-nowrap">← → / A D 레인 이동 · ↑ / Space 뛰기 · ↓ / Ctrl 숙이기 · Esc 일시정지</div>
      )}
      {paused && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[#5a403344] p-4">
          <div className="panel p-6 w-full max-w-[320px] text-center pop">
            <div className="font-display text-2xl">⏸ 일시정지</div>
            <div className="grid gap-2 mt-4">
              <button className="btn btn-coral py-3" onClick={() => void togglePause()}>계속하기</button>
              <button className="btn btn-ghost py-3 border border-[#f1e2d2]" onClick={onRetry}>처음부터 다시</button>
              <button className="btn btn-ghost py-3 border border-[#f1e2d2]" onClick={onQuit}>곡 선택으로</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
