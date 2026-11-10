// 멍글런너 함께 달리기(실시간 멀티플레이) 테스트 — 실행: npm run test:runner-multi
// 실제 소켓 클라이언트 4개로 방 만들기 → 참가 → 준비 → 동시 출발 → 입력 → 서버 판정·순위·코인을 확인한다.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import { buildChart, type Lane } from '../../shared/runner';
import { kstDay } from '../../shared/coins';
import type { MRResult, MRRoom, MRStanding } from '../../shared/runnerMulti';

const PORT = 3995;
const BASE = `http://localhost:${PORT}`;
const DUR = 16000; // 테스트에서는 곡 앞부분 16초만
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-rm-'));
let passed = 0, failed = 0;
const check = (name: string, cond: unknown, extra?: unknown) => { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(p: string, body?: object, token?: string) {
  const res = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return (await res.json()) as any;
}
async function user(u: string, nick: string, dog: string) {
  const r = await api('/api/auth/signup', { username: u, password: 'password123', nickname: nick, dogName: dog, agree: true });
  return { id: r.profile.id as number, token: r.token as string };
}
interface Client { s: Socket; id: number; token: string; events: Record<string, any[]> }
async function client(u: { id: number; token: string }): Promise<Client> {
  const s = io(BASE, { auth: { token: u.token }, transports: ['websocket'], reconnection: false });
  await new Promise<void>((r) => s.on('connect', () => r()));
  const c: Client = { s, id: u.id, token: u.token, events: {} };
  for (const ev of ['rm:room', 'rm:start', 'rm:input', 'rm:standings', 'rm:result', 'rm:notice', 'runner:invite', 'coins:earned']) s.on(ev, (d) => (c.events[ev] ??= []).push(d));
  return c;
}
const emit = <T = any>(c: Client, ev: string, data?: unknown) => new Promise<T>((r) => c.s.emit(ev, data, r));
const last = (c: Client, ev: string) => c.events[ev]?.[c.events[ev].length - 1];
/** 서버 시각 기준으로 박자에 맞춰 입력 보내기 (jitter ms 만큼 사람처럼 어긋남) */
function playBot(c: Client, round: number, startAt: number, difficulty: 'easy' | 'normal', jitter: number, seed: number, stopAt = DUR, queue?: { t: number; a: string }[], fromT = -Infinity) {
  const chart = buildChart('elise', difficulty)!;
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let lane: number = 0;
  const plan: { t: number; a: string }[] = [];
  for (const o of chart.obstacles) {
    if (o.t > stopAt) break;
    const t = Math.round(o.t + (rnd() * 2 - 1) * jitter);
    if (o.need === 'jump') plan.push({ t, a: 'J' });
    else if (o.need === 'duck') plan.push({ t, a: 'D' });
    else if (o.blocked.includes(lane as Lane)) {
      const tgt = [...o.safe].sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane))[0];
      while (lane !== tgt) { const a = tgt > lane ? 'R' : 'L'; plan.push({ t, a }); lane += a === 'R' ? 1 : -1; }
    }
  }
  plan.sort((a, b) => a.t - b.t).forEach((x, i) => plan[i] = { ...x, t: Math.max(x.t, plan[i - 1]?.t ?? -1e9) });
  const timers = plan.filter((x) => x.t > fromT).map((x) => setTimeout(() => {
    if (queue && !c.s.connected) { queue.push(x); return; }
    c.s.emit('rm:input', { round, t: x.t, a: x.a });
  }, Math.max(0, startAt + x.t - Date.now())));
  return { plan, cancel: () => timers.forEach(clearTimeout) };
}

let proc: ChildProcess | null = null;
async function main() {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_MR_DURATION_MS: String(DUR), MUNGLE_MR_END_GRACE_MS: '800', MUNGLE_MR_LOBBY_GRACE_MS: '1500', MUNGLE_POOP_MIN_S: '99999', MUNGLE_POOP_MAX_S: '99999' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr!.on('data', (d) => { const t = String(d); if (!t.includes('ExperimentalWarning') && !t.includes('--trace-warnings')) process.stderr.write(t); });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await sleep(200); } }
  try {
    const ua = await user('rma01', '하나', '콩떡'), ub = await user('rmb01', '두리', '보리'), uc = await user('rmc01', '세찌', '호두'), ud = await user('rmd01', '네모', '밤톨'), ue = await user('rme01', '다섯', '감자');
    // 오늘 이미 혼자 달리기로 2번 보상을 받은 상태 (하나) → 함께 달리기 보상은 1번만 남음
    {
      const d = new DatabaseSync(path.join(dataDir, 'mungle.db'));
      const day = kstDay(Date.now());
      for (const k of [1, 2]) d.prepare("INSERT INTO coin_tx (user_id, amount, kind, ref, day, memo, balance_after, created_at) VALUES (?,50,'runner',?,?,'멍글런너 완주',?,?)").run(ua.id, `run-test${k}`, day, 500 + 50 * k, Date.now());
      d.prepare('UPDATE wallets SET balance=600 WHERE user_id=?').run(ua.id);
      d.close();
    }
    const A = await client(ua), B = await client(ub), C = await client(uc), D = await client(ud), E = await client(ue);

    console.log('\n[방 만들기 · 참가]');
    const g = await api('/api/auth/guest', {});
    const G = await client({ id: 0, token: g.token });
    check('둘러보기 방문자는 함께 달리기 불가', (await emit(G, 'rm:create', {})).code === 'members_only');
    G.s.close();
    const cr = await emit(A, 'rm:create', { courseId: 'elise', difficulty: 'normal' });
    const code = cr.room?.code as string;
    check('방 만들기 → 6자리 코드 · 방장', cr.ok && /^[A-HJ-NP-Z2-9]{6}$/.test(code) && cr.room.hostId === ua.id && cr.room.players[0].host);
    check('잘못된 코드 거부', !(await emit(B, 'rm:join', { code: 'AAAAA' })).ok && (await emit(B, 'rm:join', { code: 'ZZZZZZ' })).code === 'not_found');
    for (const c of [B, C]) await emit(c, 'rm:join', { code: code.toLowerCase() });
    check('친구가 아니면 초대 불가', !(await emit(A, 'rm:invite', { userId: ue.id })).ok);
    const fr1 = await emit(A, 'friend:request', { userId: ue.id }); const fr2 = await emit(E, 'friend:accept', { userId: ua.id });
    const inv = await emit(A, 'rm:invite', { userId: ue.id });
    await sleep(300);
    check('멍글마을 친구 초대 → 방 코드 알림', inv.ok && last(E, 'runner:invite')?.code === code, [fr1, fr2, inv]);

    await emit(D, 'rm:join', { code: code.toLowerCase() });
    await sleep(200);
    const room4: MRRoom = last(A, 'rm:room');
    check('방 코드로 4명 참가 (소문자도 가능) · 참가자 프로필·강아지 이름', room4.players.length === 4 && room4.players.map((p) => p.dogName).join() === '콩떡,보리,호두,밤톨');
    check('5번째 참가 거부 (최대 4명)', (await emit(E, 'rm:join', { code })).code === 'full');
    check('방이 가득 차면 초대도 막힘', !(await emit(A, 'rm:invite', { userId: ue.id })).ok);
    check('이미 방에 있으면 새 방 만들기 불가', (await emit(B, 'rm:create', {})).code === 'in_room');

    console.log('\n[곡·난이도 · 준비]');
    check('방장 아닌 사람은 곡·난이도 변경 불가', !(await emit(B, 'rm:settings', { difficulty: 'easy' })).ok);
    await emit(B, 'rm:ready', { ready: true }); await emit(C, 'rm:ready', { ready: true });
    await emit(A, 'rm:settings', { difficulty: 'easy' }); await sleep(150);
    const rs: MRRoom = last(B, 'rm:room');
    check('방장이 난이도 변경 → 모두 준비 해제', rs.difficulty === 'easy' && rs.players.every((p) => !p.ready));
    check('아직 음원 없는 곡은 선택 불가', !(await emit(A, 'rm:settings', { courseId: 'danube' })).ok);
    for (const c of [A, B, C]) await emit(c, 'rm:ready', { ready: true });
    await sleep(300);
    check('한 명이라도 준비 전이면 시작 안 함', !A.events['rm:start'] && last(A, 'rm:room').players.filter((p: any) => p.ready).length === 3);
    const clk = await emit(A, 'rm:clock');
    check('서버 시계 (시작 시각 동기화용)', clk.ok && Math.abs(clk.now - Date.now()) < 1000);
    await emit(D, 'rm:ready', { ready: true });
    await sleep(300);
    const starts = [A, B, C, D].map((c) => last(c, 'rm:start'));
    const st = starts[0];
    check('전원 준비 → 모두에게 같은 시작 시각 (3초 카운트다운 뒤 동시 출발)', starts.every((x) => x && x.startAt === st.startAt && x.round === 1) && st.startAt - Date.now() > 2500 && st.difficulty === 'easy', starts);
    check('달리기 시작한 방은 새로 참가 불가', (await emit(E, 'rm:join', { code })).code === 'started');

    console.log('\n[달리기 · 실시간 동기화]');
    // 하나: 정확 / 두리: 조금 어긋남 / 세찌: 중간에 연결이 끊겼다 다시 들어옴 / 네모: 가만히 있음(자리만 지킴)
    playBot(A, 1, st.startAt, 'easy', 25, 3);
    playBot(B, 1, st.startAt, 'easy', 110, 5);
    const queued: { t: number; a: string }[] = [];
    const botC = playBot(C, 1, st.startAt, 'easy', 60, 7, DUR, queued);
    // 미래 시각 입력은 거부
    D.s.emit('rm:input', { round: 1, t: 999999, a: 'J' });
    await sleep(st.startAt - Date.now() + 5000);
    const relayed = (B.events['rm:input'] ?? []).filter((x: any) => x.id === ua.id);
    check('다른 참가자 입력이 실시간으로 전달됨 (강아지 위치·점프 재현용)', relayed.length >= 2 && relayed.every((x: any) => typeof x.t === 'number'));
    check('미래 시각 입력은 서버가 버림', !(A.events['rm:input'] ?? []).some((x: any) => x.id === ud.id && x.t === 999999));
    const sts: { list: MRStanding[] } = last(B, 'rm:standings');
    check('실시간 순위판 (서버가 입력으로 계산한 점수·콤보)', sts && sts.list.length === 4 && sts.list[0].score >= sts.list[3].score && sts.list.some((x) => x.id === ua.id && x.score > 0), sts);
    // 세찌 연결 끊김 → 끊긴 동안 입력은 모아 두었다가 다시 접속하며 전달
    C.s.disconnect();
    await sleep(300);
    check('연결이 끊긴 참가자는 순위판에 표시', (await sleep(400), last(A, 'rm:room')).players.find((p: MRPlayerLike) => p.id === uc.id)?.connected === false);
    await sleep(1500);
    const C2 = await client(uc);
    const resume = await emit(C2, 'rm:resume', { code, round: 1, inputs: queued });
    check('다시 접속 → 방 상태·시작 시각·모든 입력 기록 복구', resume.ok && resume.room.startAt === st.startAt && Array.isArray(resume.inputs[ua.id]) && resume.inputs[ua.id].length > 0, resume);
    // 이후 입력은 새 소켓으로 (아직 오지 않은 박자만)
    botC.cancel();
    playBot(C2, 1, st.startAt, 'easy', 60, 7, DUR, undefined, Math.max(Date.now() - st.startAt, ...queued.map((q) => q.t)));
    await sleep(st.startAt + DUR + 2000 - Date.now());

    console.log('\n[결과 · 보상]');
    const res: { round: number; results: MRResult[] } = last(B, 'rm:result');
    check('모두에게 같은 최종 결과', [A, B, C2, D].every((c) => JSON.stringify(last(c, 'rm:result')) === JSON.stringify(res)));
    const byId = new Map(res.results.map((r) => [r.id, r]));
    const done = res.results.filter((r) => r.completed);
    check('정상 완주자 1~3위 순위 (점수 순)', done.length === 3 && done.map((r) => r.rank).join() === '1,2,3' && done[0].score >= done[1].score && done[1].score >= done[2].score, res.results);
    check('결과에 점수·정확도·최대 콤보', done.every((r) => typeof r.score === 'number' && r.accuracy > 0 && r.maxCombo > 0));
    check('가만히 있던 참가자는 정상 완주 아님 → 보상 없음', byId.get(ud.id)?.completed === false && byId.get(ud.id)?.coin === 0 && !!byId.get(ud.id)?.reason);
    check('끊겼다 돌아온 참가자도 정상 완주', byId.get(uc.id)?.completed === true);
    const coinOf = (id: number) => byId.get(id)!.coin;
    const rankOf = (id: number) => byId.get(id)!.rank!;
    const expect = (id: number) => [100, 70, 50][rankOf(id) - 1];
    check('순위 보상 1위 100 · 2위 70 · 3위 50 (하나는 오늘 3번째라 지급)', [ua.id, ub.id, uc.id].every((id) => coinOf(id) === expect(id)), res.results.map((r) => [r.nickname, r.rank, r.coin]));
    const wa = await api('/api/coins', undefined, ua.token);
    check('혼자 달리기와 함께 달리기 하루 보상 횟수 통합 (3/3)', wa.coins.daily.runner.count === 3);
    check('서버가 보낸 코인 알림 (화면 애니메이션)', (B.events['coins:earned'] ?? []).some((e: any) => e.kind === 'runner' && e.amount === expect(ub.id)));

    console.log('\n[같은 방에서 한 번 더 · 방장 퇴장]');
    await sleep(300);
    const afterRoom: MRRoom = last(A, 'rm:room');
    check('결과 뒤 같은 방 로비로 (준비 해제)', afterRoom.state === 'lobby' && afterRoom.players.every((p) => !p.ready));
    await emit(A, 'rm:settings', { difficulty: 'normal' });
    for (const c of [A, B, C2, D]) await emit(c, 'rm:ready', { ready: true });
    await sleep(300);
    const st2 = last(B, 'rm:start');
    check('두 번째 판 시작 (round 2)', st2?.round === 2);
    playBot(A, 2, st2.startAt, 'normal', 25, 11);
    playBot(B, 2, st2.startAt, 'normal', 40, 13);
    playBot(C2, 2, st2.startAt, 'normal', 40, 17);
    playBot(D, 2, st2.startAt, 'normal', 40, 19);
    await sleep(st2.startAt + 6000 - Date.now());
    // 방장 하나가 달리는 중에 나감 → 방장은 다음 사람에게
    await emit(A, 'rm:leave');
    await sleep(400);
    const rr: MRRoom = last(B, 'rm:room');
    check('방장이 달리는 중 나가면 다음 참가자가 방장', rr.hostId === ub.id && !rr.players.some((p) => p.id === ua.id));
    await sleep(st2.startAt + DUR + 2000 - Date.now());
    const res2: { results: MRResult[] } = last(B, 'rm:result');
    const a2 = res2.results.find((r) => r.id === ua.id);
    check('중도 이탈자는 결과에 "중도 이탈", 보상 없음', a2 && !a2.completed && a2.reason === '중도 이탈' && a2.coin === 0);
    const d2 = res2.results.find((r) => r.id === ud.id)!;
    check('네모: 오늘 첫 보상 → 순위 보상 지급', d2.completed && d2.coin === [100, 70, 50][d2.rank! - 1], d2);
    check('같은 판 보상은 한 번만 (중복 지급 없음)', (await api('/api/coins', undefined, ud.token)).coins.earned.filter((t: any) => t.kind === 'runner').length === 1);

    console.log('\n[로비 연결 끊김]');
    D.s.disconnect();
    await sleep(2200);
    const rl: MRRoom = last(B, 'rm:room');
    check('로비에서 끊긴 사람은 잠시 기다렸다 방에서 정리', !rl.players.some((p) => p.id === ud.id) && rl.players.length === 2);
    await emit(B, 'rm:leave'); await emit(C2, 'rm:leave');
    check('모두 나가면 방 삭제', (await emit(E, 'rm:join', { code })).code === 'not_found');
    for (const c of [A, B, C2, E]) c.s.close();
  } finally {
    proc?.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
type MRPlayerLike = { id: number; connected: boolean };
main().catch((e) => { console.error(e); proc?.kill(); process.exit(1); });
