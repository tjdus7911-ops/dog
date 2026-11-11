// 광장 채널 테스트: 4개 광장 · 정원 · 자동 배정 · 만원 대기 · 이동 · 공간 분리 · 중복 접속
// 정원을 2명으로 줄여서(MUNGLE_PARK_CAPACITY=2) 실제 서버로 확인한다.
// 실행: npm run test:channels
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';

const PORT = 3994;
const BASE = `http://localhost:${PORT}`;
const CAP = 2;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-ch-'));
let passed = 0, failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(p: string, body?: object, token?: string, method = 'POST') {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}
const emit = <T = any>(s: Socket, ev: string, data?: unknown): Promise<T> => new Promise((r) => s.emit(ev, data, r));
interface C { id: number; token: string; s: Socket; events: { ev: string; data: any }[] }
const sock = (token: string, events: C['events']) => new Promise<Socket>((res, rej) => {
  const s = io(BASE, { auth: { token }, transports: ['websocket'], forceNew: true });
  s.onAny((ev, data) => events.push({ ev, data }));
  s.on('connect', () => res(s)); s.on('connect_error', rej);
});
let n = 0;
async function user(): Promise<C> {
  n++;
  const r = await api('/api/auth/signup', { username: `chan${String(n).padStart(3, '0')}`, password: 'password123', nickname: `광장${n}`, dogName: '콩', agree: true });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const events: C['events'] = [];
  return { id: r.body.profile.id, token: r.body.token, s: await sock(r.body.token, events), events };
}
const counts = async (c: C) => Object.fromEntries((await emit<any>(c.s, 'park:list')).parks.filter((p: any) => p.kind === 'park').map((p: any) => [p.id, p.count]));

async function main() {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_PARK_CAPACITY: String(CAP), MUNGLE_BACKUP_HOURS: '0', MUNGLE_POOP_MIN_S: '99999', MUNGLE_POOP_MAX_S: '99999' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await sleep(200); } }
  const all: C[] = [];
  try {
    console.log('\n[광장 4개 · 자동 배정]');
    const a = await user(); all.push(a);
    const list = await emit<any>(a.s, 'park:list');
    const parks = list.parks.filter((p: any) => p.kind === 'park');
    check('광장 4개 (광장 1~4) · 정원 표시', parks.length === 4 && parks.map((p: any) => p.name).join(',') === '광장 1,광장 2,광장 3,광장 4' && parks.every((p: any) => p.capacity === CAP), parks);
    const ja = await emit<any>(a.s, 'park:join');
    check('첫 접속 → 광장 1', ja.ok && ja.park.id === 'central-1');
    const b = await user(); all.push(b);
    // 다른 광장에 먼저 한 명이 있어도, 사람이 더 많은 쪽으로
    const jb = await emit<any>(b.s, 'park:join');
    check('두 번째 접속도 사람 있는 광장 1로 (빈 광장 여러 개 만들지 않음)', jb.ok && jb.park.id === 'central-1');
    const c = await user(); all.push(c);
    const jc = await emit<any>(c.s, 'park:join');
    check('광장 1 만원 → 광장 2로', jc.ok && jc.park.id === 'central-2');
    const d = await user(); all.push(d);
    const full1 = await emit<any>(d.s, 'park:join', { parkId: 'central-1' });
    check('만원 광장 직접 선택 → 거부(code full)', !full1.ok && full1.code === 'full');
    const jd = await emit<any>(d.s, 'park:join');
    check('자동 배정은 사람 있는 광장 2로', jd.ok && jd.park.id === 'central-2');
    const e = await user(); all.push(e); await emit(e.s, 'park:join');
    const f = await user(); all.push(f); await emit(f.s, 'park:join');
    const g = await user(); all.push(g); await emit(g.s, 'park:join');
    const h = await user(); all.push(h); await emit(h.s, 'park:join');
    const cnt = await counts(a);
    check(`8명 → 광장마다 ${CAP}명씩 (서버 집계)`, Object.values(cnt).every((v) => v === CAP), cnt);
    const i9 = await user(); all.push(i9);
    const ji = await emit<any>(i9.s, 'park:join');
    check('모두 가득 → 대기 안내(code all_full)', !ji.ok && ji.code === 'all_full' && /가득/.test(ji.error), ji);

    console.log('\n[퇴장 · 이동 · 인원 차감]');
    c.s.disconnect();
    await sleep(300);
    const after = await counts(a);
    check('접속 종료 → 그 광장 인원 차감', after['central-2'] === CAP - 1, after);
    const ji2 = await emit<any>(i9.s, 'park:join');
    check('자리가 나면 대기자 입장', ji2.ok && ji2.park.id === 'central-2');
    // 광장 이동: 기존 광장 퇴장 처리 + 새 광장 입구(warp) 배치
    e.events.length = 0; a.events.length = 0;
    const move = await emit<any>(a.s, 'park:join', { parkId: 'central-3' });
    check('만원 광장으로 이동 거부', !move.ok && move.code === 'full');
    // 자리 만들기: 광장 4의 한 명을 광장 1로? (광장 1도 만원) → 광장 3의 한 명 퇴장
    const pick = [e, f, g, h].find((x) => x.events.length >= 0)!;
    const where = await Promise.all([e, f, g, h].map(async (x) => ({ x, park: (await emit<any>(x.s, 'park:join')).park?.id })));
    const in3 = where.find((w) => w.park === 'central-3')!.x;
    void pick;
    in3.s.disconnect(); await sleep(300);
    const mv = await emit<any>(a.s, 'park:join', { parkId: 'central-3', warp: 'plaza' });
    const c2 = await counts(b);
    check('광장 1 → 광장 3 이동: 1은 줄고 3은 늘어남', mv.ok && mv.park.id === 'central-3' && c2['central-1'] === 1 && c2['central-3'] === CAP, c2);
    check('새 광장 입구(광장 입구 앞)에 배치', mv.ok && Math.abs(mv.spawn[1] - 10) < 1.2, mv.spawn);
    check('예전 광장 사람들에게 퇴장 알림', b.events.some((x) => x.ev === 'players:leave' && x.data?.id === a.id));

    console.log('\n[광장 간 데이터 분리]');
    b.events.length = 0;
    const other3 = where.find((w) => w.park === 'central-3' && w.x !== in3)!.x;
    other3.events.length = 0;
    a.s.emit('state', [1, 9, 0, 0, 1.7, 9.3, 0, 0]);
    await sleep(400);
    const seenB = b.events.some((x) => x.ev === 'state' || (x.ev === 'states' && JSON.stringify(x.data).includes(`"${a.id}"`)));
    const seen3 = other3.events.some((x) => (x.ev === 'states' || x.ev === 'state') && JSON.stringify(x.data).includes(String(a.id)));
    check('같은 광장 사람만 위치를 받음 (다른 광장에는 안 감)', !seenB && seen3, { seenB, seen3, ev3: other3.events.map((x) => x.ev) });
    b.events.length = 0; other3.events.length = 0;
    await emit(a.s, 'chat:public', '광장 3 안녕');
    await sleep(300);
    check('채팅도 같은 광장에만', other3.events.some((x) => x.ev === 'chat') && !b.events.some((x) => x.ev === 'chat'));

    console.log('\n[중복 접속 · 재접속]');
    const before = await counts(b);
    const evs: C['events'] = [];
    const a2 = await sock(a.token, evs);
    await sleep(200);
    const ja2 = await emit<any>(a2, 'park:join', { parkId: 'central-3' });
    const c3 = await counts(b);
    check('같은 계정이 새 창에서 접속 → 인원 두 번 세지 않음', ja2.ok && c3['central-3'] === before['central-3'], { before, c3 });
    check('예전 창은 종료 안내 후 끊김', a.events.some((x) => x.ev === 'kicked'));
    a2.disconnect(); await sleep(300);
    const c4 = await counts(b);
    check('끊긴 연결 인원 정리', c4['central-3'] === CAP - 1, c4);
  } finally {
    for (const c of all) c.s.disconnect();
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
