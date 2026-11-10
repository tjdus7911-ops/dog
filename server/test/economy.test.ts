// 출석·코인·아파트 이사 테스트 — 실행: npm run test:economy
// 기존 사용자 마이그레이션은 '코인 도입 전 DB'를 직접 만들어 서버를 다시 켜는 방식으로 확인한다.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import { PLANS, insidePlan, type PlacedItem } from '../../shared/home';
import { spaceCollider } from '../../shared/spaces';
import { kstDay } from '../../shared/coins';

const PORT = 3997;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-eco-'));
let passed = 0, failed = 0;
const check = (name: string, cond: unknown, extra?: unknown) => { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(p: string, body?: object, token?: string, method?: string, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + p, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = null; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 40) }; }
  return { status: res.status, body: data };
}
async function signup(u: string, nick: string, dog: string) {
  const r = await api('/api/auth/signup', { username: u, password: 'password123', nickname: nick, dogName: dog, agree: true });
  return { id: r.body.profile.id as number, token: r.body.token as string };
}
const login = async (u: string) => (await api('/api/auth/login', { username: u, password: 'password123' })).body;
const coins = async (t: string, h: Record<string, string> = {}) => (await api('/api/coins', undefined, t, 'GET', h)).body.coins;
const rid = () => `req-${Math.random().toString(36).slice(2, 12)}`;

let proc: ChildProcess | null = null;
async function startServer(extraEnv: Record<string, string> = {}) {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_TEST_HOOKS: '1', MUNGLE_POOP_MIN_S: '99999', MUNGLE_POOP_MAX_S: '99999', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr!.on('data', (d) => { const t = String(d); if (!t.includes('ExperimentalWarning') && !t.includes('--trace-warnings') && !t.includes('[move]')) process.stderr.write(t); });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); return; } catch { await sleep(200); } }
}
async function stopServer() { if (!proc) return; const p = proc; proc = null; p.kill(); await new Promise((r) => p.once('exit', r)); }
/** 코인 직접 넣기 (테스트용: 실제 운영에서는 보상으로만 쌓임) */
function grant(userId: number, amount: number, ref: string) {
  const d = new DatabaseSync(path.join(dataDir, 'mungle.db'));
  const bal = Number((d.prepare('SELECT balance FROM wallets WHERE user_id=?').get(userId) as any)?.balance ?? 0) + amount;
  d.prepare('UPDATE wallets SET balance=? WHERE user_id=?').run(bal, userId);
  d.prepare("INSERT INTO coin_tx (user_id, amount, kind, ref, day, memo, balance_after, created_at) VALUES (?,?,'walk',?,'2000-01-01','테스트 적립',?,?)").run(userId, amount, ref, bal, Date.now());
  d.close();
}
function connect(token: string) {
  const s = io(BASE, { auth: { token }, transports: ['websocket'] });
  return new Promise<Socket>((r) => s.on('connect', () => r(s)));
}
const emit = <T = any>(s: Socket, ev: string, data?: unknown) => new Promise<T>((r) => s.emit(ev, data, r));

async function main() {
  try {
    // ================= 1) 코인 도입 전 DB 만들기 (기존 입주자 · 아직 입주 안 한 기존 가입자) =================
    console.log('\n[기존 데이터 마이그레이션]');
    await startServer();
    const old1 = await signup('legacy01', '옛주민', '누룽지');
    const old2 = await signup('legacy02', '옛가입', '보리');
    await api('/api/apartment/move-in', { building: '1', unit: '302' }, old1.token);
    const legacyLayout: PlacedItem[] = [{ type: 'sofa', n: 0, x: 2.0, z: 1.0, rot: 1 }, { type: 'plant', n: 0, x: -3.0, z: -2.0, rot: 0 }, { type: 'frame', n: 0, x: -1.2, z: -2.75, rot: 0, style: 'pink' }];
    await api('/api/home/me/layout', { layout: legacyLayout }, old1.token, 'PUT');
    await stopServer();
    // 코인 테이블을 지워 '도입 전' 상태로 되돌림 (사용자·집·배치는 그대로)
    {
      const d = new DatabaseSync(path.join(dataDir, 'mungle.db'));
      d.exec('DELETE FROM coin_tx; DELETE FROM wallets; DELETE FROM attendance; DELETE FROM app_meta;');
      d.close();
    }
    await startServer({ MUNGLE_WALK_COIN_M: '12', MUNGLE_WALK_COIN_S: '0', MUNGLE_MEETUP_TICK_S: '1', MUNGLE_MEETUP_COIN_S: '2' });
    const o1 = await login('legacy01');
    const o2 = await login('legacy02');
    check('기존 입주자: 호실 유지', o1.profile.residence?.building === '1' && o1.profile.residence?.unit === '302');
    const oh = await api('/api/home/me', undefined, o1.token);
    check('기존 입주자: 가구 배치 그대로 (원룸 연결)', oh.body.home.tier === 1 && JSON.stringify(oh.body.home.layout.map((i: PlacedItem) => [i.type, i.x, i.z, i.rot])) === JSON.stringify(legacyLayout.map((i) => [i.type, i.x, i.z, i.rot])), oh.body.home.layout);
    const c1 = await coins(o1.token);
    check('기존 입주자: 가입 보상 중복 없음 · 입주비 소급 차감 없음 (잔액 0, 거래 없음)', c1.balance === 0 && c1.earned.length === 0 && c1.spent.length === 0, c1);
    const c2 = await coins(o2.token);
    check('아직 입주 안 한 기존 가입자: 입주비만큼 시작 선물 1회 (불이익 없음)', c2.balance === 500 && c2.earned.length === 1, c2);
    await stopServer();
    await startServer({ MUNGLE_WALK_COIN_M: '12', MUNGLE_WALK_COIN_S: '0', MUNGLE_MEETUP_TICK_S: '1', MUNGLE_MEETUP_COIN_S: '2' });
    check('서버를 다시 켜도 마이그레이션 보상 중복 없음', (await coins(o2.token)).balance === 500);

    // ================= 2) 신규 가입 → 첫 입주 =================
    console.log('\n[신규 가입 · 첫 입주]');
    const a = await signup('ecoa01', '코인A', '콩떡');
    check('신규 가입 500코인', (await coins(a.token)).balance === 500);
    const tooHigh = await api('/api/apartment/move-in', { building: '2', unit: '101' }, a.token);
    check('처음부터 2동 입주 불가 (1동부터)', tooHigh.status === 400 && tooHigh.body.code === 'order');
    const mi = await api('/api/apartment/move-in', { building: '1', unit: '101' }, a.token);
    const ca = await coins(a.token);
    check('1동 원룸 입주 → 500코인 차감 (실질 무료)', mi.status === 200 && ca.balance === 0 && ca.spent[0]?.amount === -500 && mi.body.profile.residence.unit === '101', mi.body);
    const ha = await api('/api/home/me', undefined, a.token);
    check('원룸 기본 가구: 소파·테이블 대신 기본 세트·강아지 침대·액자', ha.body.home.tier === 1 && ['sofa', 'dogbed', 'frame'].every((t) => ha.body.home.layout.some((i: PlacedItem) => i.type === t)));
    const b = await signup('ecob01', '코인B', '보리');
    const dupUnit = await api('/api/apartment/move-in', { building: '1', unit: '101' }, b.token);
    check('이미 입주한 호실은 다른 사용자가 못 들어감', dupUnit.status === 409 && (await coins(b.token)).balance === 500);

    // ================= 3) 출석 =================
    console.log('\n[출석 체크]');
    // 기준 날짜는 지난 날짜로 고정 (실제 오늘과 같은 날이 되면 가입 보상 등 실제 시각 기록이 '오늘 획득'에 섞임)
    const day0 = Date.parse('2025-03-02T15:30:00Z'); // 한국 시간 3/3 00:30
    const H = (t: number) => ({ 'x-test-now': String(t) });
    const at1 = await api('/api/coins/attendance', {}, a.token, 'POST', H(day0));
    check('출석 100코인', at1.status === 200 && at1.body.got[0].amount === 100 && at1.body.coins.attendance.claimedToday);
    const at1b = await api('/api/coins/attendance', {}, a.token, 'POST', H(day0 + 3600_000));
    check('같은 날 두 번 출석 불가', at1b.status === 409 && at1b.body.coins.balance === 100);
    // 한국 시간 자정 직전(전날)과 직후
    const before = Date.parse('2025-03-03T14:59:00Z'); // 3/3 23:59 KST → 같은 날
    check('한국 시간 기준 날짜 (23:59는 같은 날)', (await api('/api/coins/attendance', {}, a.token, 'POST', H(before))).status === 409);
    for (let d = 1; d <= 6; d++) await api('/api/coins/attendance', {}, a.token, 'POST', H(day0 + d * 86400_000));
    const c7 = await coins(a.token, H(day0 + 6 * 86400_000));
    check('7일 연속 출석 → 100×7 + 보너스 300', c7.balance === 1000 && c7.attendance.streak === 7 && c7.attendance.cycleDone === 7 && c7.earned.some((t: any) => t.kind === 'streak7' && t.amount === 300), c7);
    await api('/api/coins/attendance', {}, a.token, 'POST', H(day0 + 8 * 86400_000)); // 하루 건너뜀
    const cGap = await coins(a.token, H(day0 + 8 * 86400_000));
    check('하루 빠지면 연속 출석 1일부터 다시', cGap.attendance.streak === 1 && cGap.attendance.cycleDone === 1 && cGap.balance === 1100);
    check('오늘 획득 코인 표시', cGap.todayEarned === 100);

    // ================= 4) 이사 =================
    console.log('\n[이사]');
    const short = await api('/api/apartment/move', { building: '2', requestId: rid() }, a.token);
    check('코인 부족 시 이사 제한 + 남은 코인 안내', short.status === 400 && short.body.code === 'insufficient' && /1,900코인 남았어요/.test(short.body.error), short.body);
    const skip = await api('/api/apartment/move', { building: '3', requestId: rid() }, a.token);
    check('1동 → 3동 건너뛰기 불가', skip.status === 400 && skip.body.code === 'order');
    grant(a.id, 2400, 'g1'); // 1100 + 2400 = 3500
    // 액자 사진 + 애견샵 가구 + 꾸민 배치 준비
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const ph = await api('/api/home/me/photos', { dataUrl: png }, a.token);
    await api('/api/shop/toybox/claim', {}, a.token);
    const myLayout: PlacedItem[] = [
      { type: 'frame', n: 0, x: 1.0, z: -2.75, rot: 0, photo: ph.body.photo.url, style: 'polaroid', scale: 1.2 },
      { type: 'frame', n: 1, x: 2.0, z: -2.75, rot: 0 },
      { type: 'toybox', n: 0, x: 2.5, z: 1.5, rot: 2 }, { type: 'sofa', n: 0, x: -2, z: 1, rot: 1 },
    ];
    check('이사 전 꾸미기 저장', (await api('/api/home/me/layout', { layout: myLayout }, a.token, 'PUT')).status === 200);
    // 이사 실패 → 모두 되돌림
    const failMove = await api('/api/apartment/move', { building: '2', requestId: rid() }, a.token, 'POST', { 'x-test-fault': 'move' });
    const afterFail = await coins(a.token);
    const resFail = (await api('/api/me', undefined, a.token)).body.profile.residence;
    const homeFail = (await api('/api/home/me', undefined, a.token)).body.home;
    check('이사 중 오류 → 코인·거주지·가구 모두 이전 상태', failMove.status === 500 && afterFail.balance === 3500 && resFail.building === '1' && resFail.unit === '101' && homeFail.layout.length === 4 && afterFail.spent.length === 1, { failMove: failMove.body, bal: afterFail.balance, resFail });
    // 중복 클릭: 같은 요청 번호 2번 + 다른 요청 번호 동시
    const req1 = rid();
    const [m1, m2, m3] = await Promise.all([
      api('/api/apartment/move', { building: '2', requestId: req1 }, a.token),
      api('/api/apartment/move', { building: '2', requestId: req1 }, a.token),
      api('/api/apartment/move', { building: '2', requestId: rid() }, a.token),
    ]);
    const okCount = [m1, m2, m3].filter((r) => r.status === 200).length;
    const afterMove = await coins(a.token);
    check('중복 클릭해도 한 번만 이사·결제', okCount === 1 && afterMove.balance === 500 && afterMove.spent.filter((t: any) => t.kind === 'move').length === 1, [m1.status, m2.status, m3.status, afterMove.balance]);
    const moved = [m1, m2, m3].find((r) => r.status === 200)!.body;
    check('이사 비용 정확히 3,000코인 차감', afterMove.spent[0].amount === -3000 && afterMove.spent[0].balance === 500);
    check('2동으로 이사 + 새 호수 배정', moved.residence.building === '2' && /^\d{3}$/.test(moved.residence.unit) && moved.profile.residence.building === '2');
    const nh = moved.home;
    const photoFrame = nh.layout.find((i: PlacedItem) => i.type === 'frame' && i.photo === ph.body.photo.url);
    check('액자 사진·디자인·크기 유지, 새집 벽에 걸림 (옛 위치 사용 안 함)', photoFrame && photoFrame.style === 'polaroid' && photoFrame.scale === 1.2 && !(photoFrame.x === 1.0 && photoFrame.z === -2.75), photoFrame);
    check('새집 기본 가구 배치 + 사람 침대 선물', nh.tier === 2 && nh.layout.some((i: PlacedItem) => i.type === 'bed_cream') && nh.owned.includes('bed_cream'));
    check('보유 가구 유지 (애견샵 가구는 보관함으로)', nh.owned.includes('toybox') && !nh.layout.some((i: PlacedItem) => i.type === 'toybox'));
    const placeToy = await api('/api/home/me/layout', { layout: [...nh.layout, { type: 'toybox', n: 0, x: 3.5, z: 1.5, rot: 0 }] }, a.token, 'PUT');
    check('보관함 가구를 새집 침실에 다시 배치 가능', placeToy.status === 200 && placeToy.body.home.layout.some((i: PlacedItem) => i.type === 'toybox' && i.x === 3.5));
    const inWall = await api('/api/home/me/layout', { layout: [...nh.layout, { type: 'toybox', n: 0, x: 0.8, z: -1.0, rot: 0 }] }, a.token, 'PUT');
    check('방 사이 벽 위에는 가구를 둘 수 없음', inWall.status === 400);
    const oldBack = await api('/api/apartment/move', { building: '1', requestId: rid() }, a.token);
    check('이미 거주했던 1동으로 돌아가기 불가', oldBack.status === 400 && oldBack.body.code === 'order');
    // 옛 호실 반환 → 다른 사용자 입주 가능
    const bIn = await api('/api/apartment/move-in', { building: '1', unit: '101' }, b.token);
    check('이사 후 옛 호수(1동 101호)는 다른 사용자가 입주 가능', bIn.status === 200 && bIn.body.profile.residence.unit === '101');
    // 두 사용자가 2동으로 이사 → 호수 중복 없음
    grant(b.id, 3000, 'g2');
    const bMove = await api('/api/apartment/move', { building: '2', requestId: rid() }, b.token);
    check('같은 동으로 이사한 두 사용자의 호수가 다름', bMove.status === 200 && bMove.body.residence.unit !== moved.residence.unit, [bMove.body.residence, moved.residence]);
    const plans = (await api('/api/apartment/plans', undefined, a.token)).body;
    check('이사 선택 정보: 현재 2동 · 1동은 지난 집 · 3동은 코인 부족', plans.current === 2 && plans.plans[0].status === 'past' && plans.plans[1].status === 'current' && plans.plans[2].status === 'insufficient' && plans.plans[2].need === 9500, plans.plans.map((p: any) => [p.status, p.need]));
    grant(a.id, 9500, 'g3');
    const to3 = await api('/api/apartment/move', { building: '3', requestId: rid() }, a.token);
    check('2동 → 3동 이사 (10,000코인) + 놀이방 시설 선물', to3.status === 200 && to3.body.coins.balance === 0 && to3.body.home.tier === 3 && ['play_tunnel', 'ball_pit', 'play_steps'].every((t) => to3.body.home.owned.includes(t)));
    check('3동에서도 액자 사진 유지', to3.body.home.layout.some((i: PlacedItem) => i.photo === ph.body.photo.url));

    // ================= 5) 새집 내부 이동 · 방문 =================
    console.log('\n[새집 내부 이동 · 친구 방문]');
    const p3 = PLANS[3];
    const col = spaceCollider('home', [], 3);
    const [wx, wz] = col(-1.0, -0.4, 0.3); // 가로 벽 한가운데 → 밀려남
    check('벽 통과 불가 (충돌 처리)', Math.abs(wz + 0.4) >= 0.39, [wx, wz]);
    const [dx, dz] = col(-3.0, -0.4, 0.3); // 문 자리 → 통과
    check('문으로는 지나감', Math.abs(dx + 3.0) < 0.01 && Math.abs(dz + 0.4) < 0.01);
    check('평면도: 침실·놀이방 안쪽 좌표', insidePlan(p3, -3, -3) && insidePlan(p3, 3, -3) && !insidePlan(p3, 0, -2));
    const sa = await connect(a.token);
    const j = await emit(sa, 'park:join', { parkId: `home-${a.id}` });
    check('새집 입장: 등급·정원·현관 위치', j.ok && j.park.tier === 3 && j.park.capacity === 16 && Math.abs(j.spawn[1] - p3.spawn[1]) < 0.01, j);
    let corrected = false;
    sa.on('correct', () => { corrected = true; });
    // 거실 → 문 → 놀이방까지 걸어가기 (서버가 받아 주는지)
    const path3: [number, number][] = [[0, 3.4], [1.0, 2.6], [2.0, 1.8], [3.0, 1.0], [3.0, 0.2], [3.0, -0.6], [3.0, -1.4], [3.4, -2.2], [4.0, -3.0]];
    for (const [x, z] of path3) { sa.emit('state', [x, z, 0, 1, x + 0.5, z, 0, 1]); await sleep(400); }
    check('놀이방까지 이동 (서버 위치 검증 통과)', !corrected);
    sa.emit('state', [8.5, 0, 0, 1, 8.5, 0, 0, 1]); await sleep(300);
    check('집 밖 좌표는 서버가 되돌림', corrected);
    // 친구 방문: 실제 거주 중인 새집으로
    const sb = await connect(b.token);
    await emit(sa, 'friend:request', { userId: b.id }); await emit(sb, 'friend:accept', { userId: a.id });
    const fj = await emit(sb, 'park:join', { parkId: `home-${a.id}` });
    check('친구 집 방문 → 실제 사는 3동 집', fj.ok && fj.park.tier === 3 && /3동/.test(fj.park.name));
    const fh = await api(`/api/home/${a.id}`, undefined, b.token);
    check('방문자는 집 정보를 볼 수 있지만 보유 가구 목록은 비공개', fh.status === 200 && fh.body.home.tier === 3 && fh.body.home.owned.length === 0 && !fh.body.home.isOwner);
    const beforeA = JSON.stringify((await api('/api/home/me', undefined, a.token)).body.home.layout);
    const hack = await api(`/api/home/${a.id}/layout`, { layout: [] }, b.token, 'PUT');
    await api('/api/home/me/layout', { layout: [] }, b.token, 'PUT'); // 방문자가 바꿀 수 있는 건 자기 집뿐
    check('방문자는 남의 집 가구를 바꿀 수 없음 (자기 집 경로만 수정)', hack.status !== 200 && JSON.stringify((await api('/api/home/me', undefined, a.token)).body.home.layout) === beforeA);
    const friends = await emit(sb, 'friend:list');
    check('친구 목록에 새 주소 반영', JSON.stringify(friends).includes('"building":"3"'), friends);
    sa.close(); sb.close();

    // ================= 6) 산책 · 멍글런너 · 동네 모임 보상 =================
    console.log('\n[보상 지급]');
    const w = await signup('ecow01', '산책러', '호두');
    const sw = await connect(w.token);
    const earned: any[] = [];
    sw.on('coins:earned', (e) => earned.push(e));
    await emit(sw, 'park:join', { parkId: 'central-1' });
    const pj = await emit(sw, 'park:join', { parkId: 'central-1' });
    let [px, pz] = pj.spawn;
    // 걷지 않고 서 있기만 하면 보상 없음
    for (let i = 0; i < 4; i++) { sw.emit('state', [px, pz, 0, 0, px, pz, 0, 0]); await sleep(300); }
    check('서 있기만 하면 산책 보상 없음', earned.length === 0);
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 10; i++) { px += (i % 2 ? 1 : -1) * 0; pz += (k % 2 ? 1 : -1) * 0.9; sw.emit('state', [px, pz, 0, 1, px + 0.5, pz, 0, 1]); await sleep(260); }
    }
    await sleep(300);
    const walkE = earned.filter((e) => e.kind === 'walk');
    check('실제로 걸으면 산책 보상 30코인, 하루 최대 3번', walkE.length === 3 && walkE.every((e) => e.amount === 30), earned);
    // 순간이동은 거리로 치지 않음
    const before2 = earned.length;
    sw.emit('state', [px + 30, pz, 0, 1, px + 30, pz, 0, 1]); await sleep(300);
    check('순간이동(속도 초과)은 산책 거리로 인정 안 함', earned.length === before2);
    // 동네 모임: 온라인 모임 공원에 함께 있는 시간
    const mt = await api('/api/meetups', { title: '코인 산책 모임', kind: 'online', park: 'central-1', startsAt: Date.now() + 10 * 60_000 + 1500, capacity: 5, sizeRule: 'any', temperRule: 'any' }, w.token);
    check('온라인 모임 만들기', mt.status === 200, mt.body);
    await sleep(4500);
    const mtE = earned.filter((e) => e.kind === 'meetup');
    check('모임 시간에 모임 공원에 함께 있으면 50코인 (하루 1번)', mtE.length === 1 && mtE[0].amount === 50, earned);
    const nonMember = await signup('ecox01', '구경꾼', '밤톨');
    const sx = await connect(nonMember.token);
    const xe: any[] = []; sx.on('coins:earned', (e) => xe.push(e));
    await emit(sx, 'park:join', { parkId: 'central-1' });
    await sleep(3500);
    check('참가하지 않은 사람은 같은 공원에 있어도 모임 보상 없음', xe.filter((e) => e.kind === 'meetup').length === 0);
    sw.close(); sx.close();
    const cw = await coins(w.token);
    check('지갑: 오늘 획득 · 일일 한도 표시', cw.todayEarned === 500 + 30 * 3 + 50 && cw.daily.walk.count === 3 && cw.daily.walk.max === 3 && cw.daily.meetup.count === 1, cw);

    // ================= 7) 재로그인 후 유지 =================
    console.log('\n[재로그인]');
    await stopServer();
    await startServer();
    const re = await login('ecoa01');
    const rc = await coins(re.token);
    const rh = (await api('/api/home/me', undefined, re.token)).body.home;
    check('서버 재시작·재로그인 후 코인·거래 내역·집 정보 유지', rc.balance === 0 && rc.spent.length === 3 && re.profile.residence.building === '3' && rh.tier === 3 && rh.layout.some((i: PlacedItem) => i.photo === ph.body.photo.url));
    const hist = new DatabaseSync(path.join(dataDir, 'mungle.db'));
    const hrows = hist.prepare('SELECT building FROM residence_history WHERE user_id=? ORDER BY id').all(a.id) as any[];
    hist.close();
    check('거주 이력 기록 (1동 → 2동)', hrows.map((r) => r.building).join() === '1,2');
    const g = await api('/api/auth/guest', {});
    check('둘러보기 방문자는 코인 없음', (await api('/api/coins', undefined, g.body.token)).status === 403);
    check('날짜 계산: 한국 시간 자정', kstDay(Date.parse('2026-11-03T14:59:59Z')) === '2026-11-03' && kstDay(Date.parse('2026-11-03T15:00:00Z')) === '2026-11-04');
  } finally {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); stopServer().finally(() => process.exit(1)); });
