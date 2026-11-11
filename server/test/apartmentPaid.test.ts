// 아파트 유료 입주(원룸 500 · 투룸 1,000 · 쓰리룸 1,500) · 400호대 · 가입 보상 · 매일 출석 · 둘러보기 제한
// 실행: npm run test:apartment-paid
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { APARTMENT_BUILDINGS, unitsOf } from '../../shared/apartment';
import { PLANS } from '../../shared/home';

const PORT = 3992;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-paid-'));
let passed = 0, failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(p: string, body?: object, token?: string, method?: string, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + p, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = null; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 40) }; }
  return { status: res.status, body: data };
}
let proc: ChildProcess | null = null;
async function startServer(env: Record<string, string> = {}) {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    // MUNGLE_APARTMENT_FREE 를 주지 않음 → 기본값(유료)
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_TEST_HOOKS: '1', MUNGLE_APARTMENT_FREE: '', MUNGLE_ADMINS: 'paidadmin', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr!.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); return; } catch { await sleep(200); } }
}
async function stopServer() { if (!proc) return; const p = proc; proc = null; p.kill(); await new Promise((r) => p.once('exit', r)); }
function grant(userId: number, amount: number, ref: string) {
  const d = new DatabaseSync(path.join(dataDir, 'mungle.db'));
  const bal = Number((d.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId) as any)?.balance ?? 0) + amount;
  d.prepare('UPDATE wallets SET balance=? WHERE user_id=?').run(bal, userId);
  d.prepare("INSERT INTO coin_tx (user_id, amount, kind, ref, day, memo, balance_after, created_at) VALUES (?,?,'walk',?,'2000-01-01','테스트 적립',?,?)").run(userId, amount, ref, bal, Date.now());
  d.close();
}
const signup = async (u: string) => { const r = await api('/api/auth/signup', { username: u, password: 'password123', nickname: u.slice(0, 8), dogName: '콩', agree: true }); return { id: r.body.profile?.id as number, token: r.body.token as string, body: r.body }; };
const coins = async (t: string, h: Record<string, string> = {}) => (await api('/api/coins', undefined, t, 'GET', h)).body.coins;

async function main() {
  await startServer();
  try {
    console.log('\n[호수 목록: 원룸·투룸·쓰리룸 전체 · 400호대]');
    const expect = (floors: number, per: number) => Array.from({ length: floors }, (_, f) => Array.from({ length: per }, (_, n) => `${f + 1}${String(n + 1).padStart(2, '0')}`)).flat().sort();
    const a = await signup('paiduser1');
    const ap = (await api('/api/apartment', undefined, a.token)).body;
    const list = (id: string) => ap.buildings.find((b: any) => b.id === id).units.map((u: any) => u.unit).sort();
    check('원룸(1동) 101~404 · 16호', JSON.stringify(list('1')) === JSON.stringify(expect(4, 4)), list('1'));
    check('투룸(2동) 101~403 · 12호 (401·402·403 포함)', JSON.stringify(list('2')) === JSON.stringify(expect(4, 3)), list('2'));
    check('쓰리룸(3동) 101~403 · 12호 (401·402·403 포함)', JSON.stringify(list('3')) === JSON.stringify(expect(4, 3)), list('3'));
    check('공용 호수 규칙과 서버 목록이 같음', APARTMENT_BUILDINGS.every((b) => unitsOf(b).length === ap.buildings.find((x: any) => x.id === b.id).units.length));
    check('기본 운영 설정: 유료 입주', ap.freeAccess === false);

    console.log('\n[신규 가입 보상 500 · 1회]');
    const c0 = await coins(a.token);
    check('가입하자마자 500 멍글코인', c0.balance === 500 && c0.earned.filter((t: any) => t.kind === 'signup').length === 1 && c0.earned[0].amount === 500, c0);
    const d = new DatabaseSync(path.join(dataDir, 'mungle.db'));
    check('지급 내역 서버 저장 (coin_tx signup)', Number((d.prepare("SELECT COUNT(*) n FROM coin_tx WHERE user_id=? AND kind='signup'").get(a.id) as any).n) === 1);
    d.close();
    const dupSignup = await api('/api/auth/signup', { username: 'paiduser1', password: 'password123', nickname: 'x', dogName: 'y', agree: true });
    check('같은 아이디로 다시 가입 불가 → 중복 지급 없음', dupSignup.status >= 400 && (await coins(a.token)).balance === 500);

    console.log('\n[입주 비용: 원룸 500 · 투룸 1,000 · 쓰리룸 1,500]');
    check('가격 설정', PLANS[1].price === 500 && PLANS[2].price === 1000 && PLANS[3].price === 1500);
    const plans0 = (await api('/api/apartment/plans', undefined, a.token)).body;
    check('선택 화면 정보: 가격·상태 (잔액 500 → 원룸만 가능)', plans0.plans.map((p: any) => `${p.price}:${p.status}`).join(',') === '500:available,1000:insufficient,1500:insufficient', plans0.plans.map((p: any) => [p.price, p.status]));
    const tooPoor = await api('/api/apartment/move-in', { building: '3', unit: '401' }, a.token);
    check('코인 부족 → 쓰리룸 입주 불가 · 차감 없음 · 호실 비어 있음', tooPoor.status === 400 && tooPoor.body.code === 'insufficient' && (await coins(a.token)).balance === 500 && !(await api('/api/me', undefined, a.token)).body.profile.residence);
    grant(a.id, 1000, 'g-a'); // 1,500
    // 연속 클릭(같은 요청 동시 3번) → 한 번만 입주·결제
    const r3 = await Promise.all([0, 1, 2].map(() => api('/api/apartment/move-in', { building: '3', unit: '401' }, a.token)));
    const ca = await coins(a.token);
    check('쓰리룸 401호 입주 (400호대) · 1,500 차감 · 동시 클릭 3번에도 1번만 결제', r3.filter((r) => r.status === 200).length === 1 && ca.balance === 0 && ca.spent.filter((t: any) => t.kind === 'movein').length === 1 && ca.spent[0].amount === -1500, [r3.map((r) => r.status), ca.balance]);
    const me = (await api('/api/me', undefined, a.token)).body.profile;
    check('호수·소유 정보 저장 (3동 401호)', me.residence.building === '3' && me.residence.unit === '401');
    const home = (await api('/api/home/me', undefined, a.token)).body.home;
    check('쓰리룸 집 생성 (등급 3)', home.tier === 3);
    check('이미 입주한 사람은 또 입주 불가 (중복 결제 없음)', (await api('/api/apartment/move-in', { building: '1', unit: '101' }, a.token)).status === 409 && (await coins(a.token)).balance === 0);

    const b = await signup('paiduser2');
    grant(b.id, 500, 'g-b'); // 1,000
    const bIn = await api('/api/apartment/move-in', { building: '2', unit: '403' }, b.token);
    const cb = await coins(b.token);
    check('투룸 403호 입주 (400호대) · 1,000 차감', bIn.status === 200 && bIn.body.profile.residence.unit === '403' && cb.balance === 0 && cb.spent[0].amount === -1000, bIn.body);
    const u3 = await signup('paiduser3');
    grant(u3.id, 500, 'g-u3');
    const taken = await api('/api/apartment/move-in', { building: '2', unit: '403' }, u3.token);
    check('이미 입주한 호실은 다른 회원이 못 들어감 · 차감 없음', taken.status === 409 && (await coins(u3.token)).balance === 1000, taken.body);
    const c = await signup('paiduser4');
    const cIn = await api('/api/apartment/move-in', { building: '1', unit: '404' }, c.token);
    check('원룸 404호 입주 (가입 선물로 바로) · 500 차감', cIn.status === 200 && (await coins(c.token)).balance === 0);
    const ap2 = (await api('/api/apartment', undefined, a.token)).body;
    const occ = (id: string, u: string) => ap2.buildings.find((x: any) => x.id === id).units.find((x: any) => x.unit === u).occupied;
    check('안내판에 입주 표시 (3동 401 · 2동 403 · 1동 404)', occ('3', '401') && occ('2', '403') && occ('1', '404'));

    console.log('\n[매일 출석 100 · 한국 시간 자정 기준 · 하루 1번]');
    const day0 = Date.parse('2025-06-01T15:10:00Z'); // 한국 6/2 00:10
    const H = (t: number) => ({ 'x-test-now': String(t) });
    const at1 = await api('/api/coins/attendance', {}, c.token, 'POST', H(day0));
    check('첫 접속 출석 +100', at1.status === 200 && at1.body.got[0].amount === 100 && at1.body.coins.balance === 100);
    const again = await Promise.all([0, 1, 2].map(() => api('/api/coins/attendance', {}, c.token, 'POST', H(day0 + 60_000))));
    check('새로고침·여러 탭(동시 3번)에도 같은 날은 0번 더', again.every((r) => r.status === 409) && (await coins(c.token)).balance === 100);
    const relog = await api('/api/auth/login', { username: 'paiduser4', password: 'password123' });
    check('재로그인해도 같은 날 중복 없음', (await api('/api/coins/attendance', {}, relog.body.token, 'POST', H(day0 + 7200_000))).status === 409);
    check('한국 시간 23:59까지 같은 날', (await api('/api/coins/attendance', {}, c.token, 'POST', H(Date.parse('2025-06-02T14:59:00Z')))).status === 409);
    const next = await api('/api/coins/attendance', {}, c.token, 'POST', H(Date.parse('2025-06-02T15:00:30Z'))); // 6/3 00:00:30 KST
    check('자정이 지나면 다시 +100 (연속 2일)', next.status === 200 && next.body.streak === 2 && next.body.coins.balance === 200);
    const d2 = new DatabaseSync(path.join(dataDir, 'mungle.db'));
    check('출석·지급 기록 서버 저장', Number((d2.prepare('SELECT COUNT(*) n FROM attendance WHERE user_id=?').get(c.id) as any).n) === 2 && Number((d2.prepare("SELECT COUNT(*) n FROM coin_tx WHERE user_id=? AND kind='attendance'").get(c.id) as any).n) === 2);
    d2.close();

    console.log('\n[둘러보기 이용자]');
    const g = (await api('/api/auth/guest', {})).body;
    check('둘러보기 시작', !!g.token && g.profile.role === 'guest');
    const gAp = await api('/api/apartment', undefined, g.token);
    check('아파트 건물·호수 목록 구경 가능', gAp.status === 200 && gAp.body.buildings.length === 3 && gAp.body.buildings[2].units.some((u: any) => u.unit === '401'));
    const gIn = await api('/api/apartment/move-in', { building: '1', unit: '101' }, g.token);
    check('실제 입주 불가 (회원 전용)', gIn.status === 403 && gIn.body.code === 'members_only');
    check('입주 정보 저장 안 됨', !(await api('/api/me', undefined, g.token)).body.profile?.residence);
    check('가입 보상·코인 없음', (await api('/api/coins', undefined, g.token)).status === 403);
    check('출석 보상 없음', (await api('/api/coins/attendance', {}, g.token)).status === 403);
    const gs: Socket = io(BASE, { auth: { token: g.token }, transports: ['websocket'] });
    await new Promise((r) => gs.on('connect', r));
    const emit = (ev: string, data?: unknown) => new Promise<any>((r) => gs.emit(ev, data, r));
    const lob = await emit('park:join', { parkId: 'lobby-1' });
    check('아파트 로비 구경 가능', lob.ok === true, lob);
    const hv = await emit('park:join', { parkId: `home-${a.id}` });
    check('남의 집 들어가기는 회원 전용', hv.ok === false);
    const park = await emit('park:join', {});
    check('마을(광장) 구경 가능', park.ok === true);
    gs.close();

    console.log('\n[기존 입주자 데이터 보존]');
    const before = { me: (await api('/api/me', undefined, a.token)).body.profile.residence, coins: (await coins(a.token)).balance, home: JSON.stringify((await api('/api/home/me', undefined, a.token)).body.home.layout) };
    const admin = await signup('paidadmin');
    await api('/api/admin/settings', { apartmentFreeAccess: true }, admin.token);
    await api('/api/admin/settings', { apartmentFreeAccess: false }, admin.token);
    await stopServer();
    await startServer();
    const after = { me: (await api('/api/me', undefined, a.token)).body.profile.residence, coins: (await coins(a.token)).balance, home: JSON.stringify((await api('/api/home/me', undefined, a.token)).body.home.layout) };
    check('설정 변경·서버 재시작 후에도 호수·코인·가구 그대로', JSON.stringify(before) === JSON.stringify(after), [before.me, after.me, before.coins, after.coins]);
  } finally {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); proc?.kill(); process.exit(1); });
