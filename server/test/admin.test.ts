// 운영자 지정(계정 확인 코드) · 관리자 API 권한 · 회원 정지(기간·영구·사유·우회 차단) · 콘텐츠 숨김/삭제/복구/영구 삭제
// · 신고(사유·중복 방지·처리 기록) · 승인 전 스크린 사진 접근 차단 · 작업 이력 · 구조 변경 전 백업
// 실행: npm run test:admin
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { parseAdmins } from '../src/admins';

const PORT = 3994;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-admin-'));
const adminsFile = path.join(dataDir, 'admins.txt');
let passed = 0, failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(p: string, body?: object, token?: string, method?: string) {
  const res = await fetch(BASE + p, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data: any = null; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 40) }; }
  return { status: res.status, body: data };
}
let proc: ChildProcess | null = null;
let logs = '';
async function startServer() {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    // 운영 서버처럼: MUNGLE_ADMINS 에 아이디가 있어도 가입 시 자동 운영자 없음
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_ADMINS: 'tjdus7911', MUNGLE_ADMINS_ON_SIGNUP: '', MUNGLE_ADMINS_FILE: adminsFile, MUNGLE_ADMIN_SYNC_MS: '400', MUNGLE_CONTACT: 'help@example.com', MUNGLE_MEETUP_MIN_LEAD_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (d) => { logs += String(d); });
  proc.stderr!.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); return; } catch { await sleep(200); } }
}
async function stopServer() { if (!proc) return; const p = proc; proc = null; p.kill(); await new Promise((r) => p.once('exit', r)); }
const signup = async (u: string, nick = u.slice(0, 8)) => { const r = await api('/api/auth/signup', { username: u, password: 'password123', nickname: nick, dogName: '콩', agree: true }); return { id: r.body.profile?.id as number, token: r.body.token as string }; };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const connectSock = (token: string) => new Promise<{ s: Socket; err?: any }>((res) => {
  const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
  s.on('connect', () => res({ s }));
  s.on('connect_error', (e: any) => res({ s, err: e }));
});
const isAdmin = async (t: string) => (await api('/api/admin/me', undefined, t)).status === 200;

async function main() {
  console.log('\n[목록 파일 읽기 규칙]');
  const pa = parseAdmins('# 메모\nOwner_1 ab12-cd34-ef56 최고  # 메모\n-old_one\nonly_name\nbad name x\n');
  check('아이디·확인 코드·최고 표시 / -는 회수 / 형식 틀린 줄 무시', JSON.stringify(pa) === JSON.stringify({ grant: [{ name: 'owner_1', code: 'AB12-CD34-EF56', super: true }, { name: 'only_name', code: null, super: false }], revoke: ['old_one'] }), pa);

  fs.writeFileSync(adminsFile, '');
  await startServer();
  try {
    console.log('\n[데이터 구조 추가 전 자동 백업]');
    const backups = fs.existsSync(path.join(dataDir, 'backups')) ? fs.readdirSync(path.join(dataDir, 'backups')) : [];
    check('처음 켤 때 구조 변경 직전 백업 파일 생성 (pre-admin-*.db)', backups.some((f) => /^pre-admin-.*\.db$/.test(f)), backups);

    console.log('\n[운영자 지정: 아이디만으로는 안 됨 · 본인 확인 코드 + 목록 파일]');
    const owner = await signup('tjdus7911', '사슴');
    const other = await signup('otheruser');
    const user = await signup('plainuser', '보리맘');
    check('MUNGLE_ADMINS 에 있는 아이디로 가입해도 일반 회원', !(await isAdmin(owner.token)));
    fs.writeFileSync(adminsFile, 'tjdus7911\n');
    await sleep(1200);
    check('목록에 아이디만 적으면 운영자 안 됨 (확인 코드 필요)', !(await isAdmin(owner.token)) && /확인 코드가 없어 운영자로 바꾸지 않음: tjdus7911/.test(logs));
    const claimOther = await api('/api/admin-claim', {}, other.token);
    fs.writeFileSync(adminsFile, `tjdus7911 ${claimOther.body.code}\n`);
    await sleep(1200);
    check('다른 사람 계정에서 만든 코드로는 안 됨', !(await isAdmin(owner.token)) && /확인 코드가 맞지 않거나/.test(logs));
    check('로그인 없이 코드 발급 불가', (await api('/api/admin-claim', {})).status === 401);
    const claim = await api('/api/admin-claim', {}, owner.token);
    check('본인 확인 코드 발급 (계정 고유 ID·아이디와 함께, 24시간 유효)', claim.status === 200 && /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(claim.body.code) && claim.body.userId === owner.id && claim.body.username === 'tjdus7911', claim.body);
    fs.writeFileSync(adminsFile, `tjdus7911 ${claim.body.code} 최고\n`);
    await sleep(1200);
    const am = await api('/api/admin/me', undefined, owner.token);
    check('본인 코드 + 목록 → 최고 관리자', am.status === 200 && am.body.super === true, am.body);
    check('다른 회원은 그대로', !(await isAdmin(other.token)) && !(await isAdmin(user.token)));
    // 코드는 한 번만: 회수 후 같은 코드로 다시 적어도 안 됨
    fs.writeFileSync(adminsFile, '-otheruser\n');
    await sleep(800);

    console.log('\n[관리자 API: 서버에서 권한 검증]');
    const adminGets = ['/api/admin/me', '/api/admin/stats', '/api/admin/users', `/api/admin/users/${user.id}`, '/api/admin/content?type=post', '/api/admin/report-list', '/api/admin/actions', '/api/admin/screen', '/api/admin/reports'];
    let deny = 0, unauth = 0;
    for (const p of adminGets) { if ((await api(p, undefined, user.token)).status === 403) deny++; if ((await api(p)).status === 401) unauth++; }
    check(`일반 회원 → 관리자 조회 API ${adminGets.length}개 모두 403`, deny === adminGets.length, deny);
    check('로그인 없이 → 모두 401', unauth === adminGets.length, unauth);
    const posts = [['/api/admin/users/' + other.id + '/ban', { days: 1, reason: 'x' }], ['/api/admin/content/post/1', { action: 'hide', reason: 'x' }], ['/api/admin/reports/1/handle', { status: 'resolved', resolution: 'x' }], ['/api/admin/ban', { userId: other.id, hours: 24 }]] as const;
    let pdeny = 0;
    for (const [p, b] of posts) if ((await api(p, b, user.token)).status === 403) pdeny++;
    check('일반 회원 → 정지·숨김·신고 처리 API 모두 403', pdeny === posts.length, pdeny);

    console.log('\n[대시보드 · 회원 검색 · 상세]');
    const st = (await api('/api/admin/stats', undefined, owner.token)).body;
    check('대시보드 숫자 (회원 3 · 오늘 가입 3 · 신고 0 · 승인 대기 0 · 정지 0)', st.members === 3 && st.todayJoined === 3 && st.openReports === 0 && st.pendingScreen === 0 && st.banned === 0 && typeof st.online === 'number', st);
    const byName = (await api('/api/admin/users?q=plain', undefined, owner.token)).body.users;
    const byNick = (await api(`/api/admin/users?q=${encodeURIComponent('보리맘')}`, undefined, owner.token)).body.users;
    const byId = (await api(`/api/admin/users?q=${user.id}`, undefined, owner.token)).body.users;
    check('아이디·닉네임·고유 ID 검색', byName[0]?.id === user.id && byNick[0]?.id === user.id && byId.some((u: any) => u.id === user.id));
    const detail = (await api(`/api/admin/users/${user.id}`, undefined, owner.token)).body;
    const raw = JSON.stringify(detail);
    check('회원 상세: 아이디·닉네임·가입일·상태·최근 접속·신고·제재 이력', detail.user.username === 'plainuser' && detail.user.createdAt > 0 && detail.user.status === 'active' && 'lastSeenAt' in detail.user && Array.isArray(detail.reports) && Array.isArray(detail.sanctions));
    check('비밀번호·토큰은 응답에 없음', !/pass_hash|salt|token/i.test(raw));

    console.log('\n[신고: 사유 · 중복 방지 · 처리 기록]');
    const post = await api('/api/posts', { text: '광고합니다 싸게 팔아요', photo: PNG }, user.token);
    const pid = post.body.post.id;
    check('잘못된 사유는 거부', (await api(`/api/posts/${pid}/report`, { reason: '아무거나' }, other.token)).status === 400);
    const r1 = await api(`/api/posts/${pid}/report`, { reason: '광고 및 도배', detail: '광고글' }, other.token);
    const r2 = await api(`/api/posts/${pid}/report`, { reason: '광고 및 도배' }, other.token);
    const repList = (await api('/api/admin/report-list?status=open', undefined, owner.token)).body.reports;
    check('같은 사람이 같은 글을 두 번 신고 → 한 건만', r1.status === 200 && r2.status === 200 && repList.filter((r: any) => r.targetRef === pid).length === 1, repList.length);
    const so = await connectSock(other.token);
    const rep = (data: object) => new Promise<any>((res) => so.s.emit('report', data, res));
    const u1 = await rep({ userId: user.id, reason: '욕설 및 괴롭힘', detail: '심한 말' });
    const u2 = await rep({ userId: user.id, reason: '욕설 및 괴롭힘' });
    const repList2 = (await api('/api/admin/report-list?status=open', undefined, owner.token)).body.reports;
    check('이용자 신고(새 사유)도 중복 없이 한 건', u1?.ok && u2?.ok && repList2.filter((r: any) => r.targetType === 'user' && r.target.id === user.id).length === 1, [u1, u2]);
    so.s.close();
    const repPost = repList.find((r: any) => r.targetRef === pid);
    check('처리 사유 없이 처리 불가', (await api(`/api/admin/reports/${repPost.id}/handle`, { status: 'resolved' }, owner.token)).status === 400);

    console.log('\n[게시글: 숨김 → 해제 → 삭제(복구 가능) → 복구 → 영구 삭제]');
    await api(`/api/posts/${pid}/comments`, { text: '댓글 하나' }, other.token);
    const seen = async () => (await api('/api/posts', undefined, other.token)).body.posts.some((p: any) => p.id === pid);
    check('사유 없이 숨김 불가', (await api(`/api/admin/content/post/${pid}`, { action: 'hide' }, owner.token)).status === 400);
    check('숨김 → 다른 이용자에게 안 보임', (await api(`/api/admin/content/post/${pid}`, { action: 'hide', reason: '광고' }, owner.token)).status === 200 && !(await seen()));
    check('숨김 해제 → 다시 보임', (await api(`/api/admin/content/post/${pid}`, { action: 'unhide', reason: '오해' }, owner.token)).status === 200 && (await seen()));
    check('삭제(복구 가능) → 안 보임', (await api(`/api/admin/content/post/${pid}`, { action: 'delete', reason: '광고 재확인' }, owner.token)).status === 200 && !(await seen()));
    const delList = (await api('/api/admin/content?type=post&state=deleted', undefined, owner.token)).body.items;
    check('관리자 목록 \'삭제\' 상태에 있음 (작성자 확인)', delList.some((i: any) => i.id === pid && i.author.username === 'plainuser'));
    check('복구 → 다시 보임', (await api(`/api/admin/content/post/${pid}`, { action: 'restore', reason: '복구 테스트' }, owner.token)).status === 200 && (await seen()));
    check('보이는 글은 바로 영구 삭제 불가 (먼저 삭제 상태)', (await api(`/api/admin/content/post/${pid}`, { action: 'purge', reason: 'x', confirm: '영구 삭제' }, owner.token)).status === 400);
    await api(`/api/admin/content/post/${pid}`, { action: 'delete', reason: '광고' }, owner.token);
    check('확인 문구 없이 영구 삭제 불가', (await api(`/api/admin/content/post/${pid}`, { action: 'purge', reason: '광고' }, owner.token)).status === 400);
    check('영구 삭제', (await api(`/api/admin/content/post/${pid}`, { action: 'purge', reason: '광고 확정', confirm: '영구 삭제' }, owner.token)).status === 200);
    check('영구 삭제 후 글 없음', (await api(`/api/admin/content/post/${pid}`, undefined, owner.token)).status === 404);
    const repAfter = (await api('/api/admin/report-list?status=all', undefined, owner.token)).body.reports.find((r: any) => r.targetRef === pid);
    check('관련 신고는 기록으로 남고 처리됨으로 정리', repAfter?.status === 'resolved' && /영구 삭제/.test(repAfter.resolution), repAfter);

    console.log('\n[댓글 · 산책 모임 · 방명록 숨김]');
    const p2 = (await api('/api/posts', { text: '평범한 자랑', photo: PNG }, user.token)).body.post.id;
    await api(`/api/posts/${p2}/comments`, { text: '나쁜 댓글' }, other.token);
    const cm = (await api('/api/admin/content?type=comment&q=' + encodeURIComponent('나쁜'), undefined, owner.token)).body.items[0];
    await api(`/api/admin/content/comment/${cm.id}`, { action: 'hide', reason: '욕설' }, owner.token);
    const cl = (await api(`/api/posts/${p2}/comments`, undefined, user.token)).body.comments;
    const pc = (await api('/api/posts', undefined, user.token)).body.posts.find((p: any) => p.id === p2);
    check('숨긴 댓글은 목록·댓글 수에서 빠짐', !cl.some((c: any) => c.id === cm.id) && pc.comments === 0, [cl.length, pc.comments]);
    const mt = await api('/api/meetups', { title: '수상한 모임', intro: '연락주세요', kind: 'offline', sido: '서울', place: '광장', startsAt: Date.now() + 86400_000, capacity: 5, sizeRule: 'any', temperRule: 'any', approval: 'auto' }, user.token);
    const mid = mt.body.meetup.id;
    await api(`/api/admin/content/meetup/${mid}`, { action: 'hide', reason: '개인정보' }, owner.token);
    check('숨긴 모임은 목록·상세·참가 모두 불가', !(await api('/api/meetups?scope=upcoming', undefined, other.token)).body.meetups.some((m: any) => m.id === mid)
      && (await api(`/api/meetups/${mid}`, undefined, other.token)).status === 404 && (await api(`/api/meetups/${mid}/join`, {}, other.token)).status !== 200);

    console.log('\n[승인 전 스크린 사진: 본인·운영자 외에는 접근 불가]');
    await api('/api/screen', { consent: true, title: '스크린 신청', photo: PNG }, user.token);
    const mine = (await api('/api/screen/mine', undefined, user.token)).body.items[0];
    const bare = mine.image.split('?')[0];
    check('본인에게는 서명된 주소', /\?exp=\d+&sig=[0-9a-f]{32}$/.test(mine.image), mine.image);
    check('서명 없는 주소(다른 사람) → 404', (await fetch(BASE + bare)).status === 404);
    check('서명 위조 → 404', (await fetch(`${BASE}${bare}?exp=${Date.now() + 99999}&sig=${'0'.repeat(32)}`)).status === 404);
    check('본인 서명 주소 → 200', (await fetch(BASE + mine.image)).status === 200);
    check('다른 이용자 스크린 목록에 없음', !(await api('/api/screen', undefined, other.token)).body.slides.some((s: any) => s.title === '스크린 신청'));
    const pend = (await api('/api/admin/screen', undefined, owner.token)).body.pending[0];
    await api(`/api/admin/screen/${pend.id}`, { action: 'reject', reason: '흐린 사진' }, owner.token);
    check('반려 후에도 서명 없이는 404', (await fetch(BASE + bare)).status === 404);
    await api('/api/screen', { consent: true, title: '두번째 신청', photo: PNG }, user.token);
    const pend2 = (await api('/api/admin/screen', undefined, owner.token)).body.pending[0];
    await api(`/api/admin/screen/${pend2.id}`, { action: 'approve' }, owner.token);
    check('승인되면 누구나 볼 수 있음 (스크린에 나옴)', (await fetch(BASE + pend2.image.split('?')[0])).status === 200);
    await api(`/api/admin/screen/${pend2.id}`, { action: 'hide' }, owner.token);
    check('노출 중단(내림) → 다시 비공개', (await fetch(BASE + pend2.image.split('?')[0])).status === 404);

    console.log('\n[회원 정지 · 우회 차단 · 해제 · 운영자 보호]');
    const live = await connectSock(user.token);
    let kicked: any = null;
    live.s.on('kicked', (d) => { kicked = d; });
    check('사유 없이 정지 불가', (await api(`/api/admin/users/${user.id}/ban`, { days: 3 }, owner.token)).status === 400);
    check('잘못된 기간 불가', (await api(`/api/admin/users/${user.id}/ban`, { days: 2, reason: 'x' }, owner.token)).status === 400);
    check('3일 정지', (await api(`/api/admin/users/${user.id}/ban`, { days: 3, reason: '광고 반복' }, owner.token)).status === 200);
    await sleep(300);
    check('접속 중이면 바로 끊고 사유·기간·문의 안내', !!kicked && /광고 반복/.test(kicked.reason) && /문의: help@example.com/.test(kicked.reason) && /까지/.test(kicked.reason), kicked);
    const rest = await api('/api/me', undefined, user.token);
    check('기존 로그인(토큰)으로 API 사용 불가 + 안내', rest.status === 403 && /광고 반복/.test(rest.body.error) && rest.body.code === 'banned', rest.body);
    const login = await api('/api/auth/login', { username: 'plainuser', password: 'password123' });
    check('로그인 불가 + 사유 안내', login.status === 403 && /광고 반복/.test(login.body.error));
    const again = await connectSock(user.token);
    check('실시간 재접속 불가 (안내 포함)', again.err?.message === 'banned' && /광고 반복/.test(again.err?.data?.message ?? ''), again.err?.data);
    again.s.close(); live.s.close();
    check('정지 회원은 글쓰기도 불가', (await api('/api/posts', { text: 'x', photo: PNG }, user.token)).status === 403);
    check('운영자 계정은 정지 불가', (await api(`/api/admin/users/${owner.id}/ban`, { days: 1, reason: 'x' }, owner.token)).status === 403);
    check('예전 신고 화면 정지 버튼도 운영자 보호', (await api('/api/admin/ban', { userId: owner.id, hours: 24 }, owner.token)).status === 403);
    check('영구 정지', (await api(`/api/admin/users/${user.id}/ban`, { days: 0, reason: '반복 위반' }, owner.token)).status === 200
      && /영구 정지/.test((await api('/api/me', undefined, user.token)).body.error));
    const st2 = (await api('/api/admin/stats', undefined, owner.token)).body;
    check('대시보드 정지 회원 1', st2.banned === 1, st2);
    check('사유 없이 해제 불가', (await api(`/api/admin/users/${user.id}/unban`, {}, owner.token)).status === 400);
    check('해제 → 다시 이용 가능', (await api(`/api/admin/users/${user.id}/unban`, { reason: '이의 신청 수용' }, owner.token)).status === 200 && (await api('/api/me', undefined, user.token)).status === 200);
    const d2 = (await api(`/api/admin/users/${user.id}`, undefined, owner.token)).body;
    check('제재 내역: 3일 → 영구 → 해제 (사유·처리자·시각)', d2.sanctions.length === 3 && d2.sanctions.map((s: any) => s.action).join() === 'unban,ban_permanent,ban' && d2.sanctions.every((s: any) => s.reason && s.admin === '사슴' && s.created_at > 0), d2.sanctions);
    check('신고받은 이력이 회원 상세에 보임', d2.reports.length >= 1);

    console.log('\n[작업 이력]');
    const acts = (await api('/api/admin/actions', undefined, owner.token)).body.actions;
    const kinds = new Set(acts.map((a: any) => a.action));
    check('숨김·해제·삭제·복구·영구 삭제·정지·해제·스크린 처리·운영자 지정이 모두 기록', ['hide', 'unhide', 'delete', 'restore', 'purge', 'ban', 'ban_permanent', 'unban', 'screen_reject', 'screen_approve', 'screen_hide', 'grant_admin', 'revoke_admin'].every((k) => kinds.has(k)) || (['hide', 'unhide', 'delete', 'restore', 'purge', 'ban', 'ban_permanent', 'unban', 'screen_reject', 'screen_approve', 'screen_hide', 'grant_admin'].every((k) => kinds.has(k))), [...kinds]);
    check('각 기록에 작업자·대상·시각·사유', acts.filter((a: any) => a.action !== 'grant_admin' && a.action !== 'revoke_admin').every((a: any) => a.admin === '사슴' && a.targetId > 0 && a.at > 0 && a.reason !== undefined));

    console.log('\n[다시 켜도 그대로 · 백업은 한 번만]');
    await stopServer();
    await startServer();
    const t2 = (await api('/api/auth/login', { username: 'tjdus7911', password: 'password123' })).body.token;
    check('운영자 유지 (코드는 이미 사용됨)', await isAdmin(t2));
    check('구조가 이미 있으면 백업을 또 만들지 않음', fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.startsWith('pre-admin-')).length === 1);
  } finally {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); void stopServer(); process.exit(1); });
