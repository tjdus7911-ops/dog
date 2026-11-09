// 데이터 저장소 (SQLite, Node 내장 node:sqlite 사용 — 네이티브 빌드 불필요)
// 추후 Supabase(Postgres)로 이전할 때 이 파일의 함수 시그니처만 유지하면 된다.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_DOG, DEFAULT_HUMAN, normalizeDog, normalizeHuman, type DogAvatar, type HumanAvatar } from '../../shared/avatar';
import { DEFAULT_PRIVACY, type FriendStatus, type MyProfile, type PrivacySettings, type PublicProfile } from '../../shared/protocol';

export const DATA_DIR = process.env.MUNGLE_DATA_DIR ?? path.resolve(import.meta.dirname, '../data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.MUNGLE_DB ?? path.join(DATA_DIR, 'mungle.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  banned_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  dog_name TEXT NOT NULL,
  dog_intro TEXT NOT NULL DEFAULT '',
  dog_photo TEXT,
  human TEXT NOT NULL,
  dog TEXT NOT NULL,
  privacy TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friend_requests (
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS friends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_id, to_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, read_at);
`);

type Row = Record<string, any>;
const one = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);

// ---------- users / sessions ----------
export function createUser(username: string, passHash: string, salt: string, nickname: string, dogName: string) {
  const role = (process.env.MUNGLE_ADMINS ?? '').split(',').map((s) => s.trim().toLowerCase()).includes(username.toLowerCase()) ? 'admin' : 'user';
  const r = run('INSERT INTO users (username, pass_hash, salt, role, created_at) VALUES (?,?,?,?,?)', username, passHash, salt, role, Date.now());
  const id = Number(r.lastInsertRowid);
  run('INSERT INTO profiles (user_id, nickname, dog_name, human, dog, privacy) VALUES (?,?,?,?,?,?)',
    id, nickname, dogName, JSON.stringify(DEFAULT_HUMAN), JSON.stringify(DEFAULT_DOG), JSON.stringify(DEFAULT_PRIVACY));
  return id;
}
export const findUserByName = (username: string) => one('SELECT * FROM users WHERE username = ?', username);
export const findUser = (id: number) => one('SELECT * FROM users WHERE id = ?', id);
export const createSession = (tokenHash: string, userId: number, expiresAt: number) =>
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', tokenHash, userId, expiresAt);
export const findSession = (tokenHash: string) =>
  one('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', tokenHash, Date.now());
export const deleteSession = (tokenHash: string) => run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
export const setBan = (userId: number, until: number) => run('UPDATE users SET banned_until = ? WHERE id = ?', until, userId);

// ---------- profiles ----------
function toPublic(r: Row): PublicProfile {
  return {
    id: r.user_id, nickname: r.nickname, dogName: r.dog_name, dogIntro: r.dog_intro, dogPhoto: r.dog_photo ?? null,
    // 이전 버전 데이터도 새 항목 기본값으로 정규화해서 내보냄
    human: normalizeHuman(JSON.parse(r.human)), dog: normalizeDog(JSON.parse(r.dog)),
  };
}
export function getPublicProfile(id: number): PublicProfile | null {
  const r = one('SELECT * FROM profiles WHERE user_id = ?', id);
  return r ? toPublic(r) : null;
}
export function getMyProfile(id: number): MyProfile | null {
  const r = one('SELECT p.*, u.role FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?', id);
  if (!r) return null;
  return { ...toPublic(r), privacy: { ...DEFAULT_PRIVACY, ...JSON.parse(r.privacy) }, role: r.role };
}
export function getPrivacy(id: number): PrivacySettings {
  const r = one('SELECT privacy FROM profiles WHERE user_id = ?', id);
  return r ? { ...DEFAULT_PRIVACY, ...JSON.parse(r.privacy) } : DEFAULT_PRIVACY;
}
export function updateProfile(id: number, p: { nickname: string; dogName: string; dogIntro: string; human: HumanAvatar; dog: DogAvatar }) {
  run('UPDATE profiles SET nickname=?, dog_name=?, dog_intro=?, human=?, dog=? WHERE user_id=?',
    p.nickname, p.dogName, p.dogIntro, JSON.stringify(p.human), JSON.stringify(p.dog), id);
}
export const updatePrivacy = (id: number, p: PrivacySettings) => run('UPDATE profiles SET privacy=? WHERE user_id=?', JSON.stringify(p), id);
export const setDogPhoto = (id: number, file: string | null) => run('UPDATE profiles SET dog_photo=? WHERE user_id=?', file, id);
export const getDogPhoto = (id: number) => (one('SELECT dog_photo FROM profiles WHERE user_id=?', id)?.dog_photo as string | null) ?? null;

// ---------- blocks ----------
export const isBlocked = (blocker: number, blocked: number) => !!one('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?', blocker, blocked);
export const eitherBlocked = (a: number, b: number) => isBlocked(a, b) || isBlocked(b, a);
export function block(blocker: number, blocked: number) {
  run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)', blocker, blocked, Date.now());
  // 차단 시 친구 관계와 대기 중인 신청 정리
  removeFriend(blocker, blocked);
  run('DELETE FROM friend_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)', blocker, blocked, blocked, blocker);
}
export const unblock = (blocker: number, blocked: number) => run('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?', blocker, blocked);
export const blockedIds = (blocker: number) => all('SELECT blocked_id FROM blocks WHERE blocker_id=?', blocker).map((r) => r.blocked_id as number);
/** 나를 차단한 사용자 */
export const blockedByIds = (blocked: number) => all('SELECT blocker_id FROM blocks WHERE blocked_id=?', blocked).map((r) => r.blocker_id as number);

// ---------- friends ----------
export const areFriends = (a: number, b: number) => !!one('SELECT 1 FROM friends WHERE user_id=? AND friend_id=?', a, b);
export const hasRequest = (from: number, to: number) => !!one('SELECT 1 FROM friend_requests WHERE from_id=? AND to_id=?', from, to);

export function friendStatus(me: number, other: number): FriendStatus {
  if (isBlocked(me, other)) return 'blocked';
  if (areFriends(me, other)) return 'friends';
  if (hasRequest(me, other)) return 'outgoing';
  if (hasRequest(other, me)) return 'incoming';
  return 'none';
}
export const addRequest = (from: number, to: number) =>
  run('INSERT OR IGNORE INTO friend_requests (from_id, to_id, created_at) VALUES (?,?,?)', from, to, Date.now());
export const deleteRequest = (from: number, to: number) => run('DELETE FROM friend_requests WHERE from_id=? AND to_id=?', from, to);
export function makeFriends(a: number, b: number) {
  const now = Date.now();
  run('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?,?,?)', a, b, now);
  run('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?,?,?)', b, a, now);
  run('DELETE FROM friend_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)', a, b, b, a);
}
export function removeFriend(a: number, b: number) {
  run('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)', a, b, b, a);
}
export const friendIds = (id: number) => all('SELECT friend_id FROM friends WHERE user_id=? ORDER BY created_at', id).map((r) => r.friend_id as number);
export const incomingRequests = (id: number) => all('SELECT from_id, created_at FROM friend_requests WHERE to_id=? ORDER BY created_at DESC', id);
export const outgoingRequests = (id: number) => all('SELECT to_id FROM friend_requests WHERE from_id=?', id).map((r) => r.to_id as number);

// ---------- direct messages ----------
export function saveMessage(from: number, to: number, text: string) {
  const ts = Date.now();
  const r = run('INSERT INTO messages (from_id, to_id, text, created_at) VALUES (?,?,?,?)', from, to, text, ts);
  return { id: Number(r.lastInsertRowid), from, to, text, ts, read: false };
}
export function history(a: number, b: number, limit = 50) {
  return all(`SELECT * FROM messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY id DESC LIMIT ?`, a, b, b, a, limit)
    .reverse()
    .map((r) => ({ id: r.id, from: r.from_id, to: r.to_id, text: r.text, ts: r.created_at, read: r.read_at != null }));
}
export const markRead = (me: number, other: number) =>
  run('UPDATE messages SET read_at=? WHERE to_id=? AND from_id=? AND read_at IS NULL', Date.now(), me, other);
export function unreadCounts(me: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of all('SELECT from_id, COUNT(*) c FROM messages WHERE to_id=? AND read_at IS NULL GROUP BY from_id', me)) out[r.from_id] = r.c;
  return out;
}

// ---------- reports ----------
export const addReport = (reporter: number, target: number, reason: string, detail: string, context: string) =>
  run('INSERT INTO reports (reporter_id, target_id, reason, detail, context, created_at) VALUES (?,?,?,?,?,?)', reporter, target, reason, detail, context, Date.now());
export const listReports = () => all(`
  SELECT r.*, pr.nickname AS reporter_nickname, pt.nickname AS target_nickname, u.banned_until AS target_banned_until
  FROM reports r JOIN profiles pr ON pr.user_id = r.reporter_id JOIN profiles pt ON pt.user_id = r.target_id
  JOIN users u ON u.id = r.target_id ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 200`);
export const setReportStatus = (id: number, status: string) => run('UPDATE reports SET status=? WHERE id=?', status, id);
