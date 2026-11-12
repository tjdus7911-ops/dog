// 운영자 관리 (관리자 페이지 /admin 의 서버 쪽)
//  · 모든 API: 로그인 + 운영자 권한을 서버에서 매 요청 검증 (requireAuth → requireAdmin)
//  · 회원: 목록·검색(아이디·닉네임·고유 ID), 상세(가입일·상태·최근 접속·신고·제재 이력), 정지(1·3·7·30일·영구, 사유)·해제
//    운영자 계정은 이 화면으로 정지할 수 없음 (운영자 권한 변경은 deploy/admins.txt 확인 절차로만)
//  · 콘텐츠: 강아지 자랑 글·댓글·산책 모임·방명록·스크린 신청 — 숨김/숨김 해제/삭제(복구 가능)/복구/영구 삭제(삭제된 것만, 별도 확인)
//  · 신고: 상태·처리 사유·처리자 기록, 같은 사람이 같은 대상을 다시 신고해도 처리 전이면 한 건으로
//  · 작업 이력: 모든 운영 작업을 작업자·대상·시각·사유와 함께 저장 (일반 회원에게는 공개하지 않음)
//  · 비밀번호(해시)·로그인 토큰은 어떤 응답에도 넣지 않음
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type express from 'express';
import { all, db, one, run, transaction, type Row } from './db';
import * as repo from './db';
import { requireAdmin, requireAuth, type AuthedRequest } from './auth';
import { sanitize } from './moderation';
import { PERMANENT_BAN, banMessage } from './ban';

// ---------------------------------------------------------------- 데이터 구조 (추가만 — 기존 표·값은 그대로)
const NEW_COLUMNS: [string, string, string][] = [
  ['users', 'last_seen_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'ban_reason', "TEXT NOT NULL DEFAULT ''"],
  ['post_comments', 'hidden', 'INTEGER NOT NULL DEFAULT 0'],
  ['meetups', 'hidden', 'INTEGER NOT NULL DEFAULT 0'],
  ['guestbook', 'hidden', 'INTEGER NOT NULL DEFAULT 0'],
  ['reports', 'handled_by', 'INTEGER'],
  ['reports', 'handled_at', 'INTEGER'],
  ['reports', 'resolution', "TEXT NOT NULL DEFAULT ''"],
];
const hasColumn = (table: string, col: string) => all(`PRAGMA table_info(${table})`).some((c) => c.name === col);
const hasTable = (t: string) => !!one("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", t);

/**
 * 서버를 켤 때 한 번: 필요한 표·열이 없으면 '바꾸기 직전'에 DB 전체를 백업 파일로 떠 두고 추가한다.
 * 백업이 실패하면 구조를 바꾸지 않고 멈춤 → 자동 업데이트가 이전 버전으로 되돌림 (기존 데이터 그대로).
 * 추가만 하므로 예전 버전 프로그램도 이 DB로 그대로 동작한다.
 */
export function migrateAdmin() {
  const missing = NEW_COLUMNS.filter(([t, c]) => hasTable(t) && !hasColumn(t, c));
  const needTables = !hasTable('admin_actions') || !hasTable('admin_claims') || !hasTable('admin_meta');
  if (missing.length || needTables) {
    fs.mkdirSync(repo.BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(repo.BACKUP_DIR, `pre-admin-${stamp}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error('구조 변경 전 백업 실패 — 변경하지 않고 멈춥니다.');
    console.log(`💾 관리자 기능 데이터 구조 추가 전 백업: ${file}`);
  }
  db.exec(`
CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  until INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_type, target_id);
CREATE TABLE IF NOT EXISTS admin_claims (
  user_id INTEGER PRIMARY KEY,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS admin_meta (
  user_id INTEGER PRIMARY KEY,
  super INTEGER NOT NULL DEFAULT 0,
  granted_at INTEGER NOT NULL,
  via TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_screen_image ON screen_items(image);
`);
  for (const [t, c, def] of missing) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
}

// ---------------------------------------------------------------- 공용
const BAN_DAYS = [1, 3, 7, 30] as const;
const me = (req: express.Request) => (req as AuthedRequest).userId;
const reasonOf = (v: unknown) => sanitize(v ?? '', 200) ?? '';
export const isAdminUser = (id: number) => one('SELECT role FROM users WHERE id=?', id)?.role === 'admin';
export function logAction(adminId: number, action: string, targetType: string, targetId: number, reason = '', detail = '', until: number | null = null) {
  run('INSERT INTO admin_actions (admin_id, action, target_type, target_id, reason, detail, until, created_at) VALUES (?,?,?,?,?,?,?,?)',
    adminId, action, targetType, targetId, reason, detail, until, Date.now());
}
export const touchLastSeen = (userId: number) => { try { run('UPDATE users SET last_seen_at=? WHERE id=?', Date.now(), userId); } catch { /* 구조 추가 전 */ } };

// ---------------------------------------------------------------- 운영자 확인 코드 (계정 소유 확인용)
const CLAIM_TTL = 24 * 3600_000;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
/** 로그인한 본인에게만 보여 주는 1회용 코드 (DB에는 해시만 저장, 24시간 유효, 새로 만들면 이전 코드 무효) */
export function createClaimCode(userId: number) {
  const raw = crypto.randomBytes(6).toString('hex').toUpperCase(); // 12자리
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  run('INSERT INTO admin_claims (user_id, code_hash, created_at, used_at) VALUES (?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash, created_at=excluded.created_at, used_at=NULL', userId, sha(code), Date.now());
  return { code, expiresAt: Date.now() + CLAIM_TTL };
}
/** 저장소 목록의 '아이디 + 코드'가 그 계정이 만든 유효한 코드인지 (맞으면 코드를 사용 처리) */
export function useClaimCode(userId: number, code: string) {
  const c = one('SELECT * FROM admin_claims WHERE user_id=?', userId);
  if (!c || c.used_at || Date.now() - Number(c.created_at) > CLAIM_TTL) return false;
  const a = Buffer.from(sha(code.trim().toUpperCase())), b = Buffer.from(String(c.code_hash));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  run('UPDATE admin_claims SET used_at=? WHERE user_id=?', Date.now(), userId);
  return true;
}

// ---------------------------------------------------------------- 승인 전 스크린 사진: 본인·운영자에게만 (서명된 주소)
const SIGN_KEY = crypto.randomBytes(32);
const sign = (url: string, exp: number) => crypto.createHmac('sha256', SIGN_KEY).update(`${url}|${exp}`).digest('hex').slice(0, 32);
/** 승인 전 사진 주소에 1시간짜리 서명을 붙임 (본인·운영자 응답에만 사용) */
export function signedUpload(url: string | null | undefined) {
  if (!url || !url.startsWith('/uploads/')) return url ?? null;
  const exp = Date.now() + 3600_000;
  return `${url}?exp=${exp}&sig=${sign(url, exp)}`;
}
/**
 * /uploads 앞단: 스크린 신청용으로 올린 사진(owns_image)이 아직 승인되지 않았으면(대기·반려·내림·삭제)
 * 올바른 서명이 있을 때만 보여 줌 (주소를 알아도 다른 사람은 볼 수 없음). 그 밖의 사진은 그대로.
 */
export function guardUploads(uploadDir: string): express.RequestHandler {
  return (req, res, next) => {
    const file = path.basename(req.path);
    const url = `/uploads/${file}`;
    const locked = one("SELECT 1 FROM screen_items WHERE image=? AND owns_image=1 AND status<>'approved' LIMIT 1", url);
    if (!locked) return next();
    const exp = Number(req.query.exp), sig = String(req.query.sig ?? '');
    if (!(exp > Date.now()) || sig.length !== 32 || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(url, exp)))) return res.status(404).end();
    res.sendFile(path.join(uploadDir, file), { headers: { 'Cache-Control': 'private, no-store' } }, (e) => { if (e && !res.headersSent) res.status(404).end(); });
  };
}

// ---------------------------------------------------------------- 콘텐츠 종류
type Kind = 'post' | 'comment' | 'meetup' | 'guestbook' | 'screen';
const KINDS: Kind[] = ['post', 'comment', 'meetup', 'guestbook', 'screen'];
const KIND_LABEL: Record<Kind, string> = { post: '강아지 자랑 글', comment: '댓글', meetup: '산책 모임', guestbook: '방명록', screen: '스크린 신청' };
/** 숨김 상태 값 (자랑 글·댓글·모임·방명록): 0 보임 · 1 숨김 · 2 삭제(복구 가능) */
const STATE = { visible: 0, hidden: 1, deleted: 2 } as const;
const TABLE: Record<Exclude<Kind, 'screen'>, { table: string; author: string; text: string }> = {
  post: { table: 'posts', author: 'author_id', text: 'text' },
  comment: { table: 'post_comments', author: 'author_id', text: 'text' },
  meetup: { table: 'meetups', author: 'host_id', text: "title || ' · ' || intro" },
  guestbook: { table: 'guestbook', author: 'author_id', text: 'text' },
};
const nick = (id: number) => (one('SELECT p.nickname, u.username FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=?', id) ?? { nickname: '(탈퇴)', username: '' }) as { nickname: string; username: string };
const stateName = (k: Kind, r: Row) => k === 'screen' ? String(r.status) : r.hidden === 2 ? 'deleted' : r.hidden === 1 ? 'hidden' : 'visible';

function contentView(k: Kind, r: Row) {
  const authorId = Number(k === 'meetup' ? r.host_id : r.author_id);
  const a = nick(authorId);
  const text = k === 'meetup' ? `${r.title}${r.intro ? ` · ${r.intro}` : ''}` : k === 'screen' ? `${r.title}${r.text ? ` · ${r.text}` : ''}` : String(r.text ?? '');
  const image = k === 'post' ? (r.image as string | null) : k === 'screen' ? (r.status === 'approved' ? r.image : signedUpload(r.image)) : null;
  return {
    type: k, typeLabel: KIND_LABEL[k], id: Number(r.id), text, image: image ?? null, createdAt: Number(r.created_at),
    author: { id: authorId, nickname: a.nickname, username: a.username }, state: stateName(k, r),
    extra: k === 'comment' ? { postId: r.post_id } : k === 'guestbook' ? { homeId: r.home_id } : k === 'meetup' ? { startsAt: r.starts_at, status: r.status } : k === 'screen' ? { kind: r.kind, postId: r.post_id ?? null } : {},
    reports: Number(one('SELECT COUNT(*) n FROM reports WHERE target_type=? AND target_ref=?', k, r.id)?.n ?? 0),
  };
}

// ---------------------------------------------------------------- API
export interface AdminDeps {
  online: () => number;
  kick: (userId: number, reason: string) => void;
  screenUpdated: () => void;
  boardUpdated: () => void;
  removeImage: (url: string | null | undefined) => void;
}

export function registerAdmin(app: express.Express, deps: AdminDeps) {
  const A = [requireAuth, requireAdmin] as const;

  // 관리자 페이지 진입 확인 (클라이언트 표시용 — 실제 권한은 각 API에서 다시 검증)
  app.get('/api/admin/me', ...A, (req, res) => {
    const m = one('SELECT super FROM admin_meta WHERE user_id=?', me(req));
    res.json({ ok: true, userId: me(req), super: !!m?.super });
  });

  // ---- 대시보드
  app.get('/api/admin/stats', ...A, (_req, res) => {
    const kstMidnight = (() => { const now = Date.now() + 9 * 3600_000; return now - (now % 86400_000) - 9 * 3600_000; })();
    res.json({
      members: Number(one("SELECT COUNT(*) n FROM users WHERE role<>'guest'")?.n ?? 0),
      todayJoined: Number(one("SELECT COUNT(*) n FROM users WHERE role<>'guest' AND created_at>=?", kstMidnight)?.n ?? 0),
      online: deps.online(),
      openReports: Number(one("SELECT COUNT(*) n FROM reports WHERE status='open'")?.n ?? 0),
      pendingScreen: Number(one("SELECT COUNT(*) n FROM screen_items WHERE status='pending'")?.n ?? 0),
      banned: Number(one('SELECT COUNT(*) n FROM users WHERE banned_until>?', Date.now())?.n ?? 0),
    });
  });

  // ---- 회원
  const userStatus = (u: Row) => u.role === 'admin' ? 'admin' : Number(u.banned_until) >= PERMANENT_BAN ? 'permanent' : Number(u.banned_until) > Date.now() ? 'banned' : u.role === 'guest' ? 'guest' : 'active';
  const userRow = (u: Row) => ({
    id: Number(u.id), username: u.username as string, nickname: (u.nickname as string) ?? '', dogName: (u.dog_name as string) ?? '',
    createdAt: Number(u.created_at), lastSeenAt: Number(u.last_seen_at ?? 0) || null, status: userStatus(u),
    bannedUntil: Number(u.banned_until) > Date.now() ? Number(u.banned_until) : null, banReason: Number(u.banned_until) > Date.now() ? (u.ban_reason as string) : '',
    reportsReceived: Number(one('SELECT COUNT(*) n FROM reports WHERE target_id=?', u.id)?.n ?? 0),
  });
  app.get('/api/admin/users', ...A, (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 30);
    const status = String(req.query.status ?? 'members');
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where: string[] = [];
    const args: unknown[] = [];
    if (status === 'members') where.push("u.role<>'guest'");
    else if (status === 'banned') { where.push('u.banned_until>?'); args.push(Date.now()); }
    else if (status === 'admin') where.push("u.role='admin'");
    else if (status === 'guest') where.push("u.role='guest'");
    if (q) {
      const id = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : -1;
      where.push('(u.id=? OR lower(u.username) LIKE ? OR lower(p.nickname) LIKE ?)');
      const like = `%${q.toLowerCase().replace(/[%_]/g, '')}%`;
      args.push(id, like, like);
    }
    const sql = `SELECT u.id, u.username, u.role, u.created_at, u.banned_until, u.last_seen_at, u.ban_reason, p.nickname, p.dog_name
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.id DESC LIMIT 50 OFFSET ?`;
    const total = Number(one(`SELECT COUNT(*) n FROM users u LEFT JOIN profiles p ON p.user_id=u.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...args)?.n ?? 0);
    res.json({ users: all(sql, ...args, offset).map(userRow), total });
  });
  app.get('/api/admin/users/:id', ...A, (req, res) => {
    const id = Number(req.params.id);
    const u = one(`SELECT u.id, u.username, u.role, u.created_at, u.banned_until, u.last_seen_at, u.ban_reason, p.nickname, p.dog_name
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=?`, id);
    if (!u) return res.status(404).json({ error: '회원을 찾을 수 없어요.' });
    const reports = all(`SELECT r.id, r.reason, r.detail, r.status, r.created_at, r.target_type, r.target_ref, r.resolution, pr.nickname AS reporter
      FROM reports r LEFT JOIN profiles pr ON pr.user_id=r.reporter_id WHERE r.target_id=? ORDER BY r.id DESC LIMIT 50`, id);
    const sanctions = all(`SELECT a.id, a.action, a.reason, a.until, a.created_at, p.nickname AS admin FROM admin_actions a LEFT JOIN profiles p ON p.user_id=a.admin_id
      WHERE a.target_type='user' AND a.target_id=? ORDER BY a.id DESC LIMIT 50`, id);
    const counts = {
      posts: Number(one('SELECT COUNT(*) n FROM posts WHERE author_id=?', id)?.n ?? 0),
      comments: Number(one('SELECT COUNT(*) n FROM post_comments WHERE author_id=?', id)?.n ?? 0),
      meetups: Number(one('SELECT COUNT(*) n FROM meetups WHERE host_id=?', id)?.n ?? 0),
      reportsMade: Number(one('SELECT COUNT(*) n FROM reports WHERE reporter_id=?', id)?.n ?? 0),
    };
    res.json({ user: { ...userRow(u), super: !!one('SELECT super FROM admin_meta WHERE user_id=?', id)?.super }, reports, sanctions, counts });
  });
  function ban(adminId: number, targetId: number, days: number, reason: string) {
    const t = one('SELECT id, role FROM users WHERE id=?', targetId);
    if (!t) return { status: 404, error: '회원을 찾을 수 없어요.' };
    if (t.role === 'admin') return { status: 403, error: '운영자 계정은 정지할 수 없어요. (운영자 권한 변경은 별도 확인 절차로만)' };
    if (targetId === adminId) return { status: 400, error: '내 계정은 정지할 수 없어요.' };
    const until = days === 0 ? PERMANENT_BAN : Date.now() + days * 86400_000;
    transaction(() => {
      run('UPDATE users SET banned_until=?, ban_reason=? WHERE id=?', until, reason, targetId);
      logAction(adminId, days === 0 ? 'ban_permanent' : 'ban', 'user', targetId, reason, days === 0 ? '영구 정지' : `${days}일`, until);
    });
    deps.kick(targetId, banMessage(until, reason)); // 접속 중이면 바로 끊고 안내 (재접속·기존 로그인으로도 못 들어옴)
    return { status: 200, until };
  }
  app.post('/api/admin/users/:id/ban', ...A, (req, res) => {
    const days = Number(req.body?.days);
    const reason = reasonOf(req.body?.reason);
    if (!(BAN_DAYS as readonly number[]).includes(days) && days !== 0) return res.status(400).json({ error: '정지 기간을 골라 주세요.' });
    if (!reason) return res.status(400).json({ error: '제재 사유를 입력해 주세요.' });
    const r = ban(me(req), Number(req.params.id), days, reason);
    if (r.status !== 200) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, until: r.until });
  });
  app.post('/api/admin/users/:id/unban', ...A, (req, res) => {
    const id = Number(req.params.id);
    const t = one('SELECT id, banned_until FROM users WHERE id=?', id);
    if (!t) return res.status(404).json({ error: '회원을 찾을 수 없어요.' });
    const reason = reasonOf(req.body?.reason);
    if (!reason) return res.status(400).json({ error: '해제 사유를 입력해 주세요.' });
    transaction(() => {
      run("UPDATE users SET banned_until=0, ban_reason='' WHERE id=?", id);
      logAction(me(req), 'unban', 'user', id, reason);
    });
    res.json({ ok: true });
  });
  /** 예전 신고 화면의 '24시간/7일 정지·해제' 버튼 (같은 보호·기록 규칙) */
  app.post('/api/admin/ban', ...A, (req, res) => {
    const userId = Number(req.body?.userId);
    const hours = Number(req.body?.hours);
    if (!Number.isInteger(userId) || !(hours >= 0 && hours <= 24 * 365)) return res.status(400).json({ error: '잘못된 요청' });
    if (hours === 0) {
      if (!one('SELECT 1 FROM users WHERE id=?', userId)) return res.status(404).json({ error: '회원을 찾을 수 없어요.' });
      run("UPDATE users SET banned_until=0, ban_reason='' WHERE id=?", userId);
      logAction(me(req), 'unban', 'user', userId, reasonOf(req.body?.reason) || '신고 화면에서 해제');
      return res.json({ ok: true });
    }
    const r = ban(me(req), userId, hours / 24, reasonOf(req.body?.reason) || '신고 처리');
    if (r.status !== 200) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true });
  });

  // ---- 콘텐츠 (게시글·댓글·모임·방명록·스크린 신청)
  app.get('/api/admin/content', ...A, (req, res) => {
    const k = String(req.query.type ?? 'post') as Kind;
    if (!KINDS.includes(k)) return res.status(400).json({ error: '잘못된 종류' });
    const q = String(req.query.q ?? '').trim().slice(0, 40).toLowerCase().replace(/[%_]/g, '');
    const st = String(req.query.state ?? 'all');
    const offset = Math.max(0, Number(req.query.offset) || 0);
    let rows: Row[];
    if (k === 'screen') {
      const states = st === 'all' ? null : st === 'visible' ? ['approved'] : st === 'hidden' ? ['pending', 'rejected', 'hidden'] : st === 'deleted' ? ['deleted'] : [st];
      rows = all(`SELECT s.* FROM screen_items s LEFT JOIN profiles p ON p.user_id=s.author_id LEFT JOIN users u ON u.id=s.author_id
        WHERE s.kind='dog' ${states ? `AND s.status IN (${states.map(() => '?').join(',')})` : ''} ${q ? "AND (lower(s.title||' '||s.text) LIKE ? OR lower(p.nickname) LIKE ? OR lower(u.username) LIKE ?)" : ''}
        ORDER BY s.id DESC LIMIT 50 OFFSET ?`, ...(states ?? []), ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []), offset);
    } else {
      const T = TABLE[k];
      const sv = st === 'all' ? null : STATE[st as keyof typeof STATE];
      rows = all(`SELECT c.* FROM ${T.table} c LEFT JOIN profiles p ON p.user_id=c.${T.author} LEFT JOIN users u ON u.id=c.${T.author}
        WHERE 1=1 ${sv !== null && sv !== undefined ? 'AND c.hidden=?' : ''} ${q ? `AND (lower(${T.text.replace(/\b(title|intro|text)\b/g, 'c.$1')}) LIKE ? OR lower(p.nickname) LIKE ? OR lower(u.username) LIKE ?)` : ''}
        ORDER BY c.id DESC LIMIT 50 OFFSET ?`, ...(sv !== null && sv !== undefined ? [sv] : []), ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []), offset);
    }
    res.json({ items: rows.map((r) => contentView(k, r)) });
  });
  const getContent = (k: Kind, id: number) => one(`SELECT * FROM ${k === 'screen' ? 'screen_items' : TABLE[k].table} WHERE id=?`, id);
  app.get('/api/admin/content/:type/:id', ...A, (req, res) => {
    const k = req.params.type as Kind;
    if (!KINDS.includes(k)) return res.status(400).json({ error: '잘못된 종류' });
    const r = getContent(k, Number(req.params.id));
    if (!r) return res.status(404).json({ error: '찾을 수 없어요.' });
    const history = all(`SELECT a.action, a.reason, a.created_at, p.nickname AS admin FROM admin_actions a LEFT JOIN profiles p ON p.user_id=a.admin_id
      WHERE a.target_type=? AND a.target_id=? ORDER BY a.id DESC LIMIT 30`, k, r.id);
    const reports = all(`SELECT r.id, r.reason, r.detail, r.status, r.created_at, p.nickname AS reporter FROM reports r LEFT JOIN profiles p ON p.user_id=r.reporter_id
      WHERE r.target_type=? AND r.target_ref=? ORDER BY r.id DESC LIMIT 30`, k, r.id);
    const comments = k === 'post' ? Number(one('SELECT COUNT(*) n FROM post_comments WHERE post_id=?', r.id)?.n ?? 0) : undefined;
    res.json({ item: contentView(k, r), history, reports, comments });
  });
  /** 숨김·해제·삭제(복구 가능)·복구·영구 삭제 — 영구 삭제는 먼저 '삭제' 상태여야 하고 confirm:'영구 삭제' 가 필요 */
  app.post('/api/admin/content/:type/:id', ...A, (req, res) => {
    const k = req.params.type as Kind;
    const action = String(req.body?.action ?? '');
    const reason = reasonOf(req.body?.reason);
    if (!KINDS.includes(k) || !['hide', 'unhide', 'delete', 'restore', 'purge'].includes(action)) return res.status(400).json({ error: '잘못된 요청' });
    // 처리 사유는 선택 — 운영 기록에만 남고 작성자에게는 알리지 않음
    const r = getContent(k, Number(req.params.id));
    if (!r) return res.status(404).json({ error: '찾을 수 없어요.' });
    const id = Number(r.id);
    const cur = stateName(k, r);
    if (action === 'purge') {
      if (!(k === 'screen' ? cur === 'deleted' : r.hidden === STATE.deleted)) return res.status(400).json({ error: '먼저 삭제(복구 가능) 상태로 바꾼 뒤 영구 삭제할 수 있어요.' });
      if (req.body?.confirm !== '영구 삭제') return res.status(400).json({ error: "영구 삭제 확인 문구('영구 삭제')가 필요해요." });
      purge(k, r);
      logAction(me(req), 'purge', k, id, reason, contentView(k, r).text.slice(0, 200));
      deps.screenUpdated(); deps.boardUpdated();
      return res.json({ ok: true, state: 'purged' });
    }
    if (k === 'screen') {
      // 스크린: 숨김 = 노출 중단(내림), 삭제 = 복구 가능한 삭제, 복구·숨김 해제 = '승인 대기'로 (바로 노출하지 않고 승인 화면에서 다시 승인)
      const next = action === 'hide' ? 'hidden' : action === 'delete' ? 'deleted' : 'pending';
      if (action === 'unhide' || action === 'restore') { if (cur !== 'deleted' && cur !== 'hidden') return res.status(400).json({ error: '숨김·삭제 상태가 아니에요.' }); }
      run('UPDATE screen_items SET status=?, decided_at=?, decided_by=? WHERE id=?', next, Date.now(), me(req), id);
    } else {
      const next = action === 'hide' ? STATE.hidden : action === 'delete' ? STATE.deleted : STATE.visible;
      if (action === 'unhide' && r.hidden !== STATE.hidden) return res.status(400).json({ error: '숨김 상태가 아니에요.' });
      if (action === 'restore' && r.hidden !== STATE.deleted) return res.status(400).json({ error: '삭제 상태가 아니에요.' });
      run(`UPDATE ${TABLE[k].table} SET hidden=? WHERE id=?`, next, id);
      // 자랑 글을 숨기거나 지우면, 예전에 그 글과 연결된 스크린 항목도 노출 중단
      if (k === 'post' && next !== STATE.visible) run("UPDATE screen_items SET status='hidden' WHERE post_id=? AND status='approved'", id);
    }
    logAction(me(req), action, k, id, reason);
    deps.screenUpdated(); deps.boardUpdated();
    res.json({ ok: true, item: contentView(k, getContent(k, id)!) });
  });
  /** 영구 삭제: 글·관련 댓글·좋아요·저장·연결된 스크린 항목·사진 파일 / 모임: 참가자·채팅·후기. 신고 기록은 처리 내역으로 남김 (내용은 신고 당시 사본) */
  function purge(k: Kind, r: Row) {
    const id = Number(r.id);
    transaction(() => {
      if (k === 'post') {
        for (const t of ['post_comments', 'post_likes', 'post_saves']) run(`DELETE FROM ${t} WHERE post_id=?`, id);
        run('DELETE FROM screen_items WHERE post_id=?', id);
        run('DELETE FROM posts WHERE id=?', id);
      } else if (k === 'meetup') {
        for (const t of ['meetup_members', 'meetup_messages', 'meetup_reviews']) { if (hasTable(t)) run(`DELETE FROM ${t} WHERE meetup_id=?`, id); }
        run('DELETE FROM meetups WHERE id=?', id);
      } else if (k === 'screen') run('DELETE FROM screen_items WHERE id=?', id);
      else run(`DELETE FROM ${TABLE[k].table} WHERE id=?`, id);
      run("UPDATE reports SET status=CASE WHEN status='open' THEN 'resolved' ELSE status END, resolution=CASE WHEN resolution='' THEN '대상 콘텐츠 영구 삭제' ELSE resolution END WHERE target_type=? AND target_ref=?", k, id);
    });
    if (k === 'post') deps.removeImage(r.image);
    if (k === 'screen' && r.owns_image) deps.removeImage(r.image);
  }

  // ---- 신고
  app.get('/api/admin/report-list', ...A, (req, res) => {
    const st = String(req.query.status ?? 'open');
    const rows = all(`SELECT r.*, pr.nickname AS reporter_nickname, pt.nickname AS target_nickname, ut.username AS target_username, ut.banned_until AS target_banned_until, ut.role AS target_role, ph.nickname AS handler
      FROM reports r LEFT JOIN profiles pr ON pr.user_id=r.reporter_id LEFT JOIN profiles pt ON pt.user_id=r.target_id LEFT JOIN users ut ON ut.id=r.target_id
      LEFT JOIN profiles ph ON ph.user_id=r.handled_by ${st === 'all' ? '' : 'WHERE r.status=?'} ORDER BY r.id DESC LIMIT 100`, ...(st === 'all' ? [] : [st]));
    res.json({ reports: rows.map((r) => ({
      id: r.id, reason: r.reason, detail: r.detail, context: r.context, status: r.status, createdAt: r.created_at,
      reporter: r.reporter_nickname, target: { id: r.target_id, nickname: r.target_nickname, username: r.target_username, banned: Number(r.target_banned_until) > Date.now(), admin: r.target_role === 'admin' },
      targetType: r.target_type, targetRef: r.target_ref, resolution: r.resolution, handler: r.handler, handledAt: r.handled_at,
    })) });
  });
  app.post('/api/admin/reports/:id/handle', ...A, (req, res) => {
    const status = String(req.body?.status ?? '');
    if (!['open', 'resolved', 'dismissed'].includes(status)) return res.status(400).json({ error: '잘못된 상태' });
    const resolution = reasonOf(req.body?.resolution);
    if (status !== 'open' && !resolution) return res.status(400).json({ error: '처리 사유를 입력해 주세요.' });
    const r = one('SELECT id FROM reports WHERE id=?', Number(req.params.id));
    if (!r) return res.status(404).json({ error: '신고를 찾을 수 없어요.' });
    run('UPDATE reports SET status=?, resolution=?, handled_by=?, handled_at=? WHERE id=?', status, resolution, me(req), Date.now(), r.id);
    logAction(me(req), `report_${status}`, 'report', Number(r.id), resolution);
    res.json({ ok: true });
  });

  // ---- 작업 이력
  app.get('/api/admin/actions', ...A, (req, res) => {
    const type = String(req.query.type ?? '');
    const target = Number(req.query.target) || 0;
    const rows = all(`SELECT a.*, p.nickname AS admin FROM admin_actions a LEFT JOIN profiles p ON p.user_id=a.admin_id
      WHERE 1=1 ${type ? 'AND a.target_type=?' : ''} ${target ? 'AND a.target_id=?' : ''} ORDER BY a.id DESC LIMIT 200`, ...(type ? [type] : []), ...(target ? [target] : []));
    res.json({ actions: rows.map((a) => ({ id: a.id, admin: a.admin, action: a.action, targetType: a.target_type, targetId: a.target_id, reason: a.reason, detail: a.detail, until: a.until, at: a.created_at })) });
  });

  // ---- 운영자 확인 코드 (로그인한 본인에게만, 회원만)
  app.post('/api/admin-claim', requireAuth, (req, res) => {
    const u = one('SELECT id, username, role FROM users WHERE id=?', me(req));
    if (!u || u.role === 'guest') return res.status(403).json({ error: '회원만 사용할 수 있어요.' });
    const last = Number(one('SELECT created_at FROM admin_claims WHERE user_id=?', u.id)?.created_at ?? 0);
    if (Date.now() - last < 30_000) return res.status(429).json({ error: '잠시 후 다시 만들어 주세요.' });
    const c = createClaimCode(Number(u.id));
    res.json({ code: c.code, expiresAt: c.expiresAt, userId: Number(u.id), username: u.username, isAdmin: u.role === 'admin' });
  });
}
