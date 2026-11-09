import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import * as repo from './db';
import * as persist from './persist';
import { APARTMENT_BUILDINGS, isValidUnit, unitsOf, type UnitInfo } from '../../shared/apartment';
import { GUESTBOOK_MAX_LEN, HOME_VISIBILITY, validateLayout, type HomeView, type HomeVisibility } from '../../shared/home';
import { hashPassword, issueToken, requireAdmin, requireAuth, revokeToken, verifyPassword, type AuthedRequest } from './auth';
import { setupRealtime } from './realtime';
import { filterProfanity, RateLimiter, sanitize } from './moderation';
import { AnalysisError, dogAnalyzer, type DogPhoto } from './dogAnalyzer';
import { validateDog, validateHuman } from '../../shared/avatar';
import { DEFAULT_PRIVACY } from '../../shared/protocol';

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
app.disable('x-powered-by');
// Render 등 프록시 뒤에 배포될 때 실제 접속자 IP로 가입/로그인 횟수 제한을 적용
if (process.env.RENDER || process.env.MUNGLE_TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '6mb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.MUNGLE_CORS?.split(',') ?? false }, maxHttpBufferSize: 64 * 1024 });
const rt = setupRealtime(io);

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
  if (old) { fs.rm(path.join(repo.UPLOAD_DIR, path.basename(old)), { force: true }, () => {}); persist.removeUpload(path.basename(old)); }
  rt.profileChanged(id);
  res.json({ profile: repo.getMyProfile(id) });
});

app.delete('/api/me/dog-photo', requireAuth, (req, res) => {
  const id = (req as AuthedRequest).userId;
  const old = repo.getDogPhoto(id);
  repo.setDogPhoto(id, null);
  if (old) { fs.rm(path.join(repo.UPLOAD_DIR, path.basename(old)), { force: true }, () => {}); persist.removeUpload(path.basename(old)); }
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
        } : null,
      };
    });
    return { ...b, units };
  });
  res.json({ buildings, mine: repo.getResidence(me) });
});

app.post('/api/apartment/move-in', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  const building = String(req.body?.building ?? '');
  const unit = String(req.body?.unit ?? '');
  if (!isValidUnit(building, unit)) return res.status(400).json({ error: '존재하지 않는 호실이에요.' });
  const r = repo.moveIn(me, building, unit);
  if (!r.ok) return res.status(409).json({ error: r.reason === 'already' ? '이미 입주한 집이 있어요.' : '방금 다른 주민이 입주한 호실이에요. 다른 호실을 골라 주세요.' });
  rt.profileChanged(me);
  res.json({ profile: repo.getMyProfile(me) });
});

// ---------- 개인 집 (꾸미기·방문·좋아요·방명록) ----------
const guestbookLimiter = new RateLimiter(6, 60_000);
/** 방문 가능 여부: 집주인 / 차단 / 공개 범위(전체·친구·이웃=같은 동 주민·비공개) */
function canVisit(viewer: number, owner: number): { ok: true } | { ok: false; status: number; error: string } {
  const res = repo.getResidence(owner);
  if (!res) return { ok: false, status: 404, error: '아직 입주하지 않은 사용자예요.' };
  if (viewer === owner) return { ok: true };
  if (repo.eitherBlocked(viewer, owner)) return { ok: false, status: 403, error: '방문할 수 없는 집이에요.' };
  const vis = repo.getHome(owner).visibility;
  if (vis === 'public') return { ok: true };
  if (vis === 'friends' && repo.areFriends(viewer, owner)) return { ok: true };
  if (vis === 'neighbors' && repo.getResidence(viewer)?.building === res.building) return { ok: true };
  const why = vis === 'friends' ? '친구에게만 공개된 집이에요.' : vis === 'neighbors' ? '같은 동 이웃에게만 공개된 집이에요.' : '비공개 집이에요.';
  return { ok: false, status: 403, error: why };
}
function homeView(viewer: number, owner: number): HomeView | null {
  const p = repo.getPublicProfile(owner);
  const res = repo.getResidence(owner);
  if (!p || !res) return null;
  const h = repo.getHome(owner);
  return {
    ownerId: owner,
    owner: { nickname: p.nickname, dogName: p.dogName, dogPhoto: p.dogPhoto, human: p.human, dog: p.dog },
    residence: res, visibility: h.visibility, layout: h.layout,
    likes: repo.countLikes(owner), likedByMe: repo.hasLiked(owner, viewer), isOwner: viewer === owner,
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
  const layout = validateLayout(req.body?.layout);
  if (!layout) return res.status(400).json({ error: '가구 배치 정보가 올바르지 않아요.' });
  repo.saveHome(me, { layout });
  res.json({ home: homeView(me, me) });
});
app.put('/api/home/me/visibility', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).userId;
  const v = req.body?.visibility as HomeVisibility;
  if (!HOME_VISIBILITY.some((x) => x.id === v)) return res.status(400).json({ error: '공개 범위가 올바르지 않아요.' });
  if (!repo.getResidence(me)) return res.status(400).json({ error: '입주한 뒤 설정할 수 있어요.' });
  repo.saveHome(me, { visibility: v });
  res.json({ home: homeView(me, me) });
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

// ---------- 운영 ----------
app.get('/api/admin/reports', requireAuth, requireAdmin, (_req, res) => res.json({ reports: repo.listReports() }));
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
  app.use(express.static(clientDist, { index: false }));
  app.get(/^\/(?!api|uploads|socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ---------- 자동 백업 (기본 하루 1번, MUNGLE_BACKUP_HOURS=0 이면 끔) ----------
const backupHours = Number(process.env.MUNGLE_BACKUP_HOURS ?? 24);
if (backupHours > 0) {
  const doBackup = () => { try { console.log('💾 DB 백업:', repo.backupNow()); } catch (e) { console.error('DB 백업 실패', e); } };
  setTimeout(doBackup, 60_000).unref();
  setInterval(doBackup, backupHours * 3600_000).unref();
}

// GitHub 저장소 영구 저장 (MUNGLE_GITHUB_REPO + MUNGLE_GITHUB_TOKEN 설정 시)
persist.startDbSync(repo.snapshotBuffer, repo.totalChanges);
if (persist.enabled) console.log('💾 GitHub 저장소에 데이터 자동 저장 사용 중');

server.listen(PORT, () => console.log(`🐾 멍글마을 서버 실행 중: http://localhost:${PORT}`));
