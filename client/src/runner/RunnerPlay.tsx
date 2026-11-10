// 멍글런너 플레이 화면 — 음악 재생 시각을 기준으로 장애물·판정·강아지 움직임을 맞춘다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DogAnim } from '@shared/protocol';
import type { DogAvatar } from '@shared/avatar';
import {
  DUCK_MS, JUMP_MS, judgeRun, type Chart, type CourseInfo, type Grade, type JudgeEvent, type Obstacle, type RunResult, type RunnerAction, type RunnerInput, type Song,
} from '@shared/runner';
import { Dog, DOG_SCALE, newDogDriver } from '../game/models/Dog';
import { geo, mat } from '../game/lowpoly';
import { Lighting } from '../game/Lighting';
import { isTouchDevice } from '../game/input';
import type { MusicPlayer } from './music';

const LANE_W = 1.5;
const AHEAD_MS = 3200; // 앞쪽에 보이는 시간
export interface PlayGame {
  chart: Chart; song: Song; course: CourseInfo; player: MusicPlayer;
  inputs: RunnerInput[]; calib: number; sfx: boolean; paused: boolean; ended: boolean;
  /** 화면 표시용 최신 판정 결과 */
  live: RunResult | null;
  lastEvent: { e: JudgeEvent; at: number } | null;
  stumbleAt: number;
}

export const GRADE_LABEL: Record<Grade, string> = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
export const GRADE_COLOR: Record<Grade, string> = { perfect: '#f2836b', great: '#f6a94a', good: '#7fb07a', miss: '#9a8b80' };

// ---------------------------------------------------------------- 3D: 장애물
const NEED_COLOR = { jump: '#f6c453', duck: '#8fc7e8', left: '#f39a7b', right: '#f39a7b', side: '#f39a7b' } as const;
function ObstacleModel({ o }: { o: Obstacle }) {
  const cue = NEED_COLOR[o.need];
  return (
    <group>
      {/* 박자 표시: 장애물 바닥의 빛나는 띠 */}
      <mesh geometry={geo.box(LANE_W * 3.1, 0.02, 0.22)} position={[0, 0.02, 0]}>
        <meshBasicMaterial color={cue} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      {o.kind === 'log' && (
        <group position={[0, 0.2, 0]}>
          <mesh geometry={geo.cyl(0.2, 0.2, LANE_W * 3, 12)} material={mat('#b07a4f')} rotation={[0, 0, Math.PI / 2]} castShadow />
          {[-1, 1].map((k) => <mesh key={k} geometry={geo.cyl(0.17, 0.17, 0.02, 12)} material={mat('#e8c49a')} rotation={[0, 0, Math.PI / 2]} position={[k * LANE_W * 1.5 + k * 0.01, 0, 0]} />)}
          <mesh geometry={geo.sphere(0.12, 8, 6)} material={mat('#8fc27a')} position={[0.6, 0.2, 0]} />
        </group>
      )}
      {o.kind === 'ribbon' && (
        <group>
          {[-1, 1].map((k) => <mesh key={k} geometry={geo.cyl(0.05, 0.06, 1.25, 8)} material={mat('#fff1dc')} position={[k * LANE_W * 1.62, 0.62, 0]} castShadow />)}
          <mesh geometry={geo.box(LANE_W * 3.25, 0.16, 0.05)} material={mat('#f4a6b8')} position={[0, 0.8, 0]} castShadow />
          <mesh geometry={geo.sphere(0.12, 10, 8)} material={mat('#f28ca6')} position={[-0.14, 0.8, 0.03]} scale={[1.3, 0.8, 0.5]} />
          <mesh geometry={geo.sphere(0.12, 10, 8)} material={mat('#f28ca6')} position={[0.14, 0.8, 0.03]} scale={[1.3, 0.8, 0.5]} />
        </group>
      )}
      {o.kind === 'pot' && o.blocked.map((l) => (
        <group key={l} position={[l * LANE_W, 0, 0]}>
          <mesh geometry={geo.cyl(0.36, 0.26, 0.5, 12)} material={mat('#e98a5e')} position={[0, 0.25, 0]} castShadow />
          <mesh geometry={geo.cyl(0.39, 0.39, 0.08, 12)} material={mat('#d9774c')} position={[0, 0.5, 0]} />
          <mesh geometry={geo.sphere(0.3, 10, 8)} material={mat('#8fc27a')} position={[0, 0.72, 0]} castShadow />
          {[0, 1, 2].map((i) => <mesh key={i} geometry={geo.sphere(0.09, 8, 6)} material={mat(['#f7b8c8', '#f6c453', '#ffffff'][i])} position={[Math.sin(i * 2.1) * 0.2, 0.88, Math.cos(i * 2.1) * 0.2]} />)}
        </group>
      ))}
      {o.kind === 'fence' && o.blocked.map((l) => (
        <group key={l} position={[l * LANE_W, 0, 0]}>
          <mesh geometry={geo.box(LANE_W * 0.96, 0.08, 0.07)} material={mat('#ffffff')} position={[0, 0.32, 0]} castShadow />
          <mesh geometry={geo.box(LANE_W * 0.96, 0.08, 0.07)} material={mat('#ffffff')} position={[0, 0.6, 0]} castShadow />
          {[-0.5, -0.17, 0.17, 0.5].map((x) => (
            <group key={x} position={[x * LANE_W * 0.9, 0, 0]}>
              <mesh geometry={geo.box(0.12, 0.8, 0.06)} material={mat('#fff8ef')} position={[0, 0.4, 0.02]} castShadow />
              <mesh geometry={geo.cone(0.085, 0.14, 4)} material={mat('#fff8ef')} position={[0, 0.86, 0.02]} rotation={[0, Math.PI / 4, 0]} />
            </group>
          ))}
        </group>
      ))}
      {/* 레인 이동 방향 화살표 */}
      {o.safe.map((l) => (
        <mesh key={`a${l}`} geometry={geo.cone(0.18, 0.34, 3)} position={[l * LANE_W, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.9} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- 3D: 코스 (벚꽃 산책길)
function CherryTree({ s = 1 }: { s?: number }) {
  return (
    <group scale={s}>
      <mesh geometry={geo.cyl(0.12, 0.17, 1.3, 6)} material={mat('#9b6a45')} position={[0, 0.65, 0]} castShadow />
      <mesh geometry={geo.ico(0.85, 1)} material={mat('#f7b8c8')} position={[0, 1.7, 0]} castShadow />
      <mesh geometry={geo.ico(0.6, 1)} material={mat('#fac9d5')} position={[0.45, 1.95, 0.2]} castShadow />
      <mesh geometry={geo.ico(0.55, 1)} material={mat('#f4a6b8')} position={[-0.4, 1.9, -0.15]} castShadow />
    </group>
  );
}

function World({ game }: { game: PlayGame }) {
  const speed = game.course.speed;
  const trees = useRef<(THREE.Group | null)[]>([]);
  const dashes = useRef<(THREE.Mesh | null)[]>([]);
  const beats = useRef<(THREE.Mesh | null)[]>([]);
  const petals = useRef<THREE.InstancedMesh>(null);
  const obs = useRef<(THREE.Group | null)[]>([]);
  const petalData = useMemo(() => Array.from({ length: 70 }, (_, i) => ({ x: ((i * 37) % 100) / 100 * 12 - 6, y: ((i * 53) % 100) / 100 * 4, z: ((i * 71) % 100) / 100 * -40, r: i })), []);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const TREE_N = 18, DASH_N = 24, BEAT_N = 14;

  useFrame(({ clock }) => {
    const now = game.player.now();
    const dist = (now / 1000) * speed;
    // 나무: 양옆에 3m 간격으로 계속 흘러감
    trees.current.forEach((g, i) => {
      if (!g) return;
      const side = i % 2 ? 1 : -1;
      const span = (TREE_N / 2) * 4.2;
      const z = -(((Math.floor(i / 2) * 4.2 - dist) % span + span) % span) + 6;
      g.position.set(side * (3.6 + (i % 3) * 0.7), 0, z);
    });
    dashes.current.forEach((m, i) => {
      if (!m) return;
      const span = (DASH_N / 2) * 2;
      const z = -(((Math.floor(i / 2) * 2 - dist) % span + span) % span) + 6;
      m.position.set((i % 2 ? 0.5 : -0.5) * LANE_W, 0.012, z);
    });
    // 박자 선: 실제 음악 박자 위치
    let k = 0;
    for (const t of game.song.beats) {
      const dt = t * 1000 - now;
      if (dt < -400 || dt > AHEAD_MS) continue;
      const m = beats.current[k++];
      if (!m) break;
      m.visible = true;
      m.position.set(0, 0.011, -(dt / 1000) * speed);
    }
    for (; k < BEAT_N; k++) if (beats.current[k]) beats.current[k]!.visible = false;
    // 장애물
    const done = new Map(game.live?.events.map((e) => [e.id, e]) ?? []);
    game.chart.obstacles.forEach((o, i) => {
      const g = obs.current[i];
      if (!g) return;
      const dt = o.t - now;
      g.visible = dt < AHEAD_MS && dt > -900;
      if (!g.visible) return;
      g.position.z = -(dt / 1000) * speed;
      const ev = done.get(o.id);
      // 성공한 장애물은 통과 후 살짝 작아지며 사라짐
      const s = ev && ev.grade !== 'miss' && dt < 0 ? Math.max(0.01, 1 + dt / 400) : 1;
      g.scale.setScalar(s);
    });
    // 꽃잎
    if (petals.current) {
      const t = clock.elapsedTime;
      petalData.forEach((p, i) => {
        const z = ((p.z + dist * 0.6) % 40 + 40) % 40 - 34;
        tmp.position.set(p.x + Math.sin(t + p.r) * 0.3, ((p.y - t * 0.5) % 4 + 4) % 4 + 0.2, z);
        tmp.rotation.set(t + p.r, p.r, t * 0.7);
        tmp.scale.setScalar(0.07);
        tmp.updateMatrix();
        petals.current!.setMatrixAt(i, tmp.matrix);
      });
      petals.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      <mesh geometry={geo.box(80, 0.1, 120)} material={mat('#b8dca0')} position={[0, -0.06, -40]} receiveShadow />
      <mesh geometry={geo.box(LANE_W * 3 + 0.5, 0.02, 120)} material={mat('#f6e6cf')} position={[0, 0.0, -40]} receiveShadow />
      {[-1, 1].map((k) => <mesh key={k} geometry={geo.box(0.22, 0.08, 120)} material={mat('#f7c9b4')} position={[k * (LANE_W * 1.5 + 0.3), 0.03, -40]} />)}
      {Array.from({ length: DASH_N }, (_, i) => <mesh key={i} ref={(m) => { dashes.current[i] = m; }} geometry={geo.box(0.06, 0.01, 0.9)} material={mat('#fffaf2')} />)}
      {Array.from({ length: BEAT_N }, (_, i) => (
        <mesh key={i} ref={(m) => { beats.current[i] = m; }} geometry={geo.box(LANE_W * 3, 0.005, 0.06)} visible={false}>
          <meshBasicMaterial color="#f7b8c8" transparent opacity={0.55} toneMapped={false} />
        </mesh>
      ))}
      {Array.from({ length: TREE_N }, (_, i) => <group key={i} ref={(g) => { trees.current[i] = g; }}><CherryTree s={0.9 + (i % 4) * 0.12} /></group>)}
      {game.chart.obstacles.map((o, i) => <group key={o.id} ref={(g) => { obs.current[i] = g; }} visible={false}><ObstacleModel o={o} /></group>)}
      <instancedMesh ref={petals} args={[undefined, undefined, petalData.length]}>
        <circleGeometry args={[1, 5]} />
        <meshBasicMaterial color="#fac9d5" side={THREE.DoubleSide} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------- 3D: 내 강아지 (달리기·점프·숙이기·비틀거림)
function Runner({ game, avatar }: { game: PlayGame; avatar: DogAvatar }) {
  const g = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const d = useRef(newDogDriver());
  const x = useRef(0);
  const shadow = useRef<THREE.Mesh>(null);
  const scale = DOG_SCALE[avatar.size];
  const { camera, size } = useThree();
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = game.player.now();
    const live = game.live;
    const drv = d.current;
    // 레인
    let lane = 0;
    for (const l of live?.lanes ?? []) { if (l.t <= now) lane = l.lane; else break; }
    const tx = lane * LANE_W;
    const prevX = x.current;
    x.current += (tx - x.current) * Math.min(1, dt * 14);
    // 점프·숙이기 (받아들여진 입력 기준)
    const last = (list: number[] | undefined, len: number) => { if (!list) return undefined; for (let i = list.length - 1; i >= 0; i--) if (list[i] <= now) return now < list[i] + len ? list[i] : undefined; return undefined; };
    const j = last(live?.jumps, JUMP_MS);
    const dk = last(live?.ducks, DUCK_MS);
    const jy = j !== undefined ? (() => { const k = (now - j) / JUMP_MS; return 4 * 0.85 * k * (1 - k); })() : 0;
    const duck = dk !== undefined ? Math.sin(Math.min(1, (now - dk) / DUCK_MS) * Math.PI) : 0;
    const st = now - game.stumbleAt;
    const stumble = st >= 0 && st < 520 ? Math.sin((st / 520) * Math.PI) : 0;
    drv.anim = game.ended ? DogAnim.Greet : jy > 0.02 ? DogAnim.Walk : DogAnim.Run;
    if (!game.paused) drv.phase += dt * (game.course.speed / (0.4 * scale)) * Math.PI * (jy > 0.02 ? 0.4 : 1) * (1 - stumble * 0.6);
    if (g.current && body.current) {
      g.current.position.set(x.current, jy, 0);
      g.current.rotation.set(0, Math.PI, -(x.current - prevX) * 2.5 + Math.sin(st / 40) * 0.25 * stumble);
      body.current.scale.set(1 + duck * 0.12, 1 - duck * 0.42, 1 + duck * 0.12);
      body.current.rotation.x = -duck * 0.15 + (jy > 0 ? -0.15 : 0);
    }
    if (shadow.current) { shadow.current.position.x = x.current; shadow.current.scale.setScalar(1 - jy * 0.45); }
    // 카메라: 강아지 뒤에서 따라감 (세로 화면은 조금 더 멀리)
    const portrait = size.height > size.width;
    const cam = camera as THREE.PerspectiveCamera;
    const fov = portrait ? 64 : 52;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.position.set(x.current * 0.55, portrait ? 2.7 : 2.3, portrait ? 5.0 : 4.4);
    cam.lookAt(x.current * 0.75, 0.6, -6);
  });
  return (
    <>
      <group ref={g}>
        <group ref={body}><Dog avatar={avatar} driver={d} /></group>
      </group>
      {/* 바닥 그림자 (점프하면 작아짐) */}
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
    const r = judgeRun(game.chart, game.inputs, now);
    game.live = r;
    while (seen.current < r.events.length) {
      const e = r.events[seen.current++];
      game.lastEvent = { e, at: performance.now() };
      if (game.sfx) game.player.blip(e.grade);
      if (e.grade === 'miss' && !e.pass) game.stumbleAt = game.chart.obstacles[e.id].t + 60;
    }
    if (now >= game.chart.duration) { game.ended = true; onEnd(); }
  });
  return null;
}

// ---------------------------------------------------------------- 화면 + 조작
export function RunnerPlay({ game, avatar, best, onEnd, onQuit, onRetry }: {
  game: PlayGame; avatar: DogAvatar; best: number | null; onEnd: () => void; onQuit: () => void; onRetry: () => void;
}) {
  const [, force] = useState(0);
  const [paused, setPaused] = useState(false);
  // 자동 화면 테스트(mungle.e2e)에서만: 진행 중인 게임 상태를 노출해 박자에 맞춘 입력을 검증
  useEffect(() => {
    const w = window as unknown as { __mungleTest?: Record<string, unknown> };
    if (w.__mungleTest) w.__mungleTest.runnerGame = game;
    return () => { if (w.__mungleTest?.runnerGame === game) delete w.__mungleTest.runnerGame; };
  }, [game]);
  const touch = isTouchDevice();
  // HUD는 초당 15번 갱신 (3D는 매 프레임)
  useEffect(() => { const id = window.setInterval(() => force((x) => x + 1), 66); return () => window.clearInterval(id); }, []);
  const act = (a: RunnerAction) => {
    if (game.paused || game.ended) return;
    game.inputs.push({ t: Math.round(game.player.now() - game.calib), a });
  };
  const togglePause = async () => {
    if (game.ended) return;
    if (game.paused) { await game.player.resume(); game.paused = false; setPaused(false); }
    else { game.paused = true; setPaused(true); await game.player.pause(); }
  };
  useEffect(() => {
    const map: Record<string, RunnerAction> = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', ArrowUp: 'J', KeyW: 'J', Space: 'J', ArrowDown: 'D', KeyS: 'D' };
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
  const prog = Math.max(0, Math.min(1, now / game.chart.duration));
  const ev = game.lastEvent && performance.now() - game.lastEvent.at < 650 ? game.lastEvent : null;
  const firstT = game.chart.obstacles[0]?.t ?? 0;
  const Btn = ({ a, label, icon }: { a: RunnerAction; label: string; icon: string }) => (
    <button aria-label={label} className="w-[62px] h-[62px] rounded-full bg-[#fff8ef]/90 border-2 border-white shadow-[0_4px_12px_rgba(90,64,51,.2)] flex flex-col items-center justify-center touch-none select-none active:scale-95 active:bg-[#fde3d6]"
      onPointerDown={(e) => { e.preventDefault(); act(a); }} onContextMenu={(e) => e.preventDefault()}>
      <span className="text-2xl leading-none">{icon}</span><span className="text-[10px] font-display mt-0.5">{label}</span>
    </button>
  );
  return (
    <div className="absolute inset-0 bg-[#fde9e4] select-none" data-testid="runner-play">
      <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 52, near: 0.1, far: 120, position: [0, 2.3, 4.4] }} gl={{ antialias: true }}>
        <color attach="background" args={['#fde4ea']} />
        <fog attach="fog" args={['#fde4ea', 18, 48]} />
        <Lighting indoor={false} shadows={!touch} />
        <World game={game} />
        <Runner game={game} avatar={avatar} />
        <Judge game={game} onEnd={onEnd} />
      </Canvas>
      {/* 상단 HUD */}
      <div className="absolute inset-x-0 top-0 px-3 pt-[calc(10px+var(--safe-t,0px))] flex items-start gap-2 pointer-events-none">
        <div className="panel !rounded-2xl px-3 py-1.5 min-w-[104px]">
          <div className="text-[11px] text-cocoa-soft leading-none">점수</div>
          <div className="font-display text-2xl leading-tight tabular-nums" data-testid="runner-score">{(r?.score ?? 0).toLocaleString()}</div>
          <div className="text-[11px] text-cocoa-soft">콤보 <b className="text-cocoa">{r?.combo ?? 0}</b> · 최고 {r?.maxCombo ?? 0}</div>
        </div>
        <div className="flex-1 pt-1">
          <div className="h-2.5 rounded-full bg-white/70 overflow-hidden"><div className="h-full bg-[#f39a7b]" style={{ width: `${prog * 100}%` }} /></div>
          <div className="text-[11px] text-cocoa-soft mt-1 text-center">🎵 {game.course.title} · 내 최고 {best !== null ? best.toLocaleString() : '—'}</div>
        </div>
        <button className="btn btn-ghost w-11 h-11 pointer-events-auto" onClick={() => void togglePause()} aria-label="일시정지">⏸</button>
      </div>
      {/* 판정 */}
      {ev && (
        <div key={game.lastEvent!.at} className="absolute left-1/2 top-[28%] -translate-x-1/2 text-center pointer-events-none pop" data-testid="runner-judge">
          <div className="font-display text-4xl md:text-5xl drop-shadow-[0_2px_0_#fff]" style={{ color: GRADE_COLOR[ev.e.grade] }}>{GRADE_LABEL[ev.e.grade]}</div>
          {ev.e.pass && <div className="text-xs text-cocoa-soft">박자에 맞춰 움직여야 점수가 나요</div>}
          {(r?.combo ?? 0) >= 2 && ev.e.grade !== 'miss' && <div className="font-display text-lg text-cocoa">{r!.combo} 콤보!</div>}
        </div>
      )}
      {now < firstT - 600 && !paused && (
        <div className="absolute left-1/2 top-[30%] -translate-x-1/2 panel px-5 py-3 text-center pointer-events-none">
          <div className="font-display text-xl">♪ 음악을 들어 보세요</div>
          <div className="text-sm text-cocoa-soft">장애물 밑 빛나는 띠가 강아지에 닿는 박자에 맞춰 조작!</div>
        </div>
      )}
      {/* 모바일 조작 버튼 (Safe Area 위) */}
      {touch && (
        <div className="absolute inset-x-0 bottom-0 px-4 pb-[calc(14px+var(--safe-b))] flex justify-between items-end pointer-events-none">
          <div className="flex gap-3 pointer-events-auto"><Btn a="L" label="왼쪽" icon="◀" /><Btn a="R" label="오른쪽" icon="▶" /></div>
          <div className="flex gap-3 pointer-events-auto"><Btn a="D" label="숙이기" icon="⤵️" /><Btn a="J" label="점프" icon="⤴️" /></div>
        </div>
      )}
      {!touch && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 name-tag !text-xs !px-3 !py-1.5 opacity-90">← → 레인 이동 · ↑/Space 점프 · ↓ 숙이기 · Esc 일시정지</div>}
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
