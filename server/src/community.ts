// 멍글 동네 — 강아지 자랑(게시글·좋아요·댓글·저장·신고) · 산책 모임 · 강아지 모임 · 애견샵 선물
// 모든 데이터는 DB에 저장하고, 권한(작성자·모임장·멤버·운영자)은 서버에서 다시 확인한다.
import type express from 'express';
import { db, one, all, run, type Row } from './db';
import * as repo from './db';
import { requireAdmin, requireAuth, type AuthedRequest } from './auth';
import { filterProfanity, RateLimiter, sanitize } from './moderation';
import {
  CLUB_CATEGORIES, COMMENT_MAX_LEN, ONLINE_REGION, POST_MAX_LEN, SIDO, SIZE_RULES, TEMPER_RULES,
  type AuthorSummary, type ClubCategory, type ClubDetail, type ClubView, type CommentView, type MeetupDetail, type MeetupView, type MemberStatus, type PostView,
} from '../../shared/community';
import { PARKS } from '../../shared/protocol';
import { SHOP_ITEMS } from '../../shared/home';

db.exec(`
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id INTEGER,
  text TEXT NOT NULL,
  image TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(created_at);
CREATE TABLE IF NOT EXISTS post_likes (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS post_saves (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meetups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL, region TEXT NOT NULL, place TEXT NOT NULL, park TEXT,
  starts_at INTEGER NOT NULL, capacity INTEGER NOT NULL,
  size_rule TEXT NOT NULL DEFAULT 'any', temper_rule TEXT NOT NULL DEFAULT 'any', approval TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'open', notified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meetup_members (
  meetup_id INTEGER NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (meetup_id, user_id)
);
CREATE TABLE IF NOT EXISTS meetup_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meetup_id INTEGER NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meetup_reviews (
  meetup_id INTEGER NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL, text TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  PRIMARY KEY (meetup_id, user_id)
);
CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, category TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  official INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS club_members (
  club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', joined_at INTEGER NOT NULL,
  PRIMARY KEY (club_id, user_id)
);
CREATE TABLE IF NOT EXISTS shop_claims (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item TEXT NOT NULL, claimed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item)
);
`);
// 마이그레이션: 동네(지역), 신고 대상 종류, 스크린-게시글 연결
for (const sql of [
  "ALTER TABLE profiles ADD COLUMN region TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE reports ADD COLUMN target_type TEXT NOT NULL DEFAULT 'user'",
  'ALTER TABLE reports ADD COLUMN target_ref INTEGER',
  'ALTER TABLE screen_items ADD COLUMN post_id INTEGER',
]) { try { db.exec(sql); } catch { /* 이미 있음 */ } }
// 기본(공식) 강아지 모임: 크기별 · 믹스견 — 누구나 가입하는 열린 모임
if (!one('SELECT 1 FROM clubs WHERE official = 1')) {
  const now = Date.now();
  for (const [name, cat, intro] of [
    ['소형견 모임', 'size', '말티즈·포메·푸들 등 작은 친구들의 모임'],
    ['중형견 모임', 'size', '시바·코기·비글 등 중형견 보호자 모임'],
    ['대형견 모임', 'size', '리트리버·허스키 등 큰 친구들의 모임'],
    ['믹스견 모임', 'mix', '세상에 하나뿐인 믹스견 자랑 모임'],
  ]) run('INSERT INTO clubs (name, category, intro, owner_id, official, created_at) VALUES (?,?,?,NULL,1,?)', name, cat, intro, now);
}

export interface CommunityDeps {
  saveImage: (dataUrl: unknown) => { url: string } | { error: string };
  removeImage: (url: string | null | undefined) => void;
  notify: (userId: number, event: string, payload: unknown) => void;
  screenUpdated: () => void;
}

function author(id: number): AuthorSummary {
  const p = repo.getPublicProfile(id);
  return p
    ? { id, nickname: p.nickname, dogName: p.dogName, dogPhoto: p.dogPhoto, dogCoat: p.dog.coat, residence: p.residence }
    : { id, nickname: '(알 수 없음)', dogName: '', dogPhoto: null, dogCoat: '#e6b47a', residence: null };
}
const clean = (v: unknown, max: number) => {
  const s = sanitize(v, max);
  return s ? filterProfanity(s).text : null;
};
const me = (req: express.Request) => (req as AuthedRequest).userId;
const isAdmin = (id: number) => repo.findUser(id)?.role === 'admin';

/** 모임은 최소 이만큼 뒤에 시작해야 함 (테스트에서는 환경변수로 줄임) */
const MIN_LEAD_MS = Number(process.env.MUNGLE_MEETUP_MIN_LEAD_MS ?? 10 * 60_000);
const TICK_MS = Number(process.env.MUNGLE_MEETUP_TICK_MS ?? 30_000);

export function registerCommunity(app: express.Express, deps: CommunityDeps) {
  const postLimiter = new RateLimiter(10, 600_000);
  const commentLimiter = new RateLimiter(20, 300_000);
  const meetupLimiter = new RateLimiter(5, 3600_000);
  const chatLimiter = new RateLimiter(20, 60_000);

  // ---------- 동네(지역) 설정 ----------
  app.put('/api/me/region', requireAuth, (req, res) => {
    const sido = String(req.body?.sido ?? '');
    if (!(SIDO as readonly string[]).includes(sido)) return res.status(400).json({ error: '시·도를 골라 주세요.' });
    const dong = sanitize(req.body?.dong ?? '', 12) ?? '';
    const region = dong ? `${sido} ${dong}` : sido;
    run('UPDATE profiles SET region=? WHERE user_id=?', region, me(req));
    res.json({ region });
  });
  app.get('/api/me/region', requireAuth, (req, res) => res.json({ region: (one('SELECT region FROM profiles WHERE user_id=?', me(req))?.region as string) ?? '' }));

  // ======================= 강아지 자랑 =======================
  function postView(r: Row, viewer: number): PostView {
    const s = one('SELECT status FROM screen_items WHERE post_id = ?', r.id);
    return {
      id: r.id, author: author(r.author_id), text: r.text, image: r.image ?? null, ts: r.created_at, clubId: r.club_id ?? null,
      likes: Number(one('SELECT COUNT(*) n FROM post_likes WHERE post_id=?', r.id)?.n ?? 0),
      likedByMe: !!one('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?', r.id, viewer),
      savedByMe: !!one('SELECT 1 FROM post_saves WHERE post_id=? AND user_id=?', r.id, viewer),
      comments: Number(one('SELECT COUNT(*) n FROM post_comments WHERE post_id=?', r.id)?.n ?? 0),
      screen: (s?.status as PostView['screen']) ?? 'none',
      canDelete: r.author_id === viewer || isAdmin(viewer),
    };
  }
  const visiblePost = (id: number, viewer: number) => {
    const r = one('SELECT * FROM posts WHERE id=? AND hidden=0', id);
    if (!r || (r.author_id !== viewer && repo.eitherBlocked(viewer, r.author_id))) return null;
    return r;
  };

  app.get('/api/posts', requireAuth, (req, res) => {
    const viewer = me(req);
    const scope = String(req.query.scope ?? 'all');
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const club = Number(req.query.club) || null;
    let rows: Row[];
    if (scope === 'saved') rows = all(`SELECT p.* FROM posts p JOIN post_saves s ON s.post_id=p.id AND s.user_id=? WHERE p.hidden=0 AND p.id<? ORDER BY p.id DESC LIMIT 30`, viewer, before);
    else if (scope === 'mine') rows = all('SELECT * FROM posts WHERE author_id=? AND hidden=0 AND id<? ORDER BY id DESC LIMIT 30', viewer, before);
    else if (scope === 'user') rows = all('SELECT * FROM posts WHERE author_id=? AND hidden=0 AND club_id IS NULL AND id<? ORDER BY id DESC LIMIT 30', Number(req.query.user), before);
    else if (club) rows = all('SELECT * FROM posts WHERE club_id=? AND hidden=0 AND id<? ORDER BY id DESC LIMIT 30', club, before);
    else rows = all('SELECT * FROM posts WHERE club_id IS NULL AND hidden=0 AND id<? ORDER BY id DESC LIMIT 30', before);
    const posts = rows.filter((r) => r.author_id === viewer || !repo.eitherBlocked(viewer, r.author_id)).map((r) => postView(r, viewer));
    res.json({ posts });
  });

  app.post('/api/posts', requireAuth, (req, res) => {
    const uid = me(req);
    if (!postLimiter.allow(String(uid))) return res.status(429).json({ error: '글을 너무 자주 올리고 있어요. 잠시 후 다시 시도해 주세요.' });
    const text = clean(req.body?.text, POST_MAX_LEN);
    if (!text) return res.status(400).json({ error: '내용을 입력해 주세요.' });
    const clubId = req.body?.clubId ? Number(req.body.clubId) : null;
    if (clubId && !one('SELECT 1 FROM club_members WHERE club_id=? AND user_id=?', clubId, uid)) return res.status(403).json({ error: '모임 멤버만 글을 쓸 수 있어요.' });
    let image: string | null = null;
    if (req.body?.photo) { const r = deps.saveImage(req.body.photo); if ('error' in r) return res.status(400).json({ error: r.error }); image = r.url; }
    if (!clubId && !image) return res.status(400).json({ error: '강아지 사진을 함께 올려 주세요.' });
    const r = run('INSERT INTO posts (author_id, club_id, text, image, created_at) VALUES (?,?,?,?,?)', uid, clubId, text, image, Date.now());
    const id = Number(r.lastInsertRowid);
    // 광장 스크린 공개 동의 → 운영자 승인 대기열로
    if (req.body?.screenConsent === true && image && !clubId) {
      run(`INSERT INTO screen_items (kind, author_id, title, text, image, owns_image, status, created_at, post_id) VALUES ('dog',?,?,?,?,0,'pending',?,?)`,
        uid, Array.from(text).slice(0, 30).join(''), Array.from(text).slice(30, 110).join(''), image, Date.now(), id);
    }
    res.json({ post: postView(one('SELECT * FROM posts WHERE id=?', id)!, uid) });
  });

  app.delete('/api/posts/:id', requireAuth, (req, res) => {
    const uid = me(req);
    const r = one('SELECT * FROM posts WHERE id=?', Number(req.params.id));
    if (!r) return res.status(404).json({ error: '글을 찾을 수 없어요.' });
    if (r.author_id !== uid && !isAdmin(uid)) return res.status(403).json({ error: '작성자만 지울 수 있어요.' });
    run('DELETE FROM screen_items WHERE post_id=?', r.id);
    run('DELETE FROM posts WHERE id=?', r.id);
    deps.removeImage(r.image);
    deps.screenUpdated();
    res.json({ ok: true });
  });

  for (const [path, table] of [['like', 'post_likes'], ['save', 'post_saves']] as const) {
    app.post(`/api/posts/:id/${path}`, requireAuth, (req, res) => {
      const uid = me(req);
      const r = visiblePost(Number(req.params.id), uid);
      if (!r) return res.status(404).json({ error: '글을 찾을 수 없어요.' });
      const has = one(`SELECT 1 FROM ${table} WHERE post_id=? AND user_id=?`, r.id, uid);
      if (has) run(`DELETE FROM ${table} WHERE post_id=? AND user_id=?`, r.id, uid);
      else if (table === 'post_saves') run('INSERT INTO post_saves (post_id, user_id, created_at) VALUES (?,?,?)', r.id, uid, Date.now());
      else run('INSERT INTO post_likes (post_id, user_id) VALUES (?,?)', r.id, uid);
      res.json({ post: postView(r, uid) });
    });
  }

  function commentView(c: Row, viewer: number, postAuthor: number): CommentView {
    return { id: c.id, author: author(c.author_id), text: c.text, ts: c.created_at, canDelete: c.author_id === viewer || postAuthor === viewer || isAdmin(viewer) };
  }
  app.get('/api/posts/:id/comments', requireAuth, (req, res) => {
    const uid = me(req);
    const p = visiblePost(Number(req.params.id), uid);
    if (!p) return res.status(404).json({ error: '글을 찾을 수 없어요.' });
    const rows = all('SELECT * FROM post_comments WHERE post_id=? ORDER BY id LIMIT 200', p.id).filter((c) => c.author_id === uid || !repo.eitherBlocked(uid, c.author_id));
    res.json({ comments: rows.map((c) => commentView(c, uid, p.author_id)) });
  });
  app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
    const uid = me(req);
    const p = visiblePost(Number(req.params.id), uid);
    if (!p) return res.status(404).json({ error: '글을 찾을 수 없어요.' });
    if (!commentLimiter.allow(String(uid))) return res.status(429).json({ error: '댓글을 너무 자주 쓰고 있어요.' });
    const text = clean(req.body?.text, COMMENT_MAX_LEN);
    if (!text) return res.status(400).json({ error: '댓글을 입력해 주세요.' });
    run('INSERT INTO post_comments (post_id, author_id, text, created_at) VALUES (?,?,?,?)', p.id, uid, text, Date.now());
    if (p.author_id !== uid) deps.notify(p.author_id, 'community:notice', { text: `${author(uid).nickname}님이 내 자랑 글에 댓글을 남겼어요` });
    const rows = all('SELECT * FROM post_comments WHERE post_id=? ORDER BY id LIMIT 200', p.id).filter((c) => c.author_id === uid || !repo.eitherBlocked(uid, c.author_id));
    res.json({ comments: rows.map((c) => commentView(c, uid, p.author_id)) });
  });
  app.delete('/api/comments/:id', requireAuth, (req, res) => {
    const uid = me(req);
    const c = one('SELECT c.*, p.author_id AS post_author FROM post_comments c JOIN posts p ON p.id=c.post_id WHERE c.id=?', Number(req.params.id));
    if (!c) return res.status(404).json({ error: '댓글을 찾을 수 없어요.' });
    if (c.author_id !== uid && c.post_author !== uid && !isAdmin(uid)) return res.status(403).json({ error: '지울 수 없는 댓글이에요.' });
    run('DELETE FROM post_comments WHERE id=?', c.id);
    res.json({ ok: true });
  });

  const reportLimiter = new RateLimiter(10, 3600_000);
  app.post('/api/posts/:id/report', requireAuth, (req, res) => {
    const uid = me(req);
    const p = visiblePost(Number(req.params.id), uid);
    if (!p) return res.status(404).json({ error: '글을 찾을 수 없어요.' });
    if (p.author_id === uid) return res.status(400).json({ error: '내 글은 신고할 수 없어요.' });
    if (!reportLimiter.allow(String(uid))) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
    const reason = sanitize(req.body?.reason, 20);
    if (!reason) return res.status(400).json({ error: '신고 사유를 골라 주세요.' });
    run(`INSERT INTO reports (reporter_id, target_id, reason, detail, context, created_at, target_type, target_ref) VALUES (?,?,?,?,?,?,'post',?)`,
      uid, p.author_id, reason, sanitize(req.body?.detail ?? '', 300) ?? '', `[자랑 글 #${p.id}] ${p.text}${p.image ? `\n사진: ${p.image}` : ''}`, Date.now(), p.id);
    res.json({ ok: true });
  });
  // 운영자: 신고된 글 숨기기
  app.post('/api/admin/posts/:id/hide', requireAuth, requireAdmin, (req, res) => {
    run('UPDATE posts SET hidden=1 WHERE id=?', Number(req.params.id));
    run("UPDATE screen_items SET status='hidden' WHERE post_id=?", Number(req.params.id));
    deps.screenUpdated();
    res.json({ ok: true });
  });

  // ======================= 산책 모임 =======================
  const memberStatus = (m: number, u: number): MemberStatus => (one('SELECT status FROM meetup_members WHERE meetup_id=? AND user_id=?', m, u)?.status as MemberStatus) ?? 'none';
  function meetupView(r: Row, viewer: number): MeetupView {
    const cnt = (st: string) => Number(one('SELECT COUNT(*) n FROM meetup_members WHERE meetup_id=? AND status=?', r.id, st)?.n ?? 0);
    const rv = one('SELECT COUNT(*) n, AVG(rating) a FROM meetup_reviews WHERE meetup_id=?', r.id);
    return {
      id: r.id, host: author(r.host_id), title: r.title, intro: r.intro, kind: r.kind, region: r.region, place: r.place, park: r.park ?? null,
      startsAt: r.starts_at, capacity: r.capacity, sizeRule: r.size_rule, temperRule: r.temper_rule, approval: r.approval, status: r.status,
      approvedCount: cnt('approved'), pendingCount: cnt('pending'), myStatus: memberStatus(r.id, viewer), isHost: r.host_id === viewer,
      ended: r.starts_at + 3 * 3600_000 < Date.now(), reviewCount: Number(rv?.n ?? 0), avgRating: rv?.a ? Math.round(rv.a * 10) / 10 : null,
    };
  }
  const getMeetup = (id: number) => one('SELECT * FROM meetups WHERE id=?', id);

  app.get('/api/meetups', requireAuth, (req, res) => {
    const uid = me(req);
    const scope = String(req.query.scope ?? 'upcoming');
    const region = String(req.query.region ?? '');
    const kind = String(req.query.kind ?? '');
    let rows: Row[];
    if (scope === 'mine') rows = all(`SELECT m.* FROM meetups m JOIN meetup_members mm ON mm.meetup_id=m.id AND mm.user_id=? AND mm.status IN ('approved','pending') ORDER BY m.starts_at DESC LIMIT 50`, uid);
    else if (scope === 'past') rows = all("SELECT * FROM meetups WHERE starts_at < ? AND status='open' ORDER BY starts_at DESC LIMIT 30", Date.now());
    else rows = all("SELECT * FROM meetups WHERE starts_at > ? AND status='open' ORDER BY starts_at LIMIT 60", Date.now() - 3600_000);
    rows = rows.filter((r) => (!region || r.region.startsWith(region)) && (!kind || r.kind === kind) && (r.host_id === uid || !repo.eitherBlocked(uid, r.host_id)));
    res.json({ meetups: rows.map((r) => meetupView(r, uid)) });
  });

  app.post('/api/meetups', requireAuth, (req, res) => {
    const uid = me(req);
    const b = req.body ?? {};
    const title = clean(b.title, 30);
    const intro = clean(b.intro ?? '', 300) ?? '';
    const kind = b.kind === 'online' ? 'online' : b.kind === 'offline' ? 'offline' : null;
    const startsAt = Number(b.startsAt);
    const capacity = Number(b.capacity);
    if (!title) return res.status(400).json({ error: '모임 이름을 입력해 주세요.' });
    if (!kind) return res.status(400).json({ error: '온라인/오프라인을 골라 주세요.' });
    if (!Number.isFinite(startsAt) || startsAt < Date.now() + MIN_LEAD_MS || startsAt > Date.now() + 60 * 86400_000) return res.status(400).json({ error: '모임 날짜는 10분 뒤부터 60일 안으로 정해 주세요.' });
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 30) return res.status(400).json({ error: '정원은 2~30명으로 정해 주세요.' });
    if (!SIZE_RULES.some((x) => x.id === b.sizeRule) || !TEMPER_RULES.some((x) => x.id === b.temperRule)) return res.status(400).json({ error: '강아지 조건을 골라 주세요.' });
    let region: string, place: string, park: string | null = null;
    if (kind === 'online') {
      park = PARKS.some((p) => p.id === b.park) ? b.park : PARKS[0].id;
      region = ONLINE_REGION;
      place = `멍글마을 ${PARKS.find((p) => p.id === park)!.name} 분수대`;
    } else {
      const sido = String(b.sido ?? '');
      if (!(SIDO as readonly string[]).includes(sido)) return res.status(400).json({ error: '동네(시·도)를 골라 주세요.' });
      const dong = sanitize(b.dong ?? '', 12) ?? '';
      region = dong ? `${sido} ${dong}` : sido;
      const pl = clean(b.place, 40);
      if (!pl) return res.status(400).json({ error: '모일 장소(공원·산책로 이름 등)를 입력해 주세요.' });
      place = pl;
    }
    const approval = b.approval === 'manual' ? 'manual' : 'auto';
    if (!meetupLimiter.allow(String(uid))) return res.status(429).json({ error: '모임을 너무 많이 만들고 있어요. 잠시 후 다시 시도해 주세요.' });
    const r = run(`INSERT INTO meetups (host_id, title, intro, kind, region, place, park, starts_at, capacity, size_rule, temper_rule, approval, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, uid, title, intro, kind, region, place, park, startsAt, capacity, b.sizeRule, b.temperRule, approval, Date.now());
    const id = Number(r.lastInsertRowid);
    run("INSERT INTO meetup_members (meetup_id, user_id, status, created_at) VALUES (?,?,'approved',?)", id, uid, Date.now());
    res.json({ meetup: meetupView(getMeetup(id)!, uid) });
  });

  function detail(r: Row, viewer: number): MeetupDetail {
    const v = meetupView(r, viewer);
    const showPending = v.isHost;
    const members = all('SELECT * FROM meetup_members WHERE meetup_id=? ORDER BY created_at', r.id)
      .filter((m) => m.status === 'approved' || (showPending && m.status === 'pending') || m.user_id === viewer)
      .filter((m) => m.user_id === viewer || !repo.eitherBlocked(viewer, m.user_id))
      .map((m) => ({ user: author(m.user_id), status: m.status as MemberStatus, isHost: m.user_id === r.host_id }));
    const reviews = all('SELECT * FROM meetup_reviews WHERE meetup_id=? ORDER BY created_at DESC', r.id).map((x) => ({ user: author(x.user_id), rating: x.rating, text: x.text, ts: x.created_at }));
    return { ...v, members, reviews, myReview: reviews.some((x) => x.user.id === viewer) };
  }
  app.get('/api/meetups/:id', requireAuth, (req, res) => {
    const r = getMeetup(Number(req.params.id));
    if (!r || (r.host_id !== me(req) && repo.eitherBlocked(me(req), r.host_id))) return res.status(404).json({ error: '모임을 찾을 수 없어요.' });
    res.json({ meetup: detail(r, me(req)) });
  });

  app.post('/api/meetups/:id/join', requireAuth, (req, res) => {
    const uid = me(req);
    const r = getMeetup(Number(req.params.id));
    if (!r || r.status !== 'open' || repo.eitherBlocked(uid, r.host_id)) return res.status(404).json({ error: '참가할 수 없는 모임이에요.' });
    if (r.starts_at < Date.now()) return res.status(400).json({ error: '이미 시작한 모임이에요.' });
    const st = memberStatus(r.id, uid);
    if (st === 'approved' || st === 'pending') return res.status(400).json({ error: '이미 신청했어요.' });
    if (st === 'rejected') return res.status(403).json({ error: '모임장이 이번 신청을 받지 않았어요.' });
    const dog = repo.getPublicProfile(uid)?.dog;
    if (r.size_rule !== 'any' && dog?.size !== r.size_rule) return res.status(400).json({ error: `이 모임은 ${SIZE_RULES.find((x) => x.id === r.size_rule)?.label} 참가할 수 있어요.` });
    const approved = Number(one("SELECT COUNT(*) n FROM meetup_members WHERE meetup_id=? AND status='approved'", r.id)?.n ?? 0);
    if (approved >= r.capacity) return res.status(400).json({ error: '정원이 가득 찼어요.' });
    const status = r.approval === 'auto' ? 'approved' : 'pending';
    run('INSERT INTO meetup_members (meetup_id, user_id, status, created_at) VALUES (?,?,?,?)', r.id, uid, status, Date.now());
    deps.notify(r.host_id, 'community:notice', { text: status === 'pending' ? `${author(uid).nickname}님이 '${r.title}' 참가를 신청했어요` : `${author(uid).nickname}님이 '${r.title}'에 참가했어요` });
    res.json({ meetup: detail(r, uid) });
  });
  app.post('/api/meetups/:id/leave', requireAuth, (req, res) => {
    const uid = me(req);
    const r = getMeetup(Number(req.params.id));
    if (!r) return res.status(404).json({ error: '모임을 찾을 수 없어요.' });
    if (r.host_id === uid) return res.status(400).json({ error: '모임장은 참가 취소 대신 모임을 취소해 주세요.' });
    run("DELETE FROM meetup_members WHERE meetup_id=? AND user_id=? AND status IN ('approved','pending')", r.id, uid);
    res.json({ meetup: detail(r, uid) });
  });
  app.post('/api/meetups/:id/members/:userId', requireAuth, (req, res) => {
    const uid = me(req);
    const r = getMeetup(Number(req.params.id));
    if (!r || r.host_id !== uid) return res.status(403).json({ error: '모임장만 승인할 수 있어요.' });
    const target = Number(req.params.userId);
    if (memberStatus(r.id, target) !== 'pending') return res.status(400).json({ error: '대기 중인 신청이 아니에요.' });
    const approve = req.body?.approve === true;
    if (approve && Number(one("SELECT COUNT(*) n FROM meetup_members WHERE meetup_id=? AND status='approved'", r.id)?.n ?? 0) >= r.capacity) return res.status(400).json({ error: '정원이 가득 찼어요.' });
    run('UPDATE meetup_members SET status=? WHERE meetup_id=? AND user_id=?', approve ? 'approved' : 'rejected', r.id, target);
    deps.notify(target, 'community:notice', { text: approve ? `'${r.title}' 참가가 승인됐어요! 🐾` : `'${r.title}' 참가 신청이 승인되지 않았어요` });
    res.json({ meetup: detail(r, uid) });
  });
  app.post('/api/meetups/:id/cancel', requireAuth, (req, res) => {
    const uid = me(req);
    const r = getMeetup(Number(req.params.id));
    if (!r || r.host_id !== uid) return res.status(403).json({ error: '모임장만 취소할 수 있어요.' });
    run("UPDATE meetups SET status='cancelled' WHERE id=?", r.id);
    for (const m of all("SELECT user_id FROM meetup_members WHERE meetup_id=? AND status='approved' AND user_id<>?", r.id, uid)) deps.notify(m.user_id, 'community:notice', { text: `'${r.title}' 모임이 취소됐어요` });
    res.json({ meetup: detail(getMeetup(r.id)!, uid) });
  });

  // 모임 전용 채팅: 승인된 참가자만 읽고 쓸 수 있음
  const canChat = (m: number, u: number) => memberStatus(m, u) === 'approved';
  app.get('/api/meetups/:id/messages', requireAuth, (req, res) => {
    const uid = me(req), id = Number(req.params.id);
    if (!getMeetup(id) || !canChat(id, uid)) return res.status(403).json({ error: '참가가 승인된 멤버만 볼 수 있어요.' });
    const rows = all('SELECT * FROM meetup_messages WHERE meetup_id=? ORDER BY id DESC LIMIT 100', id).reverse();
    res.json({ messages: rows.filter((m) => m.user_id === uid || !repo.eitherBlocked(uid, m.user_id)).map((m) => ({ id: m.id, user: author(m.user_id), text: m.text, ts: m.created_at })) });
  });
  app.post('/api/meetups/:id/messages', requireAuth, (req, res) => {
    const uid = me(req), id = Number(req.params.id);
    const r = getMeetup(id);
    if (!r || !canChat(id, uid)) return res.status(403).json({ error: '참가가 승인된 멤버만 대화할 수 있어요.' });
    if (!chatLimiter.allow(String(uid))) return res.status(429).json({ error: '메시지를 너무 빨리 보내고 있어요.' });
    const text = clean(req.body?.text, 200);
    if (!text) return res.status(400).json({ error: '메시지를 입력해 주세요.' });
    const ins = run('INSERT INTO meetup_messages (meetup_id, user_id, text, created_at) VALUES (?,?,?,?)', id, uid, text, Date.now());
    const msg = { id: Number(ins.lastInsertRowid), user: author(uid), text, ts: Date.now() };
    for (const m of all("SELECT user_id FROM meetup_members WHERE meetup_id=? AND status='approved'", id)) {
      if (m.user_id !== uid && !repo.eitherBlocked(m.user_id, uid)) deps.notify(m.user_id, 'meetup:message', { meetupId: id, title: r.title, message: msg });
    }
    res.json({ message: msg });
  });
  app.post('/api/meetups/:id/reviews', requireAuth, (req, res) => {
    const uid = me(req);
    const r = getMeetup(Number(req.params.id));
    if (!r || memberStatus(r.id, uid) !== 'approved') return res.status(403).json({ error: '참가한 멤버만 후기를 쓸 수 있어요.' });
    if (r.starts_at > Date.now()) return res.status(400).json({ error: '모임이 끝난 뒤 후기를 쓸 수 있어요.' });
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: '별점을 골라 주세요.' });
    if (one('SELECT 1 FROM meetup_reviews WHERE meetup_id=? AND user_id=?', r.id, uid)) return res.status(400).json({ error: '이미 후기를 남겼어요.' });
    run('INSERT INTO meetup_reviews (meetup_id, user_id, rating, text, created_at) VALUES (?,?,?,?,?)', r.id, uid, rating, clean(req.body?.text ?? '', 200) ?? '', Date.now());
    res.json({ meetup: detail(r, uid) });
  });

  // 곧 시작하는 모임 알림 (참가자에게 '광장에서 만나요' 안내)
  setInterval(() => {
    const soon = all("SELECT * FROM meetups WHERE status='open' AND notified=0 AND starts_at BETWEEN ? AND ?", Date.now() - 60_000, Date.now() + 10 * 60_000);
    for (const r of soon) {
      run('UPDATE meetups SET notified=1 WHERE id=?', r.id);
      for (const m of all("SELECT user_id FROM meetup_members WHERE meetup_id=? AND status='approved'", r.id)) {
        deps.notify(m.user_id, 'meetup:starting', { meetupId: r.id, title: r.title, kind: r.kind, park: r.park, place: r.place });
      }
    }
  }, TICK_MS).unref();

  // ======================= 강아지 모임 =======================
  function clubView(r: Row, viewer: number): ClubView {
    const mem = one('SELECT role FROM club_members WHERE club_id=? AND user_id=?', r.id, viewer);
    return {
      id: r.id, name: r.name, category: r.category, intro: r.intro, official: !!r.official,
      memberCount: Number(one('SELECT COUNT(*) n FROM club_members WHERE club_id=?', r.id)?.n ?? 0),
      postCount: Number(one('SELECT COUNT(*) n FROM posts WHERE club_id=? AND hidden=0', r.id)?.n ?? 0),
      isMember: !!mem, isOwner: mem?.role === 'owner',
    };
  }
  app.get('/api/clubs', requireAuth, (req, res) => {
    const cat = String(req.query.category ?? '');
    const mine = req.query.scope === 'mine';
    const rows = mine
      ? all('SELECT c.* FROM clubs c JOIN club_members m ON m.club_id=c.id AND m.user_id=? ORDER BY c.official DESC, c.id', me(req))
      : all('SELECT * FROM clubs ORDER BY official DESC, id DESC LIMIT 100').filter((r) => !cat || r.category === cat);
    res.json({ clubs: rows.map((r) => clubView(r, me(req))) });
  });
  app.post('/api/clubs', requireAuth, (req, res) => {
    const uid = me(req);
    const name = clean(req.body?.name, 20);
    const intro = clean(req.body?.intro ?? '', 200) ?? '';
    const category = req.body?.category as ClubCategory;
    if (!name) return res.status(400).json({ error: '모임 이름을 입력해 주세요.' });
    if (!CLUB_CATEGORIES.some((c) => c.id === category)) return res.status(400).json({ error: '모임 종류를 골라 주세요.' });
    if (one('SELECT 1 FROM clubs WHERE name=?', name)) return res.status(409).json({ error: '같은 이름의 모임이 있어요.' });
    if (Number(one('SELECT COUNT(*) n FROM clubs WHERE owner_id=?', uid)?.n ?? 0) >= 3) return res.status(400).json({ error: '모임은 한 사람이 3개까지 만들 수 있어요.' });
    const r = run('INSERT INTO clubs (name, category, intro, owner_id, official, created_at) VALUES (?,?,?,?,0,?)', name, category, intro, uid, Date.now());
    const id = Number(r.lastInsertRowid);
    run("INSERT INTO club_members (club_id, user_id, role, joined_at) VALUES (?,?,'owner',?)", id, uid, Date.now());
    res.json({ club: clubView(one('SELECT * FROM clubs WHERE id=?', id)!, uid) });
  });
  app.get('/api/clubs/:id', requireAuth, (req, res) => {
    const uid = me(req);
    const r = one('SELECT * FROM clubs WHERE id=?', Number(req.params.id));
    if (!r) return res.status(404).json({ error: '모임을 찾을 수 없어요.' });
    const members = all('SELECT * FROM club_members WHERE club_id=? ORDER BY role=\'owner\' DESC, joined_at LIMIT 200', r.id)
      .filter((m) => m.user_id === uid || !repo.eitherBlocked(uid, m.user_id))
      .map((m) => ({ user: author(m.user_id), role: m.role }));
    res.json({ club: { ...clubView(r, uid), members } satisfies ClubDetail });
  });
  app.post('/api/clubs/:id/join', requireAuth, (req, res) => {
    const uid = me(req);
    const r = one('SELECT * FROM clubs WHERE id=?', Number(req.params.id));
    if (!r) return res.status(404).json({ error: '모임을 찾을 수 없어요.' });
    run("INSERT OR IGNORE INTO club_members (club_id, user_id, role, joined_at) VALUES (?,?,'member',?)", r.id, uid, Date.now());
    res.json({ club: clubView(r, uid) });
  });
  app.post('/api/clubs/:id/leave', requireAuth, (req, res) => {
    const uid = me(req);
    const r = one('SELECT * FROM clubs WHERE id=?', Number(req.params.id));
    if (!r) return res.status(404).json({ error: '모임을 찾을 수 없어요.' });
    if (one("SELECT 1 FROM club_members WHERE club_id=? AND user_id=? AND role='owner'", r.id, uid)) return res.status(400).json({ error: '모임장은 탈퇴할 수 없어요.' });
    run('DELETE FROM club_members WHERE club_id=? AND user_id=?', r.id, uid);
    res.json({ club: clubView(r, uid) });
  });

  // ======================= 애견샵: 입주 선물 가구 받기 =======================
  app.get('/api/shop', requireAuth, (req, res) => {
    const claimed = new Set(all('SELECT item FROM shop_claims WHERE user_id=?', me(req)).map((r) => r.item as string));
    res.json({ items: SHOP_ITEMS.map((i) => ({ ...i, claimed: claimed.has(i.id) })) });
  });
  app.post('/api/shop/:item/claim', requireAuth, (req, res) => {
    const uid = me(req);
    const item = SHOP_ITEMS.find((i) => i.id === req.params.item);
    if (!item) return res.status(404).json({ error: '없는 상품이에요.' });
    if (!repo.getResidence(uid)) return res.status(400).json({ error: '아파트에 입주한 뒤 받을 수 있어요.' });
    run('INSERT OR IGNORE INTO shop_claims (user_id, item, claimed_at) VALUES (?,?,?)', uid, item.id, Date.now());
    res.json({ ok: true });
  });
}

/** 집 꾸미기에서 쓸 수 있는 추가 가구 (애견샵에서 받은 것) */
export const claimedItems = (userId: number) => all('SELECT item FROM shop_claims WHERE user_id=?', userId).map((r) => r.item as string);

/** 광장 스크린용: 다가오는 모임 · 인기 자랑 글 */
export function screenExtras() {
  const meetups = all("SELECT * FROM meetups WHERE status='open' AND starts_at > ? ORDER BY starts_at LIMIT 3", Date.now());
  const popular = one(`SELECT s.*, p.nickname, p.dog_name, (SELECT COUNT(*) FROM post_likes l WHERE l.post_id=s.post_id) AS likes
    FROM screen_items s JOIN profiles p ON p.user_id=s.author_id WHERE s.status='approved' AND s.post_id IS NOT NULL
    AND s.created_at > ? ORDER BY likes DESC LIMIT 1`, Date.now() - 7 * 86400_000);
  return { meetups, popular };
}
