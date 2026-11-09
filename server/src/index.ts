import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import * as repo from './db';
import { hashPassword, issueToken, requireAdmin, requireAuth, revokeToken, verifyPassword, type AuthedRequest } from './auth';
import { setupRealtime } from './realtime';
import { filterProfanity, RateLimiter, sanitize } from './moderation';
import { dogAnalyzer } from './dogAnalyzer';
import { validateDog, validateHuman } from '../../shared/avatar';
import { DEFAULT_PRIVACY } from '../../shared/protocol';

const PORT = Number(process.env.PORT ?? 3001);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));

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
  const old = repo.getDogPhoto(id);
  repo.setDogPhoto(id, `/uploads/${file}`);
  if (old) fs.rm(path.join(repo.UPLOAD_DIR, path.basename(old)), { force: true }, () => {});
  rt.profileChanged(id);
  res.json({ profile: repo.getMyProfile(id) });
});

app.delete('/api/me/dog-photo', requireAuth, (req, res) => {
  const id = (req as AuthedRequest).userId;
  const old = repo.getDogPhoto(id);
  repo.setDogPhoto(id, null);
  if (old) fs.rm(path.join(repo.UPLOAD_DIR, path.basename(old)), { force: true }, () => {});
  rt.profileChanged(id);
  res.json({ profile: repo.getMyProfile(id) });
});

app.use('/uploads', express.static(repo.UPLOAD_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' }));

app.get('/api/parks', (_req, res) => res.json({ parks: rt.parks() }));

app.get('/api/dog-analysis/status', (_req, res) => res.json({ available: dogAnalyzer.available }));

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

server.listen(PORT, () => console.log(`🐾 멍글마을 서버 실행 중: http://localhost:${PORT}`));
