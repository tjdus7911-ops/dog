// 멍글런너 기록·랭킹 서버 검증 테스트 — 실행: npm run test:runner
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { COURSES, DIFFICULTIES, DUCK_MS, JUMP_MS, RUNNER_GAME_VERSION, buildChart, buildSong, judgeRun, validateChart, type Chart, type Lane, type RunnerInput } from '../../shared/runner';

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
function play(jitter: number, seed: number, skipEvery = 0, ch: Chart = chart): RunnerInput[] {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let lane: number = 0; const out: RunnerInput[] = [];
  ch.obstacles.forEach((o, i) => {
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
async function start(token: string, course = 'elise', difficulty?: string) { return api('/api/runner/start', { courseId: course, difficulty }, token); }

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

    console.log('\n[패턴 데이터]');
    check('엘리제 패턴: 피할 수 없는 배치 없음 (validateChart)', validateChart(chart).length === 0, validateChart(chart));
    const song = buildSong('elise')!;
    const onsets = new Set(song.notes.map((n) => Math.round(n.t * 1000)));
    check('장애물이 모두 실제 음표 시작 시각에 맞음', chart.obstacles.every((o) => onsets.has(o.t)), chart.obstacles.filter((o) => !onsets.has(o.t)).map((o) => o.t));
    check('장애물 사이 최소 간격 · 점프/숙이기 시간 고려', chart.obstacles.every((o, i) => i === 0 || o.t - chart.obstacles[i - 1].t >= 520)
      && chart.obstacles.every((o, i) => { const p = chart.obstacles.slice(0, i).reverse().find((x) => x.need === o.need); return !p || o.need !== 'jump' && o.need !== 'duck' || o.t - p.t >= (o.need === 'jump' ? JUMP_MS : DUCK_MS) + 40; }));
    check('BPM·마디 위치 데이터', chart.bpm === 91 && chart.obstacles.every((o) => typeof o.bar === 'number' && typeof o.pos === 'number'));
    const broken = { ...chart, obstacles: [...chart.obstacles.slice(0, 2), { ...chart.obstacles[1], id: 2, t: chart.obstacles[1].t + 100 }] };
    check('너무 붙은 장애물은 검증에서 걸러짐', validateChart(broken).length > 0);
    // 전체 곡 개방: 5곡 × EASY/NORMAL/HARD 모두 패턴이 있고, 피할 수 있고, 음표 위에 놓임
    const bad: string[] = [];
    const counts: Record<string, number[]> = {};
    for (const c of COURSES) {
      const sg = buildSong(c.id);
      const on = new Set(sg?.notes.map((n) => Math.round(n.t * 1000)) ?? []);
      counts[c.id] = [];
      for (const d of DIFFICULTIES) {
        const ch = buildChart(c.id, d);
        if (!sg || !ch) { bad.push(`${c.id}.${d}: 없음`); continue; }
        counts[c.id].push(ch.obstacles.length);
        const v = validateChart(ch);
        if (v.length) bad.push(`${c.id}.${d}: ${v[0]}`);
        if (!ch.obstacles.every((o) => on.has(o.t))) bad.push(`${c.id}.${d}: 음표 밖 장애물`);
        if (ch.obstacles.length < 20) bad.push(`${c.id}.${d}: 장애물 너무 적음`);
      }
    }
    check('5곡 × 3난이도 패턴 모두 생성 · 검증 통과 · 음표 위 배치', COURSES.length === 5 && COURSES.every((c) => c.available) && bad.length === 0, bad);
    check('난이도가 오를수록 장애물이 많아짐 (EASY < NORMAL < HARD)', Object.values(counts).every(([e, n, h]) => e < n && n < h), counts);
    check('NORMAL은 기본 난이도 · 새 패턴 버전(2)', JSON.stringify(buildChart('elise')) === JSON.stringify(buildChart('elise', 'normal')) && COURSES.every((c) => c.patternVersion === 2));

    console.log('\n[시작]');
    check('없는 코스 거부', (await start(a.token, 'nope')).status === 400);
    check('잘못된 난이도 거부', (await start(a.token, 'elise', 'insane')).status === 400);
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
    check('서버가 확인한 정상 완주 → 50코인', ok.body.coin?.amount === 50 && ok.body.coin?.kind === 'runner');
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
    const frOv = await api('/api/runner/ranking?scope=overall&friends=1', undefined, b.token);
    check('모든 코스 합산도 친구만 보기 가능', frOv.body.entries.map((e: any) => e.nickname).join() === '런너A,런너B');
    const around = await api('/api/runner/ranking?scope=course&course=elise&around=1', undefined, b.token);
    check('내 순위 탭: 내 주변 순위 (순위 번호 유지)', around.body.entries.some((e: any) => e.nickname === '런너B' && e.rank === 3));
    const screen = await api('/api/screen', undefined, a.token);
    const slide = screen.body.slides.find((x: any) => x.kind === 'runner');
    check('광장 스크린에 코스별 랭킹 슬라이드', slide && slide.course === 'elise' && slide.ranking.length === 3 && slide.ranking[0].nickname === '런너A' && slide.ranking[0].dogName === '콩떡', slide);
    // 완주 코인은 하루 3번까지 (a: s5, s7 이후 2번 더)
    const s8 = await start(a.token); await wait();
    const third = await finish(a.token, s8.body.runId, play(70, 21));
    const s9 = await start(a.token); await wait();
    const fourth = await finish(a.token, s9.body.runId, play(70, 22));
    check('완주 코인 하루 최대 3번', third.body.coin?.amount === 50 && fourth.status === 200 && fourth.body.coin === null, [third.body.coin, fourth.body.coin]);
    check('실패한 제출(너무 빨리 끝남)은 코인 없음', !fast.body.coin);
    const d = await user('rund01', '런너D', '밤톨');
    const sd1 = await start(d.token); await wait();
    const first = await finish(d.token, sd1.body.runId, play(70, 5, 2));
    check('첫 기록은 이전 순위 없음', first.status === 200 && first.body.prevRank === null && first.body.rank === 4, first.body);
    // B보다 높고 1위보다 낮은 점수가 나오는 입력을 골라 제출 → 4위에서 3위로
    const bScore = judgeRun(chart, play(140, 3)).score;
    let better: RunnerInput[] | null = null;
    for (let sd = 20; sd < 200 && !better; sd++) { const x = play(120, sd); const sc = judgeRun(chart, x).score; if (sc > bScore && sc < local.score) better = x; }
    const sd2 = await start(d.token); await wait();
    const up = await finish(d.token, sd2.body.runId, better!);
    check('순위가 오르면 이전 순위도 알려 줌 (▲ 표시용)', up.status === 200 && up.body.prevRank === 4 && up.body.rank === 3, up.body);

    console.log('\n[난이도별 기록]');
    const ud = c; // (가입 횟수 제한 때문에 기존 사용자로)
    const dh = buildChart('danube', 'hard')!;
    const hd1 = await start(ud.token, 'danube', 'hard');
    check('다른 곡 HARD 공식 기록 시작', hd1.status === 200 && !!hd1.body.runId, hd1.body);
    await sleep(1400);
    const wrongd = await api('/api/runner/finish', { runId: hd1.body.runId, courseId: 'danube', difficulty: 'normal', gameVersion: RUNNER_GAME_VERSION, patternVersion: dh.patternVersion, inputs: play(30, 5, 0, dh) }, ud.token);
    check('시작한 난이도와 다른 난이도로 제출하면 거부', wrongd.status === 400, wrongd.body);
    const hd2 = await start(ud.token, 'danube', 'hard');
    await sleep(1400);
    const okd = await api('/api/runner/finish', { runId: hd2.body.runId, courseId: 'danube', difficulty: 'hard', gameVersion: RUNNER_GAME_VERSION, patternVersion: dh.patternVersion, inputs: play(30, 5, 0, dh) }, ud.token);
    const expd = judgeRun(dh, play(30, 5, 0, dh)).score;
    check('HARD 기록: 서버가 HARD 패턴으로 다시 판정', okd.status === 200 && okd.body.result.score === expd && okd.body.rank === 1, okd.body);
    const rh = await api('/api/runner/ranking?scope=course&course=danube.hard', undefined, ud.token);
    const rn = await api('/api/runner/ranking?scope=course&course=danube', undefined, ud.token);
    check('난이도별 랭킹 분리 (HARD 랭킹에만 기록)', rh.body.entries.length === 1 && rh.body.entries[0].userId === ud.id && rn.body.entries.every((e: any) => e.userId !== ud.id), { rh: rh.body.entries.length, rn: rn.body.entries.length });
    const sm = await api('/api/runner/summary', undefined, ud.token);
    check('내 기록 요약에 난이도 키로 표시', sm.body.bests.some((b: any) => b.course === 'danube.hard'));
    check('없는 난이도 랭킹 요청 거부', (await api('/api/runner/ranking?scope=course&course=danube.insane', undefined, ud.token)).status === 400);
  } finally {
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
