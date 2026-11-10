// 멍글런너 '리듬 페이스' — 판정에 따라 달리는 빠르기가 달라지고, 플레이어마다 실제 달린 거리가 벌어진다.
//
// 중요한 분리: 장애물 판정은 언제나 '음악 시각' 기준(judgeRun)이고, 페이스·거리는 그 판정 결과로만 계산하는
// '경쟁 거리' 표현이다. 그래서 빠르게 달려도 장애물이 빨리 오거나 박자가 어긋나지 않는다.
// 같은 판정 결과 → 같은 거리 (정해진 20ms 격자로 적분) 이므로 서버가 입력 기록만으로 거리를 다시 계산해 검증한다.
// 클라이언트가 보낸 거리 값은 쓰지 않는다.
import { JUDGE, type Chart, type Grade, type JudgeEvent, type RunnerDifficulty } from './runner';

/** 페이스 설정값 (테스트하며 조정) */
export const PACE_CONFIG = {
  /** 적분 간격 (ms) — 서버와 화면이 같은 격자를 써서 같은 거리를 얻음 */
  stepMs: 20,
  /** 판정마다 기본 페이스 변화 */
  gain: { perfect: 0.03, great: 0.018, good: 0, miss: -0.04 } as Record<Grade, number>,
  /** GOOD: 기본 페이스(1.0) 쪽으로 되돌림 — 빨라졌던 만큼의 절반을 잃고, 느려졌던 만큼의 절반을 회복 */
  goodPull: 0.5,
  /** 연속 MISS 추가 감속 (두 번째부터, 최대 3번까지 누적) */
  missStreakExtra: -0.02,
  missStreakCap: 3,
  /** 기본 페이스 범위 (1 = 코스 기본 속도) */
  levelMin: -0.12,
  levelMax: 0.1,
  /** 콤보 보너스: 10콤보마다, 최대 */
  comboBonusPer10: 0.008,
  comboBonusMax: 0.024,
  /** MISS 순간 주춤 (잠깐 느려졌다 회복) */
  dip: -0.3,
  /** 박자만 놓친 경우(부딪히지는 않음)는 주춤이 작음 */
  passDip: -0.12,
  dipTauMs: 550,
  dipMin: -0.45,
  /** 페이스 변화를 부드럽게 (갑자기 빨라지거나 느려지지 않게) */
  smoothTauMs: 500,
  /** 최종 페이스 상·하한 */
  min: 0.72,
  max: 1.18,
  /** 난이도별 변화량 배율 (쉬움은 덜 벌어지고 어려움은 더 벌어짐) */
  scale: { easy: 0.8, normal: 1, hard: 1.2 } as Record<RunnerDifficulty, number>,
  /** 판정이 확정되는 시각(장애물 시각 + GOOD 범위)에 페이스에 반영 — 모두에게 같은 시점 */
  effectDelayMs: JUDGE.good,
};

export interface PaceState { t: number; dist: number; pace: number; level: number; dip: number; combo: number; missStreak: number }

/**
 * 판정 결과 → 페이스·거리 시뮬레이션. advance()를 여러 번 불러도(매 프레임) 한 번에 계산한 것과 결과가 같다.
 * 이미 지나간 시점의 판정이 나중에 바뀌면(다른 사람 입력이 늦게 도착) 처음부터 다시 계산한다.
 */
export class PaceSim {
  private s: PaceState = { t: 0, dist: 0, pace: 1, level: 0, dip: 0, combo: 0, missStreak: 0 };
  private levelSm = 0;
  private applied: string[] = [];
  private readonly k: number;
  constructor(private chart: Chart, private speed: number, difficulty: RunnerDifficulty) { this.k = PACE_CONFIG.scale[difficulty]; }
  get state(): PaceState { return this.s; }

  private reset() { this.s = { t: 0, dist: 0, pace: 1, level: 0, dip: 0, combo: 0, missStreak: 0 }; this.levelSm = 0; this.applied = []; }
  private effectAt(e: JudgeEvent) { return this.chart.obstacles[e.id].t + PACE_CONFIG.effectDelayMs; }
  private apply(e: JudgeEvent) {
    const c = PACE_CONFIG, s = this.s, k = this.k;
    s.level += c.gain[e.grade] * k;
    if (e.grade === 'good') s.level *= 1 - c.goodPull;
    if (e.grade === 'miss') {
      s.missStreak++;
      if (s.missStreak > 1) s.level += c.missStreakExtra * k * Math.min(s.missStreak - 1, c.missStreakCap);
      s.dip = Math.max(c.dipMin, s.dip + (e.pass ? c.passDip : c.dip) * k);
      s.combo = 0;
    } else { s.missStreak = 0; s.combo++; }
    s.level = Math.min(c.levelMax, Math.max(c.levelMin, s.level));
  }

  /** events: 지금까지 확정된 판정 (judgeRun 결과), until: 음악 시각(ms) */
  advance(events: JudgeEvent[], until: number) {
    const c = PACE_CONFIG;
    // 이미 반영한 판정이 바뀌었거나, 지난 시점의 판정이 새로 들어왔으면 처음부터
    const sig = (e: JudgeEvent) => `${e.id}${e.grade}${e.pass ? 'p' : ''}`;
    let rewind = this.applied.length > events.length;
    for (let i = 0; i < this.applied.length && !rewind; i++) if (this.applied[i] !== sig(events[i])) rewind = true;
    if (!rewind && events.length > this.applied.length && this.effectAt(events[this.applied.length]) < this.s.t - c.stepMs) rewind = true;
    if (rewind) this.reset();
    const s = this.s;
    let next = this.applied.length;
    const smooth = 1 - Math.exp(-c.stepMs / c.smoothTauMs), decay = Math.exp(-c.stepMs / c.dipTauMs);
    while (s.t + c.stepMs <= until) {
      while (next < events.length && this.effectAt(events[next]) <= s.t) { this.apply(events[next]); this.applied.push(sig(events[next])); next++; }
      const bonus = Math.min(c.comboBonusMax, Math.floor(s.combo / 10) * c.comboBonusPer10) * this.k;
      this.levelSm += (s.level + bonus - this.levelSm) * smooth;
      s.dip *= decay;
      s.pace = Math.min(c.max, Math.max(c.min, 1 + this.levelSm + s.dip));
      s.dist += this.speed * s.pace * (c.stepMs / 1000);
      s.t += c.stepMs;
    }
    return this;
  }
  /** 격자 사이 시각까지 이어서 본 거리 (화면 보간용, 상태는 바꾸지 않음) */
  distAt(now: number) { return this.s.dist + this.speed * this.s.pace * Math.max(0, now - this.s.t) / 1000; }
}

/** 서버·결과용: 입력 판정 결과로 그 시각의 달린 거리 (m) */
export function paceDistance(chart: Chart, events: JudgeEvent[], until: number, speed: number, difficulty: RunnerDifficulty) {
  return new PaceSim(chart, speed, difficulty).advance(events, until).state.dist;
}
