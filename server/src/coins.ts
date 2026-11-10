// 멍글 코인 지갑 — 잔액·거래 내역·출석·보상 지급. 모든 금액은 서버에서만 정한다.
// 같은 보상이 두 번 지급되지 않도록 (사용자, 종류, 고유 ID)를 DB UNIQUE로 막는다.
import type express from 'express';
import { all, db, one, run, transaction } from './db';
import * as repo from './db';
import { requireAuth, type AuthedRequest } from './auth';
import {
  COIN_LABEL, COIN_REWARDS, MEETUP_GOAL_S, WALK_GOAL, kstDay, type CoinEarned, type CoinKind, type CoinStatus, type CoinTx, type EarnKind,
} from '../../shared/coins';

db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS coin_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  day TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  balance_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_coin_tx_user ON coin_tx(user_id, id);
CREATE INDEX IF NOT EXISTS idx_coin_tx_day ON coin_tx(user_id, kind, day);
CREATE TABLE IF NOT EXISTS attendance (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  streak INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS residence_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building TEXT NOT NULL,
  unit TEXT NOT NULL,
  moved_in_at INTEGER NOT NULL,
  moved_out_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

/** 테스트에서만: 요청 헤더로 시각을 바꿔 날짜 변경·연속 출석을 검증 (운영에서는 꺼져 있음) */
const TEST_HOOKS = process.env.MUNGLE_TEST_HOOKS === '1';
export const nowOf = (req?: express.Request) => {
  const h = TEST_HOOKS ? Number(req?.headers['x-test-now']) : NaN;
  return Number.isFinite(h) && h > 0 ? h : Date.now();
};
export const testFault = (req: express.Request, name: string) => TEST_HOOKS && req.headers['x-test-fault'] === name;

export class CoinError extends Error {
  constructor(message: string, public code: 'insufficient' | 'duplicate') { super(message); }
}

const isGuest = (userId: number) => repo.findUser(userId)?.role === 'guest';
export const balanceOf = (userId: number) => Number(one('SELECT balance FROM wallets WHERE user_id=?', userId)?.balance ?? 0);

/**
 * 잔액 변경 + 거래 기록 (반드시 트랜잭션 안에서). 같은 (종류, ref)가 이미 있으면 duplicate.
 * 잔액이 모자라면 insufficient (DB CHECK 제약으로도 한 번 더 막음).
 */
export function applyTx(userId: number, amount: number, kind: CoinKind, ref: string, ts: number, memo = ''): { id: number; balance: number } {
  if (!Number.isInteger(amount)) throw new Error('bad amount');
  if (one('SELECT 1 FROM coin_tx WHERE user_id=? AND kind=? AND ref=?', userId, kind, ref)) throw new CoinError('이미 처리된 거래예요.', 'duplicate');
  const cur = balanceOf(userId);
  const next = cur + amount;
  if (next < 0) throw new CoinError(`코인이 ${(-next).toLocaleString('ko-KR')}개 모자라요.`, 'insufficient');
  run(`INSERT INTO wallets (user_id, balance, updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance, updated_at=excluded.updated_at`, userId, next, ts);
  const r = run('INSERT INTO coin_tx (user_id, amount, kind, ref, day, memo, balance_after, created_at) VALUES (?,?,?,?,?,?,?,?)',
    userId, amount, kind, ref, kstDay(ts), memo || COIN_LABEL[kind], next, ts);
  return { id: Number(r.lastInsertRowid), balance: next };
}

const todayCount = (userId: number, kind: CoinKind, day: string) => Number(one('SELECT COUNT(*) n FROM coin_tx WHERE user_id=? AND kind=? AND day=?', userId, kind, day)?.n ?? 0);

// ---------------------------------------------------------------- 실시간 알림 (화면 코인 애니메이션)
let notifier: (userId: number, e: CoinEarned) => void = () => {};
export const setCoinNotifier = (fn: typeof notifier) => { notifier = fn; };

/** 보상 지급: 하루 한도·중복을 서버에서 확인. 지급되면 금액, 아니면 null */
export function earn(userId: number, kind: EarnKind, ref: string, ts = Date.now()): CoinEarned | null {
  return earnAmount(userId, kind, ref, COIN_REWARDS[kind].amount, COIN_REWARDS[kind].label, ts);
}
/**
 * 금액이 정해진 보상 (함께 달리기 순위 보상 등). 하루 횟수 제한은 같은 종류끼리 함께 센다
 * — 멍글런너는 혼자 달리기와 함께 달리기를 합쳐 하루 3번.
 */
export function earnAmount(userId: number, kind: EarnKind, ref: string, amount: number, label: string, ts = Date.now()): CoinEarned | null {
  if (isGuest(userId)) return null;
  const rule = COIN_REWARDS[kind];
  try {
    const r = transaction(() => {
      if (rule.daily && todayCount(userId, kind, kstDay(ts)) >= rule.daily) return null;
      return applyTx(userId, amount, kind, ref, ts, label);
    });
    if (!r) return null;
    const e: CoinEarned = { amount, kind, label, balance: r.balance };
    notifier(userId, e);
    return e;
  } catch (e) {
    if (e instanceof CoinError && e.code === 'duplicate') return null;
    throw e;
  }
}

/** 신규 가입 선물 (계정당 1회 — ref 고정이라 두 번 지급되지 않음) */
export function grantSignup(userId: number) { return earn(userId, 'signup', 'once'); }

// ---------------------------------------------------------------- 출석
/** 출석: 하루 1번 (한국 시간 자정 기준), 7일 연속마다 보너스 */
export function attend(userId: number, ts: number) {
  const day = kstDay(ts);
  return transaction(() => {
    if (one('SELECT 1 FROM attendance WHERE user_id=? AND day=?', userId, day)) return null;
    const prev = one('SELECT streak FROM attendance WHERE user_id=? AND day=?', userId, kstDay(ts - 86400_000));
    const streak = prev ? Number(prev.streak) + 1 : 1;
    run('INSERT INTO attendance (user_id, day, streak, created_at) VALUES (?,?,?,?)', userId, day, streak, ts);
    const got: CoinEarned[] = [];
    const a = applyTx(userId, COIN_REWARDS.attendance.amount, 'attendance', day, ts);
    got.push({ amount: COIN_REWARDS.attendance.amount, kind: 'attendance', label: `출석 ${streak}일째`, balance: a.balance });
    if (streak % 7 === 0) {
      const b = applyTx(userId, COIN_REWARDS.streak7.amount, 'streak7', day, ts);
      got.push({ amount: COIN_REWARDS.streak7.amount, kind: 'streak7', label: `${streak}일 연속 출석 보너스`, balance: b.balance });
    }
    return { streak, got };
  });
}

function txView(r: Record<string, unknown>): CoinTx {
  return { id: Number(r.id), amount: Number(r.amount), kind: r.kind as CoinKind, memo: String(r.memo), balance: Number(r.balance_after), ts: Number(r.created_at) };
}
export function coinStatus(userId: number, ts: number): CoinStatus {
  const today = kstDay(ts);
  const todayRow = one('SELECT streak FROM attendance WHERE user_id=? AND day=?', userId, today);
  const yRow = one('SELECT streak FROM attendance WHERE user_id=? AND day=?', userId, kstDay(ts - 86400_000));
  const streak = todayRow ? Number(todayRow.streak) : yRow ? Number(yRow.streak) : 0;
  // 7일 달력: 이번 주기에서 출석한 날 수 (7일을 채우면 다음 주기로)
  const cycleDone = todayRow ? ((streak - 1) % 7) + 1 : streak % 7;
  const d = (k: 'walk' | 'runner' | 'meetup') => ({ count: todayCount(userId, k, today), max: COIN_REWARDS[k].daily });
  return {
    balance: balanceOf(userId),
    todayEarned: Number(one('SELECT COALESCE(SUM(amount),0) s FROM coin_tx WHERE user_id=? AND day=? AND amount>0', userId, today)?.s ?? 0),
    earned: all('SELECT * FROM coin_tx WHERE user_id=? AND amount>0 ORDER BY id DESC LIMIT 20', userId).map(txView),
    spent: all('SELECT * FROM coin_tx WHERE user_id=? AND amount<0 ORDER BY id DESC LIMIT 20', userId).map(txView),
    attendance: { claimedToday: !!todayRow, streak, cycleDone, today },
    daily: { walk: d('walk'), runner: d('runner'), meetup: d('meetup') },
  };
}

// ---------------------------------------------------------------- 실시간 보상 (산책 · 동네 모임)
const WALK_M = Number(process.env.MUNGLE_WALK_COIN_M ?? WALK_GOAL.meters);
const WALK_S = Number(process.env.MUNGLE_WALK_COIN_S ?? WALK_GOAL.seconds);
const MEETUP_S = Number(process.env.MUNGLE_MEETUP_COIN_S ?? MEETUP_GOAL_S);
const meetupPresence = new Map<string, number>();
export const coinHooks = {
  /** 공원에서 걸은 거리·시간이 목표에 닿으면 산책 완료 보상 (하루 3번). 목표에 닿았으면 true (누적 초기화) */
  walkProgress(userId: number, meters: number, secs: number) {
    if (meters < WALK_M || secs < WALK_S) return false;
    const ts = Date.now();
    const n = todayCount(userId, 'walk', kstDay(ts));
    if (n < COIN_REWARDS.walk.daily) earn(userId, 'walk', `${kstDay(ts)}#${n + 1}`, ts);
    return true;
  },
  /** 온라인 동네 모임: 참가 승인된 멤버가 모임 시간에 모임 공원에 함께 있은 시간 → 5분이 되면 보상 (하루 1번) */
  meetupPresence(userId: number, parkId: string, secs: number) {
    const ts = Date.now();
    const rows = all(`SELECT m.id FROM meetups m WHERE m.status='open' AND m.kind='online' AND m.park=? AND m.starts_at BETWEEN ? AND ?
      AND (m.host_id=? OR EXISTS (SELECT 1 FROM meetup_members x WHERE x.meetup_id=m.id AND x.user_id=? AND x.status='approved'))`,
    parkId, ts - 2 * 3600_000, ts + 10 * 60_000, userId, userId);
    for (const r of rows) {
      const key = `${r.id}:${userId}`;
      const t = (meetupPresence.get(key) ?? 0) + secs;
      meetupPresence.set(key, t);
      if (t >= MEETUP_S) earn(userId, 'meetup', `meetup-${r.id}`, ts);
    }
    if (meetupPresence.size > 5000) meetupPresence.clear();
  },
};

// ---------------------------------------------------------------- 기존 사용자 마이그레이션 (한 번만)
/**
 * 코인 시스템 도입 전 가입자:
 *  - 이미 입주한 사람: 집·호실·가구 그대로, 입주비 소급 차감 없음, 가입 선물 중복 지급 없음 (잔액 0에서 시작)
 *  - 아직 입주하지 않은 사람: 입주비만큼(500) 시작 선물 1회 → 신규 가입자와 같은 조건
 */
function migrate() {
  if (one("SELECT 1 FROM app_meta WHERE key='coins_v1'")) return;
  const ts = Date.now();
  transaction(() => {
    for (const u of all("SELECT id FROM users WHERE role != 'guest'")) {
      const id = Number(u.id);
      if (one('SELECT 1 FROM wallets WHERE user_id=?', id)) continue;
      run('INSERT INTO wallets (user_id, balance, updated_at) VALUES (?,0,?)', id, ts);
      if (!repo.getResidence(id)) applyTx(id, COIN_REWARDS.welcome.amount, 'welcome', 'v1', ts);
    }
    run("INSERT INTO app_meta (key, value) VALUES ('coins_v1', ?)", String(ts));
  });
}
migrate();

// ---------------------------------------------------------------- API
const me = (req: express.Request) => (req as AuthedRequest).userId;
const MEMBER_ERROR = { error: '이 기능은 멍글마을 주민만 이용할 수 있어요.', code: 'members_only' };

export function registerCoins(app: express.Express) {
  app.get('/api/coins', requireAuth, (req, res) => {
    if (isGuest(me(req))) return res.status(403).json(MEMBER_ERROR);
    res.json({ coins: coinStatus(me(req), nowOf(req)) });
  });
  app.post('/api/coins/attendance', requireAuth, (req, res) => {
    const uid = me(req);
    if (isGuest(uid)) return res.status(403).json(MEMBER_ERROR);
    const ts = nowOf(req);
    const r = attend(uid, ts);
    if (!r) return res.status(409).json({ error: '오늘은 이미 출석했어요. 내일 또 만나요!', code: 'already', coins: coinStatus(uid, ts) });
    res.json({ streak: r.streak, got: r.got, coins: coinStatus(uid, ts) });
  });
}
