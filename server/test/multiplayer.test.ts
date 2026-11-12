// 다중 사용자 통합 테스트: 실제 서버 프로세스를 띄우고 여러 클라이언트로 접속해 검증한다.
// 실행: npm run test:multi
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { SEATS, warpState } from '../../shared/world';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-test-'));

let passed = 0;
let failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(pathname: string, body?: object, token?: string, method = 'POST') {
  const res = await fetch(BASE + pathname, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

function emit<T = any>(s: Socket, ev: string, data?: unknown): Promise<T> {
  return new Promise((resolve) => s.emit(ev, data, resolve));
}

interface Client { id: number; token: string; s: Socket; events: { ev: string; data: any }[] }

async function makeUser(name: string, nickname: string, dogName: string): Promise<Client> {
  const r = await api('/api/auth/signup', { username: name, password: 'password123', nickname, dogName, agree: true });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const s = io(BASE, { auth: { token: r.body.token }, transports: ['websocket'] });
  const events: Client['events'] = [];
  s.onAny((ev, data) => events.push({ ev, data }));
  await new Promise<void>((res, rej) => { s.on('connect', () => res()); s.on('connect_error', rej); });
  return { id: r.body.profile.id, token: r.body.token, s, events };
}
const got = (c: Client, ev: string, pred: (d: any) => boolean = () => true) => c.events.some((e) => e.ev === ev && pred(e.data));
const clear = (...cs: Client[]) => cs.forEach((c) => (c.events.length = 0));

async function main() {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_PARK_CAPACITY: '3', MUNGLE_ADMINS_ON_SIGNUP: '1', MUNGLE_ADMINS: 'admin_user', MUNGLE_BACKUP_HOURS: '0', MUNGLE_OPERATOR: '멍글마을 운영팀', MUNGLE_CONTACT: 'help@example.com' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => { const t = String(d); if (!t.includes('ExperimentalWarning') && !t.includes('--trace-warnings')) process.stderr.write(t); });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/parks'); break; } catch { await sleep(200); } }

  try {
    console.log('\n[인증]');
    const bad = await api('/api/auth/signup', { username: 'ab', password: 'x', nickname: 'a', dogName: '' });
    check('잘못된 가입 정보 거부', bad.status === 400);
    const badNick = await api('/api/auth/signup', { username: 'baduser', password: 'password123', nickname: '시 발놈', dogName: '초코' });
    check('욕설 닉네임 거부', badNick.status === 400);
    const noAgree = await api('/api/auth/signup', { username: 'noagree1', password: 'password123', nickname: '동의없음', dogName: '초코' });
    check('만 14세·약관 동의 없이 가입 거부', noAgree.status === 400 && noAgree.body.error.includes('동의'));
    const site = await api('/api/site', undefined, undefined, 'GET');
    check('약관용 운영자 정보 제공', site.body.operator === '멍글마을 운영팀' && site.body.contact === 'help@example.com');

    const a = await makeUser('alice01', '앨리스', '사슴이');
    const b = await makeUser('bob0001', '밥이', '몽실이');
    const c = await makeUser('carol01', '캐롤', '보리');
    check('3명 가입 및 소켓 인증 접속', a.s.connected && b.s.connected && c.s.connected);

    console.log('\n[아바타 데이터 하위 호환]');
    const oldHuman = { skin: '#ffe0c7', hairStyle: 'bob', hairColor: '#6b4127', top: 'hoodie', topColor: '#fff3df', bottom: 'shorts', bottomColor: '#7ea6d8', shoeColor: '#ffffff', hat: 'cap', hatColor: '#fff3df', accessory: 'backpack' };
    const me0 = (await api('/api/me', undefined, a.token, 'GET')).body.profile;
    const upOld = await api('/api/me/profile', { nickname: '앨리스', dogName: '사슴이', dogIntro: '', human: oldHuman, dog: me0.dog }, a.token, 'PUT');
    check('이전 형식 아바타(신발 종류 없음) 저장 시 기본값 보정', upOld.status === 200 && upOld.body.profile.human.shoes === 'sneaker');
    const upNew = await api('/api/me/profile', { nickname: '앨리스', dogName: '사슴이', dogIntro: '', human: { ...oldHuman, hairStyle: 'twin', top: 'overalls', hat: 'headphones', accessory: 'crossbag', shoes: 'boots' }, dog: { ...me0.dog, breed: 'corgi' } }, a.token, 'PUT');
    check('새 옵션(양갈래·멜빵·헤드폰·크로스백·부츠·코기형) 저장', upNew.status === 200 && upNew.body.profile.human.hat === 'headphones');
    const { marking: _m, earSize: _e, build: _b, bodyLen: _bl, legLen: _ll, ...oldDog } = me0.dog;
    const upOldDog = await api('/api/me/profile', { nickname: '앨리스', dogName: '사슴이', dogIntro: '', human: oldHuman, dog: oldDog }, a.token, 'PUT');
    check('이전 형식 강아지(세부 특징 없음) 저장 시 기본값 보정', upOldDog.status === 200 && upOldDog.body.profile.dog.legLen === 'short' && upOldDog.body.profile.dog.marking === 'none');
    const upBad = await api('/api/me/profile', { nickname: '앨리스', dogName: '사슴이', dogIntro: '', human: { ...oldHuman, hat: 'crown' }, dog: me0.dog }, a.token, 'PUT');
    check('허용 목록 밖의 아바타 값 거부', upBad.status === 400);
    const aiOff = await api('/api/dog-analysis', { photos: [] }, a.token);
    check('AI 키 미설정 시 분석 요청은 503 안내', aiOff.status === 503 && (await api('/api/dog-analysis/status', undefined, a.token, 'GET')).body.available === false);
    const anon = io(BASE, { auth: { token: 'invalid-token-xxxxxxxxxxxxxxxxxx' }, transports: ['websocket'] });
    const anonErr = await new Promise<string>((res) => anon.on('connect_error', (e) => res(e.message)));
    check('토큰 없는 소켓 접속 거부', anonErr === 'unauthorized');
    anon.close();

    console.log('\n[2. 같은 공원 다중 접속]');
    const ja = await emit(a.s, 'park:join', { parkId: 'central-1' });
    const jb = await emit(b.s, 'park:join', { parkId: 'central-1' });
    check('A 입장', ja.ok && ja.players.length === 0);
    check('B 입장 시 A가 이미 보임', jb.ok && jb.players.some((p: any) => p.profile.id === a.id));
    await sleep(150);
    check('A가 B의 입장 이벤트 수신', got(a, 'players:join', (d) => d.profile.id === b.id && d.profile.nickname === '밥이'));
    check('공개 프로필에 로그인 ID 미포함', !JSON.stringify(jb.players).includes('alice01'));

    console.log('\n[3. 위치·애니메이션 동기화]');
    clear(a, b);
    const [x, z] = jb.spawn;
    b.s.emit('state', [x + 0.2, z - 0.1, 1.2, 1, x + 1, z, 1.1, 1]);
    await sleep(350);
    const st = a.events.find((e) => e.ev === 'states' && e.data[b.id]);
    check('B 이동/걷기 상태가 A에게 전달', st && Math.abs(st.data[b.id][0] - (x + 0.2)) < 0.02 && st.data[b.id][3] === 1, st?.data);
    clear(a, b);
    b.s.emit('state', [x + 30, z, 0, 2, x + 30, z, 0, 2]);
    await sleep(250);
    check('순간이동(속도 조작) 패킷 거부 및 보정 전송', got(b, 'correct') && !a.events.some((e) => e.ev === 'states' && e.data[b.id]?.[0] > x + 10));
    clear(a, b);
    b.s.emit('state', [x + 0.4, z, 0, 2, x + 9, z, 0, 2]);
    await sleep(250);
    const st2 = a.events.find((e) => e.ev === 'states' && e.data[b.id]);
    check('강아지 위치는 목줄 길이 이내로 제한', st2 && Math.hypot(st2.data[b.id][4] - st2.data[b.id][0], st2.data[b.id][5] - st2.data[b.id][1]) <= 4.01, st2?.data);
    b.s.emit('state', ['x', null]);
    check('잘못된 패킷 무시(서버 정상)', (await emit(b.s, 'park:list')).ok);

    console.log('\n[장소 바로 가기 · 입구 앞 순간 이동]');
    clear(a, b);
    const w1 = await emit(b.s, 'park:warp', { to: 'apartment' });
    const ws1 = warpState('apartment', b.id);
    check('아파트 입구 앞으로 바로 이동 (서버가 정한 좌표)', w1.ok && JSON.stringify(w1.state) === JSON.stringify(ws1), w1);
    await sleep(200);
    check('다른 사람 화면에도 바로 반영 (미끄러지지 않게 warp 이벤트)', got(a, 'players:warp', (d) => d.userId === b.id && d.state[0] === ws1[0] && d.state[1] === ws1[1]));
    check('입구를 바라보고 · 강아지도 바로 옆으로 함께', ws1[2] === Math.PI && Math.hypot(ws1[4] - ws1[0], ws1[5] - ws1[1]) < 1.2);
    clear(a, b);
    b.s.emit('state', [ws1[0] + 0.2, ws1[1] - 0.1, ws1[2], 1, ws1[4], ws1[5], ws1[6], 1]);
    await sleep(300);
    check('순간 이동 직후 걷기는 정상 처리 (보정·되돌림 없음)', !got(b, 'correct') && a.events.some((e) => e.ev === 'states' && Math.abs((e.data[b.id]?.[0] ?? -99) - (ws1[0] + 0.2)) < 0.02));
    check('없는 장소 이름 거부', !(await emit(b.s, 'park:warp', { to: 'moon' })).ok);
    check('좌표를 보내도 쓰지 않음 (장소 이름으로만)', !(await emit(b.s, 'park:warp', { to: { x: 100, z: 100 } })).ok);
    const inLobby = await emit(b.s, 'park:join', { parkId: 'lobby-1' });
    check('실내에서는 같은 자리 순간 이동 거부 (공원으로 나가며 이동)', inLobby.ok && !(await emit(b.s, 'park:warp', { to: 'cafe' })).ok);
    const outCafe = await emit(b.s, 'park:join', { parkId: 'central-1', warp: 'cafe' });
    const wsC = warpState('cafe', b.id);
    check('공원으로 나가며 카페 입구 앞에서 시작', outCafe.ok && outCafe.spawn[0] === wsC[0] && outCafe.spawn[1] === wsC[1] && outCafe.spawn[2] === wsC[2], outCafe.spawn);
    const runnerW = await emit(b.s, 'park:warp', { to: 'runner' });
    check('멍글런너 경기장 입구 앞', runnerW.ok && runnerW.state[0] === warpState('runner', b.id)[0]);
    const badJoin = await emit(b.s, 'park:join', { parkId: 'lobby-1', warp: 'cafe' });
    check('실내 입장에 warp를 붙여도 실내 시작 위치 (입구 좌표 무시)', badJoin.ok && Math.abs(badJoin.spawn[0]) < 5);
    await emit(b.s, 'park:join', { parkId: 'central-1' });

    console.log('\n[벤치 앉기]');
    const seat = SEATS[0];
    const far = await emit(b.s, 'seat:sit', { seatId: seat.id });
    check('멀리서는 앉기 거부', !far.ok && /가까이/.test(far.error));
    // B를 벤치 앞으로 조금씩 이동 (서버 속도 검증 통과)
    let bx = x + 0.4, bz = z;
    // (한 번에 1.0m — 이벤트가 몰려 도착해도 서버 속도 검증에 걸리지 않을 만큼 작게)
    for (let i = 0; i < 24 && Math.hypot(seat.frontX - bx, seat.frontZ - bz) > 0.1; i++) {
      const dx = seat.frontX - bx, dz = seat.frontZ - bz, dd = Math.hypot(dx, dz), step = Math.min(dd, 1.0);
      bx += (dx / dd) * step; bz += (dz / dd) * step;
      b.s.emit('state', [bx, bz, 0, 1, bx + 0.8, bz, 0, 1]);
      await sleep(320);
    }
    clear(a, b);
    const sit = await emit(b.s, 'seat:sit', { seatId: seat.id });
    await sleep(150);
    check('벤치 앞에서 앉기 성공', sit.ok && sit.seatId === seat.id, sit);
    check('다른 사용자에게 좌석 점유 전파', got(a, 'seats', (m) => m[seat.id] === b.id));
    check('이미 앉은 자리는 다른 사용자가 선택 불가', !(await emit(a.s, 'seat:sit', { seatId: seat.id })).ok);
    check('없는 좌석 거부', !(await emit(b.s, 'seat:sit', { seatId: 'nope' })).ok);
    clear(a, b);
    b.s.emit('state', [seat.x, seat.z, seat.rot, 5, seat.dogX, seat.dogZ, seat.dogRot, 6]);
    await sleep(350);
    const sst = a.events.find((e) => e.ev === 'states' && e.data[b.id]);
    check('앉기·엎드리기 상태 동기화', sst && sst.data[b.id][3] === 5 && sst.data[b.id][7] === 6, sst?.data);
    clear(a, b);
    await emit(b.s, 'seat:leave');
    await sleep(150);
    check('일어나면 좌석 해제', got(a, 'seats', (m) => m[seat.id] === undefined));
    clear(a, b);
    b.s.emit('state', [seat.frontX, seat.frontZ, 0, 5, seat.frontX + 0.8, seat.frontZ, 0, 0]);
    await sleep(350);
    const nst = a.events.find((e) => e.ev === 'states' && e.data[b.id]);
    check('좌석 없이 앉기 상태를 보내면 서버가 무시', nst && nst.data[b.id][3] === 0, nst?.data);
    await emit(b.s, 'seat:sit', { seatId: seat.id });
    clear(a);
    b.s.disconnect();
    await sleep(200);
    check('연결 종료 시 좌석 자동 해제', got(a, 'seats', (m) => m[seat.id] === undefined));
    b.s.connect();
    await new Promise<void>((r) => b.s.once('connect', () => r()));
    await emit(b.s, 'park:join', { parkId: 'central-1' });

    console.log('\n[멍글 아파트 입주]');
    const apt0 = await api('/api/apartment', undefined, a.token, 'GET');
    check('아파트 1동 4층×4호 = 16호실', apt0.status === 200 && apt0.body.buildings[0].units.length === 16 && apt0.body.buildings[0].units.every((u: any) => !u.occupied));
    const mvA = await api('/api/apartment/move-in', { building: '1', unit: '302' }, a.token);
    check('호실 선택 후 입주 확정', mvA.status === 200 && mvA.body.profile.residence?.unit === '302');
    check('이미 배정된 호실은 다른 사용자가 선택 불가', (await api('/api/apartment/move-in', { building: '1', unit: '302' }, b.token)).status === 409);
    check('한 사용자는 한 호실만', (await api('/api/apartment/move-in', { building: '1', unit: '101' }, a.token)).status === 409);
    check('없는 호실 거부', (await api('/api/apartment/move-in', { building: '1', unit: '999' }, b.token)).status === 400 && (await api('/api/apartment/move-in', { building: '9', unit: '101' }, b.token)).status === 400);
    const [r1, r2] = await Promise.all([
      api('/api/apartment/move-in', { building: '1', unit: '401' }, b.token),
      api('/api/apartment/move-in', { building: '1', unit: '401' }, c.token),
    ]);
    check('같은 호실 동시 요청 시 한 명만 입주', [r1.status, r2.status].sort().join() === '200,409');
    const apt1 = await api('/api/apartment', undefined, c.token, 'GET');
    const u302 = apt1.body.buildings[0].units.find((u: any) => u.unit === '302');
    check('안내판에 호실별 강아지 이름 표시', u302.occupied && u302.resident?.dogName === '사슴이' && !u302.resident.mine);
    const profA = await emit(c.s, 'profile:get', { userId: a.id });
    check('프로필에 동·호실 표시', profA.ok && profA.profile.residence?.unit === '302');

    console.log('\n[개인 집 · 꾸미기 · 방문 · 방명록]');
    const hA = await api('/api/home/me', undefined, a.token, 'GET');
    check('입주하면 기본 가구가 놓인 내 집', hA.status === 200 && hA.body.home.isOwner && hA.body.home.layout.length > 3 && hA.body.home.residence.unit === '302');
    const newLayout = [{ type: 'sofa', n: 0, x: -1, z: -2, rot: 1 }, { type: 'frame', n: 0, x: 0, z: -2.7, rot: 0 }, { type: 'frame', n: 1, x: 1, z: -2.7, rot: 0 }, { type: 'dogbed', n: 0, x: 2, z: 1, rot: 2 }];
    const saveL = await api('/api/home/me/layout', { layout: newLayout }, a.token, 'PUT');
    const hA2 = await api('/api/home/me', undefined, a.token, 'GET');
    check('가구 배치·회전·보관 저장', saveL.status === 200 && hA2.body.home.layout.length === 4 && hA2.body.home.layout[0].rot === 1);
    const badLayout = async (layout: unknown) => (await api('/api/home/me/layout', { layout }, a.token, 'PUT')).status === 400;
    check('잘못된 배치 거부(없는 가구·방 밖·보유 수 초과·중복)', await badLayout([{ type: 'piano', n: 0, x: 0, z: 0, rot: 0 }]) && await badLayout([{ type: 'sofa', n: 0, x: 9, z: 0, rot: 0 }])
      && await badLayout([{ type: 'sofa', n: 1, x: 0, z: 0, rot: 0 }]) && await badLayout([{ type: 'ball', n: 0, x: 0, z: 0, rot: 0 }, { type: 'ball', n: 0, x: 1, z: 0, rot: 0 }]));
    const neighborTok = r1.status === 200 ? b.token : c.token, outsiderTok = r1.status === 200 ? c.token : b.token;
    const visit = await api(`/api/home/${a.id}`, undefined, outsiderTok, 'GET');
    check('전체 공개 집 방문 (편집 권한 없음)', visit.status === 200 && !visit.body.home.isOwner && visit.body.home.layout.length === 4);
    check('입주 전 사용자의 집은 없음', (await api(`/api/home/${(await api('/api/me', undefined, outsiderTok, 'GET')).body.profile.id}`, undefined, a.token, 'GET')).status === 404);
    await api('/api/home/me/visibility', { visibility: 'private' }, a.token, 'PUT');
    check('비공개 집은 방문 불가', (await api(`/api/home/${a.id}`, undefined, outsiderTok, 'GET')).status === 403);
    await api('/api/home/me/visibility', { visibility: 'neighbors' }, a.token, 'PUT');
    check('이웃만: 이웃이 아니면 같은 동 주민도 방문 불가', (await api(`/api/home/${a.id}`, undefined, neighborTok, 'GET')).status === 403);
    const nbId = (await api('/api/me', undefined, neighborTok, 'GET')).body.profile.id;
    const outId = (await api('/api/me', undefined, outsiderTok, 'GET')).body.profile.id;
    check('다른 동/미입주 사용자에게는 이웃 신청 불가', (await api(`/api/neighbors/${outId}/request`, {}, a.token)).status === 400);
    const nreq = await api(`/api/neighbors/${nbId}/request`, {}, a.token);
    const nlist = await api('/api/neighbors', undefined, neighborTok, 'GET');
    check('이웃 신청 → 받은 신청 목록', nreq.body.status === 'outgoing' && nlist.body.incoming.some((p: any) => p.id === a.id));
    const nacc = await api(`/api/neighbors/${a.id}/accept`, {}, neighborTok);
    check('이웃 수락 → 이웃 목록', nacc.body.status === 'neighbors' && (await api('/api/neighbors', undefined, a.token, 'GET')).body.neighbors.some((p: any) => p.id === nbId));
    check('이웃만: 승인된 이웃은 방문 가능', (await api(`/api/home/${a.id}`, undefined, neighborTok, 'GET')).status === 200);
    await api('/api/home/me/visibility', { visibility: 'friends' }, a.token, 'PUT');
    check('친구만: 친구가 아니면 방문 불가', (await api(`/api/home/${a.id}`, undefined, neighborTok, 'GET')).status === 403);
    const acc0 = await api(`/api/home/${a.id}/access`, undefined, outsiderTok, 'GET');
    check('방문 권한 확인: 신청 가능 안내', acc0.status === 200 && !acc0.body.allowed && acc0.body.canRequest && acc0.body.owner.dogName === '사슴이');
    const vreq = await api(`/api/home/${a.id}/visit-request`, {}, outsiderTok);
    const pend = await api('/api/home/me/visit-requests', undefined, a.token, 'GET');
    check('방문 신청 → 집주인 대기 목록', vreq.status === 200 && pend.body.requests.some((r: any) => r.visitorId === outId));
    await api(`/api/home/me/visit-requests/${outId}`, { approve: true }, a.token);
    check('집주인 승인 후 입장 가능', (await api(`/api/home/${a.id}`, undefined, outsiderTok, 'GET')).status === 200);
    await api('/api/home/me/visibility', { visibility: 'private' }, a.token, 'PUT');
    const accP = await api(`/api/home/${a.id}/access`, undefined, outsiderTok, 'GET');
    check('비공개는 승인 받은 방문자도 입장 불가·신청 불가', !accP.body.allowed && !accP.body.canRequest && (await api(`/api/home/${a.id}/visit-request`, {}, outsiderTok)).status === 403);
    await api('/api/home/me/visibility', { visibility: 'friends' }, a.token, 'PUT');
    check('잘못된 공개 범위 거부', (await api('/api/home/me/visibility', { visibility: 'all' }, a.token, 'PUT')).status === 400);
    await api('/api/home/me/visibility', { visibility: 'public' }, a.token, 'PUT');
    const like1 = await api(`/api/home/${a.id}/like`, {}, outsiderTok);
    const like2 = await api(`/api/home/${a.id}/like`, {}, outsiderTok);
    check('집 좋아요 / 취소', like1.body.liked === true && like1.body.likes === 1 && like2.body.liked === false && like2.body.likes === 0);
    check('내 집에는 좋아요 불가', (await api(`/api/home/${a.id}/like`, {}, a.token)).status === 400);
    const gb = await api(`/api/home/${a.id}/guestbook`, { text: '집이 너무 예뻐요 시발 🐶' }, outsiderTok);
    const entry = gb.body.home?.guestbook?.[0];
    check('방명록 작성 (욕설 가림)', gb.status === 200 && entry && entry.text.includes('예뻐요') && !entry.text.includes('시발') && entry.canDelete);
    check('빈 방명록 거부', (await api(`/api/home/${a.id}/guestbook`, { text: '   ' }, outsiderTok)).status === 400);
    check('제3자는 방명록 삭제 불가', (await api(`/api/home/${a.id}/guestbook/${entry.id}`, undefined, neighborTok, 'DELETE')).status === 403);
    const delGb = await api(`/api/home/${a.id}/guestbook/${entry.id}`, undefined, a.token, 'DELETE');
    check('집주인은 방명록 삭제 가능', delGb.status === 200 && delGb.body.home.guestbook.length === 0);

    console.log('\n[공간 이동 · 집 안 동기화]');
    const nbSock = r1.status === 200 ? b : c, outSock = r1.status === 200 ? c : b;
    const lob = await emit(a.s, 'park:join', { parkId: 'lobby-1' });
    check('아파트 로비 입장', lob.ok && lob.park.kind === 'lobby' && lob.park.name === '멍글 아파트');
    const hj = await emit(a.s, 'park:join', { parkId: `home-${a.id}` });
    check('내 집 공간 입장', hj.ok && hj.park.kind === 'home' && hj.park.ownerId === a.id);
    await api('/api/home/me/visibility', { visibility: 'public' }, a.token, 'PUT');
    clear(a);
    const vj = await emit(outSock.s, 'park:join', { parkId: `home-${a.id}` });
    await sleep(150);
    check('방문자 입장 시 서로 보임', vj.ok && vj.players.some((p: any) => p.profile.id === a.id) && got(a, 'players:join', (d) => d.profile.id === outSock.id));
    check('같은 장소 재입장은 중복 없이 처리', (await emit(outSock.s, 'park:join', { parkId: `home-${a.id}` })).ok);
    clear(a);
    outSock.s.emit('state', [10, 10, 0, 1, 10.5, 10, 0, 1]);
    await sleep(250);
    check('방 밖 좌표는 거부', got(outSock, 'correct'));
    clear(outSock);
    await api('/api/home/me/visibility', { visibility: 'private' }, a.token, 'PUT');
    await sleep(200);
    check('공개 범위가 바뀌면 권한 없는 방문자는 집에서 나감', got(outSock, 'space:kicked') && got(a, 'players:leave', (d) => d.id === outSock.id));
    check('비공개 집 공간 입장 거부', !(await emit(outSock.s, 'park:join', { parkId: `home-${a.id}` })).ok);
    check('없는 장소 거부', !(await emit(outSock.s, 'park:join', { parkId: 'home-99999' })).ok && !(await emit(outSock.s, 'park:join', { parkId: 'moon' })).ok);
    const plist = await emit(a.s, 'park:list');
    check('장소 목록에 공원과 아파트 (개인 집은 제외)', plist.parks.some((p: any) => p.id === 'lobby-1') && !plist.parks.some((p: any) => p.kind === 'home'));
    await api('/api/home/me/visibility', { visibility: 'public' }, a.token, 'PUT');
    // 원래 공원으로 복귀
    await emit(a.s, 'park:join', { parkId: 'central-1' });
    await emit(outSock.s, 'park:join', { parkId: 'central-1' });
    void nbSock;

    console.log('\n[광장 대형 스크린]');
    const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    check('처음에는 스크린 콘텐츠 없음 (가짜 데이터 없음)', (await api('/api/screen', undefined, a.token, 'GET')).body.slides.length === 0);
    check('공개 동의 없이 신청 불가', (await api('/api/screen', { title: '사슴이 자랑', photo: PNG1 }, a.token)).status === 400);
    const sub = await api('/api/screen', { title: '사슴이 자랑', text: '산책 좋아해요', photo: PNG1, consent: true }, a.token);
    check('동의 후 신청 → 검토 대기 (아직 노출 안 됨)', sub.status === 200 && (await api('/api/screen', undefined, b.token, 'GET')).body.slides.length === 0);
    const mine = await api('/api/screen/mine', undefined, a.token, 'GET');
    check('내 신청 상태 확인', mine.body.items[0]?.status === 'pending');
    check('일반 사용자는 승인 불가', (await api(`/api/admin/screen/${mine.body.items[0].id}`, { action: 'approve' }, b.token)).status === 403);
    const admin0 = await makeUser('admin_user', '운영자', '관리견');
    clear(b);
    await api(`/api/admin/screen/${mine.body.items[0].id}`, { action: 'approve' }, admin0.token);
    await api('/api/admin/notices', { title: '주말 산책 이벤트', text: '토요일 오후 광장에서 만나요' }, admin0.token);
    await sleep(150);
    const feed = await api('/api/screen', undefined, b.token, 'GET');
    check('운영자 승인 후 스크린 노출 (오늘의 강아지 + 운영 공지)', feed.body.slides.length === 2 && feed.body.slides[0].label === '오늘의 강아지' && feed.body.slides[0].dogName === '사슴이' && feed.body.slides[1].label === '운영 공지');
    check('콘텐츠 변경 실시간 알림', got(b, 'screen:updated'));
    await api(`/api/screen/${mine.body.items[0].id}`, undefined, a.token, 'DELETE');
    check('작성자가 공개 철회하면 스크린에서 내려감', (await api('/api/screen', undefined, b.token, 'GET')).body.slides.length === 1);
    admin0.s.close();

    console.log('\n[정원 제한]');
    const jc = await emit(c.s, 'park:join', { parkId: 'central-1' });
    check('C 입장 (3/3)', jc.ok && jc.players.length === 2);
    const d = await makeUser('dave001', '데이브', '콩이');
    const jd = await emit(d.s, 'park:join', { parkId: 'central-1' });
    check('정원 초과 시 입장 거부', !jd.ok && /가득/.test(jd.error));
    const jd2 = await emit(d.s, 'park:join');
    check('자동 배정 시 빈 공원으로 입장', jd2.ok && jd2.park.id === 'central-2');

    console.log('\n[4. 공개 채팅]');
    clear(a, b, c, d);
    const sent = await emit(a.s, 'chat:public', '안녕하세요! 산책 나왔어요');
    await sleep(150);
    check('채팅 전송 성공', sent.ok);
    check('같은 공원 사용자에게 서버 경유 전달', got(b, 'chat', (m) => m.text === '안녕하세요! 산책 나왔어요' && m.from === a.id && typeof m.ts === 'number'));
    check('다른 공원 사용자에게는 미전달', !got(d, 'chat'));
    clear(b);
    await emit(a.s, 'chat:public', '이 시 발 진짜');
    await sleep(120);
    const filtered = b.events.find((e) => e.ev === 'chat');
    check('욕설 필터 적용', filtered && !filtered.data.text.includes('발') && filtered.data.text.includes('♥'), filtered?.data);
    let blockedBySpam = false;
    for (let i = 0; i < 7; i++) { const r = await emit(c.s, 'chat:public', `도배 ${i}`); if (!r.ok) blockedBySpam = true; }
    check('도배 방지(연속 전송 제한)', blockedBySpam);

    console.log('\n[5. 프로필 팝업 · 친구 신청]');
    const prof = await emit(a.s, 'profile:get', { userId: b.id });
    check('프로필 조회 (닉네임·강아지 이름·상태)', prof.ok && prof.profile.dogName === '몽실이' && prof.status === 'none');
    clear(b);
    const req = await emit(a.s, 'friend:request', { userId: b.id });
    await sleep(100);
    check('친구 신청 → 신청 중', req.ok && req.status === 'outgoing');
    check('B가 친구 신청 알림 수신', got(b, 'friend:event', (e) => e.kind === 'request' && e.from.id === a.id));
    check('B 입장에서 받은 신청 상태', (await emit(b.s, 'profile:get', { userId: a.id })).status === 'incoming');
    const dup = await emit(a.s, 'friend:request', { userId: b.id });
    check('중복 신청 거부', !dup.ok);
    const dmBefore = await emit(a.s, 'dm:send', { to: b.id, text: '안녕?' });
    check('친구가 아니면 1:1 대화 거부', !dmBefore.ok);
    clear(a);
    const acc = await emit(b.s, 'friend:accept', { userId: a.id });
    await sleep(100);
    check('수락 → 친구', acc.ok && (await emit(a.s, 'profile:get', { userId: b.id })).status === 'friends');
    check('A가 수락 알림 수신', got(a, 'friend:event', (e) => e.kind === 'accepted'));
    await emit(c.s, 'friend:request', { userId: a.id });
    const dec = await emit(a.s, 'friend:decline', { userId: c.id });
    check('거절 → 신청 가능 상태로', dec.ok && (await emit(c.s, 'profile:get', { userId: a.id })).status === 'none');

    console.log('\n[6. 친구 목록 · 1:1 채팅]');
    const fl = await emit(a.s, 'friend:list');
    const fb = fl.friends.find((f: any) => f.profile.id === b.id);
    check('친구 목록에 온라인·공원 표시', fb && fb.online === true && fb.parkId === 'central-1');
    clear(b);
    const dm = await emit(a.s, 'dm:send', { to: b.id, text: '같이 산책해요 🐶' });
    await sleep(100);
    check('1:1 메시지 전송·실시간 수신', dm.ok && got(b, 'dm', (m) => m.text === '같이 산책해요 🐶' && m.fromNickname === '앨리스'));
    const fl2 = await emit(b.s, 'friend:list');
    check('안 읽은 메시지 수', fl2.friends.find((f: any) => f.profile.id === a.id)?.unread === 1);
    const hist = await emit(b.s, 'dm:history', { with: a.id });
    check('대화 기록 조회(DB 저장)', hist.ok && hist.messages.length === 1);
    check('대화 기록 조회 시 읽음 처리', (await emit(b.s, 'friend:list')).friends[0].unread === 0);
    const loc = await emit(b.s, 'friend:locate', { userId: a.id });
    check('친구 위치(공원) 찾기', loc.ok && loc.parkId === 'central-1');

    console.log('\n[개인정보 설정]');
    clear(b);
    await api('/api/me/privacy', { showOnline: true, showLocation: false, allowFriendRequests: false }, a.token, 'PUT');
    await sleep(100);
    const loc2 = await emit(b.s, 'friend:locate', { userId: a.id });
    check('위치 비공개 시 친구도 위치 조회 불가', !loc2.ok);
    const fl3 = await emit(b.s, 'friend:list');
    check('위치 비공개 시 목록에 공원 숨김', fl3.friends[0].parkId === null && fl3.friends[0].online === true);
    check('친구에게 상태 변경 실시간 반영', got(b, 'presence', (p) => p.userId === a.id && p.parkId === null));
    const reqBlockedSetting = await emit(d.s, 'friend:request', { userId: a.id });
    check('친구 신청 받지 않기 설정 반영', !reqBlockedSetting.ok);
    const strangerLoc = await emit(c.s, 'friend:locate', { userId: a.id });
    check('친구가 아니면 위치 조회 불가', !strangerLoc.ok);

    console.log('\n[7. 함께 산책 — 친구 공원으로 이동]');
    await api('/api/me/privacy', { showOnline: true, showLocation: true, allowFriendRequests: true }, a.token, 'PUT');
    await emit(d.s, 'friend:request', { userId: a.id });
    await emit(a.s, 'friend:accept', { userId: d.id });
    await emit(c.s, 'park:leave');
    const locD = await emit(d.s, 'friend:locate', { userId: a.id });
    const moveD = await emit(d.s, 'park:join', { parkId: locD.parkId });
    check('친구가 있는 공원으로 이동해 함께 입장', moveD.ok && moveD.players.some((p: any) => p.profile.id === a.id));

    console.log('\n[8. 차단 · 신고 · 운영]');
    clear(a, b);
    const blk = await emit(a.s, 'block', { userId: b.id });
    await sleep(100);
    check('차단 처리 및 친구 관계 해제', blk.ok && (await emit(a.s, 'profile:get', { userId: b.id })).status === 'blocked');
    check('같은 공원에서 서로 화면에서 제거', got(a, 'players:leave', (p) => p.id === b.id) && got(b, 'players:leave', (p) => p.id === a.id));
    clear(a, b);
    await emit(b.s, 'chat:public', '나 보여?');
    await sleep(100);
    check('차단한 사용자의 채팅 미수신', !got(a, 'chat'));
    check('차단 상태에서 친구 신청 불가', !(await emit(b.s, 'friend:request', { userId: a.id })).ok);
    const rep = await emit(a.s, 'report', { userId: b.id, reason: '욕설/비하', detail: '테스트 신고' });
    check('신고 접수', rep.ok);
    const repBad = await emit(a.s, 'report', { userId: b.id, reason: '아무거나' });
    check('허용되지 않은 신고 사유 거부', !repBad.ok);
    const ub = await emit(a.s, 'unblock', { userId: b.id });
    await sleep(100);
    check('차단 해제 시 다시 표시', ub.ok && got(a, 'players:join', (p) => p.profile.id === b.id));

    const admin = await (async () => { const r = await api('/api/auth/login', { username: 'admin_user', password: 'password123' }); const s2 = io(BASE, { auth: { token: r.body.token }, transports: ['websocket'] }); await new Promise<void>((res) => s2.on('connect', () => res())); return { id: r.body.profile.id, token: r.body.token, s: s2, events: [] as any[] }; })();
    const reps = await api('/api/admin/reports', undefined, admin.token, 'GET');
    check('운영자 신고 목록 조회 (맥락 채팅 포함)', reps.status === 200 && reps.body.reports[0].target_id === b.id && reps.body.reports[0].context.includes('나 보여?'));
    check('일반 사용자는 운영 API 접근 불가', (await api('/api/admin/reports', undefined, a.token, 'GET')).status === 403);
    const ban = await api('/api/admin/ban', { userId: c.id, hours: 1 }, admin.token);
    await sleep(150);
    check('이용 정지 시 접속 종료', ban.status === 200 && !c.s.connected);
    check('정지 계정 로그인 차단', (await api('/api/auth/login', { username: 'carol01', password: 'password123' })).status === 403);

    console.log('\n[접속 · 퇴장]');
    await emit(b.s, 'park:join', { parkId: 'central-1' });
    const lastW = await emit(b.s, 'park:warp', { to: 'shop' });
    clear(a);
    b.s.disconnect();
    await sleep(150);
    check('퇴장 시 다른 사용자에게 알림', got(a, 'players:leave', (p) => p.id === b.id));
    const b2 = io(BASE, { auth: { token: b.token }, transports: ['websocket'] });
    await new Promise<void>((r) => b2.on('connect', () => r()));
    const rejoin = await emit(b2, 'park:join', { parkId: 'central-1' });
    check('연결이 끊겼다 다시 들어오면 마지막 위치로 복원', lastW.ok && rejoin.ok && rejoin.spawn[0] === lastW.state[0] && rejoin.spawn[1] === lastW.state[1], [lastW.state, rejoin.spawn]);
    const other = await emit(b2, 'park:join', { parkId: 'central-2' });
    check('다른 공원에 들어가면 그 공원의 시작 위치', other.ok && Math.abs(other.spawn[1] - 10) < 2);
    const a2 = io(BASE, { auth: { token: a.token }, transports: ['websocket'] });
    const kicked = new Promise((r) => a.s.on('kicked', r));
    await new Promise<void>((r) => a2.on('connect', () => r()));
    check('같은 계정 중복 접속 시 이전 연결 종료', !!(await Promise.race([kicked, sleep(500).then(() => null)])));

    console.log('\n[회원 탈퇴]');
    const e = await makeUser('erin0001', '에린', '두부');
    await emit(e.s, 'park:join', { parkId: 'central-2' });
    check('비밀번호가 틀리면 탈퇴 거부', (await api('/api/me', { password: 'wrongpass1' }, e.token, 'DELETE')).status === 401);
    const del = await api('/api/me', { password: 'password123' }, e.token, 'DELETE');
    await sleep(150);
    check('탈퇴 성공 시 접속 종료', del.status === 200 && !e.s.connected);
    check('탈퇴 후 로그인 불가·세션 무효', (await api('/api/auth/login', { username: 'erin0001', password: 'password123' })).status === 401 && (await api('/api/me', undefined, e.token, 'GET')).status === 401);
    check('탈퇴한 아이디 재가입 가능', (await api('/api/auth/signup', { username: 'erin0001', password: 'password123', nickname: '에린', dogName: '두부', agree: true })).status === 200);
    [a2, b2, d.s, admin.s].forEach((s) => s.close());
  } finally {
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
