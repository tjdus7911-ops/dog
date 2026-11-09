// 다중 사용자 통합 테스트: 실제 서버 프로세스를 띄우고 여러 클라이언트로 접속해 검증한다.
// 실행: npm run test:multi
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';

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
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_PARK_CAPACITY: '3', MUNGLE_ADMINS: 'admin_user', MUNGLE_BACKUP_HOURS: '0', MUNGLE_OPERATOR: '멍글마을 운영팀', MUNGLE_CONTACT: 'help@example.com' },
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

    const admin = await makeUser('admin_user', '운영자', '관리견');
    const reps = await api('/api/admin/reports', undefined, admin.token, 'GET');
    check('운영자 신고 목록 조회 (맥락 채팅 포함)', reps.status === 200 && reps.body.reports[0].target_id === b.id && reps.body.reports[0].context.includes('나 보여?'));
    check('일반 사용자는 운영 API 접근 불가', (await api('/api/admin/reports', undefined, a.token, 'GET')).status === 403);
    const ban = await api('/api/admin/ban', { userId: c.id, hours: 1 }, admin.token);
    await sleep(150);
    check('이용 정지 시 접속 종료', ban.status === 200 && !c.s.connected);
    check('정지 계정 로그인 차단', (await api('/api/auth/login', { username: 'carol01', password: 'password123' })).status === 403);

    console.log('\n[접속 · 퇴장]');
    clear(a);
    b.s.disconnect();
    await sleep(150);
    check('퇴장 시 다른 사용자에게 알림', got(a, 'players:leave', (p) => p.id === b.id));
    const b2 = io(BASE, { auth: { token: b.token }, transports: ['websocket'] });
    await new Promise<void>((r) => b2.on('connect', () => r()));
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
