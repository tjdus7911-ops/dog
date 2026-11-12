// 동네 자랑 게시판 / 광장 대형 스크린 분리 확인
// 실행: npm run test:board
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';

const PORT = 3996;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-board-'));
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
async function startServer() {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_ADMINS_FILE: adminsFile, MUNGLE_ADMIN_SYNC_MS: '400', MUNGLE_MEETUP_MIN_LEAD_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr!.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); return; } catch { await sleep(200); } }
}
async function stopServer() { if (!proc) return; const p = proc; proc = null; p.kill(); await new Promise((r) => p.once('exit', r)); }
const signup = async (u: string) => { const r = await api('/api/auth/signup', { username: u, password: 'password123', nickname: u.slice(0, 8), dogName: '콩', agree: true }); return { id: r.body.profile?.id as number, token: r.body.token as string }; };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const slides = async (t: string) => (await api('/api/screen', undefined, t)).body.slides as any[];
const screenHas = async (t: string, re: RegExp) => (await slides(t)).some((s) => re.test(`${s.title} ${s.text}`));
const db = () => new DatabaseSync(path.join(dataDir, 'mungle.db'));

async function main() {
  fs.writeFileSync(adminsFile, '');
  await startServer();
  const sockets: Socket[] = [];
  try {
    const owner = await signup('boardadmin');
    const a = await signup('writer_a');
    const b = await signup('reader_b');
    // 운영자 지정: 계정 확인 코드 + 저장소 목록 (아이디만 적으면 지정되지 않음)
    const claim = (await api('/api/admin-claim', {}, owner.token)).body;
    fs.writeFileSync(adminsFile, `boardadmin ${claim.code}\n`);
    await sleep(1000);

    // 예전 방식으로 잘못 연결돼 있던 데이터(자랑 글 + 스크린 항목)를 미리 만들어 둠 → 그대로 보존되는지
    const d0 = db();
    const oldPost = Number(d0.prepare("INSERT INTO posts (author_id, club_id, text, image, created_at) VALUES (?, NULL, '예전 자랑 글', '/uploads/old.png', ?)").run(a.id, Date.now() - 86400_000).lastInsertRowid);
    d0.prepare("INSERT INTO screen_items (kind, author_id, title, text, image, owns_image, status, created_at, post_id) VALUES ('dog', ?, '예전 자랑 글', '', '/uploads/old.png', 0, 'approved', ?, ?)").run(a.id, Date.now() - 86400_000, oldPost);
    d0.close();

    // 다른 이용자(B)의 실시간 연결: 게시판 갱신 알림을 받는지
    const sb = io(BASE, { auth: { token: b.token }, transports: ['websocket'] });
    sockets.push(sb);
    let boardEvents = 0, screenEvents = 0;
    sb.on('board:updated', () => { boardEvents++; });
    sb.on('screen:updated', () => { screenEvents++; });
    await new Promise<void>((r) => sb.on('connect', () => r()));
    await sleep(300);

    console.log('\n[1·2] 동네 자랑 글 작성 → 게시판에 바로 표시 · 대형 스크린에는 표시 안 됨]');
    // 예전 앱처럼 screenConsent:true 를 보내도 스크린 쪽에 아무것도 생기지 않아야 함
    const pending0 = (await api('/api/admin/screen', undefined, owner.token)).body.pending.length;
    const w = await api('/api/posts', { text: '우리 콩이 산책 자랑', photo: PNG, screenConsent: true }, a.token);
    check('글 등록 성공', w.status === 200 && w.body.post?.id, w.body);
    const postId = w.body.post.id;
    check('글 상태: 스크린과 연결 없음', w.body.post.screen === 'none', w.body.post.screen);
    await sleep(300);
    check('다른 이용자에게 게시판 갱신 알림이 바로 감 (board:updated)', boardEvents >= 1, boardEvents);
    check('작성자 목록 맨 위에 표시', (await api('/api/posts', undefined, a.token)).body.posts[0]?.id === postId);
    check('다른 이용자(B)도 게시판에서 확인', (await api('/api/posts', undefined, b.token)).body.posts.some((p: any) => p.id === postId));
    check('대형 스크린에 표시 안 됨', !(await screenHas(b.token, /우리 콩이 산책 자랑/)));
    const adm1 = (await api('/api/admin/screen', undefined, owner.token)).body;
    check('대형 스크린 승인 대기 목록에도 자동 등록 안 됨', adm1.pending.length === pending0 && !adm1.pending.some((x: any) => /우리 콩이/.test(x.title)), adm1.pending);
    const d1 = db();
    check('DB: 자랑 글은 posts 에만 (screen_items 에 연결 행 없음)', !d1.prepare('SELECT 1 FROM screen_items WHERE post_id=?').get(postId));
    d1.close();
    check('스크린 갱신 알림은 나가지 않음 (자랑 글은 스크린과 무관)', screenEvents === 0, screenEvents);

    console.log('\n[산책 모임도 대형 스크린에 자동으로 나오지 않음]');
    const m = await api('/api/meetups', { title: '저녁 산책 모임', intro: '같이 걸어요', kind: 'offline', sido: '서울', place: '중앙 광장', startsAt: Date.now() + 86400_000, capacity: 5, sizeRule: 'any', temperRule: 'any', approval: 'auto' }, a.token);
    check('모임 등록', m.status === 200, m.body);
    check('모임은 게시판 목록에 있음', (await api('/api/meetups?scope=upcoming', undefined, b.token)).body.meetups.some((x: any) => x.title === '저녁 산책 모임'));
    check('모임이 대형 스크린에 자동 노출 안 됨', !(await slides(b.token)).some((s) => s.kind === 'meetup' || /저녁 산책 모임/.test(s.title)));

    console.log('\n[3·4] 대형 스크린 등록 요청 → 승인 대기 · 승인 전 미노출]');
    const req1 = await api('/api/screen', { consent: true, title: '콩이 스크린 신청', text: '스크린에 나오고 싶어요', photo: PNG }, a.token);
    const req2 = await api('/api/screen', { consent: true, title: '두번째 신청', photo: PNG }, a.token);
    check('등록 요청 성공', req1.status === 200 && req2.status === 200, [req1.body, req2.body]);
    const mine = (await api('/api/screen/mine', undefined, a.token)).body.items;
    check("상태 '승인 대기'로 저장", mine.find((x: any) => x.title === '콩이 스크린 신청')?.status === 'pending', mine);
    check('승인 전에는 대형 스크린에 없음 (작성자·다른 이용자 모두)', !(await screenHas(a.token, /콩이 스크린 신청/)) && !(await screenHas(b.token, /콩이 스크린 신청/)));
    const adm2 = (await api('/api/admin/screen', undefined, owner.token)).body;
    const r1 = adm2.pending.find((x: any) => x.title === '콩이 스크린 신청');
    const r2 = adm2.pending.find((x: any) => x.title === '두번째 신청');
    check('운영자 승인 대기 목록에 있음', !!r1 && !!r2);

    console.log('\n[권한: 일반 회원은 승인 상태를 바꿀 수 없음]');
    check('작성자 본인도 승인 불가 (403)', (await api(`/api/admin/screen/${r1.id}`, { action: 'approve' }, a.token)).status === 403);
    check('다른 회원도 승인 불가 (403)', (await api(`/api/admin/screen/${r1.id}`, { action: 'approve' }, b.token)).status === 403);
    check('로그인 없이 불가 (401)', (await api(`/api/admin/screen/${r1.id}`, { action: 'approve' })).status === 401);
    check('여전히 승인 대기 · 스크린 미노출', (await api('/api/screen/mine', undefined, a.token)).body.items.find((x: any) => x.id === r1.id)?.status === 'pending' && !(await screenHas(b.token, /콩이 스크린 신청/)));

    console.log('\n[5·6] 운영자 승인 → 노출 / 거절 → 미노출]');
    check('승인', (await api(`/api/admin/screen/${r1.id}`, { action: 'approve' }, owner.token)).status === 200);
    check('승인 → 대형 스크린 노출', await screenHas(b.token, /콩이 스크린 신청/));
    check('거절', (await api(`/api/admin/screen/${r2.id}`, { action: 'reject' }, owner.token)).status === 200);
    check('거절 → 대형 스크린 미노출', !(await screenHas(b.token, /두번째 신청/)));
    check('자랑 글은 여전히 스크린에 없음', !(await screenHas(b.token, /우리 콩이 산책 자랑/)));

    console.log('\n[7] 서버를 다시 켠 뒤(재접속·새로고침)에도 그대로]');
    for (const s of sockets) s.close();
    await stopServer();
    await startServer();
    const login = async (u: string) => (await api('/api/auth/login', { username: u, password: 'password123' })).body.token as string;
    const tb = await login('reader_b');
    check('자랑 글 유지 · 다른 이용자 게시판에 표시', (await api('/api/posts', undefined, tb)).body.posts.some((p: any) => p.id === postId));
    check('자랑 글은 여전히 스크린에 없음', !(await screenHas(tb, /우리 콩이 산책 자랑/)));
    check('승인한 스크린 콘텐츠 유지 · 거절한 것은 계속 미노출', (await screenHas(tb, /콩이 스크린 신청/)) && !(await screenHas(tb, /두번째 신청/)));
    const st = (await api('/api/screen/mine', undefined, await login('writer_a'))).body.items;
    check('신청 상태 유지 (승인/반려)', st.find((x: any) => x.title === '콩이 스크린 신청')?.status === 'approved' && st.find((x: any) => x.title === '두번째 신청')?.status === 'rejected', st);

    console.log('\n[기존 데이터 보존]');
    const d2 = db();
    check('예전에 연결된 자랑 글·스크린 항목 그대로 (삭제·이동 없음)', !!d2.prepare('SELECT 1 FROM posts WHERE id=?').get(oldPost) && (d2.prepare('SELECT status FROM screen_items WHERE post_id=?').get(oldPost) as any)?.status === 'approved');
    d2.close();
    check('예전 글 배지(스크린 노출 중) 표시 유지', (await api('/api/posts', undefined, tb)).body.posts.find((p: any) => p.id === oldPost)?.screen === 'approved');
  } finally {
    for (const s of sockets) s.close();
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); void stopServer(); process.exit(1); });
