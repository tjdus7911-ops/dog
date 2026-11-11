// GitHub 저장소 영구 저장 테스트 — 가짜 GitHub API 서버로 "저장 → 디스크 초기화 → 재시작 → 복원"을 확인
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

let passed = 0, failed = 0;
const check = (name: string, ok: boolean) => { ok ? passed++ : failed++; console.log(`  ${ok ? '✅' : '❌'} ${name}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 가짜 GitHub contents API ----
const files = new Map<string, { buf: Buffer; sha: string }>();
let puts = 0;
const gh = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  const m = /^\/repos\/me\/data\/contents\/(.+)$/.exec(url.pathname);
  if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401).end(); return; }
  if (!m) { res.writeHead(404).end(); return; }
  const p = decodeURIComponent(m[1]);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (code: number, o: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET') {
      if (p === 'uploads') {
        const list = [...files].filter(([k]) => k.startsWith('uploads/')).map(([k, v]) => ({ name: k.slice(8), sha: v.sha, type: 'file' }));
        return list.length ? json(200, list) : json(404, {});
      }
      const f = files.get(p);
      if (!f) return json(404, {});
      if (req.headers.accept === 'application/vnd.github.raw') { res.writeHead(200); return res.end(f.buf); }
      return json(200, { sha: f.sha });
    }
    const b = JSON.parse(body || '{}');
    const cur = files.get(p);
    if (req.method === 'PUT') {
      if (cur && b.sha !== cur.sha) return json(409, { message: 'sha mismatch' });
      const buf = Buffer.from(b.content, 'base64');
      const sha = crypto.createHash('sha1').update(buf).digest('hex');
      files.set(p, { buf, sha }); puts++;
      return json(200, { content: { sha } });
    }
    if (req.method === 'DELETE') {
      if (!cur || b.sha !== cur.sha) return json(409, {});
      files.delete(p);
      return json(200, {});
    }
    json(405, {});
  });
});

const PORT = 3870;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-persist-'));

function start(extra: Record<string, string> = {}): Promise<ChildProcess> {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_GITHUB_REPO: 'me/data', MUNGLE_GITHUB_TOKEN: 'test-token', MUNGLE_GITHUB_API: 'http://localhost:3871', MUNGLE_SYNC_MINUTES: '60', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr!.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  return (async () => {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); return proc; } catch { await sleep(200); } }
    throw new Error('서버 시작 실패');
  })();
}
const stop = (p: ChildProcess) => new Promise<void>((r) => { p.on('exit', () => r()); p.kill('SIGTERM'); });
async function api(p: string, body?: object, token?: string, method = 'POST') {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  await new Promise<void>((r) => gh.listen(3871, r));
  try {
    console.log('\n[GitHub 영구 저장]');
    let s = await start();
    check('저장소가 비어 있어도 새로 시작', (await api('/api/health', undefined, undefined, 'GET')).status === 200);
    const su = await api('/api/auth/signup', { username: 'keeper01', password: 'password123', nickname: '보관이', dogName: '두부', agree: true });
    const ph = await api('/api/me/dog-photo', { dataUrl: PNG }, su.body.token);
    check('가입·사진 등록', su.status === 200 && ph.status === 200);
    await sleep(500);
    check('사진이 저장소에 업로드됨', [...files.keys()].some((k) => k.startsWith('uploads/')));
    await stop(s);
    check('종료(SIGTERM) 시 DB 스냅샷 저장', files.has('mungle.db') && files.get('mungle.db')!.buf.length > 0);

    // 디스크 초기화 (무료 호스팅 재시작 상황)
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir);
    s = await start();
    const login = await api('/api/auth/login', { username: 'keeper01', password: 'password123' });
    check('디스크가 비워져도 재시작 후 로그인 가능 (DB 복원)', login.status === 200 && login.body.profile.nickname === '보관이');
    const photo = login.body.profile.dogPhoto as string;
    const img = await fetch(BASE + photo);
    check('강아지 사진 복원', img.status === 200);
    await stop(s);
    const putsBefore = puts;
    s = await start();
    await stop(s);
    check('변경이 없으면 종료 시 다시 저장하지 않음', puts === putsBefore);

    s = await start();
    const del = await api('/api/me/dog-photo', undefined, (await api('/api/auth/login', { username: 'keeper01', password: 'password123' })).body.token, 'DELETE');
    await sleep(500);
    check('사진 삭제가 저장소에도 반영', del.status === 200 && ![...files.keys()].some((k) => k.startsWith('uploads/')));
    await stop(s);

    // ---- 디스크가 남는 서버(오라클 등): 서버 DB가 있으면 저장소는 백업으로만 ----
    console.log('\n[디스크가 남는 서버 · 서버 밖 백업]');
    const KEEP = { MUNGLE_GITHUB_RESTORE: 'missing' };
    const stale = { ...files.get('mungle.db')! }; // 이 시점의 백업본 (곧 오래된 것이 됨)
    s = await start(KEEP);
    const su2 = await api('/api/auth/signup', { username: 'local02', password: 'password123', nickname: '새주민', dogName: '콩', agree: true });
    await stop(s);
    check('새 가입 후 종료 시 백업 저장', su2.status === 200 && files.get('mungle.db')!.sha !== stale.sha);
    files.set('mungle.db', stale); // 저장소에 오래된 백업만 남은 상황
    s = await start(KEEP);
    check('서버 DB가 있으면 오래된 백업으로 덮어쓰지 않음', (await api('/api/auth/login', { username: 'local02', password: 'password123' })).status === 200);
    await stop(s);
    fs.rmSync(dataDir, { recursive: true, force: true }); fs.mkdirSync(dataDir);
    s = await start(KEEP);
    check('서버 DB가 없으면(새 서버) 백업에서 되살림', (await api('/api/auth/login', { username: 'keeper01', password: 'password123' })).status === 200);
    await stop(s);

    // ---- 이사 안내 모드: 예전 서버는 새 주소로 보내고 데이터는 건드리지 않음 ----
    console.log('\n[예전 주소 → 새 주소 안내]');
    const putsMoved = puts;
    s = await start({ MUNGLE_MOVED_TO: 'https://new.example.com/' });
    const r1 = await fetch(BASE + '/', { redirect: 'manual' });
    const r2 = await fetch(BASE + '/invite?code=ab12', { redirect: 'manual' });
    check('첫 화면 → 새 주소로 이동', r1.status === 302 && r1.headers.get('location') === 'https://new.example.com/');
    check('경로·쿼리 유지', r2.headers.get('location') === 'https://new.example.com/invite?code=ab12');
    const lg = await api('/api/auth/login', { username: 'keeper01', password: 'password123' });
    check('API는 새 주소 안내(410)', lg.status === 410 && lg.body.movedTo === 'https://new.example.com');
    check('상태 확인(health)은 그대로', (await api('/api/health', undefined, undefined, 'GET')).status === 200);
    await stop(s);
    check('예전 서버는 백업 저장소에 쓰지 않음', puts === putsMoved);
  } finally {
    gh.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
