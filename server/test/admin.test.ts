// 운영자 권한(가입 시 자동 지정 없음 · deploy/admins.txt · 늦게 가입한 같은 아이디 차단 · 회수) + 스크린 사진 신청 승인/반려/이력
// 실행: npm run test:admin
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAdmins } from '../src/admins';

const PORT = 3994;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-admin-'));
const adminsFile = path.join(dataDir, 'admins.txt');
let passed = 0, failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(p: string, body?: object, token?: string, method?: string) {
  const res = await fetch(BASE + p, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = null; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 40) }; }
  return { status: res.status, body: data };
}
let proc: ChildProcess | null = null;
let logs = '';
async function startServer() {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    // 운영 서버처럼: MUNGLE_ADMINS 가 있어도 가입 시 자동 운영자 없음 (ON_SIGNUP 없음)
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_ADMINS: 'squatter1', MUNGLE_ADMINS_ON_SIGNUP: '', MUNGLE_ADMINS_FILE: adminsFile, MUNGLE_ADMIN_SYNC_MS: '400' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (d) => { logs += String(d); });
  proc.stderr!.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); return; } catch { await sleep(200); } }
}
async function stopServer() { if (!proc) return; const p = proc; proc = null; p.kill(); await new Promise((r) => p.once('exit', r)); }
const signup = async (u: string) => { const r = await api('/api/auth/signup', { username: u, password: 'password123', nickname: u.slice(0, 8), dogName: '콩', agree: true }); return { id: r.body.profile?.id as number, token: r.body.token as string }; };
const role = async (t: string) => (await api('/api/me', undefined, t)).body?.profile?.role ?? (await api('/api/profile', undefined, t)).body?.profile?.role;
// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  console.log('\n[목록 파일 읽기 규칙]');
  const pa = parseAdmins('# 메모\nOwner_1  # 운영자\n-old_one\n@mid_dle\nx\nbad name\n-mid_dle\n');
  check('주석·빈 줄·형식 틀린 줄 무시, -는 회수, 같은 아이디가 양쪽이면 회수 우선', JSON.stringify(pa) === JSON.stringify({ grant: ['owner_1'], revoke: ['old_one', 'mid_dle'] }), pa);

  fs.writeFileSync(adminsFile, '# 비어 있음\n');
  await startServer();
  try {
    console.log('\n[가입할 때 아이디가 같다고 운영자가 되지 않음]');
    const sq = await signup('squatter1');
    const meSq = await api('/api/me', undefined, sq.token);
    check('MUNGLE_ADMINS 에 있는 아이디로 가입해도 일반 회원', (await api('/api/admin/reports', undefined, sq.token)).status === 403, meSq.status);
    const owner = await signup('owner_1');
    const user = await signup('plainuser');
    check('일반 회원은 관리 API 접근 불가 (403)', (await api('/api/admin/screen', undefined, user.token)).status === 403 && (await api('/api/admin/screen', undefined, owner.token)).status === 403);
    check('로그인 안 하면 401', (await api('/api/admin/screen')).status === 401);

    console.log('\n[deploy/admins.txt 로 운영자 지정 — 이미 가입한 계정만]');
    fs.writeFileSync(adminsFile, 'owner_1\nlatecomer\n');
    await sleep(1200);
    check('목록에 적은 기존 계정 → 운영자 (재로그인 없이 바로)', (await api('/api/admin/screen', undefined, owner.token)).status === 200);
    const late = await signup('latecomer');
    await sleep(1200);
    check('목록에 적힌 뒤에 같은 아이디로 가입한 계정은 운영자가 되지 않음', (await api('/api/admin/screen', undefined, late.token)).status === 403);
    check('서버 기록에 이유 남김', /목록에 적힌 뒤에 가입한 계정이라 운영자로 바꾸지 않음: latecomer/.test(logs));
    check('다른 회원은 그대로 일반 회원', (await api('/api/admin/screen', undefined, user.token)).status === 403);

    console.log('\n[스크린 사진 신청 → 승인 대기 저장 → 운영자 확인 → 승인/반려 → 반영·이력]');
    const r1 = await api('/api/screen', { consent: true, title: '보리 자랑해요', text: '산책 좋아해요', photo: PNG }, user.token);
    const r2 = await api('/api/screen', { consent: true, title: '두 번째 사진', photo: PNG }, user.token);
    check('이용자 신청 저장', r1.status === 200 && r2.status === 200, [r1.body, r2.body]);
    check('동의 없이 신청 불가', (await api('/api/screen', { title: 'x', photo: PNG }, user.token)).status === 400);
    const mine0 = (await api('/api/screen/mine', undefined, user.token)).body.items;
    check('이용자가 처리 상태 확인: 승인 대기', mine0.length === 2 && mine0.every((m: any) => m.status === 'pending'), mine0);
    const list0 = (await api('/api/admin/screen', undefined, owner.token)).body;
    const p1 = list0.pending.find((x: any) => x.title === '보리 자랑해요');
    check('운영자 목록: 신청자 닉네임·아이디·강아지·신청 시각·사진 주소', p1 && p1.author === 'plainuse' && p1.username === 'plainuser' && p1.dogName === '콩' && p1.ts > 0 && /^\/uploads\//.test(p1.image), p1);
    check('승인 전에는 광장 스크린에 없음', !(await api('/api/screen', undefined, user.token)).body.slides.some((s: any) => s.title === '보리 자랑해요'));
    const ap = await api(`/api/admin/screen/${p1.id}`, { action: 'approve' }, owner.token);
    check('승인', ap.status === 200, ap.body);
    check('승인 → 광장 스크린에 반영', (await api('/api/screen', undefined, user.token)).body.slides.some((s: any) => s.title === '보리 자랑해요'));
    const again = await api(`/api/admin/screen/${p1.id}`, { action: 'reject' }, owner.token);
    check('이미 처리된 신청은 다시 처리 안 됨 (409)', again.status === 409, again.body);
    const p2 = list0.pending.find((x: any) => x.title === '두 번째 사진');
    check('반려', (await api(`/api/admin/screen/${p2.id}`, { action: 'reject' }, owner.token)).status === 200);
    check('반려 → 스크린에 없음', !(await api('/api/screen', undefined, user.token)).body.slides.some((s: any) => s.title === '두 번째 사진'));
    const mine1 = (await api('/api/screen/mine', undefined, user.token)).body.items;
    check('이용자 상태: 승인 / 반려', mine1.find((m: any) => m.title === '보리 자랑해요')?.status === 'approved' && mine1.find((m: any) => m.title === '두 번째 사진')?.status === 'rejected', mine1);
    const list1 = (await api('/api/admin/screen', undefined, owner.token)).body;
    const h = (t: string) => list1.history.find((x: any) => x.title === t);
    check('처리 이력: 승인·반려 모두 남음 + 처리 시각·처리한 운영자', list1.pending.length === 0 && h('보리 자랑해요')?.status === 'approved' && h('두 번째 사진')?.status === 'rejected'
      && h('두 번째 사진').decidedAt > 0 && h('두 번째 사진').decidedBy === 'owner_1', list1.history);
    check('일반 회원은 승인 불가', (await api(`/api/admin/screen/${p2.id}`, { action: 'approve' }, user.token)).status === 403);
    check('내리기 → 이력에 남음', (await api(`/api/admin/screen/${p1.id}`, { action: 'hide' }, owner.token)).status === 200
      && (await api('/api/admin/screen', undefined, owner.token)).body.history.find((x: any) => x.id === p1.id)?.status === 'hidden');

    console.log('\n[권한 회수]');
    fs.writeFileSync(adminsFile, '-owner_1\n');
    await sleep(1200);
    check("'-아이디' → 운영자 권한 회수", (await api('/api/admin/screen', undefined, owner.token)).status === 403);
    void role;
  } finally {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); void stopServer(); process.exit(1); });
