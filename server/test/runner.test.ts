// 멍글런너 기록·랭킹 서버 검증 테스트 — 실행: npm run test:runner
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { RUNNER_GAME_VERSION, buildChart, judgeRun, type Lane, type RunnerInput } from '../../shared/runner';

const PORT = 3996;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-run-'));
let passed = 0, failed = 0;
const check = (name: string, cond: unknown, extra?: unknown) => { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(p: string, body?: object, token?: string, method?: string) {
  const res = await fetch(BASE + p, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}
const chart = buildChart('elise')!;
/** 사람처럼 약간씩 어긋난 입력 (seed로 결정) */
function play(jitter: number, seed: number, skipEvery = 0): RunnerInput[] {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let lane: number = 0; const out: RunnerInput[] = [];
  chart.obstacles.forEach((o, i) => {
    if (skipEvery && i % skipEvery === 0) return;
    const t = Math.round(o.t + (rnd() * 2 - 1) * jitter);
    if (o.need === 'jump') out.push({ t, a: 'J' });
    else if (o.need === 'duck') out.push({ t, a: 'D' });
    else if (o.blocked.includes(lane as Lane)) {
      const tgt = [...o.safe].sort((a, b) => Math.abs(a - lane) - Math.abs(b - lane))[0];
      while (lane !== tgt) { const a = tgt > lane ? 'R' : 'L'; out.push({ t, a }); lane += a === 'R' ? 1 : -1; }
    }
  });
  return out.sort((a, b) => a.t - b.t);
}
async function user(u: string, nick: string, dog: string) {
  const r = await api('/api/auth/signup', { username: u, password: 'password123', nickname: nick, dogName: dog, agree: true });
  return { id: r.body.profile.id as number, token: r.body.token as string };
}
const finish = (token: string, runId: string, inputs: RunnerInput[], extra: object = {}) =>
  api('/api/runner/finish', { runId, courseId: 'elise', gameVersion: RUNNER_GAME_VERSION, patternVersion: chart.patternVersion, inputs, ...extra }, token);
async function start(token: string, course = 'elise') { return api('/api/runner/start', { courseId: course }, token); }

async function main() {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_RUNNER_TIME_SCALE: '0.02' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => { const t = String(d); if (!t.includes('ExperimentalWarning') && !t.includes('--trace-warnings')) process.stderr.write(t); });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/parks'); break; } catch { await sleep(200); } }
  const wait = () => sleep(1300); // 곡 길이 × 0.02
  try {
    const a = await user('runa01', '런너A', '콩떡');
    const b = await user('runb01', '런너B', '보리');
    const c = await user('runc01', '런너C', '호두');

    console.log('\n[시작]');
    check('없는 코스 거부', (await start(a.token, 'nope')).status === 400);
    check('음원 준비 중인 코스 거부', (await start(a.token, 'danube')).status === 400);
    const g = await api('/api/auth/guest', {});
    const gs = await start(g.body.token);
    check('둘러보기 방문자는 공식 기록 시작 불가 (연습만)', gs.status === 403 && gs.body.code === 'members_only');

    console.log('\n[제출 검증]');
    const goodInputs = play(70, 7);
    const s1 = await start(a.token);
    const fast = await finish(a.token, s1.body.runId, goodInputs);
    check('곡 길이보다 빨리 끝난 제출 거부', fast.status === 400 && fast.body.code === 'too_fast');
    const s2 = await start(a.token); await wait();
    check('게임·패턴 버전 불일치 거부', (await finish(a.token, s2.body.runId, goodInputs, { patternVersion: 99 })).status === 409);
    const s3 = await start(a.token); await wait();
    check('정렬되지 않은 입력 거부', (await finish(a.token, s3.body.runId, [{ t: 500, a: 'J' }, { t: 100, a: 'J' }])).status === 400);
    const s3b = await start(a.token); await wait();
    check('없는 동작 입력 거부', (await finish(a.token, s3b.body.runId, [{ t: 100, a: 'X' }] as unknown as RunnerInput[])).status === 400);
    const s4 = await start(a.token); await wait();
    check('남의 기록 번호로 제출 불가', (await finish(b.token, s4.body.runId, goodInputs)).status === 400);
    const robot = await finish(a.token, s4.body.runId, play(0, 1));
    check('자동 입력처럼 완벽한 타이밍 거부', robot.status === 400 && robot.body.code === 'suspicious');

    console.log('\n[점수·최고 기록]');
    const s5 = await start(a.token); await wait();
    const ok = await finish(a.token, s5.body.runId, goodInputs, { score: 999999 });
    const local = judgeRun(chart, goodInputs);
    check('서버가 입력 기록으로 점수 재계산 (보낸 점수 무시)', ok.status === 200 && ok.body.result.score === local.score && ok.body.result.score !== 999999, ok.body);
    check('첫 기록은 최고 기록 갱신 + 1위', ok.body.newBest === true && ok.body.rank === 1);
    check('같은 기록 번호 재제출 거부', (await finish(a.token, s5.body.runId, goodInputs)).status === 409);
    const s6 = await start(a.token); await wait();
    const dup = await finish(a.token, s6.body.runId, goodInputs);
    check('같은 플레이 결과 중복 제출 거부', dup.status === 409 && dup.body.code === 'duplicate');
    const s7 = await start(a.token); await wait();
    const worse = await finish(a.token, s7.body.runId, play(70, 9, 4));
    check('더 낮은 점수는 최고 기록을 바꾸지 않음', worse.status === 200 && !worse.body.newBest && worse.body.best.score === local.score);

    console.log('\n[랭킹]');
    const sb = await start(b.token); await wait();
    const bRes = await finish(b.token, sb.body.runId, play(140, 3));
    check('다른 사용자 낮은 점수 → 2위', bRes.status === 200 && bRes.body.rank === 2, bRes.body);
    const sc = await start(c.token); await wait();
    const cRes = await finish(c.token, sc.body.runId, goodInputs);
    check('같은 점수·정확도·콤보면 먼저 기록한 사람이 위', cRes.body.rank === 2 && cRes.body.result.score === local.score);
    const rk = await api('/api/runner/ranking?scope=course&course=elise', undefined, b.token);
    check('곡별 랭킹: 다른 사용자 기록 표시 + 순서', rk.body.entries.map((e: any) => e.nickname).join() === '런너A,런너C,런너B' && rk.body.me.rank === 3, rk.body.entries);
    check('랭킹 항목: 닉네임·강아지 이름·점수·콤보·코스·날짜', ['nickname', 'dogName', 'dogPhoto', 'score', 'maxCombo', 'course', 'achievedAt'].every((k) => k in rk.body.entries[0]));
    // 친구 랭킹
    const sa = io(BASE, { auth: { token: a.token }, transports: ['websocket'] });
    const sbk = io(BASE, { auth: { token: b.token }, transports: ['websocket'] });
    await Promise.all([new Promise<void>((r) => sa.on('connect', () => r())), new Promise<void>((r) => sbk.on('connect', () => r()))]);
    await new Promise((r) => sa.emit('friend:request', { userId: b.id }, r));
    await new Promise((r) => sbk.emit('friend:accept', { userId: a.id }, r));
    sa.close(); sbk.close();
    const fr = await api('/api/runner/ranking?scope=friends&course=elise', undefined, b.token);
    check('친구 랭킹: 나와 친구만', fr.body.entries.map((e: any) => e.nickname).join() === '런너A,런너B');
    const wk = await api('/api/runner/ranking?scope=weekly&course=elise', undefined, a.token);
    check('주간 랭킹: 이번 주(월요일 00:00 KST) 기록, 사람별 최고 1개', wk.body.entries.length === 3 && wk.body.entries[0].score === local.score && new Date(wk.body.weekStart + 9 * 3600_000).getUTCDay() === 1 && new Date(wk.body.weekStart + 9 * 3600_000).getUTCHours() === 0);
    const lastWeek = await api(`/api/runner/ranking?scope=weekly&course=elise&week=${wk.body.week - 1}`, undefined, a.token);
    check('지난 주 기록은 따로 보존', lastWeek.body.entries.length === 0);
    const ov = await api('/api/runner/ranking?scope=overall', undefined, a.token);
    check('전체 랭킹: 정규화 포인트(0~1000)', ov.body.entries[0].points > 0 && ov.body.entries[0].points <= 1000);
    const sum = await api('/api/runner/summary', undefined, a.token);
    check('내 기록 요약 + 안내판 TOP 3', sum.body.bests[0].rank === 1 && sum.body.top.elise.length === 3);
  } finally {
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
