// 멍글런너 기록·랭킹 — 클라이언트가 보낸 점수는 쓰지 않고, 입력 기록으로 서버가 판정을 다시 계산한다.
import crypto from 'node:crypto';
import type express from 'express';
import { all, db, one, run } from './db';
import * as repo from './db';
import { requireAuth, type AuthedRequest } from './auth';
import { RateLimiter } from './moderation';
import { earn } from './coins';
import {
  ALL_RANK_KEYS, COURSES, JUDGE, RUNNER_GAME_VERSION, buildChart, isDifficulty, judgeRun, kstWeek, kstWeekStart, normalizedPoints, parseRankKey, rankKey,
  type Chart, type RunnerInput,
} from '../../shared/runner';

db.exec(`
CREATE TABLE IF NOT EXISTS runner_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS runner_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy INTEGER NOT NULL,
  max_combo INTEGER NOT NULL,
  perfect INTEGER NOT NULL, great INTEGER NOT NULL, good INTEGER NOT NULL, miss INTEGER NOT NULL,
  points INTEGER NOT NULL,
  week INTEGER NOT NULL,
  inputs_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runner_runs_course_week ON runner_runs(course, week);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runner_runs_dup ON runner_runs(user_id, course, inputs_hash);
CREATE TABLE IF NOT EXISTS runner_best (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy INTEGER NOT NULL,
  max_combo INTEGER NOT NULL,
  points INTEGER NOT NULL,
  run_id INTEGER NOT NULL,
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, course)
);
`);

/** 랭킹 키(곡 + 난이도)별 장애물 패턴: 'elise'(NORMAL, 기존 기록 그대로) · 'elise.easy' · 'elise.hard' … */
const charts = new Map<string, Chart>();
for (const key of ALL_RANK_KEYS) { const k = parseRankKey(key)!; const ch = buildChart(k.courseId, k.difficulty); if (ch) charts.set(key, ch); }

const me = (req: express.Request) => (req as AuthedRequest).userId;
/** 플레이 시간 검증 배율 (자동 테스트에서만 줄임) */
const TIME_SCALE = Number(process.env.MUNGLE_RUNNER_TIME_SCALE ?? 1);
/** 정렬 기준: 점수 → 정확도 → 최고 콤보 → 먼저 기록 */
const ORDER = 'score DESC, accuracy DESC, max_combo DESC, achieved_at ASC';

interface Best { user_id: number; score: number; accuracy: number; max_combo: number; points: number; achieved_at: number; course?: string }
function entry(r: Best, rank: number) {
  const p = repo.getPublicProfile(r.user_id);
  return {
    rank, userId: r.user_id, nickname: p?.nickname ?? '(알 수 없음)', dogName: p?.dogName ?? '', dogPhoto: p?.dogPhoto ?? null, coat: p?.dog.coat ?? '#e9a05c',
    score: r.score, accuracy: r.accuracy / 10000, maxCombo: r.max_combo, points: r.points, course: r.course ?? null, achievedAt: r.achieved_at,
  };
}
/** 코스 최고 기록 순위 (같은 점수면 정확도·콤보·기록 시각) */
function rankOfBest(course: string, b: Best) {
  return Number(one(`SELECT COUNT(*) n FROM runner_best WHERE course=? AND (score>? OR (score=? AND accuracy>?) OR (score=? AND accuracy=? AND max_combo>?) OR (score=? AND accuracy=? AND max_combo=? AND achieved_at<?))`,
    course, b.score, b.score, b.accuracy, b.score, b.accuracy, b.max_combo, b.score, b.accuracy, b.max_combo, b.achieved_at)?.n ?? 0) + 1;
}
const better = (a: { score: number; accuracy: number; max_combo: number }, b: { score: number; accuracy: number; max_combo: number }) =>
  a.score !== b.score ? a.score > b.score : a.accuracy !== b.accuracy ? a.accuracy > b.accuracy : a.max_combo > b.max_combo;

/** 주간: 그 주에 세운 기록 중 사람별 최고 1개 */
function weeklyRows(course: string, week: number) {
  return all(`SELECT user_id, score, accuracy, max_combo, points, achieved_at FROM (
    SELECT user_id, score, accuracy, max_combo, points, created_at AS achieved_at,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, accuracy DESC, max_combo DESC, created_at ASC) rn
    FROM runner_runs WHERE course=? AND week=?) WHERE rn=1 ORDER BY ${ORDER}`, course, week) as unknown as Best[];
}
/** 전체: 코스별 최고 기록의 정규화 포인트 합 (코스마다 점수 체계가 달라 원점수를 더하지 않음) */
function overallRows() {
  return all(`SELECT user_id, SUM(points) AS points, SUM(points) AS score, 0 AS accuracy, MAX(max_combo) AS max_combo, MAX(achieved_at) AS achieved_at
    FROM runner_best GROUP BY user_id ORDER BY points DESC, achieved_at ASC`) as unknown as Best[];
}

export function runnerTop(course: string, n = 3) {
  return (all(`SELECT * FROM runner_best WHERE course=? ORDER BY ${ORDER} LIMIT ?`, course, n) as unknown as Best[]).map((r, i) => entry(r, i + 1));
}

export interface RunnerDeps { changed: () => void }

export function registerRunner(app: express.Express, deps: RunnerDeps) {
  const startLimiter = new RateLimiter(40, 600_000);

  /** 공식 기록 도전 시작: 서버가 1회용 기록 번호를 준다 (비로그인 둘러보기는 연습만) */
  app.post('/api/runner/start', requireAuth, (req, res) => {
    const uid = me(req);
    const diff = req.body?.difficulty ?? 'normal';
    if (!isDifficulty(diff)) return res.status(400).json({ error: '난이도가 올바르지 않아요.' });
    const course = rankKey(String(req.body?.courseId ?? ''), diff);
    if (!charts.has(course)) return res.status(400).json({ error: '준비되지 않은 코스예요.' });
    if (!startLimiter.allow(String(uid))) return res.status(429).json({ error: '잠시 후 다시 시작해 주세요.' });
    const id = crypto.randomBytes(16).toString('hex');
    run('DELETE FROM runner_sessions WHERE user_id=? AND started_at<?', uid, Date.now() - 6 * 3600_000);
    run('INSERT INTO runner_sessions (id, user_id, course, started_at) VALUES (?,?,?,?)', id, uid, course, Date.now());
    res.json({ runId: id, gameVersion: RUNNER_GAME_VERSION, patternVersion: charts.get(course)!.patternVersion });
  });

  /** 기록 제출: 입력 기록 검증 → 서버 판정으로 점수 계산 → 최고 기록·랭킹 반영 */
  app.post('/api/runner/finish', requireAuth, (req, res) => {
    const uid = me(req);
    const b = req.body ?? {};
    const sess = typeof b.runId === 'string' ? one('SELECT * FROM runner_sessions WHERE id=?', b.runId) : undefined;
    if (!sess || sess.user_id !== uid) return res.status(400).json({ error: '기록 번호가 올바르지 않아요.', code: 'bad_run' });
    if (sess.used) return res.status(409).json({ error: '이미 제출한 기록이에요.', code: 'duplicate' });
    const course = String(sess.course);
    const chart = charts.get(course);
    if (!chart || !isDifficulty(b.difficulty ?? 'normal') || rankKey(String(b.courseId), b.difficulty ?? 'normal') !== course) return res.status(400).json({ error: '코스 정보가 맞지 않아요.' });
    if (b.gameVersion !== RUNNER_GAME_VERSION || b.patternVersion !== chart.patternVersion) {
      return res.status(409).json({ error: '게임이 업데이트되었어요. 새로고침 후 다시 도전해 주세요.', code: 'version' });
    }
    // 입력 기록 형식
    const raw = b.inputs;
    if (!Array.isArray(raw) || raw.length > chart.obstacles.length * 8 + 80) return res.status(400).json({ error: '입력 기록이 올바르지 않아요.' });
    const inputs: RunnerInput[] = [];
    let prev = -Infinity;
    for (const x of raw) {
      if (!x || !Number.isInteger(x.t) || !['L', 'R', 'J', 'D'].includes(x.a)) return res.status(400).json({ error: '입력 기록이 올바르지 않아요.' });
      if (x.t < -1000 || x.t > chart.duration + 1000 || x.t < prev) return res.status(400).json({ error: '입력 기록이 올바르지 않아요.' });
      prev = x.t;
      inputs.push({ t: x.t, a: x.a });
    }
    // 실제 플레이 시간: 곡 길이보다 짧게 끝날 수 없음 (일시정지는 허용, 너무 오래된 기록 번호는 만료)
    const elapsed = Date.now() - Number(sess.started_at);
    if (elapsed < (chart.duration - 2500) * TIME_SCALE) return res.status(400).json({ error: '플레이 시간이 곡 길이보다 짧아요.', code: 'too_fast' });
    if (elapsed > 3 * 3600_000) return res.status(400).json({ error: '기록 번호가 만료되었어요. 다시 도전해 주세요.', code: 'expired' });
    run('UPDATE runner_sessions SET used=1 WHERE id=?', sess.id);

    const r = judgeRun(chart, inputs);
    // 사람이 할 수 없는 정확도(모든 판정이 ±4ms 이내)는 자동 입력으로 보고 거부
    const timed = r.events.filter((e) => e.delta !== null);
    if (timed.length >= 15 && timed.every((e) => Math.abs(e.delta!) <= 4)) return res.status(400).json({ error: '비정상적인 기록이라 저장하지 않았어요.', code: 'suspicious' });
    if (r.score > chart.maxScore || timed.some((e) => Math.abs(e.delta!) > JUDGE.good)) return res.status(400).json({ error: '비정상적인 기록이라 저장하지 않았어요.', code: 'suspicious' });

    const hash = crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
    if (one('SELECT id FROM runner_runs WHERE user_id=? AND course=? AND inputs_hash=?', uid, course, hash)) {
      return res.status(409).json({ error: '같은 플레이 기록이 이미 제출되었어요.', code: 'duplicate' });
    }
    const now = Date.now();
    const acc = Math.round(r.accuracy * 10000);
    const points = normalizedPoints(r.score, chart.maxScore);
    const ins = run(`INSERT INTO runner_runs (user_id, course, score, accuracy, max_combo, perfect, great, good, miss, points, week, inputs_hash, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, uid, course, r.score, acc, r.maxCombo, r.counts.perfect, r.counts.great, r.counts.good, r.counts.miss, points, kstWeek(now), hash, now);
    const old = one('SELECT * FROM runner_best WHERE user_id=? AND course=?', uid, course) as unknown as Best | undefined;
    // 이번 기록 전 순위 (결과 화면의 ▲ 순위 변화 표시용)
    const prevRank = old ? rankOfBest(course, old) : null;
    const cur = { score: r.score, accuracy: acc, max_combo: r.maxCombo };
    const newBest = !old || better(cur, old);
    if (newBest) {
      run(`INSERT INTO runner_best (user_id, course, score, accuracy, max_combo, points, run_id, achieved_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id, course) DO UPDATE SET score=excluded.score, accuracy=excluded.accuracy, max_combo=excluded.max_combo, points=excluded.points, run_id=excluded.run_id, achieved_at=excluded.achieved_at`,
      uid, course, r.score, acc, r.maxCombo, points, Number(ins.lastInsertRowid), now);
      deps.changed();
    }
    const best = one('SELECT * FROM runner_best WHERE user_id=? AND course=?', uid, course) as unknown as Best;
    // 완주 보상: 서버가 검증한 정상 완주만, 하루 3번 (기록 번호마다 1번)
    const coin = earn(uid, 'runner', `run-${sess.id}`);
    res.json({
      coin,
      result: { score: r.score, maxCombo: r.maxCombo, counts: r.counts, accuracy: r.accuracy, points },
      newBest, best: { score: best.score, accuracy: best.accuracy / 10000, maxCombo: best.max_combo, achievedAt: best.achieved_at },
      rank: rankOfBest(course, best), prevRank, total: Number(one('SELECT COUNT(*) n FROM runner_best WHERE course=?', course)?.n ?? 0),
    });
  });

  /**
   * 랭킹: course(코스 전체 기간) · weekly(주간, 월요일 00:00 KST) · friends(친구) · overall(모든 코스 = 코스별 정규화 포인트 합)
   * around=1 이면 '내 순위' 탭: 내 위아래 5명씩
   */
  app.get('/api/runner/ranking', requireAuth, (req, res) => {
    const uid = me(req);
    const scope = String(req.query.scope ?? 'course');
    const course = String(req.query.course ?? 'elise');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    if (scope !== 'overall' && !parseRankKey(course)) return res.status(400).json({ error: '없는 코스예요.' });
    let rows: Best[];
    let week: number | null = null;
    if (scope === 'weekly') {
      week = req.query.week !== undefined ? Number(req.query.week) : kstWeek(Date.now());
      if (!Number.isInteger(week)) return res.status(400).json({ error: '잘못된 요청이에요.' });
      rows = weeklyRows(course, week);
    } else if (scope === 'overall') rows = overallRows();
    else {
      rows = all(`SELECT * FROM runner_best WHERE course=? ORDER BY ${ORDER}`, course) as unknown as Best[];
      if (scope === 'friends') { const ids = new Set([uid, ...repo.friendIds(uid)]); rows = rows.filter((r) => ids.has(r.user_id)); }
    }
    // friends=1: 어느 범위든 나와 친구 기록만 (scope=friends는 코스 친구 랭킹)
    if (req.query.friends === '1' && scope !== 'friends') { const ids = new Set([uid, ...repo.friendIds(uid)]); rows = rows.filter((r) => ids.has(r.user_id)); }
    rows = rows.filter((r) => r.user_id === uid || !repo.eitherBlocked(uid, r.user_id));
    const myIdx = rows.findIndex((r) => r.user_id === uid);
    const around = req.query.around === '1';
    const from = around ? Math.max(0, myIdx - 5) : 0;
    const slice = around ? (myIdx < 0 ? [] : rows.slice(from, myIdx + 6)) : rows.slice(0, limit);
    res.json({
      scope, course, week, weekStart: week !== null ? kstWeekStart(week) : null, total: rows.length,
      entries: slice.map((r, i) => entry({ ...r, course: scope === 'overall' ? undefined : course }, from + i + 1)),
      me: myIdx >= 0 ? entry({ ...rows[myIdx], course: scope === 'overall' ? undefined : course }, myIdx + 1) : null,
    });
  });

  /** 내 코스별 최고 기록 + 순위, 경기장 앞 안내판용 TOP 3 */
  app.get('/api/runner/summary', requireAuth, (req, res) => {
    const uid = me(req);
    const bests = (all('SELECT * FROM runner_best WHERE user_id=?', uid) as unknown as Best[]).map((b) => ({
      course: b.course, score: b.score, accuracy: b.accuracy / 10000, maxCombo: b.max_combo, points: b.points, achievedAt: b.achieved_at, rank: rankOfBest(b.course!, b),
    }));
    res.json({ bests, top: Object.fromEntries([...charts.keys()].map((c) => [c, runnerTop(c, 3)])) });
  });
}
