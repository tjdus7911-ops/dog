import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import * as repo from './db';
import * as persist from './persist';
import { canVisit } from './access';
import { APARTMENT_BUILDINGS, isValidUnit, unitsOf, type UnitInfo } from '../../shared/apartment';
import { FURNITURE, GUESTBOOK_MAX_LEN, HOME_VISIBILITY, PLANS, movedLayout, tierOfBuilding, validateLayout, validateStyle, type HomeTier, type HomeView, type HomeVisibility } from '../../shared/home';
import { CoinError, applyTx, balanceOf, coinStatus, grantSignup, nowOf, registerCoins, setCoinNotifier, testFault } from './coins';
import { all, one, run, transaction } from './db';
import { apartmentFree, getSettings, updateSettings } from './settings';
import { hashPassword, issueToken, requireAdmin, requireAuth, revokeToken, userFromToken, verifyPassword, type AuthedRequest } from './auth';
import { setupRealtime } from './realtime';
import { filterProfanity, RateLimiter, sanitize } from './moderation';
import { AnalysisError, dogAnalyzer, type DogPhoto } from './dogAnalyzer';
import { validateDog, validateHuman } from '../../shared/avatar';
import { DEFAULT_PRIVACY } from '../../shared/protocol';
import { claimedItems, registerCommunity, screenExtras } from './community';
import { ownedPhotoUrls, registerPets, retireDogPhoto } from './pets';
import { registerRunner, runnerTop } from './runner';
import { setupRunnerMulti } from './runnerMulti';
import { COURSES } from '../../shared/runner';

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
app.disable('x-powered-by');
// Render 등 프록시 뒤에 배포될 때 실제 접속자 IP로 가입/로그인 횟수 제한을 적용
if (process.env.RENDER || process.env.MUNGLE_TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '6mb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- 서버 이사: 예전 주소로 들어오면 새 주소로 안내 (MUNGLE_MOVED_TO=https://새주소) ----------
const MOVED_TO = process.env.MUNGLE_MOVED_TO?.trim().replace(/\/+$/, '');
if (MOVED_TO) {
  console.log(`🚚 이사 안내 모드: 모든 접속을 ${MOVED_TO} 로 보냅니다`);
  app.use((req, res) => {
    if (req.method === 'GET' && !/^\/(api|socket\.io)(\/|$)/.test(req.path)) return res.redirect(302, MOVED_TO + req.originalUrl);
    res.status(410).json({ error: `멍글마을 주소가 바뀌었어요: ${MOVED_TO}`, movedTo: MOVED_TO });
  });
}

// ---------- 비회원 둘러보기: 읽기(GET)만 허용하고 쓰기는 회원 전용 ----------
const MEMBER_ERROR = { error: '이 기능은 멍글마을 주민만 이용할 수 있어요.', code: 'members_only' };
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.path.startsWith('/auth/')) return next();
  const h = req.headers.authorization ?? '';
  const u = h.startsWith('Bearer ') ? userFromToken(h.slice(7)) : null;
  if (u && !('banned' in u) && u.role === 'guest') return res.status(403).json(MEMBER_ERROR);
  next();
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.MUNGLE_CORS?.split(',') ?? false }, maxHttpBufferSize: 64 * 1024 });
const rt = setupRealtime(io);
// 멍글런너 함께 달리기 (같은 소켓 서버에 방·입력 중계를 더함)
setupRunnerMulti(io, { notify: (u, e, p) => rt.notify(u, e, p) });

const authLimiter = new RateLimiter(20, 10 * 60_000);
const ip = (req: express.Request) => req.ip ?? 'unknown';

const USERNAME_RE = /^[a-zA-Z0-9_]{4,20}$/;
function cleanName(v: unknown, min: number, max: number) {
  const s = sanitize(v, max);
  if (!s || Array.from(s).length < min) return null;
  if (filterProfanity(s).flagged) return null;
  return s;
}

// ---------- 인증 ----------
app.post('/api/auth/signup', (req, res) => {
  if (!authLimiter.allow(ip(req))) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return res.status(400).json({ error: '아이디는 영문·숫자·_ 4~20자로 입력해 주세요.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) return res.status(400).json({ error: '비밀번호는 8자 이상으로 입력해 주세요.' });
  const nickname = cleanName(req.body.nickname, 2, 12);
  if (!nickname) return res.status(400).json({ error: '닉네임은 2~12자로, 부적절한 표현 없이 입력해 주세요.' });
  const dogName = cleanName(req.body.dogName, 1, 12);
  if (!dogName) return res.status(400).json({ error: '강아지 이름을 1~12자로 입력해 주세요.' });
  if (req.body.agree !== true) return res.status(400).json({ error: '만 14세 이상 확인과 이용약관·개인정보 처리방침 동의가 필요해요.' });
  if (repo.findUserByName(username)) return res.status(409).json({ error: '이미 사용 중인 아이디예요.' });
  const { hash, salt } = hashPassword(password);
  const id = repo.createUser(username, hash, salt, nickname, dogName);
  // 신규 가입 선물 500코인 (계정당 1회) → 1동 원룸 입주비로 사용
  grantSignup(id);
  res.json({ token: issueToken(id), profile: repo.getMyProfile(id) });
});

app.post('/api/auth/login', (req, res) => {
  if (!authLimiter.allow(ip(req))) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
  const { username, password } = req.body ?? {};
  const u = typeof username === 'string' ? repo.findUserByName(username) : undefined;
  if (!u || typeof password !== 'string' || !verifyPassword(password, u.salt, u.pass_hash)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 맞지 않아요.' });
  }
  if (u.banned_until > Date.now()) return res.status(403).json({ error: `이용이 정지된 계정입니다. (${new Date(u.banned_until).toLocaleString('ko-KR')}까지)` });
  res.json({ token: issueToken(u.id), profile: repo.getMyProfile(u.id) });
});

// 둘러보기: 임시 방문자 계정 (하루 뒤 자동 정리)
const guestLimiter = new RateLimiter(10, 3600_000);
app.post('/api/auth/guest', (req, res) => {
  if (!guestLimiter.allow(ip(req))) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
  const { hash, salt } = hashPassword(crypto.randomBytes(24).toString('hex'));
  const id = repo.createGuest(hash, salt);
  res.json({ token: issueToken(id), profile: repo.getMyProfile(id) });
});
setInterval(() => { try { repo.purgeGuests(Date.now() - 24 * 3600_000); } catch { /* 무시 */ } }, 3600_000).unref();

app.post('/api/auth/logout', requireAuth, (req, res) => {
  revokeToken((req as AuthedRequest).token);
  res.json({ ok: true });
});

// ---------- 서비스 정보 (약관·처리방침에 표시할 운영자 정보) ----------
app.get('/api/site', (_req, res) => res.json({
  operator: process.env.MUNGLE_OPERATOR ?? '',
  contact: process.env.MUNGLE_CONTACT ?? '',
  aiAnalysis: dogAnalyzer.available,
}));

// ---------- 회원 탈퇴 ----------
app.delete('/api/me', requireAuth, (req, res) => {
  const id = (req as AuthedRequest).userId;
  const u = repo.findUser(id);
  if (!u || typeof req.body?.password !== 'string' || !verifyPassword(req.body.password, u.salt, u.pass_hash)) {
    return res.status(401).json({ error: '비밀번호가 맞지 않아요.' });
  }
  const photo = repo.getDogPhoto(id);
  rt.kick(id, '회원 탈퇴가 완료되었어요.');
  repo.deleteUser(id);
  if (photo) { fs.rm(path.join(repo.UPLOAD_DIR, path.basename(photo)), { force: true }, () => {}); persist.removeUpload(path.basename(photo)); }
  res.json({ ok: true });
});

// ---------- 내 정보 ----------
app.get('/api/me', requireAuth, (req, res) => res.json({ profile: repo.getMyProfile((req as AuthedRequest).userId) }));

app.put('/api/me/profile', requireAuth, (req, res) => {
  const id = (req as AuthedRequest).userId;
  const nickname = cleanName(req.body?.nickname, 2, 12);
  const dogName = cleanName(req.body?.dogName, 1, 12);
  const dogIntro = sanitize(req.body?.dogIntro ?? '', 80) ?? '';
  const human = validateHuman(req.body?.human);
  const dog = validateDog(req.body?.dog);
  if (!nickname) return res.status(400).json({ error: '닉네임은 2~12자로, 부적절한 표현 없이 입력해 주세요.' });
  if (!dogName) return res.status(400).json({ error: '강아지 이름을 확인해 주세요.' });
  if (!human || !dog) return res.status(400).json({ error: '아바타 설정 값이 올바르지 않아요.' });
  repo.updateProfile(id, { nickname, dogName, dogIntro: filterProfanity(dogIntro).text, human, dog });
  rt.profileChanged(id);
  res.json({ profile: repo.getMyProfile(id) });
});

app.put('/api/me/privacy', requireAuth, (req, res) => {
  const id = (req as AuthedRequest).userId;
  const b = req.body ?? {};
  const p = { ...DEFAULT_PRIVACY };
  for (const k of Object.keys(p) as (keyof typeof p)[]) if (typeof b[k] === 'boolean') p[k] = b[k];
  repo.updatePrivacy(id, p);
  rt.privacyChanged(id);
  res.json({ profile: repo.getMyProfile(id) });
});

// 강아지 사진: data URL로 받아 형식(매직 바이트)과 크기를 검증한 뒤 무작위 파일명으로 저장
const MAGIC: [string, number[]][] = [['png', [0x89, 0x50, 0x4e, 0x47]], ['jpg', [0xff, 0xd8, 0xff]], ['webp', [0x52, 0x49, 0x46, 0x46]]];
/** data URL 이미지를 검증해 저장하고 '/uploads/파일명' 을 돌려준다 */
function saveImage(dataUrl: unknown): { url: string } | { error: string } {
  const m = typeof dataUrl === 'string' ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!m) return { error: 'PNG, JPG, WEBP 사진만 올릴 수 있어요.' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) return { error: '사진은 2MB 이하로 올려 주세요.' };
  const kind = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b));
  if (!kind || (kind[0] === 'webp' && buf.subarray(8, 12).toString() !== 'WEBP')) return { error: '이미지 파일이 아니에요.' };
  const file = `${crypto.randomBytes(16).toString('hex')}.${kind[0]}`;
  fs.writeFileSync(path.join(repo.UPLOAD_DIR, file), buf);
  persist.saveUpload(file, buf);
  return { url: `/uploads/${file}` };
}
function removeImage(url: string | null | undefined) {
  if (!url || !url.startsWith('/uploads/')) return;
  const f = path.basename(url);
  fs.rm(path.join(repo.UPLOAD_DIR, f), { force: true }, () => {});
  persist.removeUpload(f);
}
app.post('/api/me/dog-photo', requireAuth, (req, res) => {
  const id = (req as AuthedRequest).userId;
  const m = typeof req.body?.dataUrl === 'string' ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(req.body.dataUrl) : null;
  if (!m) return res.status(400).json({ error: 'PNG, JPG, WEBP 사진만 올릴 수 있어요.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) return res.status(400).json({ error: '사진은 2MB 이하로 올려 주세요.' });
  const kind = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b));
  if (!kind || (kind[0] === 'webp' && buf.subarray(8, 12).toString() !== 'WEBP')) return res.status(400).json({ error: '이미지 파일이 아니에요.' });
  const file = `${crypto.randomBytes(16).toString('hex')}.${kind[0]}`;
  fs.writeFileSync(path.join(repo.UPLOAD_DIR, file), buf);
  persist.saveUpload(file, buf);
  const old = repo.getDogPhoto(id);
  repo.setDogPhoto(id, `/uploads/${file}`);
  if (old && retireDogPhoto(id, old)) removeImage(old);
  rt.profileChanged(id);
  res.json({ profile: repo.getMyProfile(id) });
});

app.delete('/api/me/dog-photo', requireAuth, (req, res) => {
  const id = (req as AuthedRequest).userId;
  const old = repo.getDogPhoto(id);
  repo.setDogPhoto(id, null);
  if (old && retireDogPhoto(id, old)) removeImage(old);
  rt.profileChanged(id);
  res.json({ profile: repo.getMyProfile(id) });
});

app.use('/uploads', express.static(repo.UPLOAD_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));

app.get('/api/parks', (_req, res) => res.json({ parks: rt.parks() }));

app.get('/api/dog-analysis/status', (_req, res) => res.json({ available: dogAnalyzer.available }));

// AI 강아지 사진 분석: 정면(필수)·측면·전신 최대 3장 → 파츠 값
const aiLimiter = new RateLimiter(10, 3600_000);
app.post('/api/dog-analysis', requireAuth, async (req, res) => {
  const userId = (req as AuthedRequest).userId;
  if (!dogAnalyzer.available) return res.status(503).json({ error: 'AI 분석이 아직 설정되지 않았어요.' });
  const list = Array.isArray(req.body?.photos) ? req.body.photos : [];
  const photos: DogPhoto[] = [];
  const seen = new Set<string>();
  for (const p of list.slice(0, 3)) {
    if (!['front', 'side', 'full'].includes(p?.kind) || seen.has(p.kind)) return res.status(400).json({ error: '사진 구분이 올바르지 않아요.' });
    const m = typeof p.dataUrl === 'string' ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(p.dataUrl) : null;
    if (!m) return res.status(400).json({ error: 'PNG, JPG, WEBP 사진만 분석할 수 있어요.' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1.5 * 1024 * 1024) return res.status(400).json({ error: '사진 한 장은 1.5MB 이하여야 해요.' });
    if (!MAGIC.some(([, sig]) => sig.every((b, i) => buf[i] === b))) return res.status(400).json({ error: '이미지 파일이 아니에요.' });
    seen.add(p.kind);
    photos.push({ kind: p.kind, mediaType: m[1] as DogPhoto['mediaType'], base64: m[2] });
  }
  if (!seen.has('front')) return res.status(400).json({ error: '정면 사진은 꼭 필요해요.' });
  if (!aiLimiter.allow(`ai${userId}`)) return res.status(429).json({ error: 'AI 분석은 1시간에 10번까지 할 수 있어요.' });
  try {
    res.json({ result: await dogAnalyzer.analyze(photos) });
  } catch (e) {
    if (e instanceof AnalysisError) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'AI 분석 중 오류가 발생했어요.' });
  }
});

// ---------- 멍글 아파트 ----------
app.get('/api/apartment', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  const buildings = APARTMENT_BUILDINGS.map((b) => {
    const residents = new Map(repo.listResidents(b.id).map((r) => [r.unit as string, r]));
    const units: UnitInfo[] = unitsOf(b).map(({ unit, floor }) => {
      const r = residents.get(unit);
      const hiddenRes = r && r.user_id !== me && repo.eitherBlocked(me, r.user_id);
      return {
        unit, floor, occupied: !!r,
        resident: r && !hiddenRes ? {
          id: r.user_id, nickname: r.nickname, dogName: r.dog_name, dogCoat: (JSON.parse(r.dog)?.coat as string) ?? '#e6b47a',
          dogPhoto: r.dog_photo ?? null, mine: r.user_id === me,
          visibility: repo.getHome(r.user_id).visibility, neighbor: neighborStatus(me, r.user_id),
        } : null,
      };
    });
    return { ...b, units };
  });
  res.json({ buildings, mine: repo.getResidence(me), freeAccess: apartmentFree() });
});

/** 이사 선물 가구 (2동 사람 침대 · 3동 놀이방 시설) — 그 동에 처음 살게 될 때. 이미 받은 것은 그대로 */
function grantMoveGifts(me: number, tier: HomeTier, ts: number) {
  const gifts = FURNITURE.filter((f) => f.gift === tier).map((f) => f.id);
  if (tier >= 2 && !gifts.includes('bed_cream')) gifts.push('bed_cream');
  for (const g of gifts) run('INSERT OR IGNORE INTO shop_claims (user_id, item, claimed_at) VALUES (?,?,?)', me, g, ts);
}

/**
 * 첫 입주. 잔액 확인 · 코인 차감 · 호실 저장을 한 트랜잭션으로.
 *  · 유료(기본): 원룸 500 · 투룸 1,000 · 쓰리룸 1,500코인 — 고른 집 종류의 입주비 (shared/home PLANS)
 *  · 무료 이용(운영 설정 apartmentFreeAccess): 코인 차감 없음
 *  · 중복 결제 방지: 입주비 기록의 ref가 'first'로 고정(계정당 1번) + 이미 입주했으면 거부 + 호실 UNIQUE
 */
app.post('/api/apartment/move-in', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  const building = String(req.body?.building ?? '');
  const unit = String(req.body?.unit ?? '');
  const free = apartmentFree();
  if (!isValidUnit(building, unit)) return res.status(400).json({ error: '존재하지 않는 호실이에요.' });
  const tier = tierOfBuilding(building);
  const price = free ? 0 : PLANS[tier].price;
  if (repo.getResidence(me)) return res.status(409).json({ error: '이미 입주한 집이 있어요.' });
  const bal = balanceOf(me);
  if (bal < price) return res.status(400).json({ error: `입주까지 ${(price - bal).toLocaleString('ko-KR')}코인 남았어요! 출석과 산책으로 코인을 모아 보세요.`, code: 'insufficient', need: price - bal });
  try {
    transaction(() => {
      const r = repo.moveIn(me, building, unit);
      if (!r.ok) throw new MoveError(r.reason === 'already' ? '이미 입주한 집이 있어요.' : '방금 다른 주민이 입주한 호실이에요. 다른 호실을 골라 주세요.', 409);
      if (price > 0) applyTx(me, -price, 'movein', 'first', Date.now(), `${PLANS[tier].name} ${unit}호 입주`);
      if (tier > 1) grantMoveGifts(me, tier, Date.now());
      // 예전에 살던 기록이 있으면(다시 입주) 가구는 보관함에 그대로 — 새집 기본 배치만
      const prev = rawLayout(me);
      repo.saveHome(me, { layout: prev ? movedLayout(prev, tier) : PLANS[tier].defaultLayout.map((i) => ({ ...i })) });
    });
  } catch (e) {
    if (e instanceof MoveError) return res.status(e.status).json({ error: e.message });
    if (e instanceof CoinError) return res.status(e.code === 'duplicate' ? 409 : 400).json({ error: e.code === 'duplicate' ? '이미 입주 처리되었어요.' : e.message });
    throw e;
  }
  rt.profileChanged(me);
  res.json({ profile: repo.getMyProfile(me), coins: coinStatus(me, Date.now()) });
});

class MoveError extends Error { constructor(message: string, public status: number, public code = '') { super(message); } }
/** 이사 가능한 다음 등급 (1동 → 2동 → 3동 순서, 건너뛰기·되돌아가기 없음) */
const nextTier = (cur: HomeTier): HomeTier | null => (cur < 3 ? ((cur + 1) as HomeTier) : null);

/** 이사 선택 화면 정보: 등급별 가격·특징 · 지금 사는 곳 · 이사 가능 여부 · 남은 빈 호실 수 */
app.get('/api/apartment/plans', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  const resi = repo.getResidence(me);
  const cur = resi ? tierOfBuilding(resi.building) : null;
  const bal = balanceOf(me);
  const lived = new Set(all('SELECT building FROM residence_history WHERE user_id=?', me).map((r) => tierOfBuilding(r.building as string)));
  const freeAccess = apartmentFree();
  res.json({
    balance: bal, current: cur, residence: resi, freeAccess,
    plans: ([1, 2, 3] as HomeTier[]).map((t) => {
      const p = PLANS[t];
      const b = APARTMENT_BUILDINGS.find((x) => x.id === p.building)!;
      const free = unitsOf(b).length - repo.listResidents(b.id).length;
      // 무료 이용: 지금 사는 동만 빼고 모두 이사 가능 (순서·되돌아가기·횟수 제한 없음)
      const status = cur === t ? 'current' : freeAccess ? (free <= 0 ? 'full' : 'available')
        : lived.has(t) || (cur !== null && t < cur) ? 'past'
        : cur === null ? (free <= 0 ? 'full' : bal >= p.price ? 'available' : 'insufficient') : nextTier(cur) === t ? (free <= 0 ? 'full' : bal >= p.price ? 'available' : 'insufficient') : 'locked';
      return { tier: t, building: p.building, name: p.name, type: p.type, rooms: p.rooms, price: p.price, features: p.features, capacity: p.capacity, free, status, need: freeAccess ? 0 : Math.max(0, p.price - bal) };
    }),
  });
});

/**
 * 이사: 다음 등급 동으로만. 코인 차감 · 옛 호실 반환 · 새 호실 배정 · 새집 기본 배치를 한 트랜잭션으로 처리.
 * requestId로 같은 요청이 두 번 와도 한 번만 결제된다 (중복 클릭 방지).
 */
app.post('/api/apartment/move', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  const building = String(req.body?.building ?? '');
  const requestId = String(req.body?.requestId ?? '');
  if (!/^[\w-]{8,64}$/.test(requestId)) return res.status(400).json({ error: '잘못된 요청이에요.' });
  const target = APARTMENT_BUILDINGS.find((b) => b.id === building);
  if (!target) return res.status(400).json({ error: '존재하지 않는 동이에요.' });
  const tier = tierOfBuilding(building);
  const plan = PLANS[tier];
  const ts = nowOf(req);
  const freeAccess = apartmentFree();
  let result: { unit: string; balance: number; prev: { building: string; unit: string } };
  try {
    result = transaction(() => {
      // 같은 요청 번호로 이미 이사했다면 결과만 돌려줌 (중복 클릭 방지)
      if (one("SELECT 1 FROM coin_tx WHERE user_id=? AND kind='move' AND ref=?", me, requestId) || one('SELECT 1 FROM move_requests WHERE user_id=? AND ref=?', me, requestId)) throw new MoveError('이미 처리된 이사예요.', 409, 'duplicate');
      const cur = repo.getResidence(me);
      if (!cur) throw new MoveError('먼저 입주할 집을 골라 주세요.', 400, 'no_home');
      const curTier = tierOfBuilding(cur.building);
      if (curTier === tier) throw new MoveError('지금 살고 있는 동이에요.', 409, 'same');
      if (!freeAccess) {
        if (tier < curTier) throw new MoveError('이미 거쳐 온 동으로는 돌아갈 수 없어요.', 400, 'order');
        if (nextTier(curTier) !== tier) throw new MoveError(`${PLANS[nextTier(curTier)!].name}으로 먼저 이사해 주세요.`, 400, 'order');
        const bal = balanceOf(me);
        if (bal < plan.price) throw new MoveError(`이사까지 ${(plan.price - bal).toLocaleString('ko-KR')}코인 남았어요! 산책과 멍글런너를 즐기며 코인을 모아보세요.`, 400, 'insufficient');
      }
      // 새 호실: 비어 있는 가장 낮은 층·번호 (DB UNIQUE로 중복 배정 차단)
      const taken = new Set(repo.listResidents(target.id).map((r) => r.unit as string));
      const free = [...unitsOf(target)].sort((x, y) => x.floor - y.floor || x.n - y.n).find((u) => !taken.has(u.unit));
      if (!free) throw new MoveError(`${plan.name}에 빈 집이 없어요. 잠시 후 다시 시도해 주세요.`, 409, 'full');
      const prevRow = one('SELECT moved_in_at FROM residences WHERE user_id=?', me);
      // 옛집 반환 → 이력 기록 → 새집 입주
      run('INSERT INTO residence_history (user_id, building, unit, moved_in_at, moved_out_at) VALUES (?,?,?,?,?)', me, cur.building, cur.unit, Number(prevRow?.moved_in_at ?? ts), ts);
      run('DELETE FROM residences WHERE user_id=?', me);
      run('INSERT INTO residences (user_id, building, unit, moved_in_at) VALUES (?,?,?,?)', me, target.id, free.unit, ts);
      // 유료: 코인 차감 기록 / 무료: 차감 없이 요청 번호만 기록 (코인 내역에 0코인 줄이 생기지 않게)
      const balance = freeAccess
        ? (run('INSERT INTO move_requests (user_id, ref, created_at) VALUES (?,?,?)', me, requestId, ts), balanceOf(me))
        : applyTx(me, -plan.price, 'move', requestId, ts, `${plan.name} ${free.unit}호로 이사`).balance;
      if (testFault(req, 'move')) throw new Error('테스트: 이사 처리 중 오류');
      grantMoveGifts(me, tier, ts);
      // 새집 배치: 기본 가구 + 사진 액자 (옛 위치는 쓰지 않음, 나머지 가구는 보관함)
      const h = repo.getHome(me);
      repo.saveHome(me, { layout: movedLayout(rawLayout(me) ?? h.layout, tier) });
      return { unit: free.unit, balance, prev: cur };
    });
  } catch (e) {
    if (e instanceof MoveError) return res.status(e.status).json({ error: e.message, code: e.code, coins: coinStatus(me, ts) });
    if (e instanceof CoinError) return res.status(400).json({ error: e.message, code: e.code });
    console.error('[move]', (e as Error).message);
    return res.status(500).json({ error: '이사 중 문제가 생겼어요. 코인과 집은 그대로예요. 잠시 후 다시 시도해 주세요.', code: 'failed' });
  }
  rt.homeMoved(me);
  rt.homeUpdated(me);
  rt.profileChanged(me);
  res.json({ residence: { building: target.id, unit: result.unit }, prev: result.prev, profile: repo.getMyProfile(me), coins: coinStatus(me, ts), home: homeView(me, me) });
});
/** 저장된 배치 원본 (이사 직전 등급 기준으로 읽기 — 액자 사진을 놓치지 않게) */
function rawLayout(userId: number) {
  const r = one('SELECT layout FROM homes WHERE user_id=?', userId);
  if (!r) return null;
  try { const v = JSON.parse(r.layout as string); return Array.isArray(v) ? v : null; } catch { return null; }
}

// ---------- 개인 집 (꾸미기·방문·좋아요·방명록) ----------
const guestbookLimiter = new RateLimiter(6, 60_000);
function homeView(viewer: number, owner: number): HomeView | null {
  const p = repo.getPublicProfile(owner);
  const res = repo.getResidence(owner);
  if (!p || !res) return null;
  const h = repo.getHome(owner);
  return {
    ownerId: owner,
    owner: { nickname: p.nickname, dogName: p.dogName, dogPhoto: p.dogPhoto, human: p.human, dog: p.dog },
    residence: res, visibility: h.visibility, layout: h.layout, tier: h.tier, style: h.style,
    likes: repo.countLikes(owner), likedByMe: repo.hasLiked(owner, viewer), isOwner: viewer === owner,
    owned: viewer === owner ? claimedItems(owner) : [],
    guestbook: repo.listGuestbook(owner).filter((g) => !repo.eitherBlocked(viewer, g.author_id)).map((g) => ({
      id: g.id, authorId: g.author_id, nickname: g.nickname, dogName: g.dog_name, text: g.text, ts: g.created_at,
      canDelete: viewer === owner || viewer === g.author_id,
    })),
  };
}
const homeOwnerParam = (req: express.Request) => (req.params.userId === 'me' ? (req as AuthedRequest).userId : Number(req.params.userId));

app.get('/api/home/:userId', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId, owner = homeOwnerParam(req);
  if (!Number.isInteger(owner)) return res.status(400).json({ error: '잘못된 요청이에요.' });
  const c = canVisit(me, owner);
  if (!c.ok) return res.status(c.status).json({ error: c.error });
  res.json({ home: homeView(me, owner) });
});

// 집주인만 가구 배치·공개 범위 변경 (다른 사용자는 경로상 자기 집만 수정 가능)
app.put('/api/home/me/layout', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  if (!repo.getResidence(me)) return res.status(400).json({ error: '입주한 뒤 집을 꾸밀 수 있어요.' });
  const layout = validateLayout(req.body?.layout, new Set(claimedItems(me)), repo.homeTier(me));
  if (!layout) return res.status(400).json({ error: '가구 배치 정보가 올바르지 않아요.' });
  // 액자 사진은 내가 올린 사진만 걸 수 있음 (다른 사람 사진 주소를 넣어도 거부)
  const mine = ownedPhotoUrls(me);
  if (layout.some((i) => i.photo && !mine.has(i.photo))) return res.status(403).json({ error: '내가 올린 사진만 액자에 걸 수 있어요.' });
  repo.saveHome(me, { layout });
  rt.homeUpdated(me);
  res.json({ home: homeView(me, me) });
});
/** 벽지·바닥재 (집주인만) */
app.put('/api/home/me/style', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  if (!repo.getResidence(me)) return res.status(400).json({ error: '입주한 뒤 꾸밀 수 있어요.' });
  const style = validateStyle(req.body?.style);
  if (!style) return res.status(400).json({ error: '벽지·바닥재 정보가 올바르지 않아요.' });
  repo.saveHome(me, { style });
  rt.homeUpdated(me);
  res.json({ home: homeView(me, me) });
});
app.put('/api/home/me/visibility', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  const v = req.body?.visibility as HomeVisibility;
  if (!HOME_VISIBILITY.some((x) => x.id === v)) return res.status(400).json({ error: '공개 범위가 올바르지 않아요.' });
  if (!repo.getResidence(me)) return res.status(400).json({ error: '입주한 뒤 설정할 수 있어요.' });
  repo.saveHome(me, { visibility: v });
  rt.recheckHome(me);
  rt.homeUpdated(me);
  res.json({ home: homeView(me, me) });
});

// 방문 권한 확인 (로비 호실 카드: 입장 / 방문 신청 / 불가)
app.get('/api/home/:userId/access', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId, owner = homeOwnerParam(req);
  const p = repo.getPublicProfile(owner);
  const r = repo.getResidence(owner);
  if (!p || !r || (owner !== me && repo.eitherBlocked(me, owner))) return res.status(404).json({ error: '방문할 수 없는 집이에요.' });
  const c = canVisit(me, owner);
  const vr = repo.getVisitRequest(owner, me);
  res.json({
    allowed: c.ok, reason: c.ok ? null : c.error, canRequest: !c.ok && c.canRequest,
    request: vr ? (vr.status === 'approved' && vr.expires_at < Date.now() ? 'expired' : vr.status) : null,
    visibility: repo.getHome(owner).visibility,
    owner: { id: owner, nickname: p.nickname, dogName: p.dogName, dogIntro: p.dogIntro, dogPhoto: p.dogPhoto, dog: p.dog, residence: r },
    neighbor: neighborStatus(me, owner),
  });
});
const visitLimiter = new RateLimiter(20, 3600_000);
app.post('/api/home/:userId/visit-request', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId, owner = homeOwnerParam(req);
  if (owner === me) return res.status(400).json({ error: '내 집이에요.' });
  const c = canVisit(me, owner);
  if (c.ok) return res.status(400).json({ error: '바로 들어갈 수 있는 집이에요.' });
  if (!c.canRequest) return res.status(c.status).json({ error: c.error });
  if (!visitLimiter.allow(String(me))) return res.status(429).json({ error: '방문 신청을 너무 많이 보냈어요. 잠시 후 다시 시도해 주세요.' });
  repo.requestVisit(owner, me);
  const p = repo.getPublicProfile(me)!;
  rt.notify(owner, 'visit:request', { fromId: me, nickname: p.nickname, dogName: p.dogName });
  res.json({ ok: true, request: 'pending' });
});
app.get('/api/home/me/visit-requests', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  res.json({ requests: repo.pendingVisits(me).map((v) => ({ visitorId: v.visitor_id, nickname: v.nickname, dogName: v.dog_name, ts: v.created_at })) });
});
app.post('/api/home/me/visit-requests/:visitorId', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId, visitor = Number(req.params.visitorId);
  const vr = repo.getVisitRequest(me, visitor);
  if (!vr || vr.status !== 'pending') return res.status(404).json({ error: '처리할 방문 신청이 없어요.' });
  const approve = req.body?.approve === true;
  repo.decideVisit(me, visitor, approve);
  const p = repo.getPublicProfile(me)!;
  rt.notify(visitor, 'visit:decided', { homeId: me, nickname: p.nickname, approve });
  res.json({ requests: repo.pendingVisits(me).map((v) => ({ visitorId: v.visitor_id, nickname: v.nickname, dogName: v.dog_name, ts: v.created_at })) });
});

// ---------- 이웃 (같은 아파트 동 주민끼리 신청·수락) ----------
type NeighborStatus = 'none' | 'outgoing' | 'incoming' | 'neighbors' | 'unavailable';
function neighborStatus(me: number, other: number): NeighborStatus {
  if (me === other) return 'unavailable';
  const a = repo.getResidence(me), b = repo.getResidence(other);
  if (!a || !b || a.building !== b.building || repo.eitherBlocked(me, other)) return 'unavailable';
  if (repo.areNeighbors(me, other)) return 'neighbors';
  if (repo.hasNeighborRequest(me, other)) return 'outgoing';
  if (repo.hasNeighborRequest(other, me)) return 'incoming';
  return 'none';
}
const neighborLimiter = new RateLimiter(30, 60_000);
app.get('/api/neighbors', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  res.json({
    neighbors: repo.neighborIds(me).map((id) => repo.getPublicProfile(id)).filter(Boolean),
    incoming: repo.incomingNeighborRequests(me).map((r) => repo.getPublicProfile(r.from_id)).filter(Boolean),
    outgoing: repo.outgoingNeighborRequests(me).map((id) => repo.getPublicProfile(id)).filter(Boolean),
  });
});
app.post('/api/neighbors/:userId/:action', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId, other = Number(req.params.userId);
  if (!neighborLimiter.allow(String(me))) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
  const st = neighborStatus(me, other);
  if (st === 'unavailable') return res.status(400).json({ error: '같은 아파트 동 주민끼리만 이웃이 될 수 있어요.' });
  const meP = repo.getPublicProfile(me)!;
  switch (req.params.action) {
    case 'request':
      if (st === 'incoming') { repo.makeNeighbors(me, other); rt.notify(other, 'neighbor:update', { kind: 'accepted', nickname: meP.nickname }); break; }
      if (st !== 'none') return res.status(400).json({ error: st === 'neighbors' ? '이미 이웃이에요.' : '이미 신청했어요.' });
      repo.addNeighborRequest(me, other);
      rt.notify(other, 'neighbor:update', { kind: 'request', nickname: meP.nickname });
      break;
    case 'accept':
      if (st !== 'incoming') return res.status(400).json({ error: '받은 이웃 신청이 없어요.' });
      repo.makeNeighbors(me, other);
      rt.notify(other, 'neighbor:update', { kind: 'accepted', nickname: meP.nickname });
      break;
    case 'decline':
      if (st !== 'incoming') return res.status(400).json({ error: '받은 이웃 신청이 없어요.' });
      repo.removeNeighborRequest(other, me);
      break;
    case 'cancel':
      if (st !== 'outgoing') return res.status(400).json({ error: '보낸 이웃 신청이 없어요.' });
      repo.removeNeighborRequest(me, other);
      break;
    case 'remove':
      if (st !== 'neighbors') return res.status(400).json({ error: '이웃이 아니에요.' });
      repo.removeNeighbor(me, other);
      rt.recheckHome(me); rt.recheckHome(other);
      break;
    default:
      return res.status(400).json({ error: '잘못된 요청이에요.' });
  }
  res.json({ status: neighborStatus(me, other) });
});

app.post('/api/home/:userId/like', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId, owner = homeOwnerParam(req);
  if (owner === me) return res.status(400).json({ error: '내 집에는 좋아요를 누를 수 없어요.' });
  const c = canVisit(me, owner);
  if (!c.ok) return res.status(c.status).json({ error: c.error });
  const liked = repo.toggleLike(owner, me);
  res.json({ liked, likes: repo.countLikes(owner) });
});

app.post('/api/home/:userId/guestbook', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId, owner = homeOwnerParam(req);
  const c = canVisit(me, owner);
  if (!c.ok) return res.status(c.status).json({ error: c.error });
  if (!guestbookLimiter.allow(String(me))) return res.status(429).json({ error: '방명록을 너무 자주 남기고 있어요. 잠시 후 다시 써 주세요.' });
  const clean = sanitize(req.body?.text, GUESTBOOK_MAX_LEN);
  if (!clean) return res.status(400).json({ error: '방명록 내용을 입력해 주세요.' });
  repo.addGuestbook(owner, me, filterProfanity(clean).text);
  res.json({ home: homeView(me, owner) });
});
app.delete('/api/home/:userId/guestbook/:id', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId, owner = homeOwnerParam(req);
  const g = repo.getGuestbookEntry(Number(req.params.id));
  if (!g || g.home_id !== owner) return res.status(404).json({ error: '방명록을 찾을 수 없어요.' });
  if (me !== owner && me !== g.author_id) return res.status(403).json({ error: '집주인이나 작성자만 지울 수 있어요.' });
  repo.deleteGuestbook(g.id);
  const c = canVisit(me, owner);
  res.json({ home: c.ok ? homeView(me, owner) : null });
});

// ---------- 광장 대형 스크린 (작성자 공개 동의 + 운영자 승인 후 노출) ----------
const screenLimiter = new RateLimiter(5, 3600_000);
function screenFeed() {
  const items = repo.listScreen('approved', 30);
  const dogs = items.filter((i) => i.kind === 'dog');
  const notices = items.filter((i) => i.kind === 'notice');
  // 오늘의 강아지: 승인된 강아지 중 날짜마다 한 마리씩 돌아가며
  const day = Math.floor((Date.now() + 9 * 3600_000) / 86400_000);
  const today = dogs.length ? dogs[day % dogs.length] : null;
  const { meetups, popular } = screenExtras();
  const pop = popular && popular.id !== today?.id ? popular : null;
  const slides = [
    ...(today ? [{ ...toScreen(today), label: '오늘의 강아지' }] : []),
    ...(pop ? [{ ...toScreen(pop), label: `인기 자랑 글 ❤️${pop.likes}` }] : []),
    ...meetups.map((m) => ({
      id: m.id as number, kind: 'meetup', label: '동네 모임 일정', title: m.title as string,
      text: `${fmtWhen(m.starts_at)} · ${m.kind === 'online' ? '온라인 · ' : ''}${m.place}`, image: null,
      author: repo.getPublicProfile(m.host_id)?.nickname ?? '', authorId: m.host_id as number, dogName: null, ts: m.created_at as number,
    })),
    ...dogs.filter((d) => d !== today && d.id !== pop?.id).slice(0, 6).map((d) => ({ ...toScreen(d), label: '우리 강아지 자랑' })),
    ...notices.slice(0, 3).map((n) => ({ ...toScreen(n), label: '운영 공지' })),
    // 멍글런너 코스별 TOP 3 (기록이 있는 코스만)
    ...COURSES.filter((c) => c.available).map((c) => ({ c, top: runnerTop(c.id, 3) })).filter((x) => x.top.length).map(({ c, top }) => ({
      id: -c.order, kind: 'runner', label: '🏃 멍글런너 랭킹', title: `${c.course} · ${c.title}`, text: `${c.composer} · 1위 ${top[0].score.toLocaleString()}점`,
      image: null, author: '', authorId: 0, dogName: null, ts: top[0].achievedAt, course: c.id,
      ranking: top.map((t) => ({ rank: t.rank, nickname: t.nickname, dogName: t.dogName, score: t.score, coat: t.coat })),
    })),
  ];
  return slides;
}
function fmtWhen(ts: number) {
  return new Date(ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
function toScreen(r: Record<string, any>) {
  return { id: r.id as number, kind: r.kind as string, title: r.title as string, text: r.text as string, image: (r.image as string | null) ?? null,
    author: r.kind === 'notice' ? '멍글마을 운영팀' : (r.nickname as string), dogName: (r.dog_name as string | null) ?? null, authorId: r.author_id as number, ts: r.created_at as number };
}
app.get('/api/screen', requireAuth, (_req, res) => res.json({ slides: screenFeed() }));
app.get('/api/screen/mine', requireAuth, (req, res) => {
  res.json({ items: repo.listScreenByAuthor((req as AuthedRequest).userId).map((r) => ({ ...toScreen(r), status: r.status })) });
});
app.post('/api/screen', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  if (req.body?.consent !== true) return res.status(400).json({ error: '광장 스크린 공개에 동의해야 신청할 수 있어요.' });
  const title = sanitize(req.body?.title, 30);
  const text = sanitize(req.body?.text ?? '', 80) ?? '';
  if (!title) return res.status(400).json({ error: '제목을 입력해 주세요.' });
  if (filterProfanity(title).flagged || filterProfanity(text).flagged) return res.status(400).json({ error: '부적절한 표현이 있어요.' });
  if (repo.countPendingScreen(me) >= 3) return res.status(400).json({ error: '검토 중인 신청이 3개 있어요. 승인된 뒤 다시 신청해 주세요.' });
  if (!screenLimiter.allow(String(me))) return res.status(429).json({ error: '잠시 후 다시 신청해 주세요.' });
  let image: string | null = null;
  if (req.body?.useProfilePhoto) image = repo.getDogPhoto(me);
  else if (req.body?.photo) { const r = saveImage(req.body.photo); if ('error' in r) return res.status(400).json({ error: r.error }); image = r.url; }
  if (!image) return res.status(400).json({ error: '강아지 사진을 올려 주세요.' });
  repo.addScreen({ kind: 'dog', authorId: me, title, text, image, status: 'pending', ownsImage: !req.body?.useProfilePhoto });
  res.json({ ok: true });
});
app.delete('/api/screen/:id', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  const it = repo.getScreen(Number(req.params.id));
  if (!it || it.author_id !== me || it.kind !== 'dog') return res.status(404).json({ error: '찾을 수 없어요.' });
  repo.deleteScreen(it.id);
  if (it.owns_image) removeImage(it.image);
  rt.screenUpdated();
  res.json({ ok: true });
});
app.get('/api/admin/screen', requireAuth, requireAdmin, (_req, res) => {
  res.json({ items: [...repo.listScreen('pending', 50), ...repo.listScreen('approved', 50)].map((r) => ({ ...toScreen(r), status: r.status })) });
});
app.post('/api/admin/screen/:id', requireAuth, requireAdmin, (req, res) => {
  const it = repo.getScreen(Number(req.params.id));
  const action = req.body?.action;
  if (!it || !['approve', 'reject', 'hide'].includes(action)) return res.status(400).json({ error: '잘못된 요청' });
  repo.setScreenStatus(it.id, action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'hidden');
  rt.screenUpdated();
  if (it.kind === 'dog') rt.notify(it.author_id, 'screen:decided', { title: it.title, approved: action === 'approve' });
  res.json({ ok: true });
});
app.post('/api/admin/notices', requireAuth, requireAdmin, (req, res) => {
  const title = sanitize(req.body?.title, 30);
  const text = sanitize(req.body?.text ?? '', 80) ?? '';
  if (!title) return res.status(400).json({ error: '제목을 입력해 주세요.' });
  repo.addScreen({ kind: 'notice', authorId: (req as AuthedRequest).userId, title, text, image: null, status: 'approved', ownsImage: false });
  rt.screenUpdated();
  res.json({ ok: true });
});

// ---------- 강아지 프로필 · 집 액자 사진 ----------
registerCoins(app);
setCoinNotifier((u, e) => rt.notify(u, 'coins:earned', e));
registerPets(app, { saveImage, removeImage, profileChanged: (u) => rt.profileChanged(u) });
registerRunner(app, { changed: () => { rt.runnerChanged(); rt.screenUpdated(); } });

// ---------- 멍글 동네 (강아지 자랑·산책 모임·강아지 모임·애견샵) ----------
registerCommunity(app, { saveImage, removeImage, notify: (u, e, p) => rt.notify(u, e, p), screenUpdated: () => rt.screenUpdated() });

// ---------- 운영 ----------
app.get('/api/admin/reports', requireAuth, requireAdmin, (_req, res) => res.json({ reports: repo.listReports() }));
// 운영 설정 (아파트 무료 이용 등) — 바꿔도 기존 거주·가구·결제 내역은 그대로
app.get('/api/admin/settings', requireAuth, requireAdmin, (_req, res) => res.json({ settings: getSettings() }));
app.post('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  const v = req.body?.apartmentFreeAccess;
  if (typeof v !== 'boolean') return res.status(400).json({ error: '잘못된 설정 값이에요.' });
  res.json({ settings: updateSettings({ apartmentFreeAccess: v }) });
});
app.post('/api/admin/reports/:id/status', requireAuth, requireAdmin, (req, res) => {
  const status = req.body?.status;
  if (!['open', 'resolved', 'dismissed'].includes(status)) return res.status(400).json({ error: '잘못된 상태' });
  repo.setReportStatus(Number(req.params.id), status);
  res.json({ ok: true });
});
app.post('/api/admin/ban', requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.body?.userId);
  const hours = Number(req.body?.hours);
  if (!Number.isInteger(userId) || !repo.findUser(userId) || !(hours >= 0 && hours <= 24 * 365)) return res.status(400).json({ error: '잘못된 요청' });
  repo.setBan(userId, hours === 0 ? 0 : Date.now() + hours * 3600_000);
  if (hours > 0) rt.kick(userId, '운영 정책 위반으로 이용이 일시 정지되었어요.');
  res.json({ ok: true });
});

// ---------- 프로덕션: 빌드된 클라이언트 제공 ----------
const clientDist = path.resolve(import.meta.dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  // 빌드 파일(이름에 해시가 붙음)은 오래 보관해도 안전 · 없는 파일은 화면(html) 대신 404
  app.use('/assets', express.static(path.join(clientDist, 'assets'), { index: false, immutable: true, maxAge: '365d', fallthrough: true }));
  app.use('/assets', (_req, res) => res.status(404).end());
  // 홈 화면 앱: 서비스 워커·앱 정보는 항상 새로 확인 (새 배포가 바로 반영되게)
  app.use(express.static(clientDist, {
    index: false,
    setHeaders(res, file) {
      const base = path.basename(file);
      if (base === 'sw.js') { res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Service-Worker-Allowed', '/'); }
      else if (base === 'manifest.webmanifest') { res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache'); }
      else if (/\.(png|svg|jpg)$/.test(base)) res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  }));
  // 첫 화면: 링크 미리보기(카카오톡·SNS)는 전체 주소가 필요해서 요청 주소로 채워 보냄
  const indexFile = path.join(clientDist, 'index.html');
  let indexCache: { mtime: number; html: string } | null = null;
  const indexHtml = () => {
    const mtime = fs.statSync(indexFile).mtimeMs;
    if (!indexCache || indexCache.mtime !== mtime) indexCache = { mtime, html: fs.readFileSync(indexFile, 'utf8') };
    return indexCache.html;
  };
  const publicOrigin = (req: express.Request) => {
    const fixed = process.env.MUNGLE_PUBLIC_URL?.replace(/\/+$/, '');
    if (fixed) return fixed;
    const host = String(req.get('host') ?? '').replace(/[^a-zA-Z0-9.:\-[\]]/g, '');
    return `${req.protocol}://${host}`;
  };
  app.get(/^\/(?!api|uploads|socket\.io).*/, (req, res) => {
    const origin = publicOrigin(req);
    const html = indexHtml()
      .replace('property="og:url" content="/"', `property="og:url" content="${origin}/"`)
      .replace('property="og:image" content="/og.jpg"', `property="og:image" content="${origin}/og.jpg"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  });
}

// ---------- 자동 백업 (기본 하루 1번, MUNGLE_BACKUP_HOURS=0 이면 끔) ----------
const backupHours = Number(process.env.MUNGLE_BACKUP_HOURS ?? 24);
if (backupHours > 0) {
  const doBackup = () => { try { console.log('💾 DB 백업:', repo.backupNow()); } catch (e) { console.error('DB 백업 실패', e); } };
  setTimeout(doBackup, 60_000).unref();
  setInterval(doBackup, backupHours * 3600_000).unref();
}

// GitHub 저장소 영구 저장 (MUNGLE_GITHUB_REPO + MUNGLE_GITHUB_TOKEN 설정 시)
// (이사 안내 모드인 예전 서버는 저장하지 않음 — 새 서버가 같은 저장소에 백업 중일 수 있음)
if (!MOVED_TO) {
  persist.startDbSync(repo.snapshotBuffer, repo.totalChanges);
  if (persist.enabled) console.log('💾 GitHub 저장소에 데이터 자동 저장 사용 중');
}

server.listen(PORT, () => console.log(`🐾 멍글마을 서버 실행 중: http://localhost:${PORT}`));
