// 운영자 권한 관리 — '계정 소유 확인 + 저장소 주인 확인' 두 가지가 모두 맞을 때만 운영자로 지정
//  1) 운영자가 될 사람이 그 계정으로 로그인 → 설정 화면의 '운영자 계정 등록'에서 1회용 확인 코드를 받음
//     (로그인한 본인에게만 보이고, 서버에는 해시만 저장, 24시간 유효, 한 번 쓰면 끝)
//  2) 저장소 주인이 GitHub 의 deploy/admins.txt 에 '아이디 코드' 한 줄을 적음 (저장소에 쓸 수 있는 사람만 가능)
//  3) 서버가 1분마다 파일을 읽어, 그 아이디 계정의 고유 ID 로 만든 코드가 맞을 때만 운영자로 바꿈
//  → 아이디가 같다는 이유만으로는 절대 운영자가 되지 않음 (가입할 때 자동 지정 없음, 아이디만 적힌 줄은 무시)
//  · 줄 끝에 '최고'를 붙이면 최고 관리자로 표시 (예: tjdus7911 AB12-CD34-EF56 최고)
//  · 권한 회수: '-아이디' 줄 (줄을 지우기만 해서는 회수되지 않음 — 실수로 운영자가 사라지지 않게)
//  · 운영자 계정은 관리자 페이지에서 정지할 수 없음. 권한 변경은 이 절차로만.
//  · (MUNGLE_ADMINS + MUNGLE_ADMINS_ON_SIGNUP=1 의 '가입 시 자동 운영자'는 자동 테스트 전용)
import fs from 'node:fs';
import path from 'node:path';
import { all, one, run } from './db';
import { useClaimCode } from './admin';

export const ADMINS_FILE = process.env.MUNGLE_ADMINS_FILE ?? path.resolve(import.meta.dirname, '../../deploy/admins.txt');
const NAME_RE = /^[A-Za-z0-9_]{4,20}$/;
const CODE_RE = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/i;

export interface AdminLine { name: string; code: string | null; super: boolean }
/** 파일 내용 → 지정할 줄(아이디·코드·최고)과 회수할 아이디 (주석 #, 빈 줄·형식이 틀린 줄은 건너뜀) */
export function parseAdmins(text: string) {
  const grant: AdminLine[] = [], revoke: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [first, ...rest] = line.split(/\s+/);
    const off = first.startsWith('-');
    const name = (off ? first.slice(1) : first).replace(/^@/, '');
    if (!NAME_RE.test(name)) continue;
    if (off) { revoke.push(name.toLowerCase()); continue; }
    const code = rest.find((t) => CODE_RE.test(t)) ?? null;
    grant.push({ name: name.toLowerCase(), code: code ? code.toUpperCase() : null, super: rest.includes('최고') });
  }
  // 같은 아이디가 양쪽에 있으면 회수가 우선
  return { grant: grant.filter((g) => !revoke.includes(g.name)), revoke };
}

const byName = (name: string) => all('SELECT id, username, role FROM users WHERE lower(username) = ?', name)[0];

/** 파일을 읽어 권한 반영. 바뀐 내용을 돌려준다 (파일이 없으면 아무것도 하지 않음) */
export function syncAdmins(file = ADMINS_FILE) {
  const out = { granted: [] as string[], revoked: [] as string[], missing: [] as string[], needCode: [] as string[], badCode: [] as string[] };
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  const { grant, revoke } = parseAdmins(text);
  for (const g of grant) {
    const u = byName(g.name);
    if (!u) { out.missing.push(g.name); continue; }
    if (u.role === 'admin') {
      // 이미 운영자: '최고' 표시만 맞춤
      if (one('SELECT 1 FROM admin_meta WHERE user_id=?', u.id)) run('UPDATE admin_meta SET super=? WHERE user_id=?', g.super ? 1 : 0, u.id);
      continue;
    }
    if (u.role !== 'user') continue; // 둘러보기(임시) 계정은 제외
    if (!g.code) { out.needCode.push(u.username); continue; }
    if (!useClaimCode(Number(u.id), g.code)) { out.badCode.push(u.username); continue; }
    run("UPDATE users SET role = 'admin' WHERE id = ?", u.id);
    run('INSERT INTO admin_meta (user_id, super, granted_at, via) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET super=excluded.super, granted_at=excluded.granted_at, via=excluded.via',
      u.id, g.super ? 1 : 0, Date.now(), 'admins.txt+code');
    run("INSERT INTO admin_actions (admin_id, action, target_type, target_id, reason, detail, until, created_at) VALUES (0,'grant_admin','user',?,'deploy/admins.txt + 계정 확인 코드',?,NULL,?)", u.id, g.super ? '최고 관리자' : '운영자', Date.now());
    out.granted.push(u.username);
  }
  for (const n of revoke) {
    const u = byName(n);
    if (u?.role === 'admin') {
      run("UPDATE users SET role = 'user' WHERE id = ?", u.id);
      run('DELETE FROM admin_meta WHERE user_id=?', u.id);
      run("INSERT INTO admin_actions (admin_id, action, target_type, target_id, reason, detail, until, created_at) VALUES (0,'revoke_admin','user',?,'deploy/admins.txt','',NULL,?)", u.id, Date.now());
      out.revoked.push(u.username);
    }
  }
  if (out.granted.length) console.log(`🛡️ 운영자 지정: ${out.granted.join(', ')}`);
  if (out.revoked.length) console.log(`🛡️ 운영자 권한 회수: ${out.revoked.join(', ')}`);
  return out;
}

let lastLog = '';
export function startAdminSync(ms = Number(process.env.MUNGLE_ADMIN_SYNC_MS ?? 60_000)) {
  const tick = () => {
    try {
      const r = syncAdmins();
      const msg = [
        r.missing.length ? `가입된 계정이 없는 아이디: ${r.missing.join(', ')}` : '',
        r.needCode.length ? `확인 코드가 없어 운영자로 바꾸지 않음: ${r.needCode.join(', ')} (설정 → 운영자 계정 등록에서 코드를 받아 '아이디 코드'로 적어 주세요)` : '',
        r.badCode.length ? `확인 코드가 맞지 않거나 만료(24시간)·사용됨: ${r.badCode.join(', ')}` : '',
      ].filter(Boolean).join(' / ');
      if (msg && msg !== lastLog) console.log(`🛡️ deploy/admins.txt — ${msg}`);
      lastLog = msg;
    } catch (e) { console.error('운영자 목록 반영 실패', e); }
  };
  tick();
  setInterval(tick, Math.max(1000, ms)).unref();
}

/** 지금 운영자인 계정 (관리 명령·점검용) */
export const listAdmins = () => all("SELECT u.id, u.username, u.created_at, COALESCE(m.super, 0) AS super FROM users u LEFT JOIN admin_meta m ON m.user_id=u.id WHERE u.role = 'admin' ORDER BY u.id");
