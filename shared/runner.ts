// 멍글런너 (Mungle Runner) — 클래식 리듬 레이싱 공용 규칙
// 클라이언트(연주·화면 판정)와 서버(점수 재계산·검증)가 같은 코드로 같은 결과를 얻도록 순수 함수만 둔다.
//
// 음원: 원곡(작곡)은 저작권 보호기간이 끝난 퍼블릭 도메인 작품이고, 연주는 외부 녹음을 쓰지 않고
// 아래 악보 데이터로 브라우저에서 직접 합성한다(멍글마을 자체 편곡). 그래서 음원과 비트 타임라인이 항상 일치한다.

import { SONG_DEFS } from './songs';
import { generateChart, MIN_GAP, type SongMeta } from './runnerChart';
import { DUCK_MS, EARLY_MARGIN_MS, JUMP_MS, overlapWindow } from './runnerPose';
export { DUCK_MS, JUMP_MS };

export const RUNNER_GAME_VERSION = 1;

export type Lane = -1 | 0 | 1;
export type ObstacleKind = 'log' | 'ribbon' | 'pot' | 'fence';
/** 입력: 왼쪽·오른쪽 레인 이동, 점프, 몸 낮추기 (t: 음악 시각 ms) */
export type RunnerAction = 'L' | 'R' | 'J' | 'D';
export interface RunnerInput { t: number; a: RunnerAction }

export interface CourseInfo {
  id: string;
  order: number;
  title: string;
  composer: string;
  /** 1~5 */
  difficulty: number;
  course: string;
  theme: string;
  /** 연주 데이터(악보)와 장애물 패턴이 모두 있는 곡만 true */
  available: boolean;
  patternVersion: number;
  /** 달리는 속도 (m/s) */
  speed: number;
}

export const COURSES: CourseInfo[] = [
  { id: 'elise', order: 1, title: '엘리제를 위하여', composer: '베토벤', difficulty: 1, course: '벚꽃 산책길', theme: 'cherry', available: true, patternVersion: 2, speed: 4.6 },
  { id: 'danube', order: 2, title: '아름답고 푸른 도나우', composer: '요한 슈트라우스 2세', difficulty: 2, course: '구름 정원', theme: 'cloud', available: true, patternVersion: 2, speed: 4.6 },
  { id: 'turkish', order: 3, title: '터키 행진곡', composer: '모차르트', difficulty: 3, course: '장난감 마을', theme: 'toy', available: true, patternVersion: 2, speed: 5.0 },
  { id: 'revolutionary', order: 4, title: '혁명 연습곡', composer: '쇼팽', difficulty: 4, course: '별빛 숲길', theme: 'star', available: true, patternVersion: 2, speed: 5.3 },
  { id: 'summer', order: 5, title: '사계 중 여름 3악장', composer: '비발디', difficulty: 5, course: '폭풍 질주', theme: 'storm', available: true, patternVersion: 2, speed: 5.5 },
];
export const COURSE_BY_ID = new Map(COURSES.map((c) => [c.id, c]));

// ---------------------------------------------------------------- 판정·점수
export const JUDGE = { perfect: 80, great: 150, good: 230 } as const;
export type Grade = 'perfect' | 'great' | 'good' | 'miss';
export const GRADE_POINTS: Record<Grade, number> = { perfect: 100, great: 70, good: 40, miss: 0 };
/** 정확도 가중치 */
const GRADE_ACC: Record<Grade, number> = { perfect: 1, great: 0.7, good: 0.4, miss: 0 };
/** 콤보 보너스: 10콤보마다 +10%, 최대 +100% (모든 사용자 동일) */
export const comboMultiplier = (combo: number) => 1 + Math.min(10, Math.floor(combo / 10)) * 0.1;

// ---------------------------------------------------------------- 악보 (엘리제를 위하여 · 멍글마을 편곡)
// 3/8박자, 한 마디 = 16분음표 6칸. [칸, 음(MIDI), 길이(16분음표 수), 손(0 오른손 1 왼손)]
type N = [number, number, number, number];
const LH = (a: number, b: number, c: number): N[] => [[0, a, 3, 1], [1, b, 2, 1], [2, c, 1, 1]];
const BARS: Record<string, N[]> = {
  intro1: [[0, 45, 2, 1], [1, 52, 2, 1], [2, 57, 2, 1], [3, 60, 2, 1], [4, 64, 2, 1], [5, 69, 2, 1]],
  intro2: [[0, 40, 2, 1], [1, 52, 2, 1], [2, 56, 2, 1], [3, 59, 1, 1], [4, 76, 1, 0], [5, 75, 1, 0]],
  T1: [[0, 76, 1, 0], [1, 75, 1, 0], [2, 76, 1, 0], [3, 71, 1, 0], [4, 74, 1, 0], [5, 72, 1, 0]],
  T2: [[0, 69, 3, 0], [3, 60, 1, 0], [4, 64, 1, 0], [5, 69, 1, 0], ...LH(45, 52, 57)],
  T3: [[0, 71, 3, 0], [3, 64, 1, 0], [4, 68, 1, 0], [5, 71, 1, 0], ...LH(40, 52, 56)],
  T4: [[0, 72, 3, 0], [3, 64, 1, 0], [4, 76, 1, 0], [5, 75, 1, 0], ...LH(45, 52, 57)],
  T7: [[0, 71, 3, 0], [3, 64, 1, 0], [4, 72, 1, 0], [5, 71, 1, 0], ...LH(40, 52, 56)],
  T8a: [[0, 69, 4, 0], [4, 76, 1, 0], [5, 75, 1, 0], ...LH(45, 52, 57)],
  T8b: [[0, 69, 3, 0], [3, 71, 1, 0], [4, 72, 1, 0], [5, 74, 1, 0], ...LH(45, 52, 57)],
  B9: [[0, 76, 3, 0], [3, 67, 1, 0], [4, 77, 1, 0], [5, 76, 1, 0], ...LH(48, 55, 60)],
  B10: [[0, 74, 3, 0], [3, 65, 1, 0], [4, 76, 1, 0], [5, 74, 1, 0], ...LH(43, 55, 59)],
  B11: [[0, 72, 3, 0], [3, 64, 1, 0], [4, 74, 1, 0], [5, 72, 1, 0], ...LH(45, 52, 57)],
  B12: [[0, 71, 3, 0], [3, 64, 1, 0], [4, 76, 1, 0], [5, 75, 1, 0], ...LH(40, 52, 56)],
  END1: [[0, 69, 6, 0], ...LH(45, 52, 57)],
  END2: [[0, 45, 6, 1], [0, 57, 6, 1], [0, 60, 6, 0], [0, 64, 6, 0], [0, 69, 6, 0]],
};
const THEME = ['T1', 'T2', 'T3', 'T4', 'T1', 'T2', 'T7'];
/** [마디 이름, 템포 배율(1=기본, 클수록 느림), 셈여림 0~1, 2절 여부] — 프레이즈 끝은 살짝 늘이고(루바토) 마지막은 리타르단도 */
type BarPlan = [string, number, number, number];
const ELISE_PLAN: BarPlan[] = [
  ['intro1', 1.04, 0.45, 0], ['intro2', 1.06, 0.5, 0],
  ...THEME.map((b, i): BarPlan => [b, i === 3 ? 1.06 : 1, 0.55, 0]), ['T8a', 1.1, 0.5, 0],
  ...THEME.map((b, i): BarPlan => [b, i === 3 ? 1.06 : 1, 0.6, 0]), ['T8b', 1.06, 0.6, 0],
  ['B9', 0.97, 0.72, 0], ['B10', 0.97, 0.72, 0], ['B11', 0.98, 0.68, 0], ['B12', 1.08, 0.62, 0],
  ...THEME.map((b): BarPlan => [b, 0.96, 0.7, 1]), ['T8b', 1.0, 0.72, 1],
  ['B9', 0.94, 0.85, 1], ['B10', 0.94, 0.85, 1], ['B11', 0.95, 0.8, 1], ['B12', 1.04, 0.72, 1],
  ...THEME.map((b, i): BarPlan => [b, i < 4 ? 0.96 : 1 + (i - 3) * 0.06, 0.7 - i * 0.03, 1]),
  ['END1', 1.35, 0.5, 1], ['END2', 1.7, 0.45, 1],
];
/** 기본 16분음표 길이 (초) — 한 마디 ≈ 1.3초 */
const ELISE_SIXTEENTH = 0.22;

export interface SongNote { t: number; dur: number; midi: number; vel: number; hand: number; bar: number; pos: number; part: number }
export interface Song { courseId: string; notes: SongNote[]; bars: { t: number; name: string; len: number; vel: number; part: number }[]; beats: number[]; duration: number; /** 한 마디 16분음표 칸 수 */ barLen: number }

export function buildSong(courseId: string): Song | null {
  const def = SONG_DEFS[courseId];
  if (def) {
    // 다른 곡: 같은 방식 (마디 계획 × 템포 배율)으로 악보 → 시각
    const notes: SongNote[] = [];
    const bars: Song['bars'] = [];
    const beats: number[] = [];
    let t = 0.6;
    def.plan.forEach(([name, k, vel, part], bi) => {
      const s = def.sixteenth * k;
      bars.push({ t, name, len: s * def.barLen, vel, part });
      for (let b = 0; b < def.barLen; b += def.beatLen) beats.push(t + b * s);
      for (const [pos, midi, len, hand] of def.bars[name]) {
        notes.push({ t: t + pos * s, dur: len * s, midi, vel: vel * (hand ? 0.6 : 1) * (pos === 0 ? 1.08 : 1), hand, bar: bi, pos, part });
      }
      t += s * def.barLen;
    });
    return { courseId, notes, bars, beats, duration: t + 1.6, barLen: def.barLen };
  }
  if (courseId !== 'elise') return null;
  const notes: SongNote[] = [];
  const bars: Song['bars'] = [];
  const beats: number[] = [];
  let t = 0.6; // 시작 여유
  ELISE_PLAN.forEach(([name, k, vel, part], bi) => {
    const s = ELISE_SIXTEENTH * k;
    bars.push({ t, name, len: s * 6, vel, part });
    beats.push(t, t + s * 3); // 3/8박자: 점4분음표 단위 2박
    for (const [pos, midi, len, hand] of BARS[name]) {
      notes.push({ t: t + pos * s, dur: len * s, midi, vel: vel * (hand ? 0.62 : 1) * (pos === 0 ? 1.08 : 1), hand, bar: bi, pos, part });
    }
    t += s * 6;
  });
  return { courseId, notes, bars, beats, duration: t + 1.6, barLen: 6 };
}

// ---------------------------------------------------------------- 장애물 패턴 (곡별 데이터)
export interface Obstacle {
  id: number;
  /** 판정 시각 (음악 시작 기준 ms) — 이 박자에 맞춰 조작 */
  t: number;
  kind: ObstacleKind;
  /** 막힌 레인 (점프·숙이기 장애물은 세 레인 모두) */
  blocked: Lane[];
  /** 레인 장애물: 피할 수 있는 레인 */
  safe: Lane[];
  /** 필요한 조작 안내 */
  need: 'jump' | 'duck' | 'left' | 'right' | 'side';
  /** 패턴 표의 위치 (마디 번호, 16분음표 칸) — 사람이 악보와 대조하기 위함 */
  bar: number;
  pos: number;
}
export interface Chart { courseId: string; difficulty: RunnerDifficulty; patternVersion: number; obstacles: Obstacle[]; duration: number; maxScore: number; bpm: number }


/** 기본 템포: 3/8박자 점4분음표 기준 BPM (마디마다 ELISE_PLAN 배율로 변함) */
export const ELISE_BPM = Math.round(60 / (ELISE_SIXTEENTH * 3));

/** 난이도: EASY(마디 첫 박 위주·조금 느리게) · NORMAL(기본) · HARD(박 사이 장애물 추가·조금 빠르게) */
export type RunnerDifficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: RunnerDifficulty[] = ['easy', 'normal', 'hard'];
export const DIFFICULTY_LABEL: Record<RunnerDifficulty, string> = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' };
export const DIFFICULTY_DESC: Record<RunnerDifficulty, string> = { easy: '주요 박자만 · 한 번에 한 동작', normal: '반 박 섞임 · 2~3개 연속', hard: '16분음표 멜로디 · 4~6개 연속 · 빠르게' };
/** 난이도별 달리는 속도 배율 (화면에서 장애물이 다가오는 빠르기 — 판정 시각은 음악 기준 그대로) */
export const DIFFICULTY_SPEED: Record<RunnerDifficulty, number> = { easy: 0.9, normal: 1, hard: 1.14 };
export const isDifficulty = (v: unknown): v is RunnerDifficulty => v === 'easy' || v === 'normal' || v === 'hard';
/** 곡·난이도별 기본 달리기 속도 (m/s) — 장애물이 다가오는 속도이자 거리 경쟁의 기본 페이스 */
export const courseSpeed = (courseId: string, d: RunnerDifficulty) => (COURSE_BY_ID.get(courseId)?.speed ?? 4.6) * DIFFICULTY_SPEED[d];
/** 랭킹·최고 기록 구분: NORMAL은 곡 id 그대로(기존 기록 유지), EASY/HARD는 'elise.hard' 처럼 */
export const rankKey = (courseId: string, d: RunnerDifficulty) => (d === 'normal' ? courseId : `${courseId}.${d}`);
export function parseRankKey(key: string): { courseId: string; difficulty: RunnerDifficulty } | null {
  const [c, d] = key.split('.');
  const difficulty = d === undefined ? 'normal' : d;
  if (!COURSE_BY_ID.get(c)?.available || !isDifficulty(difficulty) || (d !== undefined && d === 'normal')) return null;
  return { courseId: c, difficulty };
}
export const ALL_RANK_KEYS = COURSES.filter((c) => c.available).flatMap((c) => DIFFICULTIES.map((d) => rankKey(c.id, d)));

/** 곡의 박자 구조 (한 마디 16분음표 칸 수 · 한 박의 칸 수) */
export function songMeta(courseId: string): SongMeta | null {
  if (courseId === 'elise') return { barLen: 6, beatLen: 3 };
  const d = SONG_DEFS[courseId];
  return d ? { barLen: d.barLen, beatLen: d.beatLen } : null;
}

/** 악보 → 판정 시각이 붙은 장애물 목록 (곡·난이도별로 악보의 멜로디·강세·셈여림에서 만듦 — runnerChart.ts) */
export function buildChart(courseId: string, difficulty: RunnerDifficulty = 'normal'): Chart | null {
  const song = buildSong(courseId);
  const info = COURSE_BY_ID.get(courseId);
  const meta = songMeta(courseId);
  if (!song || !info?.available || !meta) return null;
  const obs: Obstacle[] = generateChart(song, meta, difficulty, courseSpeed(courseId, difficulty)).map((o, id) => ({ ...o, id }));
  // 최대 점수: 모두 PERFECT로 이어 간 경우
  let max = 0;
  obs.forEach((_, i) => { max += Math.round(GRADE_POINTS.perfect * comboMultiplier(i)); });
  return {
    courseId, difficulty, patternVersion: info.patternVersion, obstacles: obs, duration: Math.round(song.duration * 1000), maxScore: max,
    bpm: courseId === 'elise' ? ELISE_BPM : SONG_DEFS[courseId].bpm,
  };
}

/**
 * 출발 카운트다운(카운트인): 곡의 첫 박에 맞춰 3번 — 박 간격의 정수배(0.6~1.2초)로 센다.
 * 반환: 각 숫자(3·2·1)가 시작되는 음악 시각(ms, 음수 가능)과 '출발!' 시각(= 첫 박)
 */
export function countIn(song: Song): { ticks: number[]; go: number; interval: number } {
  const b0 = song.bars[0];
  const meta = songMeta(song.courseId) ?? { barLen: song.barLen, beatLen: song.barLen };
  const beat = (b0.len / song.barLen) * meta.beatLen * 1000;
  const n = Math.max(1, Math.ceil(600 / beat));
  const interval = Math.round(beat * n);
  const go = Math.round(b0.t * 1000);
  return { ticks: [go - 3 * interval, go - 2 * interval, go - interval], go, interval };
}

/** 모든 장애물을 정확한 박자에 피하는 입력 (테스트·검증용 '완벽한 플레이어') */
export function perfectInputs(chart: Chart, offset = 0): RunnerInput[] {
  const out: RunnerInput[] = [];
  let lane: Lane = 0;
  for (const o of chart.obstacles) {
    const t = o.t + offset;
    if (o.need === 'jump') out.push({ t, a: 'J' });
    else if (o.need === 'duck') out.push({ t, a: 'D' });
    else if (o.blocked.includes(lane)) {
      const to = o.safe.filter((s) => Math.abs(s - lane) === 1).sort((a, b) => b - a)[0];
      if (to === undefined) continue;
      out.push({ t, a: to > lane ? 'R' : 'L' });
      lane = to;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * 클리어할 수 없는 배치가 없는지 검사 (테스트·개발용). 문제 목록을 돌려준다.
 * - 동작 사이 최소 시간 (점프 체공·숙이기 유지·레인 이동) — runnerChart.MIN_GAP
 * - 아직 몸을 지나가는 장애물과 부딪히는 동작 (통나무 위에서 숙이기, 리본 아래에서 점프, 막힌 레인으로 이동)
 * - 레인 장애물: 지금 있을 수 있는 모든 레인에서 한 번 이동으로 피할 수 있고, 반드시 움직여야 함
 */
export function validateChart(c: Chart): string[] {
  const errs: string[] = [];
  const speed = courseSpeed(c.courseId, c.difficulty);
  const act = (o: Obstacle) => (o.need === 'jump' ? 'J' : o.need === 'duck' ? 'D' : 'M');
  let lanes: Lane[] = [0];
  c.obstacles.forEach((o, i) => {
    for (const p of c.obstacles.slice(Math.max(0, i - 4), i)) {
      const gap = o.t - p.t, need = MIN_GAP[act(p)][act(o)];
      if (gap < need) errs.push(`#${o.id} #${p.id} 동작과 간격 ${gap}ms (최소 ${need}ms)`);
    }
    const active = c.obstacles.slice(0, i).filter((p) => overlapWindow(p.t, speed, p.kind)[1] > o.t - EARLY_MARGIN_MS);
    if (o.need === 'jump' && active.some((p) => p.kind === 'ribbon')) errs.push(`#${o.id} 리본 아래에서 점프`);
    if (o.need === 'duck' && active.some((p) => p.kind === 'log')) errs.push(`#${o.id} 통나무 위에서 숙이기`);
    if (o.kind === 'pot' || o.kind === 'fence') {
      if (!o.safe.length) errs.push(`#${o.id} 피할 레인이 없음`);
      if (!lanes.every((l) => o.blocked.includes(l))) errs.push(`#${o.id} 움직이지 않아도 되는 레인 장애물`);
      const next = new Set<Lane>();
      for (const l of lanes) {
        const reach = o.safe.filter((s) => Math.abs(s - l) === 1);
        if (!reach.length) errs.push(`#${o.id} 한 번 이동으로 피할 수 없음 (레인 ${l})`);
        reach.forEach((r) => next.add(r));
      }
      for (const l of next) for (const p of active) if ((p.kind === 'pot' || p.kind === 'fence') && !p.safe.includes(l)) errs.push(`#${o.id} 이동한 레인이 앞 장애물에 막힘`);
      lanes = [...next];
    }
  });
  return errs;
}

// ---------------------------------------------------------------- 판정 시뮬레이션
export interface JudgeEvent { id: number; grade: Grade; delta: number | null; /** 부딪히지는 않았지만 박자에 맞춘 조작이 없었음 */ pass?: boolean }
export interface RunResult {
  events: JudgeEvent[];
  score: number;
  combo: number;
  maxCombo: number;
  counts: Record<Grade, number>;
  /** 0~1 */
  accuracy: number;
  /** 화면 표시용: 받아들여진 점프·숙이기 시작 시각, 레인 변화 */
  jumps: number[];
  ducks: number[];
  lanes: { t: number; lane: Lane }[];
}

function gradeOf(delta: number): Grade {
  const d = Math.abs(delta);
  return d <= JUDGE.perfect ? 'perfect' : d <= JUDGE.great ? 'great' : d <= JUDGE.good ? 'good' : 'miss';
}

/**
 * 입력 기록으로 판정을 계산한다. untilMs를 주면 그 시각까지 판정이 끝난 장애물만 계산 (진행 중 화면 표시용).
 * 서버도 같은 함수로 점수를 다시 계산하므로 클라이언트가 보낸 점수는 쓰지 않는다.
 */
export function judgeRun(chart: Chart, inputsRaw: RunnerInput[], untilMs = Infinity): RunResult {
  const inputs = inputsRaw.filter((i) => i.t <= untilMs).slice().sort((a, b) => a.t - b.t);
  // 1) 입력 → 받아들여진 점프·숙이기, 레인 변화
  const jumps: number[] = [], ducks: number[] = [];
  const lanes: { t: number; lane: Lane }[] = [{ t: -1e9, lane: 0 }];
  let lane: Lane = 0, airUntil = -1e9, duckUntil = -1e9;
  const laneMoves: { t: number; lane: Lane }[] = [];
  for (const i of inputs) {
    if (i.a === 'J') { if (i.t >= airUntil) { jumps.push(i.t); airUntil = i.t + JUMP_MS; } }
    else if (i.a === 'D') { if (i.t >= duckUntil) { ducks.push(i.t); duckUntil = i.t + DUCK_MS; } }
    else {
      const next = Math.max(-1, Math.min(1, lane + (i.a === 'L' ? -1 : 1))) as Lane;
      if (next !== lane) { lane = next; lanes.push({ t: i.t, lane }); laneMoves.push({ t: i.t, lane }); }
    }
  }
  const laneAt = (t: number) => { let l: Lane = 0; for (const x of lanes) { if (x.t <= t) l = x.lane; else break; } return l; };
  // 2) 장애물 순서대로 판정 (가장 가까운 미사용 입력과 짝지음)
  const usedJ = new Set<number>(), usedD = new Set<number>(), usedM = new Set<number>();
  const events: JudgeEvent[] = [];
  const counts: Record<Grade, number> = { perfect: 0, great: 0, good: 0, miss: 0 };
  let score = 0, combo = 0, maxCombo = 0, acc = 0;
  const pick = (list: number[], used: Set<number>, t: number) => {
    let best = -1, bd = Infinity;
    list.forEach((x, k) => { if (used.has(k)) return; const d = Math.abs(x - t); if (d <= JUDGE.good && d < bd) { bd = d; best = k; } });
    return best;
  };
  for (const o of chart.obstacles) {
    if (o.t + JUDGE.good > untilMs) break;
    let grade: Grade = 'miss', delta: number | null = null;
    if (o.need === 'jump' || o.need === 'duck') {
      const list = o.need === 'jump' ? jumps : ducks, used = o.need === 'jump' ? usedJ : usedD;
      const k = pick(list, used, o.t);
      if (k >= 0) { used.add(k); delta = list[k] - o.t; grade = gradeOf(delta); }
    } else {
      // 레인 장애물: 박자에 맞춰 안전한 레인으로 옮긴 입력을 판정. 미리 옮겨 둔 경우는 GOOD
      let best = -1, bd = Infinity;
      laneMoves.forEach((m, k) => {
        if (usedM.has(k) || !o.safe.includes(m.lane)) return;
        const d = Math.abs(m.t - o.t);
        if (d <= JUDGE.good && d < bd) { bd = d; best = k; }
      });
      // 짝지은 이동 뒤에 다시 막힌 레인으로 돌아갔으면 실패
      const settled = laneAt(o.t + JUDGE.good);
      if (best >= 0 && o.safe.includes(laneAt(Math.max(o.t, laneMoves[best].t)))) {
        usedM.add(best); delta = laneMoves[best].t - o.t; grade = gradeOf(delta);
      } else if (o.safe.includes(laneAt(o.t)) && o.safe.includes(settled)) {
        // 이미 안전한 레인: 직전(1.5초 안)에 미리 옮겨 피했으면 GOOD, 가만히 있다 운 좋게 피한 것은 박자 놓침(MISS, 충돌 없음)
        const early = laneMoves.some((m) => m.t >= o.t - 1500 && m.t < o.t - JUDGE.good);
        if (early) grade = 'good';
        else { events.push({ id: o.id, grade: 'miss', delta: null, pass: true }); counts.miss++; combo = 0; continue; }
      }
    }
    counts[grade]++;
    if (grade === 'miss') combo = 0;
    else { score += Math.round(GRADE_POINTS[grade] * comboMultiplier(combo)); combo++; maxCombo = Math.max(maxCombo, combo); }
    acc += GRADE_ACC[grade];
    events.push({ id: o.id, grade, delta });
  }
  return { events, score, combo, maxCombo, counts, accuracy: events.length ? acc / events.length : 0, jumps, ducks, lanes };
}

/** 코스별 원점수를 0~1000 포인트로 정규화 (서로 다른 코스 점수를 직접 비교하지 않기 위함) */
export const normalizedPoints = (score: number, maxScore: number) => Math.round((Math.min(score, maxScore) / Math.max(1, maxScore)) * 1000);

/** 주간 랭킹 기간: 한국 시간 월요일 00:00 기준 주 번호 */
export function kstWeek(ts: number) {
  const days = Math.floor((ts + 9 * 3600_000) / 86400_000); // 1970-01-01(목) 기준 한국 날짜
  return Math.floor((days + 3) / 7); // 월요일 시작
}
export function kstWeekStart(week: number) { return (week * 7 - 3) * 86400_000 - 9 * 3600_000; }
