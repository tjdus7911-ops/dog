// 아파트 무료 이용(운영 설정 apartmentFreeAccess) 테스트
// 실행: npm run test:apartment-free
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PlacedItem } from '../../shared/home';

const PORT = 3993;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mungle-free-'));
let passed = 0, failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}`, extra ?? ''); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(p: string, body?: object, token?: string, method?: string) {
  const res = await fetch(BASE + p, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
}
const rid = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    // 무료 이용 설정을 켠 상태(MUNGLE_APARTMENT_FREE=1)의 동작 — 기본값은 유료
    env: { ...process.env, PORT: String(PORT), MUNGLE_DATA_DIR: dataDir, MUNGLE_BACKUP_HOURS: '0', MUNGLE_ADMINS: 'freeadmin', MUNGLE_APARTMENT_FREE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => { const t = String(d); if (!/ExperimentalWarning|trace-warnings/.test(t)) process.stderr.write(t); });
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break; } catch { await sleep(200); } }
  try {
    const signup = async (u: string) => (await api('/api/auth/signup', { username: u, password: 'password123', nickname: u.slice(0, 8), dogName: '콩', agree: true })).body;
    const a = await signup('freeuser1');
    const coins0 = (await api('/api/coins', undefined, a.token)).body.coins.balance;

    console.log('\n[처음부터 원룸·투룸·쓰리룸 무료]');
    const ap = await api('/api/apartment', undefined, a.token);
    check('운영 설정이 켜지면 무료 이용', ap.body.freeAccess === true);
    const plans0 = (await api('/api/apartment/plans', undefined, a.token)).body;
    check('입주 전에도 세 종류 모두 선택 가능', plans0.freeAccess && plans0.plans.every((p: any) => p.status === 'available' && p.need === 0), plans0.plans.map((p: any) => p.status));
    const mi = await api('/api/apartment/move-in', { building: '3', unit: '201' }, a.token);
    check('첫 입주로 바로 3동 쓰리룸', mi.status === 200 && mi.body.profile.residence.building === '3', mi.body);
    const c1 = (await api('/api/coins', undefined, a.token)).body.coins;
    check('입주 코인 차감 없음', c1.balance === coins0 && !c1.spent.some((t: any) => t.kind === 'movein'), c1);
    check('한 번에 아파트 하나만 (두 번째 입주 거부)', (await api('/api/apartment/move-in', { building: '1', unit: '101' }, a.token)).status === 409);

    console.log('\n[무료 이사 · 순서·횟수 제한 없음 · 가구·사진 보존]');
    const ph = await api('/api/home/me/photos', { dataUrl: PNG }, a.token);
    const home = (await api('/api/home/me', undefined, a.token)).body.home;
    const myLayout: PlacedItem[] = [...home.layout.filter((i: PlacedItem) => i.type !== 'frame'), { type: 'frame', n: 0, x: 1.0, z: -3.5, rot: 0, photo: ph.body.photo.url }];
    const saved = await api('/api/home/me/layout', { layout: myLayout }, a.token, 'PUT');
    check('꾸미기 저장', saved.status === 200, saved.body);
    const down = await api('/api/apartment/move', { building: '1', requestId: rid() }, a.token);
    check('3동 → 1동 (되돌아가기) 무료 이사', down.status === 200 && down.body.residence.building === '1', down.body);
    const req = rid();
    const [m1, m2] = await Promise.all([api('/api/apartment/move', { building: '2', requestId: req }, a.token), api('/api/apartment/move', { building: '2', requestId: req }, a.token)]);
    check('같은 요청 번호 두 번 → 한 번만 이사', [m1, m2].filter((r) => r.status === 200).length === 1);
    const up = await api('/api/apartment/move', { building: '3', requestId: rid() }, a.token);
    check('여러 번 이사 가능 (2동 → 3동)', up.status === 200 && up.body.residence.building === '3');
    const c2 = (await api('/api/coins', undefined, a.token)).body.coins;
    check('이사해도 코인 그대로 · 코인 내역에 0코인 줄 없음', c2.balance === coins0 && !c2.spent.some((t: any) => t.kind === 'move'), c2);
    const nh = up.body.home;
    check('사진 액자는 새집 벽에 그대로', nh.layout.some((i: PlacedItem) => i.type === 'frame' && i.photo === ph.body.photo.url), nh.layout);
    const photos = (await api('/api/home/me/photos', undefined, a.token)).body;
    check('업로드한 사진 목록 유지', JSON.stringify(photos).includes(ph.body.photo.url));
    check('같은 동으로 이사 거부', (await api('/api/apartment/move', { building: '3', requestId: rid() }, a.token)).status === 409);

    console.log('\n[운영 설정으로 유료 전환 → 기존 거주 유지]');
    const admin = await signup('freeadmin');
    const g = await api('/api/admin/settings', undefined, admin.token);
    check('관리자: 설정 조회', g.status === 200 && g.body.settings.apartmentFreeAccess === true);
    check('일반 사용자는 설정 변경 불가', (await api('/api/admin/settings', { apartmentFreeAccess: false }, a.token)).status === 403);
    const off = await api('/api/admin/settings', { apartmentFreeAccess: false }, admin.token);
    check('관리자: 무료 이용 끄기', off.status === 200 && off.body.settings.apartmentFreeAccess === false);
    const me = (await api('/api/me', undefined, a.token)).body.profile;
    check('유료로 바뀌어도 이미 사는 3동 쓰리룸은 그대로', me.residence.building === '3');
    const plans1 = (await api('/api/apartment/plans', undefined, a.token)).body;
    check('유료 전환 후 다시 가격 기준 안내', plans1.freeAccess === false && plans1.plans.find((p: any) => p.tier === 3).status === 'current');
    const b = await signup('freeuser2');
    check('유료일 때 첫 입주는 1동만', (await api('/api/apartment/move-in', { building: '2', unit: '101' }, b.token)).status === 400);
    await api('/api/admin/settings', { apartmentFreeAccess: true }, admin.token);
    check('다시 무료로 → 2동 바로 입주', (await api('/api/apartment/move-in', { building: '2', unit: '101' }, b.token)).status === 200);
  } finally {
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(`\n결과: ${passed}개 통과, ${failed}개 실패`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
