// GitHub 저장소를 데이터 보관함으로 쓰는 영구 저장 (카드 없는 무료 호스팅용)
// - Render 무료 플랜처럼 재시작하면 디스크가 비는 환경에서, DB 스냅샷과 강아지 사진을
//   사용자 소유의 비공개 GitHub 저장소에 저장했다가 서버가 켜질 때 되살린다.
// - 환경변수 MUNGLE_GITHUB_REPO(소유자/저장소)와 MUNGLE_GITHUB_TOKEN 이 있을 때만 동작한다.
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.MUNGLE_GITHUB_REPO ?? '';
const TOKEN = process.env.MUNGLE_GITHUB_TOKEN ?? '';
const BRANCH = process.env.MUNGLE_GITHUB_BRANCH ?? 'main';
const API = (process.env.MUNGLE_GITHUB_API ?? 'https://api.github.com').replace(/\/$/, '');
export const enabled = !!(REPO && TOKEN);
/**
 * 서버를 켤 때 저장소의 DB로 되살리는 조건
 *  · always (기본): 디스크가 임시인 곳(Render 무료). 켤 때마다 저장소의 최신본으로
 *  · missing: 디스크가 남는 서버(오라클 등). 서버 DB가 없을 때만(새 서버·복구) 되살리고, 평소엔 백업만
 */
const RESTORE_MODE = process.env.MUNGLE_GITHUB_RESTORE === 'missing' ? 'missing' : 'always';

export const DATA_DIR = process.env.MUNGLE_DATA_DIR ?? path.resolve(import.meta.dirname, '../data');
const DB_FILE = process.env.MUNGLE_DB ?? path.join(DATA_DIR, 'mungle.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const shas = new Map<string, string>(); // 저장소 경로 → 최신 blob sha (덮어쓰기에 필요)
let chain: Promise<unknown> = Promise.resolve(); // GitHub 쓰기는 한 번에 하나씩 (sha 충돌 방지)

function gh(p: string, init: RequestInit = {}, accept = 'application/vnd.github+json') {
  return fetch(`${API}/repos/${REPO}/contents/${p}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'mungle-village', ...(init.headers ?? {}) },
  });
}

async function getSha(p: string): Promise<string | undefined> {
  const r = await gh(`${p}?ref=${BRANCH}`);
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`GitHub 조회 실패 ${r.status}`);
  const j = (await r.json()) as { sha?: string };
  return j.sha;
}

async function putFile(p: string, buf: Buffer, message: string) {
  const body = (sha?: string) => JSON.stringify({ message, content: buf.toString('base64'), branch: BRANCH, ...(sha ? { sha } : {}) });
  let r = await gh(p, { method: 'PUT', body: body(shas.get(p)), headers: { 'content-type': 'application/json' } });
  if (r.status === 409 || r.status === 422) { // sha 불일치 → 최신 sha로 한 번 재시도
    const sha = await getSha(p);
    r = await gh(p, { method: 'PUT', body: body(sha), headers: { 'content-type': 'application/json' } });
  }
  if (!r.ok) throw new Error(`GitHub 저장 실패 ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { content?: { sha?: string } };
  if (j.content?.sha) shas.set(p, j.content.sha);
}

async function deleteFile(p: string, message: string) {
  const sha = shas.get(p) ?? (await getSha(p));
  if (!sha) return;
  const r = await gh(p, { method: 'DELETE', body: JSON.stringify({ message, sha, branch: BRANCH }), headers: { 'content-type': 'application/json' } });
  if (!r.ok && r.status !== 404) throw new Error(`GitHub 삭제 실패 ${r.status}`);
  shas.delete(p);
}

async function download(p: string): Promise<Buffer | null> {
  const r = await gh(`${p}?ref=${BRANCH}`, {}, 'application/vnd.github.raw');
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub 내려받기 실패 ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** 작업을 순서대로 실행. 실패는 로그만 남기고 다음 작업은 계속된다. */
function queue(job: () => Promise<unknown>): Promise<void> {
  const next = chain.then(job).then(() => {}, (e) => { console.error('💾 GitHub 저장 오류:', (e as Error).message); });
  chain = next;
  return next;
}

/** 서버 시작 전에 호출: 저장소에 있는 DB와 사진을 되살린다 */
export async function restore() {
  if (!enabled) return;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const keepLocal = RESTORE_MODE === 'missing' && fs.existsSync(DB_FILE);
  const dbBuf = keepLocal ? null : await download('mungle.db');
  if (keepLocal) console.log('💾 서버 디스크의 데이터를 그대로 사용 (GitHub 저장소는 백업용)');
  else if (dbBuf) {
    fs.writeFileSync(DB_FILE, dbBuf);
    for (const ext of ['-wal', '-shm']) fs.rmSync(DB_FILE + ext, { force: true });
    console.log(`💾 GitHub에서 데이터 복원 (${(dbBuf.length / 1024).toFixed(1)}KB)`);
  } else console.log('💾 GitHub 저장소에 저장된 데이터가 없어 새로 시작합니다.');
  const r = await gh(`uploads?ref=${BRANCH}`);
  if (r.ok) {
    const list = (await r.json()) as { name: string; sha: string; type: string }[];
    for (const f of list) {
      if (f.type !== 'file' || !/^[a-f0-9]{32}\.(png|jpe?g|webp)$/.test(f.name)) continue;
      shas.set(`uploads/${f.name}`, f.sha);
      const dest = path.join(UPLOAD_DIR, f.name);
      if (fs.existsSync(dest)) continue;
      const buf = await download(`uploads/${f.name}`);
      if (buf) fs.writeFileSync(dest, buf);
    }
    console.log(`💾 강아지 사진 ${list.length}장 확인`);
  }
}

/** 사진 저장/삭제를 저장소에도 반영 (응답을 기다리게 하지 않음) */
export function saveUpload(file: string, buf: Buffer) {
  if (enabled) void queue(() => putFile(`uploads/${file}`, buf, `photo: ${file}`));
}
export function removeUpload(file: string) {
  if (enabled) void queue(() => deleteFile(`uploads/${file}`, `photo removed: ${file}`));
}

/**
 * DB 스냅샷 주기 저장 + 종료 시 저장.
 * snapshot(): 현재 DB를 파일로 떠서 내용(Buffer)을 돌려주는 함수, changes(): 변경 카운터
 */
export function startDbSync(snapshot: () => Buffer, changes: () => number, minutes = Number(process.env.MUNGLE_SYNC_MINUTES ?? 5)) {
  if (!enabled) return { flush: async () => {} };
  let saved = changes();
  const flush = () => queue(async () => {
    const now = changes();
    if (now === saved) return;
    const buf = snapshot();
    await putFile('mungle.db', buf, `data snapshot ${new Date().toISOString()}`);
    saved = now;
    console.log(`💾 GitHub에 데이터 저장 (${(buf.length / 1024).toFixed(1)}KB)`);
  });
  setInterval(() => { void flush(); }, Math.max(1, minutes) * 60_000).unref();
  let closing = false;
  const onExit = (sig: string) => {
    if (closing) return;
    closing = true;
    console.log(`💾 ${sig} 수신 — 종료 전 데이터 저장`);
    const t = setTimeout(() => process.exit(0), 20_000);
    flush().finally(() => { clearTimeout(t); process.exit(0); });
  };
  process.on('SIGTERM', () => onExit('SIGTERM'));
  process.on('SIGINT', () => onExit('SIGINT'));
  return { flush };
}
