// 멍글런너 함께 달리기(실시간 멀티플레이) 테스트 — 실행: npm run test:runner-multi
// 실제 소켓 클라이언트 4개로 방 만들기 → 참가 → 준비 → 동시 출발 → 입력 → 서버 판정·순위·코인을 확인한다.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { io, type Socket } from 'socket.io-client';
import { buildChart, courseSpeed, judgeRun, type Chart, type Lane, type RunnerInput } from '../../shared/runner';
import { PACE_CONFIG, PaceSim, paceDistance } from '../../shared/runnerPace';
import { kstDay } from '../../shared/coins';
import { roundDist, type MRResult, type MRRoom, type MRStanding } from '../../shared/runnerMulti';

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

/** 박자에 딱 맞춘 입력 (keep(장애물 시각)이 false면 그 장애물은 아무것도 안 함 = MISS) */
function perfectPlan(chart: Chart, keep: (t: number) => boolean, stopAt = Infinity): RunnerInput[] {
  let lane = 0; const plan: RunnerInput[] = [];
  for (const o of chart.obstacles) {
    if (o.t > stopAt) break;
    if (!keep(o.t)) continue;
    if (o.need === 'jump') plan.push({ t: o.t, a: 'J' });
    else if (o.need === 'duck') plan.push({ t: o.t, a: 'D' });
    else if (o.blocked.includes(lane as Lane)) {
      const tgt = [...o.safe].sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane))[0];
      while (lane !== tgt) { const a = tgt > lane ? 'R' : 'L'; plan.push({ t: o.t, a }); lane += a === 'R' ? 1 : -1; }
    }
  }
  return plan;
}
function sendPlan(c: Client, round: number, startAt: number, plan: RunnerInput[]) {
  const timers = plan.map((x) => setTimeout(() => c.s.emit('rm:input', { round, t: x.t, a: x.a }), Math.max(0, startAt + x.t - Date.now())));
  return () => timers.forEach(clearTimeout);
}

/** 서버 없이 확인: 페이스 계산 규칙 */
function paceUnitTests() {
  console.log('\n[리듬 페이스 계산]');
  const ch = buildChart('elise', 'normal')!;
  const sp = courseSpeed('elise', 'normal');
  const dur = ch.duration;
  const ev = (inp: RunnerInput[]) => judgeRun(ch, inp, dur + 500).events;
  const P = ev(perfectPlan(ch, () => true)), M = ev([]);
  const dP = paceDistance(ch, P, dur, sp, 'normal'), dM = paceDistance(ch, M, dur, sp, 'normal'), base = sp * dur / 1000;
  check('전부 PERFECT는 기본보다 멀리, 전부 MISS는 기본보다 짧게 (상·하한 안)', dP > base && dM < base && dP <= base * PACE_CONFIG.max && dM >= base * PACE_CONFIG.min, { dP, dM, base });
  // 매 프레임 조금씩 계산해도(실시간 화면) 한 번에 계산한 것(서버 확정)과 같은 거리
  const sim = new PaceSim(ch, sp, 'normal');
  for (let t = 0; t <= dur; t += 16.7) sim.advance(judgeRun(ch, perfectPlan(ch, () => true), t).events, t);
  sim.advance(P, dur);
  check('프레임마다 이어서 계산 = 한 번에 계산 (서버·화면 같은 거리)', Math.abs(sim.state.dist - dP) < 1e-6, [sim.state.dist, dP]);
  // 늦게 도착한 입력으로 지난 판정이 바뀌면 처음부터 다시 계산
  const late = new PaceSim(ch, sp, 'normal');
  late.advance(M, 20000);
  const half = perfectPlan(ch, (t) => t < 20000);
  late.advance(ev(half), 20000);
  check('늦게 온 입력으로 판정이 바뀌면 다시 계산 (되감기)', Math.abs(late.state.dist - paceDistance(ch, ev(half), 20000, sp, 'normal')) < 1e-6);
  // 한 번 실수는 조금만 손해
  const one = ev(perfectPlan(ch, (t) => t !== ch.obstacles[8].t));
  const lost = dP - paceDistance(ch, one, dur, sp, 'normal');
  check('MISS 한 번은 조금만 뒤처짐 (0.5~4m)', lost > 0.5 && lost < 4, lost);
  // 연속 MISS 감속은 하한까지만
  const s2 = new PaceSim(ch, sp, 'normal').advance(M, dur).state;
  check('연속 MISS: 감속이 쌓이되 하한(최소 페이스) 이상', s2.pace >= PACE_CONFIG.min && s2.level >= PACE_CONFIG.levelMin, s2);
  // 페이스는 부드럽게 변함: 20ms마다 변화량이 작음
  const sm = new PaceSim(ch, sp, 'normal'); let prev = 1, maxStep = 0;
  for (let t = 0; t <= dur; t += 20) { const p = sm.advance(P, t).state.pace; maxStep = Math.max(maxStep, Math.abs(p - prev)); prev = p; }
  check('페이스가 갑자기 튀지 않음 (20ms당 변화 2% 미만)', maxStep < 0.02, maxStep);
  // 난이도별 밸런스: HARD는 같은 실력 차이로 더 벌어짐
  const gap = (d: 'easy' | 'normal' | 'hard') => { const c = buildChart('elise', d)!; const e1 = judgeRun(c, perfectPlan(c, () => true), c.duration + 500).events; return (paceDistance(c, e1, c.duration, courseSpeed('elise', d), d) - paceDistance(c, [], c.duration, courseSpeed('elise', d), d)); };
  check('난이도별 차이: EASY < NORMAL < HARD', gap('easy') < gap('normal') && gap('normal') < gap('hard'), [gap('easy'), gap('normal'), gap('hard')]);
}

let proc: ChildProcess | null = null;
async function main() {
  paceUnitTests();
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
    const dn = await emit(A, 'rm:settings', { courseId: 'danube', difficulty: 'hard' }); await sleep(150);
    check('모든 곡·HARD 선택 가능 (도나우 HARD)', dn.ok && last(B, 'rm:room').courseId === 'danube' && last(B, 'rm:room').difficulty === 'hard', dn);
    check('없는 곡은 선택 불가', !(await emit(A, 'rm:settings', { courseId: 'nope' })).ok);
    await emit(A, 'rm:settings', { courseId: 'elise', difficulty: 'easy' }); await sleep(150);
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
    check('실시간 순위판 (서버가 계산한 거리·점수·콤보, 거리 순)', sts && sts.list.length === 4 && sts.list.map((x) => x.rank).join() === '1,2,3,4'
      && sts.list.every((x, i) => i === 0 || x.left || roundDist(sts.list[i - 1].distance) >= roundDist(x.distance)) && sts.list.every((x) => x.distance > 0 && x.pace > 0) && sts.list.some((x) => x.id === ua.id && x.score > 0), sts);
    check('가만히 있는 참가자는 거리에서 뒤처짐', sts.list.find((x) => x.id === ud.id)!.distance < sts.list.find((x) => x.id === ua.id)!.distance, sts.list.map((x) => [x.id, x.distance]));
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
    check('정상 완주자 1~3위 순위 (달린 거리 순)', done.length === 3 && done.map((r) => r.rank).join() === '1,2,3' && done[0].distance >= done[1].distance && done[1].distance >= done[2].distance, res.results.map((r) => [r.nickname, r.rank, r.distance, r.score]));
    check('결과에 거리·점수·정확도·최대 콤보·판정 횟수', done.every((r) => r.distance > 0 && typeof r.score === 'number' && r.accuracy > 0 && r.maxCombo > 0 && ['perfect', 'great', 'good', 'miss'].every((g) => typeof r.counts[g as 'miss'] === 'number')));
    {
      // 서버 거리 = 하나가 보낸 입력으로 다시 계산한 거리 (화면이 보낸 거리는 쓰지 않음)
      const ch = buildChart('elise', 'easy')!;
      const bot = playBot(A, 99, Date.now() + 1e9, 'easy', 25, 3); // 같은 seed → 같은 입력 계획 (보내지는 않음)
      bot.cancel();
      const aPlan = bot.plan;
      const re = judgeRun(ch, aPlan.filter((x) => x.t <= DUR) as RunnerInput[], DUR + 500);
      const expectDist = roundDist(paceDistance(ch, re.events, DUR, courseSpeed('elise', 'easy'), 'easy'));
      check('서버 거리 = 입력 기록으로 다시 계산한 거리 (조작 불가)', byId.get(ua.id)!.distance === expectDist && byId.get(ua.id)!.score === re.score, [byId.get(ua.id)!.distance, expectDist]);
    }
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
    check('중도 이탈자의 거리는 나간 순간에서 멈춤', !!a2 && a2.distance > 0 && res2.results.filter((r) => r.completed).every((r) => r.distance > a2.distance), res2.results.map((r) => [r.nickname, r.distance]));
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

    console.log('\n[거리 경쟁 · 추월 (2명)]');
    // 두리: 처음 6초 PERFECT → 그 뒤 MISS / 다섯: 처음 6초 MISS → 그 뒤 PERFECT
    const r3 = await emit(B, 'rm:create', { courseId: 'elise', difficulty: 'easy' });
    await emit(E, 'rm:join', { code: r3.room.code });
    await emit(B, 'rm:ready', { ready: true }); await emit(E, 'rm:ready', { ready: true });
    await sleep(300);
    const st3 = last(E, 'rm:start');
    check('2명 방 시작', st3?.round === 1 && last(E, 'rm:room').players.length === 2);
    const ch3 = buildChart('elise', 'easy')!;
    const SPLIT = 6000;
    sendPlan(B, 1, st3.startAt, perfectPlan(ch3, (t) => t < SPLIT, DUR));
    sendPlan(E, 1, st3.startAt, perfectPlan(ch3, (t) => t >= SPLIT, DUR));
    await sleep(st3.startAt + SPLIT + 900 - Date.now());
    // 서버 순위판(계산 시각 t)에서 두 사람의 거리 차이
    const gapAt = (ms: number) => {
      const list = ((E.events['rm:standings'] ?? []) as { t: number; list: MRStanding[] }[]).filter((x) => x.list.length === 2);
      const near = list.reduce((a, b) => (Math.abs(b.t - ms) < Math.abs(a.t - ms) ? b : a), list[0]);
      return near.list.find((x) => x.id === ub.id)!.distance - near.list.find((x) => x.id === ue.id)!.distance;
    };
    const g1 = gapAt(4000), g2 = gapAt(5600), g3 = gapAt(6600);
    check('PERFECT 계속 vs MISS 반복 → 거리 차이가 점점 벌어짐 (서버 순위판)', g1 < g2 && g2 < g3 && g3 > 1, { g1, g2, g3 });
    await sleep(st3.startAt + DUR + 2000 - Date.now());
    const all3 = (E.events['rm:standings'] ?? []).map((x: { list: MRStanding[] }) => x.list).filter((l: MRStanding[]) => l.length === 2);
    const overtook = all3.some((l: MRStanding[]) => l.find((x) => x.id === ue.id)!.rank === 1 && l.find((x) => x.id === ue.id)!.distance > l.find((x) => x.id === ub.id)!.distance);
    check('뒤처졌던 다섯이 연속 PERFECT로 다시 추월 (달리는 중 순위 1위)', overtook, all3.slice(-3));
    const res3: { results: MRResult[] } = last(E, 'rm:result');
    const e3 = res3?.results.find((r) => r.id === ue.id), b3 = res3?.results.find((r) => r.id === ub.id);
    check('최종 순위도 추월한 다섯이 1위 (거리 기준)', e3?.rank === 1 && b3?.rank === 2 && e3.distance > b3.distance, res3?.results);
    await emit(B, 'rm:leave'); await emit(E, 'rm:leave');
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
