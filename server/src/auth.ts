import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import * as repo from './db';
import { banMessage } from './ban';

const SESSION_TTL = 1000 * 60 * 60 * 24 * 14; // 14일

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, hash: string) {
  const h = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export function issueToken(userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  // DB에는 토큰 원문이 아닌 해시만 저장한다.
  repo.createSession(sha(token), userId, Date.now() + SESSION_TTL);
  return token;
}

export function revokeToken(token: string) {
  repo.deleteSession(sha(token));
}

/** 토큰 → 사용자 id. 정지된 계정은 null */
export function userFromToken(token: unknown): { id: number; role: string } | { banned: number; reason: string } | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const s = repo.findSession(sha(token));
  if (!s) return null;
  const u = repo.findUser(s.user_id);
  if (!u) return null;
  if (u.banned_until > Date.now()) return { banned: u.banned_until, reason: String(u.ban_reason ?? '') };
  return { id: u.id, role: u.role };
}

export interface AuthedRequest extends Request {
  userId: number;
  role: string;
  token: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const u = userFromToken(token);
  if (!u) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if ('banned' in u) return res.status(403).json({ error: banMessage(u.banned, u.reason), code: 'banned' });
  (req as AuthedRequest).userId = u.id;
  (req as AuthedRequest).role = u.role;
  (req as AuthedRequest).token = token;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if ((req as AuthedRequest).role !== 'admin') return res.status(403).json({ error: '운영자 권한이 필요합니다.' });
  next();
}
