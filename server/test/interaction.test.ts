// 강아지 상호작용·소셜·둘러보기·액자 사진 통합 테스트
// 실행: npm run test:interaction
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { BINS } from '../../shared/world';
import { furnitureSpots } from '../../shared/home';

const PORT = 3997;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-int-'));
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let passed = 0, failed = 0;
const check = (name: string, cond: unknown, extra?: unknown) => { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(p: string, body?: object, token?: string, method?: string) {
  const res = await fetch(BASE + p, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}
const emit = <T = any>(s: Socket, ev: string, data?: unknown): Promise<T> => new Promise((r) => s.emit(ev, data, r));
interface C { id: number; token: string; s: Socket; ev: { e: string; d: any }[]; poops: Map<string, any>; begins: Set<string> }
async function connect(token: string, id: number): Promise<C> {
  const s = io(BASE, { auth: { token }, transports: ['websocket'] });
  const ev: C['ev'] = [];
  const poops = new Map<string, any>(), begins = new Set<string>();
  s.onAny((e, d) => {
    ev.push({ e, d });
    if (e === 'poop:begin') begins.add(d.id);
    if (e === 'poop:add') poops.set(d.id, d);
    if (e === 'poop:remove') poops.delete(d.id);
  });
  await new Promise<void>((res, rej) => { s.on('connect', () => res()); s.on('connect_error', rej); });
  return { id, token, s, ev, poops, begins };
}
async function user(name: string, nick: string, dog: string) {
  const r = await api('/api/auth/signup', { username: name, password: 'password123', nickname: nick, dogName: dog, agree: true });
  return connect(r.body.token, r.body.profile.id);
}
const got = (c: C, e: string, f: (d: any) => boolean = () => true) => c.ev.some((x) => x.e === e && f(x.d));
const state = (c: C, x: number, z: number, dx: number, dz: number, ha = 0, da = 0) => c.s.emit('state', [x, z, 0, ha, dx, dz, 0, da]);
/** 서버의 이동 속도 검증을 통과하도록 조금씩 이동 */
async function walk(c: C, from: [number, number], to: [number, number], dog = true) {
  const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.25);
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / steps, z = from[1] + ((to[1] - from[1]) * i) / steps;
    state(c, x, z, dog ? x + 0.6 : x, z, 1, 1);
    await sleep(60);
  }
}

/** 서버가 배변을 만들 때까지 제자리 왕복 산책 */
const myPoop = (c: C) => [...c.poops.values()].find((x) => x.ownerId === c.id);
async function walkUntilPoop(c: C, p: [number, number]) {
  for (let k = 0; k < 12 && !myPoop(c); k++) {
    await walk(c, p, [p[0], p[1] - 1.5]);
    await walk(c, [p[0], p[1] - 1.5], p);
  }
  for (let i = 0; i < 20 && !myPoop(c); i++) await sleep(150);
  return myPoop(c);
}

async function main() {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_POOP_MIN_S: '1', MUNGLE_POOP_MAX_S: '1.5', MUNGLE_POOP_CHANCE: '1', MUNGLE_POOP_TICK_MS: '300', MUNGLE_POOP_SQUAT_MS: '400' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => { const t = String(d); if (!t.includes('ExperimentalWarning') && !t.includes('--trace-warnings')) process.stderr.write(t); });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/parks'); break; } catch { await sleep(200); } }
  try {
    const a = await user('alice01', '앨리스', '사슴이');
    const b = await user('bob0001', '밥이', '몽실이');
    const ja = await emit(a.s, 'park:join', { parkId: 'central-1' });
    const jb = await emit(b.s, 'park:join', { parkId: 'central-1' });
    check('입장 응답에 배변·봉투 상태 포함', Array.isArray(ja.poops) && Array.isArray(jb.bags));
    const pa: [number, number] = [ja.spawn[0], ja.spawn[1]];
    const pb: [number, number] = [jb.spawn[0], jb.spawn[1]];

    console.log('\n[1. 쓰다듬기]');
    state(a, pa[0], pa[1], pa[0] + 0.7, pa[1]);
    await sleep(150);
    a.ev.length = 0; b.ev.length = 0;
    const own = await emit(a.s, 'pet', { targetId: a.id });
    await sleep(150);
    check('내 강아지 쓰다듬기 + 같은 공간에 실시간 전달', own.ok && got(b, 'pet', (d) => d.fromId === a.id && d.targetId === a.id));
    check('연속 쓰다듬기 제한', !(await emit(a.s, 'pet', { targetId: a.id })).ok);
    // 멀리 있는 다른 강아지
    state(b, pb[0], pb[1], pb[0] + 0.5, pb[1]);
    await sleep(2000);
    const far = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 3;
    if (far) check('멀리 있는 강아지는 쓰다듬기 불가', !(await emit(a.s, 'pet', { targetId: b.id })).ok);
    await walk(a, pa, [pb[0] + 1.2, pb[1]]);
    pa[0] = pb[0] + 1.2; pa[1] = pb[1];
    await sleep(2000);
    a.ev.length = 0; b.ev.length = 0;
    const other = await emit(a.s, 'pet', { targetId: b.id });
    await sleep(150);
    check('다른 사용자 강아지 쓰다듬기 (보호자 화면에도 표시)', other.ok && got(b, 'pet', (d) => d.fromId === a.id && d.targetId === b.id));
    await api('/api/me/dog-profile', { allowPetting: 'none' }, b.token, 'PUT');
    await sleep(2000);
    const denied = await emit(a.s, 'pet', { targetId: b.id });
    check('보호자가 쓰다듬기를 막으면 거부', !denied.ok && denied.error.includes('허용'));
    await api('/api/me/dog-profile', { allowPetting: 'friends' }, b.token, 'PUT');
    await sleep(2000);
    check('친구만 허용이면 친구 아닌 사람 거부', !(await emit(a.s, 'pet', { targetId: b.id })).ok);
    await emit(a.s, 'friend:request', { userId: b.id });
    await emit(b.s, 'friend:accept', { userId: a.id });
    await sleep(1900);
    check('친구가 되면 쓰다듬기 가능', (await emit(a.s, 'pet', { targetId: b.id })).ok);

    console.log('\n[2. 배변 → 줍기 → 휴지통]');
    check('배변 전에는 줍기 불가 (없는 배변)', !(await emit(a.s, 'poop:pickup', { id: 'fake-id' })).ok);
    check('봉투 없이 버리기 불가', !(await emit(a.s, 'bag:dispose', { binId: BINS[0].id })).ok);
    // 배변 자세를 클라이언트가 임의로 보내도 서버가 무시
    state(a, pa[0], pa[1], pa[0] + 0.7, pa[1], 0, 7);
    await sleep(200);
    a.ev.length = 0; b.ev.length = 0;
    // 산책(걷기) 누적 → 서버가 배변 이벤트 생성
    const poop = await walkUntilPoop(a, pa);
    check('산책 중 서버가 배변 이벤트 생성 (시작 → 생성)', !!poop && a.begins.has(poop.id) && poop.ownerId === a.id);
    check('같은 공간 사용자에게 배변 동기화', !!poop && b.poops.has(poop.id));
    check('다른 사람은 내 강아지 배변을 치울 수 없음', !(await emit(b.s, 'poop:pickup', { id: poop.id })).ok);
    // 멀리서 줍기 불가
    await walk(a, pa, [poop.x + 3, poop.z]);
    pa[0] = poop.x + 3; pa[1] = poop.z;
    await sleep(150);
    check('멀리서는 줍기 불가', !(await emit(a.s, 'poop:pickup', { id: poop.id })).ok);
    await walk(a, pa, [poop.x + 0.6, poop.z]);
    pa[0] = poop.x + 0.6; pa[1] = poop.z;
    await sleep(150);
    b.ev.length = 0;
    const pick = await emit(a.s, 'poop:pickup', { id: poop.id });
    await sleep(150);
    check('가까이서 줍기 → 바닥에서 사라지고 봉투를 듦 (모두에게)', pick.ok && got(b, 'poop:remove', (d) => d.id === poop.id) && got(b, 'bag', (d) => d.userId === a.id && d.holding));
    check('중복 줍기 불가', !(await emit(a.s, 'poop:pickup', { id: poop.id })).ok);
    const bin = BINS.reduce((best, x) => (Math.hypot(x.x - pa[0], x.z - pa[1]) < Math.hypot(best.x - pa[0], best.z - pa[1]) ? x : best));
    check('휴지통에서 멀면 버리기 불가', !(await emit(a.s, 'bag:dispose', { binId: bin.id })).ok);
    const bk = 1 - 1 / Math.hypot(bin.x, bin.z); // 휴지통에서 공원 안쪽으로 1m
    const binSpot: [number, number] = [bin.x * bk, bin.z * bk];
    await walk(a, pa, binSpot, true);
    pa[0] = binSpot[0]; pa[1] = binSpot[1];
    await sleep(150);
    b.ev.length = 0;
    const disp = await emit(a.s, 'bag:dispose', { binId: bin.id });
    await sleep(150);
    check('휴지통에 버리기 → 뚜껑 열림·봉투 사라짐 (모두에게)', disp.ok && got(b, 'bin', (d) => d.binId === bin.id) && got(b, 'bag', (d) => d.userId === a.id && !d.holding), JSON.stringify(disp) + JSON.stringify(pa) + JSON.stringify(bin));
    // 정리 정책: 다음 배변 후 공간을 떠나면 정리
    a.ev.length = 0;
    const p2 = await walkUntilPoop(a, pa);
    b.ev.length = 0;
    await emit(a.s, 'park:join', { parkId: 'central-2' });
    await sleep(150);
    check('보호자가 공간을 떠나면 치우지 않은 배변 정리', !!p2 && got(b, 'poop:remove', (d) => d.id === p2.id));
    await emit(a.s, 'park:join', { parkId: 'central-1' });

    console.log('\n[3. 강아지 프로필]');
    await api('/api/me/dog-profile', { age: 3, gender: 'female', traits: ['활발해요', '간식 최고', '이상한값'], intro: '산책을 좋아해요', visibility: 'friends', allowPetting: 'all' }, b.token, 'PUT');
    await api('/api/me/dog-photos', { dataUrl: PNG1 }, b.token);
    const c = await user('carol01', '캐롤', '보리');
    const pf = await api(`/api/dogs/${b.id}`, undefined, a.token);
    check('친구에게는 나이·성별·성격·소개·사진첩 공개', pf.body.dog.age === 3 && pf.body.dog.gender === 'female' && pf.body.dog.traits.length === 2 && pf.body.dog.photos.length === 1 && pf.body.dog.intro === '산책을 좋아해요');
    const pc = await api(`/api/dogs/${b.id}`, undefined, c.token);
    check('친구 공개 설정이면 친구 아닌 사람에게는 이름·견종만', pc.body.dog.limited && pc.body.dog.age === null && pc.body.dog.photos.length === 0 && pc.body.dog.name === '몽실이');

    console.log('\n[4. 집 공개 범위 · 친구 집 방문]');
    await api('/api/apartment/move-in', { building: '1', unit: '101' }, b.token);
    await api('/api/home/me/visibility', { visibility: 'friends' }, b.token, 'PUT');
    check('친구 공개 집: 친구는 입장', (await emit(a.s, 'park:join', { parkId: `home-${b.id}` })).ok);
    check('친구 공개 집: 친구 아닌 사람은 입장 불가', !(await emit(c.s, 'park:join', { parkId: `home-${b.id}` })).ok);
    await api('/api/home/me/visibility', { visibility: 'approval' }, b.token, 'PUT');
    await sleep(100);
    const ac = await api(`/api/home/${b.id}/access`, undefined, c.token);
    check('승인제: 방문 신청 필요', ac.body.allowed === false && ac.body.canRequest === true);
    check('승인제: 친구도 바로 입장 불가', !(await emit(a.s, 'park:join', { parkId: `home-${b.id}` })).ok);
    await api(`/api/home/${b.id}/visit-request`, {}, c.token);
    await api(`/api/home/me/visit-requests/${c.id}`, { approve: true }, b.token);
    check('승인 후 입장 가능', (await emit(c.s, 'park:join', { parkId: `home-${b.id}` })).ok);
    await api('/api/home/me/visibility', { visibility: 'private' }, b.token, 'PUT');
    check('비공개: 집주인만', !(await emit(a.s, 'park:join', { parkId: `home-${b.id}` })).ok && (await emit(b.s, 'park:join', { parkId: `home-${b.id}` })).ok);

    console.log('\n[4-1. 집 가구 앉기·눕기 자세 검증]');
    await api('/api/home/me/visibility', { visibility: 'public' }, b.token, 'PUT');
    const hj = await emit(a.s, 'park:join', { parkId: `home-${b.id}` });
    const sofa = furnitureSpots((await api('/api/home/me', undefined, b.token)).body.home.layout).find((x) => x.type === 'sofa')!;
    const seatSpot = sofa.human[0];
    const lastAnim = (c: C, id: number) => { for (let k = c.ev.length - 1; k >= 0; k--) { const e = c.ev[k]; if (e.e === 'states' && e.d[id]) return e.d[id][3]; } return -1; };
    // 소파 자리까지 걸어가서 앉기 자세 → 인정
    await walk(a, [hj.spawn[0], hj.spawn[1]], [seatSpot.x, seatSpot.z + 0.9]);
    await walk(a, [seatSpot.x, seatSpot.z + 0.9], [seatSpot.x, seatSpot.z]);
    b.ev.length = 0;
    state(a, seatSpot.x, seatSpot.z, seatSpot.x + 0.6, seatSpot.z + 0.3, 5); await sleep(400);
    check('집 소파 자리에서 앉기 자세 인정 (다른 사람에게 앉은 모습)', lastAnim(b, a.id) === 5, lastAnim(b, a.id));
    // 소파가 아닌 곳에서 앉기·눕기 → 서 있는 자세로
    await walk(a, [seatSpot.x, seatSpot.z], [0, 0.8]);
    state(a, 0, 0.8, 0.6, 1, 5); await sleep(400);
    check('가구가 없는 곳의 앉기 자세는 무시', lastAnim(b, a.id) === 0);
    state(a, 0, 0.8, 0.6, 1, 10); await sleep(400);
    check('침대가 없는 곳의 잠자기 자세는 무시', lastAnim(b, a.id) === 0);

    console.log('\n[5. 액자 사진]');
    const up1 = await api('/api/home/me/photos', { dataUrl: PNG1 }, b.token);
    const up2 = await api('/api/home/me/photos', { dataUrl: PNG1 }, b.token);
    check('액자용 사진 업로드 (서버 저장)', up1.status === 200 && up1.body.photo.url.startsWith('/uploads/') && fs.existsSync(path.join(dataDir, 'uploads', path.basename(up1.body.photo.url))));
    check('이미지가 아닌 파일 거부', (await api('/api/home/me/photos', { dataUrl: 'data:image/png;base64,aGVsbG8=' }, b.token)).status === 400);
    const layout = [
      { type: 'frame', n: 0, x: -1, z: -2, rot: 0, photo: up1.body.photo.url, style: 'polaroid', scale: 1.3, fit: { z: 1.4, x: 0.2, y: -0.1 } },
      { type: 'frame', n: 1, x: 1, z: -2, rot: 1, photo: up2.body.photo.url, style: 'round' },
      { type: 'frame', n: 2, x: 0, z: -2.4, rot: 0 },
    ];
    const sv = await api('/api/home/me/layout', { layout }, b.token, 'PUT');
    check('여러 액자에 서로 다른 사진·디자인·크기 저장', sv.status === 200 && sv.body.home.layout[0].photo === up1.body.photo.url && sv.body.home.layout[1].photo === up2.body.photo.url && sv.body.home.layout[0].style === 'polaroid' && sv.body.home.layout[0].scale === 1.3);
    const re = await api('/api/home/me', undefined, b.token);
    check('다시 불러와도(재접속) 같은 사진', re.body.home.layout.find((i: any) => i.n === 0).photo === up1.body.photo.url);
    const upA = await api('/api/home/me/photos', { dataUrl: PNG1 }, a.token);
    check('남의 사진 주소는 액자에 걸 수 없음', (await api('/api/home/me/layout', { layout: [{ ...layout[0], photo: upA.body.photo.url }] }, b.token, 'PUT')).status === 403);
    check('잘못된 크기 값 거부', (await api('/api/home/me/layout', { layout: [{ ...layout[0], scale: 9 }] }, b.token, 'PUT')).status === 400);
    check('액자에 걸린 사진은 삭제 불가 (참조 확인)', (await api(`/api/home/me/photos/${up1.body.photo.id}`, undefined, b.token, 'DELETE')).status === 409);
    // 대표 사진을 액자에 건 뒤 대표 사진을 바꿔도 액자 사진은 지켜짐
    const main1 = (await api('/api/me/dog-photo', { dataUrl: PNG1 }, b.token)).body.profile.dogPhoto as string;
    await api('/api/home/me/layout', { layout: [...layout.slice(0, 2), { ...layout[2], photo: main1 }] }, b.token, 'PUT');
    await api('/api/me/dog-photo', { dataUrl: PNG1 }, b.token);
    const kept = await api('/api/home/me/photos', undefined, b.token);
    check('대표 사진을 바꿔도 액자에 걸린 사진 파일은 유지 (내 사진으로 이동)', fs.existsSync(path.join(dataDir, 'uploads', path.basename(main1))) && kept.body.uploads.some((u: any) => u.url === main1));
    await api('/api/home/me/visibility', { visibility: 'public' }, b.token, 'PUT');
    const visit = await api(`/api/home/${b.id}`, undefined, a.token);
    check('방문자에게도 같은 액자 사진 표시', visit.body.home.layout[0].photo === up1.body.photo.url && visit.body.home.isOwner === false);

    console.log('\n[6. 비회원 둘러보기]');
    const g = await api('/api/auth/guest', {});
    check('둘러보기 방문자 계정 발급', g.status === 200 && g.body.profile.role === 'guest' && g.body.profile.nickname.startsWith('방문자'));
    const gc = await connect(g.body.token, g.body.profile.id);
    const gj = await emit(gc.s, 'park:join', { parkId: 'central-1' });
    check('방문자는 공원 구경 가능', gj.ok);
    check('다른 사용자에게 방문자로 표시', got(b, 'players:join', (d) => d.profile.id === g.body.profile.id && d.profile.guest === true) || (await emit(b.s, 'park:join', { parkId: 'central-1' })).players?.some((p: any) => p.profile.guest));
    const gChat = await emit(gc.s, 'chat:public', '안녕');
    check('방문자 채팅 불가 (주민 전용 안내 코드)', !gChat.ok && gChat.code === 'members_only');
    check('방문자 친구 신청 불가', !(await emit(gc.s, 'friend:request', { userId: a.id })).ok);
    check('방문자 쓰다듬기 불가', !(await emit(gc.s, 'pet', { targetId: a.id })).ok);
    check('방문자 집 입장 불가', !(await emit(gc.s, 'park:join', { parkId: `home-${b.id}` })).ok);
    const gw = await api('/api/posts', { text: '안녕', photo: PNG1 }, g.body.token);
    check('방문자 글쓰기 불가 (members_only)', gw.status === 403 && gw.body.code === 'members_only');
    check('방문자 입주 불가', (await api('/api/apartment/move-in', { building: '1', unit: '202' }, g.body.token)).status === 403);
    check('방문자 아바타 저장 불가', (await api('/api/me/profile', { nickname: 'x' }, g.body.token, 'PUT')).status === 403);
    check('방문자도 공개 게시물·강아지 프로필 열람 가능', (await api('/api/posts', undefined, g.body.token)).status === 200 && (await api(`/api/dogs/${a.id}`, undefined, g.body.token)).status === 200);
    [a, b, c, gc].forEach((x) => x.s.close());
  } finally {
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
