// 운영자 권한 관리
//  · 가입할 때 아이디가 같다는 이유만으로 운영자가 되지 않는다.
//    (MUNGLE_ADMINS 의 '가입 시 자동 운영자'는 자동 테스트용 — MUNGLE_ADMINS_ON_SIGNUP=1 일 때만 동작)
//  · 운영자 지정: 저장소의 deploy/admins.txt 에 '이미 가입한' 아이디를 한 줄에 하나씩 적는다.
//    서버가 켜질 때와 1분마다 이 파일을 읽어, 적힌 아이디(일반 회원)를 운영자로 바꾼다.
//    저장소에 쓸 수 있는 사람(저장소 주인)만 바꿀 수 있고, 서버는 GitHub 의 최신 내용을 자동으로 받아온다.
//  · 권한 회수: 같은 파일에 '-아이디' 줄을 적는다. (줄을 지우기만 해서는 회수되지 않음 — 실수로 운영자가 사라지지 않게)
//  · 목록에 아이디가 '처음 보인 시각'을 서버에 기록해 두고, 그보다 먼저 가입한 계정만 운영자로 바꾼다.
//    → 아직 아무도 쓰지 않는 아이디를 적어 두었다가 다른 사람이 그 아이디로 먼저 가입해도 운영자가 되지 않는다.
//    (그런 경우 줄을 지웠다가 다시 적으면 그때를 기준으로 다시 판단)
//  · 둘러보기(임시) 계정은 운영자로 바꾸지 않는다. 비밀번호·토큰 같은 인증 정보는 이 파일에 두지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { all, db, run } from './db';

db.exec('CREATE TABLE IF NOT EXISTS admin_names (name TEXT PRIMARY KEY, first_seen INTEGER NOT NULL)');

export const ADMINS_FILE = process.env.MUNGLE_ADMINS_FILE ?? path.resolve(import.meta.dirname, '../../deploy/admins.txt');
const NAME_RE = /^[A-Za-z0-9_]{4,20}$/;

/** 파일 내용 → 지정·회수할 아이디 (주석 #, 빈 줄 무시, 형식이 틀린 줄은 건너뜀) */
export function parseAdmins(text: string) {
  const grant: string[] = [], revoke: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const off = line.startsWith('-');
    const name = (off ? line.slice(1) : line).trim().replace(/^@/, '');
    if (!NAME_RE.test(name)) continue;
    (off ? revoke : grant).push(name.toLowerCase());
  }
  // 같은 아이디가 양쪽에 있으면 회수가 우선
  return { grant: grant.filter((n) => !revoke.includes(n)), revoke };
}

const byName = (name: string) => all('SELECT id, username, role, created_at FROM users WHERE lower(username) = ?', name)[0];

/** 파일을 읽어 권한 반영. 바뀐 아이디를 돌려준다 (파일이 없으면 아무것도 하지 않음) */
export function syncAdmins(file = ADMINS_FILE) {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { granted: [] as string[], revoked: [] as string[], missing: [] as string[], tooNew: [] as string[] }; }
  const { grant, revoke } = parseAdmins(text);
  const granted: string[] = [], revoked: string[] = [], missing: string[] = [], tooNew: string[] = [];
  // 목록에서 빠진 아이디는 '처음 보인 시각'도 지움 (다시 적으면 그때부터 새로)
  const now = Date.now();
  for (const r of all('SELECT name FROM admin_names')) if (!grant.includes(r.name)) run('DELETE FROM admin_names WHERE name = ?', r.name);
  for (const n of grant) {
    run('INSERT OR IGNORE INTO admin_names (name, first_seen) VALUES (?, ?)', n, now);
    const seen = Number(all('SELECT first_seen FROM admin_names WHERE name = ?', n)[0]?.first_seen ?? now);
    const u = byName(n);
    if (!u) { missing.push(n); continue; }
    if (u.role !== 'user') continue;
    if (Number(u.created_at) >= seen) { tooNew.push(u.username); continue; }
    run("UPDATE users SET role = 'admin' WHERE id = ?", u.id); granted.push(u.username);
  }
  for (const n of revoke) {
    const u = byName(n);
    if (u?.role === 'admin') { run("UPDATE users SET role = 'user' WHERE id = ?", u.id); revoked.push(u.username); }
  }
  if (granted.length) console.log(`🛡️ 운영자 지정: ${granted.join(', ')}`);
  if (tooNew.length) console.log(`🛡️ 목록에 적힌 뒤에 가입한 계정이라 운영자로 바꾸지 않음: ${tooNew.join(', ')} (본인 계정이 맞다면 줄을 지웠다가 다시 적어 주세요)`);
  if (revoked.length) console.log(`🛡️ 운영자 권한 회수: ${revoked.join(', ')}`);
  return { granted, revoked, missing, tooNew };
}

let lastMissing = '';
export function startAdminSync(ms = Number(process.env.MUNGLE_ADMIN_SYNC_MS ?? 60_000)) {
  const tick = () => {
    try {
      const r = syncAdmins();
      const miss = r.missing.join(',');
      if (miss && miss !== lastMissing) console.log(`🛡️ deploy/admins.txt 에 적혔지만 가입된 계정이 없는 아이디: ${r.missing.join(', ')} (이 아이디로 나중에 가입한 계정은 운영자가 되지 않아요 — 먼저 가입한 뒤 적어 주세요)`);
      lastMissing = miss;
    } catch (e) { console.error('운영자 목록 반영 실패', e); }
  };
  tick();
  setInterval(tick, Math.max(1000, ms)).unref();
}

/** 지금 운영자인 계정 (관리 명령·점검용) */
export const listAdmins = () => all("SELECT id, username, created_at FROM users WHERE role = 'admin' ORDER BY id");
