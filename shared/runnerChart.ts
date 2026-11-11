// 멍글런너 차트(장애물 비트맵) 생성 — 곡의 악보에서 직접 만든다.
//
// 1) 악보의 모든 음 시작 칸을 '박자 후보'로 모은다 (마디 첫 박 > 박 > 반 박 > 16분음표 순으로 강세 점수).
// 2) 난이도마다 쓸 수 있는 박자 단위·최소 간격·연속 동작 수가 다르다.
//    EASY: 주요 박(마디 첫 박·박)만, 간격 ≥ 1.1초, 연속 동작 없음
//    NORMAL: 박 + 셈여림이 센 구간의 반 박, 간격 ≥ 0.43초, 2~3개 연속
//    HARD: 반 박 + 클라이맥스의 16분음표 멜로디, 동작 사이 최소 시간만 지키면 됨, 4~6개 연속
// 3) 동작 종류는 멜로디로 정한다: 크게 올라가는 음·길게 끄는 첫 박 → 점프, 크게 내려가는 음 → 숙이기,
//    한 음씩 오르내림 → 그 방향으로 레인 이동, 같은 음 반복 → 좌우 번갈아 (곡마다 멜로디가 달라 패턴도 다름)
// 4) 모든 동작은 물리 규칙(점프 체공·숙이기 유지·레인 이동·장애물이 몸을 지나가는 시간)을 지켜야만 들어간다.
//    → 실제로 클리어할 수 없는 조합은 만들어지지 않고, validateChart가 한 번 더 검사한다.
import type { Lane, Obstacle, ObstacleKind, RunnerDifficulty, Song } from './runner';
import { DUCK_MS, EARLY_MARGIN_MS, JUMP_MS, overlapWindow } from './runnerPose';

export interface SongMeta { barLen: number; beatLen: number }
type Act = 'J' | 'D' | 'M';

/** 연속 동작 사이 최소 시간 (ms) — [앞 동작][뒤 동작] */
export const MIN_GAP: Record<Act, Record<Act, number>> = {
  // 점프: 착지 전에 다시 점프·숙이기 불가. 공중에서 옆 레인으로 옮기는 것은 가능
  J: { J: JUMP_MS + 40, D: JUMP_MS + 40, M: 200 },
  // 숙이기: 일어서기 시작한 뒤에 점프, 다 일어선 뒤에 다시 숙이기
  D: { J: 380, D: DUCK_MS + 40, M: 200 },
  // 레인 이동: 이동이 거의 끝난 뒤 다음 동작
  M: { J: 200, D: 200, M: 200 },
};

interface Cfg {
  /** 선택할 때 최소 간격 (ms) — 셈여림이 센 구간 / 잔잔한 구간 */
  minGap: number; calmGap: number;
  /** 일반 구간 / 클라이맥스 구간에서 쓸 수 있는 가장 잘게 쪼갠 박 (3 마디 첫 박 · 2 박 · 1 반 박 · 0 16분음표) */
  metric: number; climaxMetric: number;
  /** 연속 동작: 이 간격(ms)보다 가까우면 이어진 동작, 최대 개수, 끝난 뒤 쉬는 시간 */
  chainGap: number; chainCap: number; rest: number;
  /** 8마디마다 마지막 마디는 쉬어 감 */
  phraseRest: boolean;
}
const CFG: Record<RunnerDifficulty, Cfg> = {
  easy: { minGap: 1100, calmGap: 1100, metric: 2, climaxMetric: 2, chainGap: 900, chainCap: 1, rest: 1100, phraseRest: true },
  normal: { minGap: 270, calmGap: 600, metric: 2, climaxMetric: 1, chainGap: 520, chainCap: 3, rest: 900, phraseRest: false },
  hard: { minGap: 200, calmGap: 210, metric: 1, climaxMetric: 0, chainGap: 520, chainCap: 6, rest: 360, phraseRest: false },
};

interface Slot { t: number; bar: number; pos: number; metric: number; mel: number | null; melLen: number; inten: number; climax: boolean }

function slotsOf(song: Song, meta: SongMeta): Slot[] {
  const vels = song.bars.map((b) => b.vel);
  const lo = Math.min(...vels), hi = Math.max(...vels);
  const byKey = new Map<string, { mel: number | null; melLen: number }>();
  for (const n of song.notes) {
    const k = `${n.bar}:${n.pos}`;
    const cur = byKey.get(k) ?? { mel: null, melLen: 0 };
    if (n.hand === 0 && (cur.mel === null || n.midi > cur.mel)) { cur.mel = n.midi; cur.melLen = n.dur; }
    byKey.set(k, cur);
  }
  const half = meta.beatLen / 2;
  const out: Slot[] = [];
  song.bars.forEach((b, bi) => {
    const inten = hi > lo ? (b.vel - lo) / (hi - lo) : 0.5;
    const six = b.len / meta.barLen;
    for (let pos = 0; pos < meta.barLen; pos++) {
      const n = byKey.get(`${bi}:${pos}`);
      const metric = pos === 0 ? 3 : pos % meta.beatLen === 0 ? 2 : (Number.isInteger(half) ? pos % half === 0 : pos % 2 === 0) ? 1 : 0;
      // 실제로 소리가 나는 칸(음 시작)에만 장애물 — 들리는 박자와 판정 박자가 같게
      if (!n) continue;
      out.push({ t: Math.round((b.t + pos * six) * 1000), bar: bi, pos, metric, mel: n?.mel ?? null, melLen: (n?.melLen ?? 0) / (six * meta.beatLen), inten, climax: inten >= 0.8 });
    }
  });
  return out;
}

/** 박자 후보 고르기: 강한 박부터 넣고, 이미 고른 박과 가까우면 뺀다 */
function pick(slots: Slot[], cfg: Cfg, from: number, to: number, firstBar: number): Slot[] {
  const ok = slots.filter((s) => {
    if (s.t < from || s.t > to) return false;
    if (cfg.phraseRest && (s.bar - firstBar) % 8 === 7) return false;
    const need = s.climax ? cfg.climaxMetric : s.inten >= 0.5 ? Math.min(cfg.metric, cfg.climaxMetric + 1) : cfg.metric;
    if (s.metric < need) return false;
    // 약한 박은 멜로디 음이 있을 때만 (반주만 있는 칸에는 장애물을 두지 않음)
    return s.metric >= 2 || s.mel !== null;
  });
  const order = [...ok].sort((a, b) => b.metric - a.metric || b.inten - a.inten || Number(b.mel !== null) - Number(a.mel !== null) || a.t - b.t);
  const chosen: number[] = [];
  const out: Slot[] = [];
  for (const s of order) {
    // 이분 탐색으로 가장 가까운 선택된 박
    let lo = 0, hi = chosen.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (chosen[m] < s.t) lo = m + 1; else hi = m; }
    const near = Math.min(lo < chosen.length ? chosen[lo] - s.t : Infinity, lo > 0 ? s.t - chosen[lo - 1] : Infinity);
    if (near < (s.inten >= 0.5 ? cfg.minGap : cfg.calmGap)) continue;
    chosen.splice(lo, 0, s.t);
    out.push(s);
  }
  return out.sort((a, b) => a.t - b.t);
}

const ALL: Lane[] = [-1, 0, 1];

/** 악보 → 장애물 목록 (곡·난이도마다 결정적으로 같은 결과 → 서버도 같은 차트로 검증) */
export function generateChart(song: Song, meta: SongMeta, difficulty: RunnerDifficulty, speed: number): Omit<Obstacle, 'id'>[] {
  const cfg = CFG[difficulty];
  const slots = slotsOf(song, meta);
  // 전주 마디(멜로디가 시작되기 전)는 비우고, 마지막 마디(끝맺음)와 골인 직전도 비움
  const firstMel = slots.find((s) => s.mel !== null && s.bar > 0)?.bar ?? 1;
  const firstBar = Math.max(1, firstMel);
  const from = Math.max(1600, Math.round(song.bars[firstBar].t * 1000));
  const to = Math.round(song.bars[song.bars.length - 1].t * 1000) - 300;
  const picked = pick(slots, cfg, from, to, firstBar);

  const out: Omit<Obstacle, 'id'>[] = [];
  /** 지금 강아지가 있을 수 있는 레인 (가운데 화분을 피하면 왼쪽·오른쪽 둘 다 가능) */
  let lanes: Lane[] = [0];
  let prevMel: number | null = null;
  let alt: 1 | -1 = 1;
  let chain = 0, capped = false;
  const recent: Act[] = [];
  let potTurn = 0;
  const actOf = (o: Omit<Obstacle, 'id'>): Act => (o.need === 'jump' ? 'J' : o.need === 'duck' ? 'D' : 'M');
  const kindOf: Record<Act, ObstacleKind | null> = { J: 'log', D: 'ribbon', M: null };

  for (const s of picked) {
    const prev = out[out.length - 1];
    const gap = prev ? s.t - prev.t : Infinity;
    // 연속 동작 개수 제한 (끝나면 잠깐 쉼)
    if (gap < cfg.chainGap) { if (chain >= cfg.chainCap) { continue; } }
    else if (capped && gap < cfg.rest) continue;

    // 멜로디로 원하는 동작 정하기
    const leap = s.mel !== null && prevMel !== null ? s.mel - prevMel : 0;
    let want: Act; let dir: 1 | -1;
    if (s.metric === 3 && s.melLen >= 1 && difficulty !== 'hard') want = leap < -4 ? 'D' : 'J';
    else if (leap >= 5) want = 'J';
    else if (leap <= -5) want = 'D';
    // HARD: 마디 첫 박·강한 박은 점프·숙이기로 강세를 살림 (선율이 오르면 점프, 내리면 숙이기)
    else if (difficulty === 'hard' && s.metric >= 2 && (s.metric === 3 || Math.abs(leap) >= 2)) want = leap < 0 || (leap === 0 && s.bar % 2 === 1) ? 'D' : 'J';
    else want = 'M';
    dir = leap > 0 ? 1 : leap < 0 ? -1 : alt;
    if (leap === 0) alt = (alt === 1 ? -1 : 1);
    // NORMAL: 점프·숙이기가 두 번 이어지면 레인 이동을 섞음 (이동 → 점프/숙이기 연계)
    if (difficulty === 'normal' && want !== 'M' && recent.slice(-2).length === 2 && recent.slice(-2).every((a) => a !== 'M')) want = 'M';
    // EASY: 레인 이동을 연달아 두지 않고, 점프·숙이기와 번갈아
    if (difficulty === 'easy' && want === 'M' && recent[recent.length - 1] === 'M') want = leap >= 0 ? 'J' : 'D';
    // 같은 동작이 너무 이어지지 않게 (HARD는 레인 지그재그 4번까지 허용)
    const same = recent.slice(-(difficulty === 'hard' ? 4 : 2));
    if (same.length === (difficulty === 'hard' ? 4 : 2) && same.every((a) => a === want)) want = want === 'J' ? 'D' : want === 'D' ? 'M' : (leap >= 0 ? 'J' : 'D');

    const tryOrder: Act[] = [want, ...(['M', 'J', 'D'] as Act[]).filter((a) => a !== want)];
    let placed: Omit<Obstacle, 'id'> | null = null;
    for (const a of tryOrder) {
      // 앞 동작들과의 최소 시간 (바로 앞뿐 아니라 그 전 점프·숙이기도: 점프 → 이동 → 점프는 착지 후에)
      if (out.slice(-4).some((p) => s.t - p.t < MIN_GAP[actOf(p)][a])) continue;
      // 아직 몸을 지나가고 있는 장애물과 부딪히지 않는지
      const active = out.filter((o) => overlapWindow(o.t, speed, o.kind)[1] > s.t - EARLY_MARGIN_MS);
      if (a === 'J' && active.some((o) => o.kind === 'ribbon')) continue;
      if (a === 'D' && active.some((o) => o.kind === 'log')) continue;
      if (a !== 'M') { placed = { t: s.t, kind: kindOf[a]!, blocked: ALL, safe: [], need: a === 'J' ? 'jump' : 'duck', bar: s.bar, pos: s.pos }; break; }
      // 레인 장애물
      const okLane = (l: Lane) => active.every((o) => o.kind === 'log' || o.kind === 'ribbon' || o.safe.includes(l));
      let cand: { o: Omit<Obstacle, 'id'>; next: Lane[] } | null = null;
      if (lanes.length === 2) {
        // 왼쪽·오른쪽 어디에 있든: 가운데만 열린 울타리
        if (okLane(0)) cand = { o: { t: s.t, kind: 'fence', blocked: [-1, 1], safe: [0], need: 'side', bar: s.bar, pos: s.pos }, next: [0] };
      } else {
        const c = lanes[0];
        let target = (c + dir) as Lane;
        if (target < -1 || target > 1) target = (c - dir) as Lane;
        const usePot = c === 0 ? (difficulty !== 'hard' ? potTurn % 2 === 0 : potTurn % 4 === 0) : (difficulty === 'hard' ? potTurn % 3 === 0 : potTurn % 2 === 0);
        if (usePot && (c === 0 ? okLane(-1) && okLane(1) : okLane(0))) {
          // 화분: 지금 레인만 막힘 (가운데면 좌우 아무 쪽, 가장자리면 가운데로)
          const safe = ALL.filter((x) => x !== c);
          cand = { o: { t: s.t, kind: 'pot', blocked: [c], safe, need: c === 0 ? 'side' : c > 0 ? 'left' : 'right', bar: s.bar, pos: s.pos }, next: c === 0 ? [-1, 1] : [0] };
        } else if (okLane(target)) {
          // 울타리: 한 레인만 열림 → 그 방향으로
          cand = { o: { t: s.t, kind: 'fence', blocked: ALL.filter((x) => x !== target), safe: [target], need: target > c ? 'right' : 'left', bar: s.bar, pos: s.pos }, next: [target] };
        }
      }
      if (cand) { placed = cand.o; lanes = cand.next; potTurn++; break; }
    }
    if (!placed) continue;
    if (gap < cfg.chainGap) { chain++; capped = chain >= cfg.chainCap; }
    else { chain = 1; capped = cfg.chainCap === 1; }
    out.push(placed);
    recent.push(actOf(placed));
    if (s.mel !== null) prevMel = s.mel;
  }
  return out;
}

export interface ChartStats { count: number; perSec: number; minGap: number; medianGap: number; maxChain: number; chains4: number; jump: number; duck: number; lane: number }
/** 차트 비교용 통계 (연속 동작: 간격 < 520ms) */
export function chartStats(obs: { t: number; need: string }[], durationMs: number): ChartStats {
  const gaps = obs.slice(1).map((o, i) => o.t - obs[i].t);
  let run = 1, maxChain = obs.length ? 1 : 0, chains4 = 0;
  gaps.forEach((g, i) => {
    if (g < 520) run++; else { if (run >= 4) chains4++; run = 1; }
    maxChain = Math.max(maxChain, run);
    if (i === gaps.length - 1 && run >= 4) chains4++;
  });
  const sorted = [...gaps].sort((a, b) => a - b);
  return {
    count: obs.length, perSec: Math.round((obs.length / (durationMs / 1000)) * 100) / 100,
    minGap: sorted[0] ?? 0, medianGap: sorted[sorted.length >> 1] ?? 0, maxChain, chains4,
    jump: obs.filter((o) => o.need === 'jump').length, duck: obs.filter((o) => o.need === 'duck').length,
    lane: obs.filter((o) => o.need !== 'jump' && o.need !== 'duck').length,
  };
}
