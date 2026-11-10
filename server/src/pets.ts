// 강아지 프로필(나이·성별·성격·사진첩·공개 범위·쓰다듬기 허용) · 집 액자 사진 보관함
import type express from 'express';
import { all, db, one, run } from './db';
import * as repo from './db';
import { requireAuth, type AuthedRequest } from './auth';
import { filterProfanity, RateLimiter, sanitize } from './moderation';
import { BREED_PRESETS } from '../../shared/avatar';
import { DOG_PHOTO_MAX, DOG_TRAITS, type DogProfileSettings, type DogProfileView } from '../../shared/protocol';

db.exec(`
CREATE TABLE IF NOT EXISTS home_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_home_photos_owner ON home_photos(owner_id);
`);
const HOME_PHOTO_MAX = 30;

export interface PetDeps {
  saveImage: (dataUrl: unknown) => { url: string } | { error: string };
  removeImage: (url: string | null | undefined) => void;
  profileChanged: (userId: number) => void;
}

/** 이 사용자가 액자에 쓸 수 있는 사진 (내가 올린 집 사진 + 강아지 대표 사진 + 강아지 사진첩) */
export function ownedPhotoUrls(userId: number): Set<string> {
  const set = new Set(all('SELECT url FROM home_photos WHERE owner_id=?', userId).map((r) => r.url as string));
  const main = repo.getDogPhoto(userId);
  if (main) set.add(main);
  for (const u of repo.getDogProfile(userId).photos) set.add(u);
  return set;
}
/** 집 배치에서 이 사진을 쓰고 있는지 (삭제 전 참조 확인) */
const usedInLayout = (userId: number, url: string) => repo.getHome(userId).layout.some((i) => i.photo === url);

const me = (req: express.Request) => (req as AuthedRequest).userId;

/**
 * 강아지 대표 사진을 바꾸거나 지울 때: 집 액자에 걸려 있으면 파일을 지우지 않고 '내가 올린 사진'으로 옮겨 액자 사진을 지킨다.
 * @returns 파일을 지워도 되면 true
 */
export function retireDogPhoto(userId: number, url: string): boolean {
  if (!usedInLayout(userId, url)) return true;
  if (!one('SELECT id FROM home_photos WHERE owner_id=? AND url=?', userId, url)) run('INSERT INTO home_photos (owner_id, url, created_at) VALUES (?,?,?)', userId, url, Date.now());
  return false;
}

export function dogProfileView(viewer: number, ownerId: number): DogProfileView | null {
  const p = repo.getPublicProfile(ownerId);
  if (!p) return null;
  const s = repo.getDogProfile(ownerId);
  const isMe = viewer === ownerId;
  const friends = repo.areFriends(viewer, ownerId);
  const full = isMe || s.visibility === 'all' || (s.visibility === 'friends' && friends);
  const status = isMe ? 'none' : repo.friendStatus(viewer, ownerId);
  const viewerGuest = repo.findUser(viewer)?.role === 'guest';
  return {
    ownerId, ownerNickname: p.nickname, name: p.dogName,
    breed: BREED_PRESETS[p.dog.breed]?.label ?? '믹스견',
    photos: [...(p.dogPhoto ? [p.dogPhoto] : []), ...(full ? s.photos : [])],
    coat: p.dog.coat,
    intro: full ? p.dogIntro : '',
    age: full ? s.age : null,
    gender: full ? s.gender : null,
    traits: full ? s.traits : [],
    limited: !full,
    canPet: !viewerGuest && !p.guest && (isMe || s.allowPetting === 'all' || (s.allowPetting === 'friends' && friends)) && !repo.eitherBlocked(viewer, ownerId),
    friendStatus: status, isMe, guest: !!p.guest,
  };
}

export function registerPets(app: express.Express, deps: PetDeps) {
  const uploadLimiter = new RateLimiter(30, 3600_000);

  // ---------- 강아지 프로필 ----------
  app.get('/api/dogs/:userId', requireAuth, (req, res) => {
    const owner = Number(req.params.userId);
    if (!Number.isInteger(owner)) return res.status(400).json({ error: '잘못된 요청이에요.' });
    if (owner !== me(req) && repo.eitherBlocked(me(req), owner)) return res.status(404).json({ error: '볼 수 없는 프로필이에요.' });
    const v = dogProfileView(me(req), owner);
    if (!v) return res.status(404).json({ error: '강아지를 찾을 수 없어요.' });
    res.json({ dog: v });
  });
  app.get('/api/me/dog-profile', requireAuth, (req, res) => {
    res.json({ settings: repo.getDogProfile(me(req)), intro: repo.getPublicProfile(me(req))?.dogIntro ?? '' });
  });
  app.put('/api/me/dog-profile', requireAuth, (req, res) => {
    const uid = me(req);
    const b = req.body ?? {};
    const cur = repo.getDogProfile(uid);
    const age = b.age === null || b.age === undefined ? null : Number(b.age);
    if (age !== null && !(Number.isInteger(age) && age >= 0 && age <= 25)) return res.status(400).json({ error: '나이는 0~25살로 골라 주세요.' });
    const gender = b.gender === 'male' || b.gender === 'female' ? b.gender : null;
    const traits = Array.isArray(b.traits) ? [...new Set(b.traits.filter((t: unknown) => (DOG_TRAITS as readonly unknown[]).includes(t)))].slice(0, 4) as string[] : cur.traits;
    const visibility = ['all', 'friends', 'private'].includes(b.visibility) ? b.visibility : cur.visibility;
    const allowPetting = ['all', 'friends', 'none'].includes(b.allowPetting) ? b.allowPetting : cur.allowPetting;
    const next: DogProfileSettings = { ...cur, age, gender, traits, visibility, allowPetting };
    repo.setDogProfile(uid, next);
    if (typeof b.intro === 'string') {
      const intro = sanitize(b.intro, 80) ?? '';
      if (intro && filterProfanity(intro).flagged) return res.status(400).json({ error: '부적절한 표현이 있어요.' });
      repo.setDogIntro(uid, intro);
      deps.profileChanged(uid);
    }
    res.json({ settings: next });
  });
  // 사진첩 (최대 8장)
  app.post('/api/me/dog-photos', requireAuth, (req, res) => {
    const uid = me(req);
    if (!uploadLimiter.allow(String(uid))) return res.status(429).json({ error: '사진을 너무 자주 올리고 있어요.' });
    const cur = repo.getDogProfile(uid);
    if (cur.photos.length >= DOG_PHOTO_MAX) return res.status(400).json({ error: `사진첩에는 ${DOG_PHOTO_MAX}장까지 올릴 수 있어요.` });
    const r = deps.saveImage(req.body?.dataUrl);
    if ('error' in r) return res.status(400).json({ error: r.error });
    const next = { ...cur, photos: [...cur.photos, r.url] };
    repo.setDogProfile(uid, next);
    res.json({ settings: next });
  });
  app.delete('/api/me/dog-photos', requireAuth, (req, res) => {
    const uid = me(req);
    const url = String(req.body?.url ?? '');
    const cur = repo.getDogProfile(uid);
    if (!cur.photos.includes(url)) return res.status(404).json({ error: '사진을 찾을 수 없어요.' });
    if (usedInLayout(uid, url)) return res.status(409).json({ error: '집 액자에 걸린 사진이에요. 액자에서 먼저 바꿔 주세요.' });
    const next = { ...cur, photos: cur.photos.filter((u) => u !== url) };
    repo.setDogProfile(uid, next);
    deps.removeImage(url);
    res.json({ settings: next });
  });

  // ---------- 집 액자용 사진 보관함 ----------
  app.get('/api/home/me/photos', requireAuth, (req, res) => {
    const uid = me(req);
    const p = repo.getPublicProfile(uid);
    res.json({
      uploads: all('SELECT id, url, created_at FROM home_photos WHERE owner_id=? ORDER BY id DESC', uid).map((r) => ({ id: r.id, url: r.url })),
      dogPhotos: [...(p?.dogPhoto ? [p.dogPhoto] : []), ...repo.getDogProfile(uid).photos],
    });
  });
  app.post('/api/home/me/photos', requireAuth, (req, res) => {
    const uid = me(req);
    if (!uploadLimiter.allow(String(uid))) return res.status(429).json({ error: '사진을 너무 자주 올리고 있어요.' });
    if (Number(one('SELECT COUNT(*) n FROM home_photos WHERE owner_id=?', uid)?.n ?? 0) >= HOME_PHOTO_MAX) return res.status(400).json({ error: `집 사진은 ${HOME_PHOTO_MAX}장까지 보관할 수 있어요.` });
    const r = deps.saveImage(req.body?.dataUrl);
    if ('error' in r) return res.status(400).json({ error: r.error });
    const ins = run('INSERT INTO home_photos (owner_id, url, created_at) VALUES (?,?,?)', uid, r.url, Date.now());
    res.json({ photo: { id: Number(ins.lastInsertRowid), url: r.url } });
  });
  app.delete('/api/home/me/photos/:id', requireAuth, (req, res) => {
    const uid = me(req);
    const row = one('SELECT * FROM home_photos WHERE id=? AND owner_id=?', Number(req.params.id), uid);
    if (!row) return res.status(404).json({ error: '사진을 찾을 수 없어요.' });
    if (usedInLayout(uid, row.url)) return res.status(409).json({ error: '액자에 걸린 사진이에요. 액자에서 먼저 바꿔 주세요.' });
    run('DELETE FROM home_photos WHERE id=?', row.id);
    deps.removeImage(row.url);
    res.json({ ok: true });
  });
}
