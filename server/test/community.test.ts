// 멍글 동네 통합 테스트: 강아지 자랑 · 산책 모임 · 강아지 모임 · 애견카페/샵 공간 · 광장 스크린 연동
// 실행: npm run test:community
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-comm-'));
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let passed = 0, failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(pathname: string, body?: object, token?: string, method?: string) {
  const res = await fetch(BASE + pathname, {
    method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}
const emit = <T = any>(s: Socket, ev: string, data?: unknown): Promise<T> => new Promise((r) => s.emit(ev, data, r));
interface Client { id: number; token: string; s: Socket; events: { ev: string; data: any }[] }
async function makeUser(name: string, nickname: string, dogName: string, login = false): Promise<Client> {
  const r = login ? await api('/api/auth/login', { username: name, password: 'password123' }) : await api('/api/auth/signup', { username: name, password: 'password123', nickname, dogName, agree: true });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const s = io(BASE, { auth: { token: r.body.token }, transports: ['websocket'] });
  const events: Client['events'] = [];
  s.onAny((ev, data) => events.push({ ev, data }));
  await new Promise<void>((res, rej) => { s.on('connect', () => res()); s.on('connect_error', rej); });
  return { id: r.body.profile.id, token: r.body.token, s, events };
}
const got = (c: Client, ev: string, pred: (d: any) => boolean = () => true) => c.events.some((e) => e.ev === ev && pred(e.data));

async function main() {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_ADMINS_ON_SIGNUP: '1', MUNGLE_ADMINS: 'admin_user', MUNGLE_BACKUP_HOURS: '0', MUNGLE_MEETUP_MIN_LEAD_MS: '0', MUNGLE_MEETUP_TICK_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => { const t = String(d); if (!t.includes('ExperimentalWarning') && !t.includes('--trace-warnings')) process.stderr.write(t); });
  for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/api/parks'); break; } catch { await sleep(200); } }

  try {
    const a = await makeUser('alice01', '앨리스', '사슴이');
    const b = await makeUser('bob0001', '밥이', '몽실이');
    const c = await makeUser('carol01', '캐롤', '보리');
    await makeUser('admin_user', '운영자', '멍멍');
    const admin = await makeUser('admin_user', '', '', true);

    console.log('\n[동네(지역) 설정]');
    check('목록에 없는 시·도 거부', (await api('/api/me/region', { sido: '서울특별시 강남구 123-4' }, a.token, 'PUT')).status === 400);
    const rg = await api('/api/me/region', { sido: '서울', dong: '마포구' }, a.token, 'PUT');
    check('동네 단위(시·도 + 구) 저장', rg.status === 200 && rg.body.region === '서울 마포구');

    console.log('\n[4. 강아지 자랑]');
    check('사진 없는 자랑 글 거부', (await api('/api/posts', { text: '우리 사슴이' }, a.token)).status === 400);
    check('로그인 없이 글쓰기 불가', (await api('/api/posts', { text: 'x', photo: PNG1 })).status === 401);
    const p1 = await api('/api/posts', { text: '우리 사슴이 첫 산책 🐾', photo: PNG1, screenConsent: true }, a.token);
    check('사진 + 글 게시 (DB 저장, 업로드 파일 생성)', p1.status === 200 && p1.body.post.image?.startsWith('/uploads/') && fs.existsSync(path.join(dataDir, 'uploads', path.basename(p1.body.post.image))));
    check('스크린 공개 동의 → 운영자 승인 대기', p1.body.post.screen === 'pending');
    const pid = p1.body.post.id;
    const feed = await api('/api/posts', undefined, b.token);
    check('다른 사용자 피드에 표시 (작성자·강아지 프로필 포함)', feed.body.posts[0]?.id === pid && feed.body.posts[0].author.nickname === '앨리스' && feed.body.posts[0].author.dogName === '사슴이');
    const lk = await api(`/api/posts/${pid}/like`, {}, b.token);
    check('좋아요', lk.body.post.likes === 1 && lk.body.post.likedByMe);
    check('좋아요 취소(토글)', (await api(`/api/posts/${pid}/like`, {}, b.token)).body.post.likes === 0);
    await api(`/api/posts/${pid}/like`, {}, b.token);
    await api(`/api/posts/${pid}/like`, {}, c.token);
    const sv = await api(`/api/posts/${pid}/save`, {}, b.token);
    check('게시글 저장', sv.body.post.savedByMe);
    const saved = await api('/api/posts?scope=saved', undefined, b.token);
    check('저장한 글 목록', saved.body.posts.length === 1 && saved.body.posts[0].id === pid);
    check('남의 저장 목록엔 없음', (await api('/api/posts?scope=saved', undefined, c.token)).body.posts.length === 0);
    a.events.length = 0;
    const cm = await api(`/api/posts/${pid}/comments`, { text: '너무 귀여워요!' }, b.token);
    await sleep(100);
    check('댓글 작성 + 글쓴이에게 실시간 알림', cm.status === 200 && cm.body.comments.length === 1 && got(a, 'community:notice'));
    const cid = cm.body.comments[0].id;
    check('다른 사람 댓글은 제3자가 못 지움', (await api(`/api/comments/${cid}`, undefined, c.token, 'DELETE')).status === 403);
    check('글쓴이는 자기 글의 댓글 삭제 가능', (await api(`/api/comments/${cid}`, undefined, a.token, 'DELETE')).status === 200);
    check('남의 글 삭제 불가', (await api(`/api/posts/${pid}`, undefined, b.token, 'DELETE')).status === 403);
    check('내 글은 신고 불가', (await api(`/api/posts/${pid}/report`, { reason: '스팸' }, a.token)).status === 400);
    const rp = await api(`/api/posts/${pid}/report`, { reason: '부적절한 사진', detail: '테스트' }, c.token);
    const reps = await api('/api/admin/reports', undefined, admin.token);
    check('게시글 신고 → 운영자 신고 목록 (글 내용 포함)', rp.status === 200 && reps.body.reports.some((r: any) => r.target_type === 'post' && r.target_ref === pid && r.context.includes('첫 산책')));

    console.log('\n[광장 스크린 연동]');
    const before = await api('/api/screen', undefined, b.token);
    check('승인 전에는 스크린에 노출 안 됨', !before.body.slides.some((s: any) => s.title.includes('사슴이 첫 산책')));
    const pend = (await api('/api/admin/screen', undefined, admin.token)).body.items.find((i: any) => i.title.includes('사슴이 첫 산책'));
    a.events.length = 0;
    await api(`/api/admin/screen/${pend.id}`, { action: 'approve' }, admin.token);
    await sleep(100);
    const after = await api('/api/screen', undefined, b.token);
    check('운영자 승인 후 스크린 노출 + 작성자 알림', after.body.slides.some((s: any) => s.title.includes('사슴이 첫 산책')) && got(a, 'screen:decided', (d) => d.approved));
    check('게시글에 스크린 승인 상태 표시', (await api('/api/posts?scope=mine', undefined, a.token)).body.posts[0].screen === 'approved');

    console.log('\n[차단]');
    await emit(c.s, 'block', { userId: a.id });
    check('차단한 사용자의 글은 피드에서 숨김', !(await api('/api/posts', undefined, c.token)).body.posts.some((p: any) => p.author.id === a.id));
    check('차단 관계면 댓글 불가', (await api(`/api/posts/${pid}/comments`, { text: '안녕' }, c.token)).status === 404);
    await emit(c.s, 'unblock', { userId: a.id });

    console.log('\n[5. 산책 모임]');
    const base = { title: '토요일 망원 한강 산책', intro: '천천히 걸어요', kind: 'offline', sido: '서울', dong: '마포구', place: '망원한강공원 입구', capacity: 3, sizeRule: 'any', temperRule: 'social', approval: 'manual' };
    check('과거 시간 모임 거부', (await api('/api/meetups', { ...base, startsAt: Date.now() - 1000 }, a.token)).status === 400);
    check('정원 범위 검증', (await api('/api/meetups', { ...base, capacity: 99, startsAt: Date.now() + 3600_000 }, a.token)).status === 400);
    check('오프라인 모임은 동네 필수', (await api('/api/meetups', { ...base, sido: '', startsAt: Date.now() + 3600_000 }, a.token)).status === 400);
    const m1 = await api('/api/meetups', { ...base, startsAt: Date.now() + 3600_000 }, a.token);
    check('모임 생성 (모임장 자동 참가)', m1.status === 200 && m1.body.meetup.isHost && m1.body.meetup.approvedCount === 1 && m1.body.meetup.region === '서울 마포구');
    const mid = m1.body.meetup.id;
    const list = await api('/api/meetups?region=서울', undefined, b.token);
    check('지역별 목록', list.body.meetups.some((m: any) => m.id === mid) && !(await api('/api/meetups?region=부산', undefined, b.token)).body.meetups.some((m: any) => m.id === mid));
    check('신청 전에는 모임 채팅 접근 불가', (await api(`/api/meetups/${mid}/messages`, undefined, b.token)).status === 403);
    a.events.length = 0;
    const jn = await api(`/api/meetups/${mid}/join`, {}, b.token);
    await sleep(100);
    check('참가 신청 (승인 대기) + 모임장 알림', jn.body.meetup.myStatus === 'pending' && got(a, 'community:notice'));
    check('승인 대기 중에도 채팅 불가', (await api(`/api/meetups/${mid}/messages`, { text: '안녕하세요' }, b.token)).status === 403);
    check('모임장 아닌 사람은 승인 불가', (await api(`/api/meetups/${mid}/members/${b.id}`, { approve: true }, c.token)).status === 403);
    b.events.length = 0;
    const ap = await api(`/api/meetups/${mid}/members/${b.id}`, { approve: true }, a.token);
    await sleep(100);
    check('모임장 승인 + 신청자 알림', ap.body.meetup.approvedCount === 2 && got(b, 'community:notice', (d) => d.text.includes('승인')));
    a.events.length = 0;
    const msg = await api(`/api/meetups/${mid}/messages`, { text: '토요일에 봬요!' }, b.token);
    await sleep(100);
    check('승인 멤버 모임 채팅 + 다른 멤버 실시간 수신', msg.status === 200 && got(a, 'meetup:message', (d) => d.meetupId === mid && d.message.text === '토요일에 봬요!'));
    check('모임 채팅 기록 (DB)', (await api(`/api/meetups/${mid}/messages`, undefined, a.token)).body.messages.length === 1);
    check('비멤버는 채팅 기록 못 봄', (await api(`/api/meetups/${mid}/messages`, undefined, c.token)).status === 403);
    await api(`/api/meetups/${mid}/join`, {}, c.token);
    await api(`/api/meetups/${mid}/members/${c.id}`, { approve: true }, a.token);
    const d4 = await makeUser('dave0001', '데이브', '콩이');
    await api(`/api/meetups/${mid}/join`, {}, d4.token);
    check('정원 초과 시 승인 불가', (await api(`/api/meetups/${mid}/members/${d4.id}`, { approve: true }, a.token)).status === 400);
    const lv = await api(`/api/meetups/${mid}/leave`, {}, c.token);
    check('참가 취소', lv.body.meetup.myStatus === 'none' && lv.body.meetup.approvedCount === 2);
    check('모임장은 참가 취소 대신 모임 취소', (await api(`/api/meetups/${mid}/leave`, {}, a.token)).status === 400);
    check('시작 전에는 후기 불가', (await api(`/api/meetups/${mid}/reviews`, { rating: 5 }, b.token)).status === 400);
    // 크기 조건
    const small = await api('/api/meetups', { ...base, title: '소형견 산책', sizeRule: 'small', approval: 'auto', startsAt: Date.now() + 3600_000 }, a.token);
    const bDog = (await api('/api/me', undefined, b.token)).body.profile.dog;
    const smallJoin = await api(`/api/meetups/${small.body.meetup.id}/join`, {}, b.token);
    check('강아지 크기 조건 검증', bDog.size === 'small' ? smallJoin.status === 200 : smallJoin.status === 400 && smallJoin.body.error.includes('소형견'));
    // 모임 취소
    b.events.length = 0;
    await api(`/api/meetups/${small.body.meetup.id}/join`, {}, b.token);
    const cn = await api(`/api/meetups/${small.body.meetup.id}/cancel`, {}, a.token);
    check('모임장 모임 취소', cn.body.meetup.status === 'cancelled');
    check('취소된 모임은 참가 불가', (await api(`/api/meetups/${small.body.meetup.id}/join`, {}, d4.token)).status === 404);
    // 온라인 모임: 곧 시작 알림 → 광장 공원 안내
    b.events.length = 0;
    const on = await api('/api/meetups', { title: '밤 산책 번개', kind: 'online', park: 'central-2', capacity: 5, sizeRule: 'any', temperRule: 'any', approval: 'auto', startsAt: Date.now() + 1500 }, a.token);
    check('온라인 모임 (멍글마을 공원에서 만남)', on.status === 200 && on.body.meetup.region === '온라인' && on.body.meetup.park === 'central-2');
    await api(`/api/meetups/${on.body.meetup.id}/join`, {}, b.token);
    await sleep(900);
    check('모임 시작 전 참가자에게 광장 안내 알림', got(b, 'meetup:starting', (d) => d.meetupId === on.body.meetup.id && d.park === 'central-2'));
    const scr = await api('/api/screen', undefined, c.token);
    check('광장 스크린에 동네 모임 일정 표시', scr.body.slides.some((s: any) => s.kind === 'meetup' && s.title === '토요일 망원 한강 산책'));
    await sleep(1200);
    check('비참가자 후기 불가', (await api(`/api/meetups/${on.body.meetup.id}/reviews`, { rating: 5 }, c.token)).status === 403);
    const rv = await api(`/api/meetups/${on.body.meetup.id}/reviews`, { rating: 5, text: '즐거웠어요' }, b.token);
    check('모임 후 후기 작성 (별점)', rv.status === 200 && rv.body.meetup.reviewCount === 1 && rv.body.meetup.avgRating === 5);
    check('후기 중복 불가', (await api(`/api/meetups/${on.body.meetup.id}/reviews`, { rating: 4 }, b.token)).status === 400);

    console.log('\n[6. 강아지 모임]');
    const clubs = await api('/api/clubs', undefined, b.token);
    check('기본 모임(소형·중형·대형·믹스견) 제공', ['소형견 모임', '중형견 모임', '대형견 모임', '믹스견 모임'].every((n) => clubs.body.clubs.some((c: any) => c.name === n)));
    const cl = await api('/api/clubs', { name: '웰시코기 사랑방', category: 'breed', intro: '짧은 다리 모여라' }, a.token);
    check('견종별 모임 만들기 (모임장)', cl.status === 200 && cl.body.club.isOwner && cl.body.club.memberCount === 1);
    check('같은 이름 모임 거부', (await api('/api/clubs', { name: '웰시코기 사랑방', category: 'free' }, b.token)).status === 409);
    const cid2 = cl.body.club.id;
    check('비멤버는 모임 게시판 글쓰기 불가', (await api('/api/posts', { text: '안녕', clubId: cid2 }, b.token)).status === 403);
    const jc = await api(`/api/clubs/${cid2}/join`, {}, b.token);
    check('모임 가입', jc.body.club.isMember && jc.body.club.memberCount === 2);
    const cp = await api('/api/posts', { text: '코기 산책 같이 해요', clubId: cid2 }, b.token);
    check('모임 게시판 글 (사진 선택)', cp.status === 200 && cp.body.post.clubId === cid2);
    check('모임 게시판 목록', (await api(`/api/posts?club=${cid2}`, undefined, a.token)).body.posts.length === 1);
    check('모임 글은 전체 자랑 피드에 섞이지 않음', !(await api('/api/posts', undefined, a.token)).body.posts.some((p: any) => p.clubId));
    const det = await api(`/api/clubs/${cid2}`, undefined, c.token);
    check('멤버 목록', det.body.club.members.length === 2 && det.body.club.members[0].role === 'owner');
    check('모임장 탈퇴 불가', (await api(`/api/clubs/${cid2}/leave`, {}, a.token)).status === 400);
    check('모임 탈퇴', (await api(`/api/clubs/${cid2}/leave`, {}, b.token)).body.club.isMember === false);
    check('내 모임 목록', (await api('/api/clubs?scope=mine', undefined, a.token)).body.clubs.some((c: any) => c.id === cid2));

    console.log('\n[7. 애견카페 · 애견샵]');
    await emit(a.s, 'park:join', { parkId: 'central-1' });
    const cafe = await emit(a.s, 'park:join', { parkId: 'cafe-1' });
    check('애견카페 실내 입장', cafe.ok && cafe.park.kind === 'cafe');
    const cafeB = await emit(b.s, 'park:join', { parkId: 'cafe-1' });
    check('같은 카페 안 사용자 서로 보임', cafeB.ok && cafeB.players.some((p: any) => p.profile.id === a.id));
    const out = await emit(a.s, 'park:join', { parkId: 'central-1', from: 'cafe' });
    check('카페에서 나오면 카페 입구 앞', out.ok && out.spawn[0] < -18 && out.spawn[2 - 1] > -11);
    check('애견샵 실내 입장', (await emit(c.s, 'park:join', { parkId: 'shop-1' })).park?.kind === 'shop');
    const shop = await api('/api/shop', undefined, a.token);
    check('애견샵 상품 목록', shop.body.items.length >= 4 && shop.body.items.every((i: any) => !i.claimed));
    check('미입주자는 가구 받기 불가', (await api('/api/shop/doghouse/claim', {}, a.token)).status === 400);
    await api('/api/apartment/move-in', { building: '1', unit: '101' }, a.token);
    const layoutWith = [{ type: 'doghouse', n: 0, x: 1, z: 1, rot: 0 }];
    check('받기 전엔 샵 가구 배치 불가', (await api('/api/home/me/layout', { layout: layoutWith }, a.token, 'PUT')).status === 400);
    check('입주 후 가구 받기', (await api('/api/shop/doghouse/claim', {}, a.token)).status === 200 && (await api('/api/shop', undefined, a.token)).body.items.find((i: any) => i.id === 'doghouse').claimed);
    const lay = await api('/api/home/me/layout', { layout: layoutWith }, a.token, 'PUT');
    check('받은 가구 집에 배치 (보유 목록 포함)', lay.status === 200 && lay.body.home.layout[0].type === 'doghouse' && lay.body.home.owned.includes('doghouse'));
    [a, b, c, d4, admin].forEach((x) => x.s.close());
  } finally {
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
