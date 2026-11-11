// 멍글런너 차트·싱크 검증 (서버 없이): 5곡 × 3난이도 전 구간
// 실행: npm run test:runner-charts
import { COURSES, DIFFICULTIES, JUDGE, buildChart, buildSong, countIn, courseSpeed, judgeRun, perfectInputs, validateChart, type Chart, type Lane, type RunnerInput } from '../../shared/runner';
import { chartStats } from '../../shared/runnerChart';
import { LANE_W, duckAmount, jumpHeight, judgeLineZ, laneProgress, obstacleZ, overlapWindow, OBSTACLE_DEPTH } from '../../shared/runnerPose';
import { MR_COUNTDOWN_MS } from '../../shared/runnerMulti';

let passed = 0, failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); }
}

/** 완벽한 입력(박자 ± off ms)으로 달릴 때 장애물이 몸을 지나가는 동안 실제로 비켜 있는지 (화면과 같은 동작 규칙) */
function clearance(ch: Chart, inputs: RunnerInput[]): string[] {
  const bad: string[] = [];
  const speed = courseSpeed(ch.courseId, ch.difficulty);
  const jumps = inputs.filter((i) => i.a === 'J').map((i) => i.t);
  const ducks = inputs.filter((i) => i.a === 'D').map((i) => i.t);
  const moves = inputs.filter((i) => i.a === 'L' || i.a === 'R');
  // 레인 위치 (x, m): 이동마다 지수 수렴
  const xAt = (t: number) => {
    let x = 0, lane = 0, lt = -1e9;
    for (const m of moves) {
      if (m.t > t) break;
      x = x + (lane * LANE_W - x) * laneProgress(m.t - lt);
      lane = Math.max(-1, Math.min(1, lane + (m.a === 'L' ? -1 : 1))); lt = m.t;
    }
    return x + (lane * LANE_W - x) * laneProgress(t - lt);
  };
  const lastBefore = (list: number[], t: number) => { let v = -1e9; for (const x of list) if (x <= t) v = x; return v; };
  for (const o of ch.obstacles) {
    const [a, b] = overlapWindow(o.t, speed, o.kind);
    for (let t = a; t <= b; t += 10) {
      if (o.need === 'jump' && jumpHeight(t - lastBefore(jumps, t)) < 0.18) { bad.push(`#${o.id} 통나무에 걸림 (${Math.round(t - o.t)}ms)`); break; }
      if (o.need === 'duck' && duckAmount(t - lastBefore(ducks, t)) < 0.9) { bad.push(`#${o.id} 리본에 걸림 (${Math.round(t - o.t)}ms)`); break; }
      if (o.kind === 'pot' && o.blocked.some((l) => Math.abs(xAt(t) - l * LANE_W) < 0.68)) { bad.push(`#${o.id} 화분에 걸림 (${Math.round(t - o.t)}ms)`); break; }
      if (o.kind === 'fence' && Math.abs(xAt(t) - o.safe[0] * LANE_W) > 0.5) { bad.push(`#${o.id} 울타리에 걸림 (${Math.round(t - o.t)}ms)`); break; }
    }
  }
  return bad;
}

const stats: Record<string, ReturnType<typeof chartStats>> = {};
console.log('\n[5곡 × 3난이도: 차트 생성 · 음표 위 배치 · 물리 검증 · 완벽한 플레이]');
for (const c of COURSES) {
  const song = buildSong(c.id)!;
  const onsets = new Set(song.notes.map((n) => Math.round(n.t * 1000)));
  for (const d of DIFFICULTIES) {
    const ch = buildChart(c.id, d)!;
    const key = `${c.id}.${d}`;
    stats[key] = chartStats(ch.obstacles, ch.duration);
    const errs = validateChart(ch);
    check(`${key}: 불가능한 조합 없음 (${ch.obstacles.length}개)`, errs.length === 0, errs.slice(0, 5));
    check(`${key}: 모든 장애물이 실제 음 시작 시각 (들리는 박자 = 판정 박자)`, ch.obstacles.every((o) => onsets.has(o.t)));
    check(`${key}: 곡 처음~끝 전체에 배치 (끝 10초 안에도 장애물)`, ch.obstacles[0].t < 6000 && ch.obstacles[ch.obstacles.length - 1].t > ch.duration - 12000, [ch.obstacles[0].t, ch.obstacles.at(-1)!.t, ch.duration]);
    const perf = judgeRun(ch, perfectInputs(ch));
    check(`${key}: 정확한 박자 입력 → 전부 PERFECT · 최대 점수`, perf.counts.perfect === ch.obstacles.length && perf.score === ch.maxScore, perf.counts);
    for (const off of [-40, 0, 40]) {
      const bad = clearance(ch, perfectInputs(ch, off));
      check(`${key}: 박자 ${off >= 0 ? '+' : ''}${off}ms 입력 시 강아지가 장애물을 실제로 비켜 감`, bad.length === 0, bad.slice(0, 4));
    }
  }
}

console.log('\n[판정 창: 음악 박자 기준]');
{
  const ch = buildChart('turkish', 'hard')!;
  const grades = (off: number) => judgeRun(ch, perfectInputs(ch, off)).counts;
  check(`±${JUDGE.perfect}ms 이내 → PERFECT`, grades(JUDGE.perfect).perfect === ch.obstacles.length && grades(-JUDGE.perfect).perfect === ch.obstacles.length);
  check(`${JUDGE.perfect + 1}~${JUDGE.great}ms → GREAT`, grades(JUDGE.great).great === ch.obstacles.length && grades(-(JUDGE.perfect + 1)).great === ch.obstacles.length);
  check(`${JUDGE.great + 1}~${JUDGE.good}ms → GOOD`, grades(JUDGE.good).good === ch.obstacles.length);
  const late = grades(JUDGE.good + 60);
  check(`${JUDGE.good + 60}ms 늦으면 대부분 MISS`, late.miss >= ch.obstacles.length * 0.8, late);
  check('아무것도 안 하면 전부 MISS', judgeRun(ch, []).counts.miss === ch.obstacles.length);
}

console.log('\n[판정선·장애물 위치: 음악 시각만으로 계산 (프레임과 무관)]');
{
  const sp = courseSpeed('summer', 'hard');
  const front = (dt: number, k: keyof typeof OBSTACLE_DEPTH) => obstacleZ(dt, sp, k) + OBSTACLE_DEPTH[k] / 2;
  check('박자 순간 장애물 앞면 = 판정선 (모든 종류)', (Object.keys(OBSTACLE_DEPTH) as (keyof typeof OBSTACLE_DEPTH)[]).every((k) => Math.abs(front(0, k) - judgeLineZ(sp)) < 1e-9));
  // 같은 음악 시각이면 몇 프레임으로 나눠 그려도 같은 위치 (누적 오차 없음)
  const direct = obstacleZ(1234.5, sp, 'log');
  let acc = 0; for (let i = 0; i < 1000; i++) acc = obstacleZ(5000 - (5000 - 1234.5) * ((i + 1) / 1000), sp, 'log');
  check('프레임을 1000번 나눠도 위치 오차 없음', Math.abs(acc - direct) < 1e-9);
}

console.log('\n[카운트인: 곡 첫 박에 맞춘 3 · 2 · 1 · 출발]');
for (const c of COURSES) {
  const song = buildSong(c.id)!;
  const ci = countIn(song);
  const gaps = [ci.ticks[1] - ci.ticks[0], ci.ticks[2] - ci.ticks[1], ci.go - ci.ticks[2]];
  check(`${c.id}: 같은 간격 ${ci.interval}ms · 출발 = 첫 마디 시작 · 함께 달리기 카운트다운 안에 들어감`, gaps.every((g) => Math.abs(g - ci.interval) <= 1) && ci.go === Math.round(song.bars[0].t * 1000) && ci.ticks[0] > -MR_COUNTDOWN_MS && ci.interval >= 550 && ci.interval <= 1200, ci);
}

console.log('\n[난이도 차이]');
const rows: string[] = [];
for (const c of COURSES) {
  const [e, n, h] = DIFFICULTIES.map((d) => stats[`${c.id}.${d}`]);
  rows.push(`  ${c.id.padEnd(14)} EASY ${e.count}개 ${e.perSec}/s 최소${e.minGap}ms 연속${e.maxChain} | NORMAL ${n.count}개 ${n.perSec}/s 최소${n.minGap}ms 연속${n.maxChain} | HARD ${h.count}개 ${h.perSec}/s 최소${h.minGap}ms 연속${h.maxChain} (4연속↑ ${h.chains4}회)`);
  check(`${c.id}: 밀도 EASY < NORMAL(×1.5↑) < HARD(×1.4↑)`, n.perSec >= e.perSec * 1.5 && h.perSec >= n.perSec * 1.4, [e.perSec, n.perSec, h.perSec]);
  check(`${c.id}: EASY 단독 동작 · 간격 1.1초↑`, e.maxChain === 1 && e.minGap >= 1100, e);
  check(`${c.id}: NORMAL 최대 3연속`, n.maxChain <= 3, n);
  check(`${c.id}: HARD 4~6연속 구간이 여러 번 · 최대 6`, h.maxChain >= 4 && h.maxChain <= 6 && h.chains4 >= 5, h);
  check(`${c.id}: HARD 점프·숙이기·레인 이동이 모두 충분히 섞임`, h.jump >= 15 && h.duck >= 8 && h.lane >= 30, h);
}
console.log(rows.join('\n'));
{
  const seq = (id: string) => buildChart(id, 'hard')!.obstacles.slice(0, 40).map((o) => o.need[0]).join('');
  const all = COURSES.map((c) => seq(c.id));
  check('곡마다 HARD 패턴이 다름 (같은 패턴 재사용 없음)', new Set(all).size === all.length);
}

console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
process.exit(failed ? 1 : 0);

// (사용하지 않는 import 경고 방지)
void (null as unknown as Lane);
