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
  DIFFICULTY_LABEL, DUCK_MS, JUDGE, JUMP_MS, countIn, judgeRun, type Chart, type CourseInfo, type Grade, type JudgeEvent, type Lane, type Obstacle, type RunResult, type RunnerAction, type RunnerInput, type Song,
} from '@shared/runner';
import { PaceSim } from '@shared/runnerPace';
import { LANE_RATE, LANE_W as POSE_LANE_W, LEAD_MS, OBSTACLE_DEPTH, duckAmount, jumpHeight, judgeLineZ, obstacleZ } from '@shared/runnerPose';
import { Dog, DOG_SCALE, DOG_STEP, newDogDriver } from '../game/models/Dog';
import { Human, newHumanDriver } from '../game/models/Human';
import { geo, mat } from '../game/lowpoly';
import { Lighting } from '../game/Lighting';
import { isTouchDevice } from '../game/input';
import type { MusicPlayer } from './music';
import { MR_COUNTDOWN_MS, byDistance, type MRPlayer, type MRResult } from '@shared/runnerMulti';
import { multiLive, sendInput } from './multi';
import { PARK_FOG, PARK_SKY, ThemePark } from './RunnerWorld';

export const LANE_W = POSE_LANE_W;
/** 함께 달리기: 플레이어마다 독립 트랙 (트랙 안에 3레인). 트랙 중심 간격 */
const TRACK_PITCH = 5.2;
const TRACK_SLOTS = [0, 1, -1, 2];
/** 트랙 배치: 나는 항상 가운데(0), 다른 참가자는 오른쪽 → 왼쪽 → 오른쪽 바깥 */
export function trackLayout(game: { multi?: { myId: number; players: MRPlayer[] } }) {
  if (!game.multi) return [{ id: -1, x: 0, me: true }];
  const me = game.multi.myId;
  const order = [me, ...game.multi.players.map((p) => p.id).filter((id) => id !== me)];
  return order.map((id, i) => ({ id, x: TRACK_SLOTS[i] * TRACK_PITCH, me: id === me }));
}
/**
 * 자동 화면 테스트 전용: 한 컴퓨터에서 여러 브라우저(소프트웨어 렌더링)를 동시에 돌릴 때 화면 갱신을 초당 8번으로 줄임.
 * 판정은 음악 시계 기준이라 결과에는 영향이 없다. (mungle.e2e + mungle.e2e.lowfps 둘 다 있을 때만)
 */
/** 자동 화면 테스트 전용: 내 강아지를 옆에서 가까이 보는 카메라 (삐끗·귀 자세 확인) — mungle.e2e + mungle.e2e.sidecam */
const SIDE_CAM = (() => { try { return localStorage.getItem('mungle.e2e') === '1' && localStorage.getItem('mungle.e2e.sidecam') === '1'; } catch { return false; } })();
/** 새 3D 공간(파스텔 테마파크) 시안: 승인 전까지는 mungle.runnerWorld=v2 일 때만 */
const WORLD_V2 = (() => { try { return localStorage.getItem('mungle.runnerWorld') === 'v2'; } catch { return false; } })();
const LOW_FPS = (() => { try { return localStorage.getItem('mungle.e2e') === '1' && localStorage.getItem('mungle.e2e.lowfps') === '1'; } catch { return false; } })();
function LowFpsTicker() {
  const { invalidate } = useThree();
  useEffect(() => { const id = window.setInterval(() => invalidate(), 125); return () => window.clearInterval(id); }, [invalidate]);
  return null;
}
export const AHEAD_MS = 4200; // 앞쪽에 보이는 시간 (속도가 느려진 만큼 멀리)
/** 출발 전 기다리는 시간(초): 카운트인(곡 첫 박에 맞춘 3·2·1)이 모두 들어가고, 보호자 응원이 보일 만큼 */
export const countdownSec = (song: Song) => Math.max(2.4, -countIn(song).ticks[0] / 1000 + 0.4);
/** 달리기 다리 동작 최대 빠르기 (초당 주기) — 속도가 올라가도 허우적거리지 않게 */
const MAX_GAIT_HZ = 2.9;

export interface PlayGame {
  chart: Chart; song: Song; course: CourseInfo; player: MusicPlayer;
  inputs: RunnerInput[]; calib: number; sfx: boolean; paused: boolean; ended: boolean;
  /** 화면 표시용 최신 판정 결과 */
  live: RunResult | null;
  lastEvent: { e: JudgeEvent; at: number; points: number } | null;
  /** 함께 달리기: 판 번호 · 나 · 참가자 (없으면 혼자 달리기) */
  multi?: { round: number; myId: number; players: MRPlayer[] };
  /** 거리 경쟁·삐끗·추월 상태 (플레이 화면이 만듦) */
  race?: Race;
  /** 함께 달리기: 음악이 끝난 시각 (performance.now) → 마무리 연출 */
  finaleAt?: number;
  /** 함께 달리기: 서버가 확정한 최종 결과 (마무리 연출에서 순위 발표) */
  results?: MRResult[] | null;
}

/** 화면 시각: 함께 달리기는 음악이 끝나면 강아지들이 천천히 멈추듯 (마무리 연출) */
export function sceneNow(game: PlayGame) {
  const now = game.player.now(), end = game.chart.duration;
  if (!game.multi || now <= end) return now;
  return end + 700 * (1 - Math.exp(-(now - end) / 700));
}
/** 마무리 연출 중 달리는 빠르기 비율 (1 → 0) */
const sceneSpeed = (game: PlayGame) => { const now = game.player.now(), end = game.chart.duration; return !game.multi || now <= end ? 1 : Math.exp(-(now - end) / 700); };

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
      {/* 박자 표시: 장애물 앞면(강아지 쪽)의 빛나는 띠가 판정선에 닿는 순간이 박자 */}
      <mesh geometry={geo.box(LANE_W * 3.05, 0.02, 0.14)} position={[0, 0.02, OBSTACLE_DEPTH[o.kind] / 2 - 0.07]}>
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
export type Part = { geo: THREE.BufferGeometry; color: string; at: [number, number, number]; scale?: [number, number, number] };
export function Instanced({ parts, count, spacing, xOf, game, offset = 0, rot = false }: {
  parts: Part[]; count: number; spacing: number; xOf: (i: number) => number; game: PlayGame; offset?: number; rot?: boolean;
}) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const z = useLoop(count, spacing);
  useFrame(() => {
    const dist = (Math.max(0, sceneNow(game)) / 1000) * game.course.speed;
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

/** 함께 달리기 출발선: 모든 트랙을 가로지르는 현수막 게이트 (기둥은 바깥 양끝에만 → 출발선 소개 때 강아지를 가리지 않음) */
function StartGate({ xs }: { xs: number[] }) {
  const edge = LANE_W * 1.5;
  const L = Math.min(...xs) - edge - 0.45, R = Math.max(...xs) + edge + 0.45, W = R - L, cx = (L + R) / 2;
  const cells = Math.max(8, Math.round(W / 0.5));
  const cw = W / cells;
  return (
    <group>
      {[L, R].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh geometry={geo.cyl(0.2, 0.24, 4.2, 10)} material={mat('#fff1dc')} position={[0, 2.1, 0]} />
          <mesh geometry={geo.sphere(0.28, 10, 8)} material={mat('#f39a7b')} position={[0, 4.3, 0]} />
        </group>
      ))}
      {/* 현수막은 달리기 카메라보다 높이 (출발할 때 화면 위쪽을 가리지 않게) */}
      <mesh geometry={geo.box(W, 0.62, 0.06)} material={mat('#fff1dc')} position={[cx, 3.9, 0]} />
      {Array.from({ length: cells }, (_, i) => (
        <mesh key={i} geometry={geo.box(cw, 0.3, 0.07)} material={mat('#f39a7b')} position={[L + cw * (i + 0.5), i % 2 ? 3.75 : 4.05, 0]} />
      ))}
      {xs.map((x) => (
        <group key={x} position={[x, 4.5, 0.03]} scale={0.55}>
          <mesh geometry={geo.sphere(0.45, 14, 10)} material={mat('#f39a7b')} scale={[1.15, 0.85, 0.45]} />
          {[[-0.5, 0.45], [-0.18, 0.66], [0.18, 0.66], [0.5, 0.45]].map(([tx, ty], i) => <mesh key={i} geometry={geo.sphere(0.18, 10, 8)} material={mat('#f39a7b')} position={[tx, ty, 0]} scale={[1, 1.15, 0.5]} />)}
        </group>
      ))}
    </group>
  );
}

/**
 * 판정선 + 박자선 (내 트랙에만 — 다른 사람 트랙은 네트워크 지연만큼 늦게 그려서 박자선과 어긋나므로)
 * 박자선은 음악의 실제 박 위치. 장애물 앞면의 빛나는 띠가 판정선에 닿는 순간이 박자.
 */
export function BeatGuide({ game, color = '#ffffff' }: { game: PlayGame; color?: string }) {
  const beats = useRef<(THREE.Mesh | null)[]>([]);
  const speed = game.course.speed;
  const edge = LANE_W * 1.5;
  useFrame(() => {
    const now = sceneNow(game);
    let k = 0;
    for (const t of game.song.beats) {
      if (now > game.chart.duration) break;
      const dt = t * 1000 - now;
      if (dt < -300 || dt > AHEAD_MS) continue;
      const m = beats.current[k++];
      if (!m) break;
      m.visible = true;
      m.position.z = judgeLineZ(speed) - (dt / 1000) * speed;
    }
    for (; k < beats.current.length; k++) if (beats.current[k]) beats.current[k]!.visible = false;
  });
  return (
    <group>
      <mesh geometry={geo.box(edge * 2 - 0.1, 0.012, 0.07)} position={[0, 0.016, judgeLineZ(speed)]}>
        <meshBasicMaterial color={color} transparent opacity={0.95} toneMapped={false} />
      </mesh>
      {Array.from({ length: 16 }, (_, i) => (
        <mesh key={i} ref={(m) => { beats.current[i] = m; }} geometry={geo.box(edge * 2, 0.006, 0.05)} position={[0, 0.004, 0]} visible={false}>
          <meshBasicMaterial color={color} transparent opacity={0.5} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function CherryWalk({ game, xs }: { game: PlayGame; xs: number[] }) {
  const minX = Math.min(...xs), maxX = Math.max(...xs), midX = (minX + maxX) / 2, span = maxX - minX;
  const sorted = [...xs].sort((a, b) => a - b);
  const dividers = sorted.slice(1).map((x, i) => (x + sorted[i]) / 2);
  const speed = game.course.speed;
  const petals = useRef<THREE.InstancedMesh>(null);
  const goal = useRef<THREE.Group>(null);
  const start = useRef<THREE.Group>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const petalData = useMemo(() => Array.from({ length: 60 + xs.length * 20 }, (_, i) => ({ x: midX + ((i * 37) % 100) / 100 * (11 + span) - (5.5 + span / 2), y: ((i * 53) % 100) / 100 * 4, z: ((i * 71) % 100) / 100, r: i })), [midX, span, xs.length]);
  // 트랙 사이 칸막이: 낮은 회양목 울타리 + 꽃
  const hedge: Part[] = useMemo(() => [
    { geo: geo.box(0.5, 0.34, 1.9), color: '#a9d38f', at: [0, 0.17, 0] },
    { geo: geo.sphere(0.09, 8, 6), color: '#f7b8c8', at: [0.12, 0.38, -0.4] },
    { geo: geo.sphere(0.08, 8, 6), color: '#ffffff', at: [-0.1, 0.37, 0.3] },
    { geo: geo.sphere(0.08, 8, 6), color: '#b59ad6', at: [0.05, 0.37, 0.75] },
  ], []);
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
  useFrame(({ clock }) => {
    const now = sceneNow(game);
    const dist = (Math.max(0, now) / 1000) * speed;
    if (goal.current) { goal.current.position.z = -((finishT - now) / 1000) * speed; goal.current.visible = finishT - now < AHEAD_MS * 2.5; }
    // 출발 아치: 혼자 달리기는 강아지 바로 앞(출발하며 통과), 함께 달리기는 강아지들 바로 뒤(출발선 소개 때 배경)
    if (start.current) { start.current.position.z = dist + (game.multi ? 0.7 : -1.2); start.current.visible = dist < 30; }
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
  const outL = minX - edge, outR = maxX + edge;
  const side = (i: number, d: number) => (i % 2 ? outR + d : outL - d);
  return (
    <group>
      {/* 잔디 */}
      <mesh geometry={geo.box(70 + span, 0.1, 140)} material={mat('#bfe0a5')} position={[midX, -0.06, -50]} receiveShadow />
      {xs.map((x) => (
        <group key={x} position={[x, 0, 0]}>
          {/* 트랙: 분홍 산책길 + 가장자리 (트랙마다 3레인) */}
          <mesh geometry={geo.box(edge * 2 + 0.3, 0.03, 140)} material={mat(x === 0 || xs.length === 1 ? '#f6cfd6' : '#f3d7dc')} position={[0, 0.0, -50]} receiveShadow />
          {[-1, 1].map((k) => <mesh key={k} geometry={geo.box(0.22, 0.07, 140)} material={mat(x === 0 ? '#f4a6b8' : '#e9b6c4')} position={[k * (edge + 0.15), 0.03, -50]} />)}
          {/* 레인 구분 점선 (2줄) */}
          <Instanced game={game} parts={dashes} count={18} spacing={2.2} xOf={(i) => (i % 2 ? 0.5 : -0.5) * LANE_W} />
        </group>
      ))}
      {/* 트랙 사이 칸막이 (넘어갈 수 없음) */}
      {dividers.map((dx) => <Instanced key={dx} game={game} parts={hedge} count={36} spacing={2.0} xOf={() => dx} />)}
      {/* 바깥쪽: 흰 울타리 · 가로등 · 벚꽃나무 · 작은 화단 */}
      <Instanced game={game} parts={fence} count={44} spacing={1.5} xOf={(i) => side(i, 0.75)} />
      <Instanced game={game} parts={lamp} count={10} spacing={6} offset={1.5} xOf={(i) => side(i, 0.45)} />
      <Instanced game={game} parts={tree} count={20} spacing={3.4} xOf={(i) => side(i, 2.1 + (i % 3) * 0.9)} rot />
      <Instanced game={game} parts={bed} count={12} spacing={5} offset={2.6} xOf={(i) => side(i, 1.25)} rot />
      <instancedMesh ref={petals} args={[undefined, undefined, petalData.length]} frustumCulled={false}>
        <circleGeometry args={[1, 5]} />
        <meshBasicMaterial color="#fac9d5" side={THREE.DoubleSide} toneMapped={false} />
      </instancedMesh>
      {/* 출발·골인 아치: 트랙마다 하나씩 */}
      <group ref={start}>{game.multi ? <StartGate xs={xs} /> : xs.map((x) => <group key={x} position={[x, 0, 0]}><Arch /></group>)}</group>
      <group ref={goal} visible={false}>{xs.map((x) => <group key={x} position={[x, 0, 0]}><Arch goal /></group>)}</group>
    </group>
  );
}

/**
 * 한 트랙의 장애물 (모든 트랙이 같은 기준 비트맵 · 판정은 그 트랙 주인 기준)
 * 장애물은 언제나 '음악 시각'으로 강아지에게 다가온다 — 거리 경쟁으로 강아지가 앞서거나 뒤처지면(z) 그 트랙의 장애물도 같이 옮겨져
 * 판정 박자는 그대로이고, 페이스 때문에 장애물이 빨라지거나 느려지지 않는다.
 */
function Obstacles({ game, r }: { game: PlayGame; r: Racer }) {
  const obs = useRef<(THREE.Group | null)[]>([]);
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    const now = r.view;
    const res = r.live;
    if (root.current) root.current.position.z = r.z;
    const done = new Map(res?.events.map((e) => [e.id, e]) ?? []);
    game.chart.obstacles.forEach((o, i) => {
      const g = obs.current[i];
      if (!g) return;
      const dt = o.t - now;
      g.visible = dt < AHEAD_MS && dt > -900;
      if (!g.visible) return;
      g.position.z = obstacleZ(dt, game.course.speed, o.kind);
      // 피한 장애물은 지나간 뒤 작게 사라짐
      const ev = done.get(o.id);
      g.scale.setScalar(ev && ev.grade !== 'miss' && dt < 0 ? Math.max(0.01, 1 + dt / 380) : 1);
    });
  });
  return <group ref={root} position={[r.x, 0, 0]}>{game.chart.obstacles.map((o, i) => <group key={o.id} ref={(g) => { obs.current[i] = g; }} visible={false}><ObstacleModel o={o} /></group>)}</group>;
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


// ---------------------------------------------------------------- 강아지 자세 (판정 결과 → 레인·점프·숙이기)
// 누르는 순간 바로 동작 (예전의 70ms 도약 준비 자세를 없앰 — 박자에 눌렀는데 늦게 뛰어 보이지 않게). 동작 모양은 shared/runnerPose.
/** 판정 결과(받아들여진 입력)로 지금 레인·점프·숙이기 자세 계산 — 내 강아지와 함께 달리는 강아지가 같은 규칙 */
function poseAt(now: number, live: RunResult | null) {
  let lane = 0, laneT = -1e9;
  for (const l of live?.lanes ?? []) { if (l.t <= now) { lane = l.lane; laneT = l.t; } else break; }
  const last = (list: number[] | undefined, len: number) => { if (!list) return undefined; for (let i = list.length - 1; i >= 0; i--) if (list[i] <= now) return now < list[i] + len + 120 ? list[i] : undefined; return undefined; };
  const j = last(live?.jumps, JUMP_MS);
  const dk = last(live?.ducks, DUCK_MS);
  // 점프: 즉시 떠올라 포물선 → 착지 때 살짝 눌림(120ms)
  let jy = 0, crouch = 0, air = 0;
  if (j !== undefined) {
    const e = now - j;
    if (e < JUMP_MS) { jy = jumpHeight(e); air = Math.sin((e / JUMP_MS) * Math.PI); }
    else crouch = 1 - (e - JUMP_MS) / 120;
  }
  const slide = dk !== undefined ? duckAmount(now - dk) : 0;
  return { lane, laneT, jy, crouch, air, slide, j };
}
const laneAt = (live: RunResult, t: number) => { let l: Lane = 0; for (const x of live.lanes) { if (x.t <= t) l = x.lane; else break; } return l; };
/** 그 시각까지 마지막으로 받아들여진 조작 (뛰기·숙이기·레인 이동) */
function lastAction(live: RunResult | null, v: number) {
  if (!live) return -1e9;
  let t = -1e9;
  const scan = (list: number[]) => { for (let i = list.length - 1; i >= 0; i--) if (list[i] <= v) { t = Math.max(t, list[i]); break; } };
  scan(live.jumps); scan(live.ducks);
  for (let i = live.lanes.length - 1; i >= 0; i--) if (live.lanes[i].t <= v) { t = Math.max(t, live.lanes[i].t); break; }
  return t;
}

// ---------------------------------------------------------------- 거리 경쟁 · 삐끗 · 추월 (플레이어마다 독립 상태)
/** 다른 참가자 트랙은 이만큼 늦게 그림 — 입력이 네트워크로 도착하기 전에 자세가 튀지 않게 (판정·순위는 서버 기준) */
const RIVAL_DELAY_MS = 300;
/** 화면에 보이는 앞뒤 간격 (실제 거리 차이를 부드럽게 줄여서): 앞은 최대 약 7m, 뒤는 약 2.6m — 멀어져도 사라지지 않게 */
const AHEAD_SPREAD = 7;
const BEHIND_SPREAD = 2.6;
const compress = (d: number) => (d >= 0 ? AHEAD_SPREAD * Math.tanh(d / AHEAD_SPREAD) : -BEHIND_SPREAD * Math.tanh(-d / BEHIND_SPREAD));
/** 삐끗 길이·들어오는 시간 (ms) */
const TRIP_MS = 480;
const TRIP_IN = 90;
/** 추월 판정 여유 (m) — 나란히 달릴 때 알림이 깜빡이지 않게 */
const OVERTAKE_HYST = 0.6;

interface Trip { at: number; kind: number; side: number }
export interface Racer {
  id: number; me: boolean;
  /** 트랙 중심 x */
  x: number;
  /** 이 트랙을 그리는 음악 시각 (나: 지금, 다른 사람: 지금 − RIVAL_DELAY_MS) */
  view: number;
  live: RunResult | null;
  sim: PaceSim | null;
  /** 달린 거리 (m) · 페이스 · 연속 MISS */
  dist: number; pace: number; missStreak: number;
  /** 화면 앞뒤 위치 (부드럽게 따라감) · 레인 x (부드럽게) */
  z: number; lx: number;
  trips: Trip[]; tripSeen: Set<number>;
  wagUntil: number; sparkUntil: number; missAt: number;
  seen: number; lastGrade: Grade | null; gradeAt: number;
  rank: number;
  gone: boolean;
  /** 화면 밖에 있을 때 가장자리 표시 위치 (px) */
  edge: { x: number; y: number; side: 'left' | 'right' | 'bottom' } | null;
}
export interface Race {
  racers: Racer[];
  byId: Map<number, Racer>;
  me: Racer;
  /** 순위 순서 (id) */
  order: number[];
  ahead: Map<string, boolean>;
  banner: { text: string; at: number; good: boolean } | null;
}
function createRace(game: PlayGame): Race {
  const racers: Racer[] = trackLayout(game).map((t) => ({
    id: t.id, me: t.me, x: t.x, view: -1e9, live: null,
    // 페이스는 함께 달리기에서만 (혼자 달리기는 점수 경쟁 그대로)
    sim: game.multi ? new PaceSim(game.chart, game.course.speed, game.chart.difficulty) : null,
    dist: 0, pace: 1, missStreak: 0, z: 0, lx: 0, trips: [], tripSeen: new Set(), wagUntil: 0, sparkUntil: 0, missAt: -1e9,
    seen: 0, lastGrade: null, gradeAt: -1e9, rank: 1, gone: false, edge: null,
  }));
  return { racers, byId: new Map(racers.map((r) => [r.id, r])), me: racers.find((r) => r.me)!, order: racers.map((r) => r.id), ahead: new Map(), banner: null };
}
const playerOf = (game: PlayGame, id: number) => game.multi?.players.find((p) => p.id === id);
const dogNameOf = (game: PlayGame, id: number) => playerOf(game, id)?.dogName ?? '친구';

/**
 * 장애물이 코끝에 닿는 순간(박자 + LEAD_MS) 피하지 못한 상태면 바로 '삐끗' 시작.
 * 아직 GOOD 범위 안에서 늦게 조작하면 그 조작이 삐끗을 끊고 바로 반응한다 (최종 판정은 judgeRun).
 * 같은 장애물에서는 한 번만.
 */
function detectTrips(chart: Chart, r: Racer) {
  const live = r.live;
  if (!live) return;
  const v = r.view;
  for (const o of chart.obstacles) {
    if (o.t + LEAD_MS > v) break;
    if (o.t + 600 < v || r.tripSeen.has(o.id)) continue;
    r.tripSeen.add(o.id);
    let kind = -1, side = 1;
    if (o.need === 'jump' || o.need === 'duck') {
      const list = o.need === 'jump' ? live.jumps : live.ducks;
      if (!list.some((x) => x <= v && Math.abs(x - o.t) <= JUDGE.good)) kind = o.need === 'jump' ? 0 : 1;
    } else {
      // 장애물이 코끝에 닿는 순간(박자 + LEAD_MS)의 레인 — 박자에 맞춰 옮겼으면 이미 비켜 있음
      const lane = laneAt(live, o.t + LEAD_MS);
      if (o.blocked.includes(lane)) { kind = 2; side = lane > 0 ? -1 : 1; }
    }
    if (kind >= 0) { r.trips.push({ at: o.t + LEAD_MS, kind, side }); if (r.trips.length > 3) r.trips.shift(); }
  }
}
/** 삐끗 세기 (겹쳐도 더해지지 않고 가장 센 것 하나) — 다음 조작이 들어오면 회복 단계를 끊음 */
function tripLevel(r: Racer, v: number) {
  const act = lastAction(r.live, v);
  let k = 0, kind = 0, side = 1, t = 0;
  for (const tr of r.trips) {
    const e = v - tr.at;
    if (e < 0 || e > TRIP_MS) continue;
    let lvl = e < TRIP_IN ? smooth01(e / TRIP_IN) : smooth01((TRIP_MS - e) / (TRIP_MS - TRIP_IN));
    if (act > tr.at) lvl *= 1 - smooth01((v - act) / 90);
    if (lvl > k) { k = lvl; kind = tr.kind; side = tr.side; t = e; }
  }
  return { k, kind, side, t };
}

/** 매 프레임: 판정(다른 사람은 받은 입력으로 재현) → 삐끗 → 페이스·거리 → 순위·추월 → 화면 앞뒤 위치 */
function RaceDriver({ game }: { game: PlayGame }) {
  const { camera, size } = useThree();
  const v3 = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const race = game.race!;
    const now = game.player.now();
    const scene = sceneNow(game);
    const end = game.chart.duration;
    const perf = performance.now();
    const fin = game.results ? new Map(game.results.map((x) => [x.id, x])) : null;
    for (const r of race.racers) {
      if (r.me) { r.view = scene; r.live = game.live; }
      else { r.view = scene - RIVAL_DELAY_MS; r.live = judgeRun(game.chart, multiLive.inputs[r.id] ?? [], Math.min(r.view, end + 500)); }
      detectTrips(game.chart, r);
      if (r.live && r.live.events.length > r.seen) {
        const e = r.live.events[r.live.events.length - 1];
        r.seen = r.live.events.length; r.lastGrade = e.grade; r.gradeAt = perf;
        if (e.grade === 'miss' && !e.pass) r.missAt = perf;
      }
      if (r.sim && r.live) {
        const st = r.sim.advance(r.live.events, Math.min(r.view, end)).state;
        r.pace = st.pace; r.missStreak = st.missStreak;
        // 다른 사람은 늦게 그린 만큼 지금 페이스로 이어서 계산 (부드러운 보간)
        r.dist = r.sim.distAt(Math.max(0, Math.min(now, end)));
      }
      const srv = multiLive.standings.find((x) => x.id === r.id);
      r.gone = !r.me && !!srv && (srv.left || !srv.connected);
      if (srv?.left) r.dist = srv.distance; // 나간 사람은 서버가 멈춘 거리
      const f = fin?.get(r.id);
      if (f) r.dist = f.distance; // 최종 결과가 오면 서버가 확정한 거리로
    }
    if (!game.multi) return;
    // 순위: 거리 → 정확도 → 점수 (나간 사람은 아래)
    const key = (r: Racer) => ({ distance: r.dist, accuracy: r.live?.accuracy ?? 0, score: r.live?.score ?? 0 });
    const sorted = [...race.racers].sort((a, b) => Number(a.gone) - Number(b.gone) || byDistance(key(a), key(b)) || a.id - b.id);
    sorted.forEach((r, i) => { r.rank = fin?.get(r.id)?.rank ?? i + 1; });
    race.order = sorted.map((r) => r.id);
    // 추월: 두 강아지 사이 앞뒤가 바뀌면 (여유 OVERTAKE_HYST) — 앞지른 강아지는 꼬리 흔들기 + 반짝
    if (now > 1500 && now < end) {
      for (const a of race.racers) for (const b of race.racers) {
        if (a.id >= b.id || a.gone || b.gone) continue;
        const k = `${a.id}:${b.id}`;
        const diff = a.dist - b.dist;
        const prev = race.ahead.get(k);
        const cur = diff > OVERTAKE_HYST ? true : diff < -OVERTAKE_HYST ? false : prev;
        if (cur === undefined) continue;
        if (prev !== undefined && cur !== prev) {
          const win = cur ? a : b, lose = cur ? b : a;
          win.wagUntil = perf + 1300; win.sparkUntil = perf + 900;
          if (win.me) race.banner = { text: `🐾 ${dogNameOf(game, lose.id)} 추월!`, at: perf, good: true };
          else if (lose.me) race.banner = { text: `💨 ${dogNameOf(game, win.id)}에게 추월당했어요`, at: perf, good: false };
        }
        race.ahead.set(k, cur);
      }
    }
    // 화면 앞뒤 위치: 달리는 중에는 내 강아지 기준(나는 항상 가운데), 끝나면 1위 기준으로 최종 거리 순서대로
    const finale = game.finaleAt !== undefined;
    const lead = Math.max(...race.racers.map((r) => r.dist));
    const kz = 1 - Math.exp(-dt / (finale ? 0.5 : 0.3));
    for (const r of race.racers) {
      const target = finale ? AHEAD_SPREAD * Math.tanh((lead - r.dist) / AHEAD_SPREAD) : r.me ? 0 : -compress(r.dist - race.me.dist);
      r.z += (target - r.z) * kz;
      // 화면 밖(뒤쪽·옆)에 있는 친구는 가장자리에 표시
      r.edge = null;
      if (!r.me && !finale && now > 0) {
        v3.set(r.x + r.lx, 0.45, r.z).project(camera);
        const behind = v3.z > 1;
        if (behind || Math.abs(v3.x) > 0.98 || v3.y < -0.98) {
          const side: 'left' | 'right' | 'bottom' = behind || v3.y < -0.98 ? (Math.abs(v3.x) > 0.6 || behind ? (r.x >= race.me.x ? 'right' : 'left') : 'bottom') : v3.x > 0 ? 'right' : 'left';
          const px = side === 'left' ? 6 : side === 'right' ? size.width - 6 : (Math.max(-0.9, Math.min(0.9, v3.x)) + 1) / 2 * size.width;
          const py = side === 'bottom' ? size.height - 6 : (1 - (Math.max(-0.5, Math.min(0.7, behind ? -0.5 : v3.y)) + 1) / 2) * size.height;
          r.edge = { x: px, y: py, side };
        }
      }
    }
  }, -1);
  return null;
}

/** 연속 성공·추월 때 강아지 주변에 작게 반짝이는 별 (가벼운 효과) */
function Sparkle({ r }: { r: Racer }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const on = (r.live?.combo ?? 0) >= 10 || performance.now() < r.sparkUntil;
    g.current.visible = on;
    if (!on) return;
    const t = clock.elapsedTime;
    g.current.children.forEach((c, i) => {
      const a = t * 2.2 + (i / g.current!.children.length) * Math.PI * 2;
      c.position.set(Math.cos(a) * 0.42, 0.55 + Math.sin(t * 3 + i) * 0.12, 0.25 + Math.sin(a) * 0.18);
      c.rotation.set(t * 3 + i, t * 2, 0);
      const k = 0.6 + 0.4 * Math.sin(t * 6 + i * 1.7);
      c.scale.setScalar(0.05 * k);
    });
  });
  return (
    <group ref={g} visible={false}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} geometry={geo.ico(1, 0)}>
          <meshBasicMaterial color={i % 2 ? '#fff3b0' : '#ffffff'} transparent opacity={0.9} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** 달리는 강아지 하나 (나 · 함께 달리는 친구 공통): 레인·점프·숙이기·삐끗·귀·꼬리, 이름표, 머리 위 MISS·순위 */
function RaceDog({ game, r, avatar, label, color }: { game: PlayGame; r: Racer; avatar: DogAvatar; label: string; color: string }) {
  const g = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const tag = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const d = useRef(newDogDriver());
  const st = useRef({ tilt: 0 });
  const scale = DOG_SCALE[avatar.size];
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const v = r.view;
    const perf = performance.now();
    const { lane, jy, crouch, air, slide, j } = poseAt(v, r.live);
    const prevX = r.lx;
    r.lx += (lane * LANE_W - r.lx) * (1 - Math.exp(-dt * LANE_RATE)); // 레인 이동: 판정 규칙과 같은 빠르기 (shared/runnerPose)
    const drv = d.current;
    drv.crouch += (crouch - drv.crouch) * Math.min(1, dt * 30);
    drv.air += (air - drv.air) * Math.min(1, dt * 20);
    drv.slide += (slide - drv.slide) * Math.min(1, dt * 25);
    // 삐끗 (블렌딩된 세기) · 귀 처짐 (실수가 이어지면 살짝 처진 채) · 추월 꼬리 흔들기
    const tr = tripLevel(r, v);
    drv.trip = tr.k; drv.tripKind = tr.kind; drv.tripSide = tr.side; drv.tripT = tr.t;
    const earT = tr.k > 0.05 ? 1 : r.missStreak > 0 ? 0.5 : 0;
    drv.earDown += (earT - drv.earDown) * Math.min(1, dt * (earT > drv.earDown ? 12 : 2.5));
    drv.wagUntil = r.wagUntil;
    const finale = game.finaleAt !== undefined;
    const spd = sceneSpeed(game);
    const running = v >= 0 && spd > 0.2 && !(game.ended && !game.multi);
    const final = game.results?.find((x) => x.id === r.id);
    drv.anim = running ? DogAnim.Run : (final?.rank === 1 || (!game.multi && game.ended)) ? DogAnim.Greet : DogAnim.Stand;
    if (finale && final?.rank && final.rank > 1) drv.wagUntil = Math.max(drv.wagUntil, perf + 300); // 다른 강아지도 완주했다고 꼬리 살랑
    if (!game.paused && running) {
      // 다리 빠르기: 페이스가 빠르면 조금 더 빠르게 (최대 MAX_GAIT_HZ의 110% — 허우적거리지 않게), 공중·숙이기·삐끗 땐 천천히
      const pf = Math.min(1, Math.max(0, (r.pace - 0.8) / 0.4));
      const hz = Math.min(MAX_GAIT_HZ * (0.9 + 0.2 * pf), (game.course.speed * r.pace * spd) / (DOG_STEP.run * scale * 2));
      drv.phase += dt * hz * Math.PI * 2 * (1 - drv.air * 0.7) * (1 - drv.slide * 0.8) * (1 - drv.trip * 0.45);
    }
    if (g.current) {
      g.current.position.set(r.x + r.lx, jy, r.z);
      st.current.tilt += ((-(r.lx - prevX) / Math.max(dt, 1e-3)) * 0.05 - st.current.tilt) * Math.min(1, dt * 10);
      g.current.rotation.set(-air * 0.12 * (jy > 0 && v - (j ?? 0) < JUMP_MS / 2 ? 1 : -1), Math.PI, st.current.tilt);
    }
    if (shadow.current) { shadow.current.position.set(r.x + r.lx, 0.02, r.z); shadow.current.scale.setScalar(1 - jy * 0.5); }
    // 발밑 이름표 (다른 사람: 방금 판정 → 잠깐, 평소엔 콤보)
    if (tag.current && !r.me) {
      const pop = finale ? '' : r.lastGrade && perf - r.gradeAt < 650 ? `<b style="color:${GRADE_COLOR[r.lastGrade]}">${GRADE_LABEL[r.lastGrade]}</b>` : r.live && r.live.combo > 1 ? `${r.live.combo}콤보` : '';
      const html = `<span style="background:${color}" class="rounded-full px-1.5 text-white">${label}</span>${pop ? ` ${pop}` : ''}`;
      if (tag.current.dataset.v !== html) { tag.current.dataset.v = html; tag.current.innerHTML = html; }
    }
    // 머리 위: 내 MISS (작게, 잠깐) · 마무리 연출의 순위 배지
    if (top.current) {
      let html = '';
      if (final?.rank) html = `<span class="rounded-full px-2 py-0.5 text-white" style="background:${final.rank === 1 ? '#f6b73c' : '#a58d80'}">${['🥇', '🥈', '🥉', '🏅'][final.rank - 1]} ${final.rank}위 · ${final.distance.toFixed(1)}m</span>`;
      else if (finale && game.results) html = `<span class="rounded-full px-2 py-0.5 bg-white/80 text-cocoa-soft">${final?.reason ?? ''}</span>`;
      else if (r.me && perf - r.missAt < 600) html = `<span style="color:#8a7a70;opacity:${(1 - (perf - r.missAt) / 600).toFixed(2)};text-shadow:0 0 3px #fff,0 0 3px #fff">MISS</span>`;
      if (top.current.dataset.v !== html) { top.current.dataset.v = html; top.current.innerHTML = html; }
    }
  });
  return (
    <>
      <group ref={g}>
        <Dog avatar={avatar} driver={d} earBones />
        <Sparkle r={r} />
        {/* 이름표는 발밑 뒤쪽(카메라 쪽)에: 강아지 위에 띄우면 앞의 장애물을 가림 */}
        <Html position={[0, 0.02, -0.55]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          {r.me
            ? <div className="rounded-full bg-[#f39a7b] text-white px-2 py-0.5 text-[11px] font-display whitespace-nowrap shadow" data-testid="my-tag">나 · {label}</div>
            : <div ref={tag} className="rounded-full bg-white/85 px-1 py-0.5 text-[10px] font-display whitespace-nowrap shadow" data-testid={`rival-${r.id}`} />}
        </Html>
        <Html position={[0, 0.95 * scale, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={top} className="font-display text-[12px] whitespace-nowrap drop-shadow-[0_1px_0_#fff]" data-testid={r.me ? 'my-top' : `top-${r.id}`} />
        </Html>
      </group>
      <mesh ref={shadow} geometry={geo.circle(0.32 * scale, 16)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <meshBasicMaterial color="#4a3b2a" transparent opacity={0.14} depthWrite={false} />
      </mesh>
    </>
  );
}
const RIVAL_COLORS = ['#8fb5e8', '#b9a6e6', '#7fb07a', '#f6a94a'];

// ---------------------------------------------------------------- 카메라
// 혼자 달리기: 내 강아지 뒤에서 일정한 높이로 따라감 (점프·착지·삐끗에 흔들리지 않음, 레인 이동만 부드럽게)
// 함께 달리기 (PC·모바일 같은 규칙):
//   출발 전 → 출발선의 강아지들을 앞쪽 비스듬히에서 한 번에 보여 주며 소개 (약 2.6초)
//   카운트다운 → 옆으로 돌아 내 강아지 뒤로 (부드러운 곡선, 강아지를 뚫고 지나가지 않게)
//   달리는 중 → 내 강아지 중심 (내 강아지는 화면 아래 가운데, 장애물이 잘 보이게). 전체 트랙을 계속 보여 주지 않음
//   끝 → 다시 전체 보기로, 최종 거리 순서대로 선 강아지들과 순위 발표
type Pose = { P: THREE.Vector3; L: THREE.Vector3; fov: number };
const mkPose = (): Pose => ({ P: new THREE.Vector3(), L: new THREE.Vector3(), fov: 50 });
/** 모든 강아지가 화면에 들어오는 '앞쪽 비스듬히' 전체 보기 (세로 화면은 더 옆에서 줄을 따라 보게) */
function overviewPose(race: Race, aspect: number, drift: number, out: Pose) {
  const xs = race.racers.map((r) => r.x + r.lx), zs = race.racers.map((r) => r.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const portrait = aspect < 1;
  out.fov = portrait ? 54 : 44;
  const yaw = (portrait ? 0.95 : 0.3) + drift, pitch = portrait ? 0.3 : 0.3;
  const D = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const F = D.clone().negate();
  const R = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize();
  const U = new THREE.Vector3().crossVectors(R, F);
  const tanV = Math.tan((out.fov / 2) * Math.PI / 180) * 0.72, tanH = tanV * aspect;
  const T = new THREE.Vector3(cx, 0.45, cz);
  let dist = 3.2;
  const rel = new THREE.Vector3();
  for (let i = 0; i < xs.length; i++) for (const h of [0, 1.1]) {
    rel.set(xs[i] - cx, h - 0.45, zs[i] - cz);
    const x = rel.dot(R), y = rel.dot(U), z = rel.dot(F);
    dist = Math.max(dist, Math.abs(x) / tanH - z + 0.6, Math.abs(y) / tanV - z + 0.6);
  }
  out.L.copy(T);
  out.P.copy(T).addScaledVector(D, dist);
  return out;
}
/**
 * 두 구도 사이: 위치는 높이 넘어가는 곡선 — 강아지 앞(얼굴 쪽)과 뒤(달리는 시점)를 오갈 때
 * 꼭대기(apex)가 출발 게이트·강아지들 위를 지나 무엇도 뚫고 지나가지 않게. 보는 곳·화각은 부드럽게.
 */
function blendPose(a: Pose, b: Pose, k: number, out: Pose, apexZ?: number) {
  const apex = new THREE.Vector3((a.P.x + b.P.x) / 2 + 1.5, Math.max(a.P.y, b.P.y) + 3.4, apexZ ?? (a.P.z + b.P.z) / 2);
  // 곡선이 k=0.5에서 꼭대기를 지나도록 조절점 계산
  const ctrl = apex.clone().multiplyScalar(2).addScaledVector(a.P, -0.5).addScaledVector(b.P, -0.5);
  const u = 1 - k;
  out.P.set(0, 0, 0).addScaledVector(a.P, u * u).addScaledVector(ctrl, 2 * u * k).addScaledVector(b.P, k * k);
  out.L.copy(a.L).lerp(b.L, k);
  out.fov = a.fov + (b.fov - a.fov) * k;
  return out;
}
function CameraRig({ game }: { game: PlayGame }) {
  const { camera, size } = useThree();
  const poses = useMemo(() => ({ play: mkPose(), ov: mkPose(), out: mkPose() }), []);
  useFrame(() => {
    const race = game.race!;
    const me = race.me;
    const cam = camera as THREE.PerspectiveCamera;
    const portrait = size.height > size.width;
    const sx = me.lx, mz = me.z;
    const play = poses.play;
    // 내 강아지 중심 구도 (세로 화면: 내 트랙을 크게 / PC: 같은 구도에 화각만 조금 넓게 — 옆 트랙은 가장자리에 일부만)
    if (portrait) { play.fov = 56; play.P.set(sx * 0.45, 2.25, 3.55 + mz); play.L.set(sx * 0.6, 0.5, -6 + mz); }
    else if (!game.multi) { play.fov = 48; play.P.set(sx * 0.45, 2.2, 3.9); play.L.set(sx * 0.6, 0.45, -7); }
    else { play.fov = 52; play.P.set(sx * 0.45, 2.3, 4.1 + mz); play.L.set(sx * 0.6, 0.45, -7 + mz); }
    let pose = play;
    if (game.multi) {
      const now = game.player.now();
      const introK = smooth01((now + MR_COUNTDOWN_MS) / 1800);
      const finK = game.finaleAt !== undefined ? smooth01((performance.now() - game.finaleAt) / 1600) : 0;
      const aspect = size.width / Math.max(1, size.height);
      if (introK < 1) {
        // 소개하는 동안 아주 천천히 옆으로 흐르듯
        const drift = Math.max(-0.12, Math.min(0, (now + MR_COUNTDOWN_MS) / 1000 * 0.05));
        pose = blendPose(overviewPose(race, aspect, drift, poses.ov), play, introK, poses.out, 0.7);
      } else if (finK > 0) pose = blendPose(play, overviewPose(race, aspect, 0, poses.ov), finK, poses.out);
    }
    if (SIDE_CAM) { pose = poses.out; pose.fov = 34; pose.P.set(me.x + me.lx + 2.1, 0.75, me.z - 0.9); pose.L.set(me.x + me.lx, 0.3, me.z - 0.05); }
    if (Math.abs(cam.fov - pose.fov) > 0.01) { cam.fov = pose.fov; cam.updateProjectionMatrix(); }
    cam.position.copy(pose.P);
    cam.lookAt(pose.L);
  });
  return null;
}

/** 매 프레임 내 판정 계산 (서버와 같은 judgeRun) → 새 판정에 효과음 */
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
    }
    if (now >= game.chart.duration) { game.ended = true; onEnd(); }
  }, -2);
  return null;
}

// ---------------------------------------------------------------- 화면 + 조작
export function RunnerPlay({ game, avatar, human, best, onEnd, onQuit, onRetry }: {
  game: PlayGame; avatar: DogAvatar; human: HumanAvatar | null; best: number | null; onEnd: () => void; onQuit: () => void; onRetry: () => void;
}) {
  const [, force] = useState(0);
  const [paused, setPaused] = useState(false);
  if (!game.race) game.race = createRace(game);
  const race = game.race;
  const touch = isTouchDevice();
  // 자동 화면 테스트(mungle.e2e)에서만: 진행 중인 게임 상태를 노출해 박자에 맞춘 입력을 검증
  useEffect(() => {
    const w = window as unknown as { __mungleTest?: Record<string, unknown> };
    if (w.__mungleTest) w.__mungleTest.runnerGame = game;
    return () => { if (w.__mungleTest?.runnerGame === game) delete w.__mungleTest.runnerGame; };
  }, [game]);
  // HUD는 초당 15번 갱신 (3D는 매 프레임)
  useEffect(() => { const id = window.setInterval(() => force((x) => x + 1), 66); return () => window.clearInterval(id); }, []);
  /**
   * 입력 시각 = 누른 순간의 음악 시각. 이벤트가 처리되기까지 밀린 시간(렌더링 중이면 한 프레임 가까이)을 빼서
   * 화면이 느려도 판정이 늦어지지 않게 한다. (event.timeStamp는 performance.now 기준)
   */
  const act = (a: RunnerAction, evTs?: number) => {
    if (game.paused || game.ended) return;
    const lag = evTs !== undefined && evTs > 0 ? Math.min(100, Math.max(0, performance.now() - evTs)) : 0;
    const t = Math.round(game.player.now() - lag - game.calib);
    // 같은 시각에 두 번 누르는 경우도 순서가 유지되게 (서버는 시각 순서를 확인)
    const lastT = game.inputs[game.inputs.length - 1]?.t ?? -Infinity;
    const tt = Math.max(t, lastT);
    game.inputs.push({ t: tt, a });
    if (game.multi) sendInput(game.multi.round, tt, a);
  };
  const togglePause = async () => {
    // 함께 달리기는 모두 같은 시각에 달리므로 멈출 수 없음
    if (game.ended || game.multi) return;
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
      if (!e.repeat) act(a, e.timeStamp);
    };
    window.addEventListener('keydown', down);
    // 다른 앱으로 전환하면 자동 일시정지
    const vis = () => { if (document.hidden && !game.paused && !game.multi) void togglePause(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('keydown', down); document.removeEventListener('visibilitychange', vis); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const now = game.player.now();
  const r = game.live;
  const me = race.me;
  const playEnd = game.chart.duration - 1600;
  const prog = Math.max(0, Math.min(1, now / playEnd));
  const ev = game.lastEvent && game.lastEvent.e.grade !== 'miss' && performance.now() - game.lastEvent.at < 560 ? game.lastEvent : null;
  const intro = !!game.multi && now < -MR_COUNTDOWN_MS;
  // 카운트인: 곡 첫 박에 맞춘 3 · 2 · 1 → 첫 박에 '출발!' (음악 시계 기준이라 실제 음악과 정확히 이어짐)
  const ci = countIn(game.song);
  const ciIdx = ci.ticks.filter((t) => now >= t).length;
  const countdown = !intro && now < ci.go && ciIdx > 0 ? 4 - ciIdx : 0;
  const goShow = !intro && now >= ci.go && now < ci.go + 600;
  const finale = game.finaleAt !== undefined;
  const banner = race.banner && performance.now() - race.banner.at < 1600 ? race.banner : null;
  const myName = game.multi?.players.find((p) => p.id === game.multi!.myId)?.nickname ?? '';
  // 모바일 조작 버튼: 한 줄 4개, 화면 너비에 맞춰 같은 크기 (멀티터치: pointerdown 즉시 실행)
  const Btn = ({ a, label, icon }: { a: RunnerAction; label: string; icon: string }) => (
    <button aria-label={label} data-testid={`rb-${a}`}
      className="aspect-square w-full max-w-[min(86px,19vh)] mx-auto rounded-full bg-[#fff8ef] border-[3px] border-white shadow-[0_4px_12px_rgba(90,64,51,.2)] flex flex-col items-center justify-center touch-none select-none active:scale-95 active:bg-[#fde3d6]"
      onPointerDown={(e) => { e.preventDefault(); act(a, e.timeStamp); }} onContextMenu={(e) => e.preventDefault()}>
      <span className="font-display leading-none text-[#e2604f]" style={{ fontSize: 'min(8vw, 30px)' }}>{icon}</span>
      <span className="font-display leading-none mt-0.5 text-cocoa" style={{ fontSize: 'min(3vw, 12px)' }}>{label}</span>
    </button>
  );
  return (
    <div className="absolute inset-0 bg-[#fde9e4] select-none overflow-hidden flex flex-col" data-testid="runner-play">
      {/* 3D 화면: 모바일은 조작 버튼 줄 위쪽까지만 (버튼이 강아지를 가리지 않게) */}
      <div className="relative flex-1 min-h-0">
      <Canvas shadows dpr={LOW_FPS ? 0.5 : [1, 1.75]} frameloop={LOW_FPS ? 'demand' : 'always'} camera={{ fov: 50, near: 0.1, far: 120, position: [0, 2.5, 4.4] }} gl={{ antialias: !LOW_FPS }}>
        {LOW_FPS && <LowFpsTicker />}
        <color attach="background" args={[WORLD_V2 ? PARK_SKY : '#fde4ea']} />
        <fog attach="fog" args={WORLD_V2 ? [PARK_FOG, 26, 88] : ['#fde4ea', 20, 52]} />
        <Lighting indoor={false} shadows={!touch} />
        <Judge game={game} onEnd={onEnd} />
        <RaceDriver game={game} />
        {WORLD_V2 ? <ThemePark game={game} xs={race.racers.map((t) => t.x)} /> : <CherryWalk game={game} xs={race.racers.map((t) => t.x)} />}
        <BeatGuide game={game} />
        {race.racers.map((t) => <Obstacles key={t.id} game={game} r={t} />)}
        {human && !game.multi && <Cheer game={game} human={human} />}
        {race.racers.map((t, i) => {
          if (t.me) return <RaceDog key={t.id} game={game} r={t} avatar={avatar} label={myName} color="#f39a7b" />;
          const p = playerOf(game, t.id);
          return p ? <RaceDog key={t.id} game={game} r={t} avatar={p.dog} label={p.nickname} color={RIVAL_COLORS[(i - 1) % RIVAL_COLORS.length]} /> : null;
        })}
        <CameraRig game={game} />
      </Canvas>
      {/* 화면 밖(뒤쪽·옆 트랙)에 있는 친구 표시: 사라지지 않게 가장자리에 이름과 거리 차이 */}
      {game.multi && !finale && race.racers.filter((x) => x.edge).map((x) => {
        const gap = x.dist - me.dist;
        return (
          <div key={x.id} className="absolute pointer-events-none rounded-full bg-white/85 shadow px-1.5 py-0.5 text-[10px] font-display whitespace-nowrap" data-testid={`edge-${x.id}`}
            style={{ left: x.edge!.x, top: x.edge!.y, transform: `translate(${x.edge!.side === 'left' ? '0' : x.edge!.side === 'right' ? '-100%' : '-50%'}, ${x.edge!.side === 'bottom' ? '-100%' : '-50%'})` }}>
            {x.edge!.side === 'left' ? '◀ ' : ''}{dogNameOf(game, x.id)} {Math.abs(gap) < 0.05 ? <span className="text-cocoa-soft">나란히</span> : <span className={gap > 0 ? 'text-[#e2604f]' : 'text-[#6d84a3]'}>{gap > 0 ? '+' : ''}{gap.toFixed(1)}m</span>}{x.edge!.side === 'right' ? ' ▶' : x.edge!.side === 'bottom' ? ' ▼' : ''}
          </div>
        );
      })}
      {intro && <IntroOverlay game={game} />}
      {finale && <FinaleOverlay game={game} />}
      </div>
      {/* 상단: 나가기/일시정지 · 곡 제목 · 진행 바 · 남은 시간 / 콤보·페이스 · 점수·순위 */}
      {!intro && !finale && (
        <div className="absolute inset-x-0 top-0 px-3 pt-[calc(10px+var(--safe-t,0px))] pointer-events-none">
          <div className="flex items-center gap-2">
            {game.multi ? (
              <button className="w-11 h-11 rounded-full bg-[#b9a6e6] text-white shadow pointer-events-auto text-lg shrink-0" aria-label="나가기" data-testid="mr-quit"
                onClick={() => { if (confirm('지금 나가면 이번 판 순위와 보상을 받을 수 없어요. 나갈까요?')) onQuit(); }}>✕</button>
            ) : (
              <button className="w-11 h-11 rounded-full bg-[#b9a6e6] text-white shadow pointer-events-auto text-lg shrink-0" onClick={() => void togglePause()} aria-label="일시정지">⏸</button>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-display text-sm text-cocoa truncate">🎵 {game.course.title} - {game.course.composer} · {DIFFICULTY_LABEL[game.chart.difficulty]}</div>
              <div className="h-2 rounded-full bg-white/70 overflow-hidden mt-1"><div className="h-full bg-[#f39a7b]" style={{ width: `${prog * 100}%` }} /></div>
            </div>
            <div className="rounded-full bg-[#5a4033aa] text-white text-xs px-2.5 py-1 tabular-nums shrink-0" data-testid="runner-time">{mmss(Math.max(0, now))} / {mmss(playEnd)}</div>
          </div>
          <div className="flex items-start justify-between mt-2 gap-2">
            <div className="leading-none">
              <div className="font-display text-[13px] text-[#e2604f] tracking-wide drop-shadow-[0_1px_0_#fff]">COMBO</div>
              <div className="font-display text-4xl text-[#f6a94a] drop-shadow-[0_2px_0_#fff] tabular-nums">{r?.combo ?? 0}</div>
              {game.multi && <PaceMeter pace={me.pace} />}
            </div>
            <div className="text-right flex flex-col items-end">
              <div className="rounded-full bg-[#5a403399] text-white font-display text-xl px-3 py-0.5 tabular-nums" data-testid="runner-score">{(r?.score ?? 0).toLocaleString()}</div>
              {game.multi ? <LiveRanking game={game} compact={touch} /> : <div className="text-[11px] text-cocoa-soft mt-0.5">내 최고 {best !== null ? best.toLocaleString() : '—'}</div>}
            </div>
          </div>
          {game.multi && now > 0 && <GapChip game={game} />}
        </div>
      )}
      {/* 판정: 잠깐 떴다가 사라짐 (화면 위쪽, 작게 — MISS는 강아지 머리 위에 작게) */}
      {ev && !finale && (
        <div key={game.lastEvent!.at} className="absolute left-1/2 top-[22%] -translate-x-1/2 text-center pointer-events-none judge-pop" data-testid="runner-judge">
          <div className="font-display text-3xl md:text-4xl drop-shadow-[0_2px_0_#fff]" style={{ color: GRADE_COLOR[ev.e.grade] }}>{GRADE_LABEL[ev.e.grade]}</div>
          {ev.points > 0 && <div className="font-display text-lg text-[#f6a94a] drop-shadow-[0_1px_0_#fff]">+{ev.points}</div>}
        </div>
      )}
      {game.lastEvent?.e.pass && performance.now() - game.lastEvent.at < 900 && !finale && (
        <div className="absolute left-1/2 top-[22%] -translate-x-1/2 text-[11px] text-cocoa-soft pointer-events-none panel !rounded-full px-3 py-1">박자에 맞춰 움직여야 점수가 나요</div>
      )}
      {/* 추월 알림 */}
      {banner && !finale && (
        <div key={banner.at} className={`absolute left-1/2 top-[30%] -translate-x-1/2 rounded-full px-4 py-1.5 font-display text-base whitespace-nowrap pointer-events-none pop shadow ${banner.good ? 'bg-[#f39a7b] text-white' : 'bg-white/90 text-[#6d84a3]'}`} data-testid="mr-banner">{banner.text}</div>
      )}
      {countdown > 0 && !paused && (
        <div className="absolute left-1/2 top-[30%] -translate-x-1/2 text-center pointer-events-none">
          <div key={countdown} className="font-display text-6xl text-white drop-shadow-[0_3px_0_#f39a7b] pop" data-testid="runner-countdown">{countdown}</div>
          <div className="panel !rounded-2xl px-4 py-2 mt-2 text-sm whitespace-nowrap">빛나는 띠가 하얀 판정선에 닿는 <b>박자</b>에 맞춰 조작!</div>
        </div>
      )}
      {goShow && !paused && (
        <div key="go" className="absolute left-1/2 top-[30%] -translate-x-1/2 font-display text-5xl text-white drop-shadow-[0_3px_0_#f39a7b] pop pointer-events-none" data-testid="runner-go">출발!</div>
      )}
      {/* 조작: 모바일은 한 줄 4버튼 (← 뛰기 숙이기 →), PC는 하단 안내 */}
      {touch ? (
        <div className="shrink-0 px-3 pt-2 pb-[calc(8px+var(--safe-b))] bg-[linear-gradient(#f3d9d6,#fbe7e2)] border-t-2 border-white/70">
          <div className="mx-auto max-w-[460px] grid grid-cols-4 gap-2" data-testid="runner-controls">
            <Btn a="L" label="왼쪽" icon="←" /><Btn a="R" label="오른쪽" icon="→" /><Btn a="J" label="뛰기" icon="↑" /><Btn a="D" label="숙이기" icon="↓" />
          </div>
        </div>
      ) : !intro && !finale && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 name-tag !text-xs !px-3 !py-1.5 opacity-90 whitespace-nowrap">← → / A D 레인 이동 · ↑ / Space 뛰기 · ↓ / Ctrl 숙이기{game.multi ? ' · 함께 달리기는 멈출 수 없어요' : ' · Esc 일시정지'}</div>
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

/** 페이스 표시 (100% = 기본 빠르기) */
function PaceMeter({ pace }: { pace: number }) {
  const pct = Math.round(pace * 100);
  const col = pct >= 104 ? '#e2604f' : pct <= 94 ? '#6d84a3' : '#a58d80';
  return (
    <div className="mt-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-display tabular-nums whitespace-nowrap" style={{ color: col }} data-testid="mr-pace">
      🐾 페이스 {pct}%{pct >= 104 ? ' ▲' : pct <= 94 ? ' ▼' : ''}
    </div>
  );
}

/** 앞 친구까지 거리 / 선두면 2위와 차이 */
function GapChip({ game }: { game: PlayGame }) {
  const race = game.race!;
  const me = race.me;
  const idx = race.order.indexOf(me.id);
  const ahead = idx > 0 ? race.byId.get(race.order[idx - 1])! : null;
  const behind = idx >= 0 && idx < race.order.length - 1 ? race.byId.get(race.order[idx + 1])! : null;
  return (
    <div className="mt-1.5 flex justify-center">
      <div className="rounded-full bg-white/85 shadow px-3 py-0.5 text-[12px] font-display whitespace-nowrap" data-testid="mr-gap">
        {ahead && ahead.dist - me.dist < 0.05 ? <>🐾 나란히 달리는 중 · 🐶{dogNameOf(game, ahead.id)}</>
          : ahead ? <>앞의 🐶{dogNameOf(game, ahead.id)}까지 <b className="text-[#6d84a3]">{Math.max(0, ahead.dist - me.dist).toFixed(1)}m</b></>
          : behind && me.dist - behind.dist < 0.05 ? <>🐾 나란히 달리는 중 · 🐶{dogNameOf(game, behind.id)}</>
          : behind ? <>🥇 선두! 2위와 <b className="text-[#e2604f]">+{Math.max(0, me.dist - behind.dist).toFixed(1)}m</b></> : '🥇 선두!'}
      </div>
    </div>
  );
}

/** 함께 달리기 실시간 순위 (달린 거리 순 · 같으면 정확도 → 점수) — 모바일은 작고 간결하게 */
function LiveRanking({ game, compact }: { game: PlayGame; compact: boolean }) {
  const race = game.race!;
  const m = game.multi!;
  return (
    <div className={`mt-1 rounded-2xl bg-white/85 px-2 py-1 text-left ${compact ? 'min-w-[128px]' : 'min-w-[210px]'}`} data-testid="mr-live">
      {race.order.map((id) => {
        const x = race.byId.get(id)!;
        const p = m.players.find((q) => q.id === id);
        const mine = id === m.myId;
        return (
          <div key={id} className={`flex items-center gap-1 text-[11px] leading-5 ${mine ? 'font-display text-[#e2604f]' : 'text-cocoa'} ${x.gone ? 'opacity-50' : ''}`} data-testid={`mr-row-${id}`}>
            <span className="w-4 text-center">{x.rank}</span>
            <span className={`flex-1 truncate ${compact ? 'max-w-[56px]' : 'max-w-[110px]'}`}>{compact ? p?.dogName : <>{p?.nickname} <span className="text-cocoa-soft">· 🐶{p?.dogName}</span></>}</span>
            <span className="tabular-nums w-12 text-right" data-testid={`mr-dist-${id}`}>{x.dist.toFixed(compact ? 0 : 1)}m</span>
            <span className="tabular-nums w-7 text-right text-[10px] text-cocoa-soft">{(x.live?.combo ?? 0) > 1 ? `×${x.live!.combo}` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 출발 전 참가자 소개 (출발선의 강아지들을 한 번에 보여 주는 동안) */
function IntroOverlay({ game }: { game: PlayGame }) {
  const race = game.race!;
  const order = [...race.racers].sort((a, b) => a.x - b.x);
  return (
    <>
      <div className="absolute inset-x-0 top-0 pt-[calc(14px+var(--safe-t,0px))] px-3 text-center pointer-events-none">
        <div className="inline-block panel !rounded-full px-4 py-1.5 font-display text-sm pop">🐾 함께 달리기 · {game.course.title} · {DIFFICULTY_LABEL[game.chart.difficulty]}</div>
        <div className="font-display text-xl text-white drop-shadow-[0_2px_0_#f39a7b] mt-2">오늘의 선수들!</div>
      </div>
      <div className="absolute inset-x-0 bottom-3 px-3 flex justify-center gap-1.5 flex-wrap pointer-events-none" data-testid="mr-intro">
        {order.map((r, i) => {
          const p = playerOf(game, r.id);
          return (
            <div key={r.id} className={`panel !rounded-2xl px-2.5 py-1.5 text-center pop ${r.me ? 'ring-2 ring-[#f39a7b]' : ''}`} style={{ animationDelay: `${i * 120}ms` }}>
              <div className="font-display text-sm leading-tight">🐶 {p?.dogName}</div>
              <div className="text-[11px] text-cocoa-soft leading-tight">{p?.nickname}{r.me ? ' (나)' : ''}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** 끝: 완주 → 서버가 확정한 순위 발표 (강아지들은 최종 거리 순서대로 서 있음) */
function FinaleOverlay({ game }: { game: PlayGame }) {
  const res = game.results;
  const ranked = res?.filter((x) => x.rank).sort((a, b) => a.rank! - b.rank!) ?? [];
  return (
    <div className="absolute inset-x-0 top-0 pt-[calc(14px+var(--safe-t,0px))] px-3 text-center pointer-events-none" data-testid="mr-finale">
      <div className="inline-block font-display text-2xl text-white bg-[#f39a7b] rounded-full px-6 py-1 shadow-[0_3px_0_#d9705f] pop">🏁 완주!</div>
      {!res && <div className="text-sm text-cocoa mt-2 panel !rounded-full inline-block px-3 py-1 ml-2">기록을 확인하는 중…</div>}
      {res && (
        <div className="mt-2 flex justify-center gap-1.5 flex-wrap">
          {ranked.map((x, i) => (
            <div key={x.id} className={`panel !rounded-2xl px-2.5 py-1 pop ${x.id === game.multi?.myId ? 'ring-2 ring-[#f39a7b]' : ''}`} style={{ animationDelay: `${i * 260}ms` }}>
              <span className="font-display">{['🥇', '🥈', '🥉', '🏅'][x.rank! - 1]} {x.dogName}</span> <span className="text-[11px] text-cocoa-soft tabular-nums">{x.distance.toFixed(1)}m</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
