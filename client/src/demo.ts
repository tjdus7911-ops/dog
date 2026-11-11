// 미리보기(데모) 모드 — 서버 없이 아바타 만들기와 혼자 산책만 체험하는 빌드 (VITE_DEMO=1)
// 실시간 멀티플레이·채팅·친구처럼 서버가 필요한 기능은 화면에서 숨기고 안내한다.
// AI 강아지 사진 분석은 Claude 앱 안에서 열었을 때 보는 사람의 Claude로 실행한다 (sample 기능).
import { DEFAULT_DOG, DEFAULT_HUMAN, validateDog, validateHuman } from '@shared/avatar';
import { DEFAULT_PRIVACY, type MyProfile } from '@shared/protocol';
import { DEFAULT_STYLE, PLANS, movedLayout, tierOfBuilding, validateLayout, validateStyle, type HomeStyle, type HomeTier, type HomeVisibility, type PlacedItem } from '@shared/home';
import { COIN_LABEL, COIN_REWARDS, kstDay, type CoinKind, type CoinStatus, type CoinTx } from '@shared/coins';
import { APARTMENT_BUILDINGS, isValidUnit, unitsOf } from '@shared/apartment';
import { interpretDogFeatures, jsonPrompt, type DogPhotoKind } from '@shared/dogAnalysis';
import { demoClaimed, demoCommunity } from './demoCommunity';

export const DEMO = import.meta.env.VITE_DEMO === '1';
/** 미리보기도 서버 기본 운영 설정과 같게: 아파트 무료 이용 */
const DEMO_FREE = false;

const KEY = 'mungle.demo.profile';

export function loadDemoProfile(): { profile: MyProfile; fresh: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { profile: { ...p, residence: p.residence ?? null, human: validateHuman(p.human) ?? DEFAULT_HUMAN, dog: validateDog(p.dog) ?? DEFAULT_DOG }, fresh: false };
    }
  } catch { /* 저장소 사용 불가 */ }
  return {
    fresh: true,
    profile: {
      id: 1, nickname: '멍글이', dogName: '사슴이', dogIntro: '', dogPhoto: null, residence: null,
      human: { ...DEFAULT_HUMAN }, dog: { ...DEFAULT_DOG }, privacy: DEFAULT_PRIVACY, role: 'user',
    },
  };
}

function saveDemoProfile(p: MyProfile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 저장 실패 시 이번 세션에서만 유지 */ }
}

export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
  location.reload();
}

/** 서버 API 대신 브라우저 안에서 처리 */
export async function demoApi(path: string, opts: { method?: string; body?: any }): Promise<any> {
  const cur = loadDemoProfile().profile;
  if (path === '/api/me') return { profile: cur };
  if (path === '/api/me/profile') {
    const b = opts.body ?? {};
    const human = validateHuman(b.human), dog = validateDog(b.dog);
    if (!human || !dog) throw new Error('아바타 설정 값이 올바르지 않아요.');
    const next: MyProfile = {
      ...cur, human, dog,
      nickname: String(b.nickname || cur.nickname).slice(0, 12),
      dogName: String(b.dogName || cur.dogName).slice(0, 12),
      dogIntro: String(b.dogIntro ?? '').slice(0, 80),
    };
    saveDemoProfile(next);
    return { profile: next };
  }
  if (path === '/api/me/dog-photo') {
    const next = { ...cur, dogPhoto: opts.method === 'DELETE' ? null : opts.body?.dataUrl ?? null };
    saveDemoProfile(next);
    return { profile: next };
  }
  // 멍글 아파트: 미리보기에서는 다른 주민 없이 내 호실만 (브라우저에 저장)
  if (path === '/api/apartment') {
    const mine = cur.residence;
    return {
      mine, freeAccess: DEMO_FREE,
      buildings: APARTMENT_BUILDINGS.map((b) => ({
        ...b,
        units: unitsOf(b).map(({ unit, floor }) => {
          const isMine = !!mine && mine.building === b.id && mine.unit === unit;
          return {
            unit, floor, occupied: isMine,
            resident: isMine ? { id: cur.id, nickname: cur.nickname, dogName: cur.dogName, dogCoat: cur.dog.coat, dogPhoto: cur.dogPhoto, mine: true } : null,
          };
        }),
      })),
    };
  }
  if (path === '/api/apartment/move-in') {
    const { building, unit } = opts.body ?? {};
    if (!isValidUnit(String(building), String(unit))) throw new Error('존재하지 않는 호실이에요.');
    if (cur.residence) throw new Error('이미 입주한 집이 있어요.');
    const w = wallet();
    if (!DEMO_FREE) {
      const pl = PLANS[tierOfBuilding(String(building))];
      if (w.balance < pl.price) throw new Error(`입주까지 ${(pl.price - w.balance).toLocaleString('ko-KR')}코인 남았어요!`);
      addTx(w, -pl.price, 'movein', `${pl.name} ${unit}호 입주`);
    }
    const next = { ...cur, residence: { building: String(building), unit: String(unit) } };
    saveDemoProfile(next);
    const tierIn = tierOfBuilding(String(building));
    if (tierIn > 1) { const h = loadDemoHome(); saveDemoHome({ ...h, layout: movedLayout(h.layout, tierIn) }); }
    return { profile: next, coins: demoCoinStatus(w) };
  }
  // ---- 코인 (미리보기: 이 기기에만 저장) ----
  if (path === '/api/coins') return { coins: demoCoinStatus(wallet()) };
  if (path === '/api/coins/attendance') {
    const w = wallet();
    const day = kstDay(Date.now());
    if (w.att[day]) throw new Error('오늘은 이미 출석했어요. 내일 또 만나요!');
    const streak = (w.att[kstDay(Date.now() - 86400_000)] ?? 0) + 1;
    w.att[day] = streak;
    const got = [{ amount: 100, kind: 'attendance', label: `출석 ${streak}일째`, balance: addTx(w, 100, 'attendance') }];
    if (streak % 7 === 0) got.push({ amount: 300, kind: 'streak7', label: `${streak}일 연속 출석 보너스`, balance: addTx(w, 300, 'streak7') });
    return { streak, got, coins: demoCoinStatus(w) };
  }
  if (path === '/api/apartment/plans') {
    const w = wallet();
    const t = cur.residence ? tierOfBuilding(cur.residence.building) : null;
    return {
      balance: w.balance, current: t, residence: cur.residence, freeAccess: DEMO_FREE,
      plans: ([1, 2, 3] as HomeTier[]).map((k) => {
        const p = PLANS[k];
        const status = t === k ? 'current' : DEMO_FREE ? 'available' : t !== null && k < t ? 'past' : t === null ? (w.balance >= p.price ? 'available' : 'insufficient') : t + 1 === k ? (w.balance >= p.price ? 'available' : 'insufficient') : 'locked';
        return { tier: k, building: p.building, name: p.name, type: p.type, rooms: p.rooms, price: p.price, features: p.features, capacity: p.capacity, free: 16, status, need: DEMO_FREE ? 0 : Math.max(0, p.price - w.balance) };
      }),
    };
  }
  if (path === '/api/apartment/move') {
    const w = wallet();
    if (!cur.residence) throw new Error('먼저 1동 원룸에 입주해 주세요.');
    const tier = tierOfBuilding(String(opts.body?.building));
    const t = tierOfBuilding(cur.residence.building);
    const p = PLANS[tier];
    if (tier === t) throw new Error('지금 살고 있는 동이에요.');
    if (!DEMO_FREE) {
      if (tier !== t + 1) throw new Error('1동 → 2동 → 3동 순서로 이사할 수 있어요.');
      if (w.balance < p.price) throw new Error(`이사까지 ${(p.price - w.balance).toLocaleString('ko-KR')}코인 남았어요! 산책과 멍글런너를 즐기며 코인을 모아보세요.`);
      addTx(w, -p.price, 'move', `${p.name} 101호로 이사`);
    }
    const next = { ...cur, residence: { building: p.building, unit: '101' } };
    saveDemoProfile(next);
    const h = loadDemoHome();
    saveDemoHome({ ...h, layout: movedLayout(h.layout, tier) });
    return { residence: next.residence, profile: next, coins: demoCoinStatus(w), home: demoHomeView(next) };
  }
  // 우리 집 (미리보기: 내 집만, 브라우저에 저장)
  if (path.startsWith('/api/home/') && path.endsWith('/access')) {
    if (!cur.residence || path !== `/api/home/${cur.id}/access`) throw new Error('미리보기에서는 다른 집에 방문할 수 없어요.');
    return {
      allowed: true, reason: null, canRequest: false, request: null, visibility: 'public', neighbor: 'unavailable',
      owner: { id: cur.id, nickname: cur.nickname, dogName: cur.dogName, dogIntro: cur.dogIntro, dogPhoto: cur.dogPhoto, dog: cur.dog, residence: cur.residence },
    };
  }
  if (path.startsWith('/api/home/')) {
    if (!cur.residence) throw new Error('먼저 아파트에 입주해 주세요.');
    const tier = tierOfBuilding(cur.residence.building);
    let saved = loadDemoHome();
    if (path === '/api/home/me/layout') {
      const layout = validateLayout(opts.body?.layout, new Set(demoOwned(tier)), tier);
      if (!layout) throw new Error('가구 배치 정보가 올바르지 않아요.');
      saved = { ...saved, layout };
    } else if (path === '/api/home/me/visibility') saved = { ...saved, visibility: opts.body?.visibility ?? 'public' };
    else if (path === '/api/home/me/style') {
      const st = validateStyle(opts.body?.style);
      if (!st) throw new Error('벽지·바닥재 정보가 올바르지 않아요.');
      saved = { ...saved, style: st };
    } else if (path !== '/api/home/me' && path !== `/api/home/${cur.id}`) throw new Error('미리보기에서는 다른 집에 방문할 수 없어요.');
    saveDemoHome(saved);
    return { home: demoHomeView(cur) };
  }
  const community = demoCommunity(path, opts, cur);
  if (community !== undefined) return community;
  if (path === '/api/dog-analysis/status') return { available: !!(await getSample()), demo: true };
  if (path === '/api/dog-analysis') return { result: await analyzeInClaude(opts.body?.photos ?? []) };
  throw new Error('미리보기에서는 서버 기능을 사용할 수 없어요.');
}

// ---------- AI 사진 분석 (Claude 앱 안에서 열린 미리보기 전용) ----------
type Sample = {
  json: (input: string, opts?: { images?: Blob[] }) => Promise<unknown>;
  limits: () => Promise<{ images?: { maxCount: number } }>;
};
let samplePromise: Promise<Sample | null> | null = null;
function getSample() {
  samplePromise ??= (async () => {
    const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    if (!c?.use) return null;
    try {
      const s = (await c.use('sample')) as Sample | null;
      if (!s) return null;
      const lim = await s.limits().catch(() => null);
      return lim?.images ? s : null;
    } catch { return null; }
  })();
  return samplePromise;
}

function dataUrlToBlob(url: string) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url);
  if (!m) throw new Error('사진을 읽지 못했어요.');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

const SAMPLE_ERRORS: Record<string, string> = {
  not_granted: 'AI 사용을 허용해야 분석할 수 있어요. 페이지를 새로 고친 뒤 다시 시도하면 허용 창이 다시 떠요.',
  rate_limited: 'AI 사용량이 잠시 많아요. 조금 뒤에 다시 시도해 주세요.',
  image_rejected: '이 사진은 분석할 수 없어요. 다른 사진(JPG·PNG)으로 시도해 주세요.',
  refused: '이 사진은 분석할 수 없어요. 강아지가 잘 보이는 다른 사진으로 시도해 주세요.',
  invalid_json: 'AI 답변을 읽지 못했어요. 다시 시도해 주세요.',
  session_expired: 'Claude 로그인이 만료되었어요. 다시 로그인해 주세요.',
  images_unavailable: '이 화면에서는 사진을 AI로 보낼 수 없어요.',
};

async function analyzeInClaude(photos: { kind: DogPhotoKind; dataUrl: string }[]) {
  const s = await getSample();
  if (!s) throw new Error('이 미리보기를 Claude 앱 안에서 열어야 AI 분석을 쓸 수 있어요.');
  const valid = photos.filter((p) => p && typeof p.dataUrl === 'string').slice(0, 3);
  if (!valid.length) throw new Error('정면 사진을 먼저 올려 주세요.');
  let raw: unknown;
  try {
    raw = await s.json(jsonPrompt(valid.map((p) => p.kind)), { images: valid.map((p) => dataUrlToBlob(p.dataUrl)) });
  } catch (e) {
    const code = (e as { code?: string })?.code ?? '';
    throw new Error(SAMPLE_ERRORS[code] ?? 'AI 분석 중 문제가 생겼어요. 다시 시도해 주세요.');
  }
  const r = interpretDogFeatures(raw);
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

// ---------- 미리보기 집 · 코인 (브라우저에만 저장) ----------
type DemoHome = { layout: PlacedItem[]; visibility: HomeVisibility; style: HomeStyle };
const KEYH = 'mungle.demo.home';
function loadDemoHome(): DemoHome {
  const p = loadDemoProfile().profile;
  const tier = tierOfBuilding(p.residence?.building);
  let saved: DemoHome = { layout: PLANS[tier].defaultLayout, visibility: 'public', style: { ...DEFAULT_STYLE } };
  try { const raw = localStorage.getItem(KEYH); if (raw) saved = { ...saved, ...JSON.parse(raw) }; } catch { /* 무시 */ }
  return saved;
}
function saveDemoHome(h: DemoHome) { try { localStorage.setItem(KEYH, JSON.stringify(h)); } catch { /* 무시 */ } }
/** 애견샵에서 받은 가구 + 등급별 이사 선물 */
function demoOwned(tier: HomeTier) {
  const gifts = [...(tier >= 2 ? ['bed_cream'] : []), ...(tier >= 3 ? ['play_tunnel', 'ball_pit', 'play_steps'] : [])];
  return [...new Set([...demoClaimed(), ...gifts])];
}
function demoHomeView(cur: MyProfile) {
  const tier = tierOfBuilding(cur.residence?.building);
  const saved = loadDemoHome();
  return {
    ownerId: cur.id, owner: { nickname: cur.nickname, dogName: cur.dogName, dogPhoto: cur.dogPhoto, human: cur.human, dog: cur.dog },
    residence: cur.residence, visibility: saved.visibility, layout: validateLayout(saved.layout, undefined, tier) ?? PLANS[tier].defaultLayout,
    likes: 0, likedByMe: false, isOwner: true, guestbook: [], owned: demoOwned(tier), tier, style: validateStyle(saved.style) ?? DEFAULT_STYLE,
  };
}
type DemoWallet = { balance: number; tx: CoinTx[]; att: Record<string, number> };
const KEYC = 'mungle.demo.coins';
function wallet(): DemoWallet {
  try { const raw = localStorage.getItem(KEYC); if (raw) return JSON.parse(raw); } catch { /* 무시 */ }
  // 처음: 신규 가입 선물 (이미 입주한 미리보기 사용자는 입주비 소급 없음)
  const w: DemoWallet = { balance: 0, tx: [], att: {} };
  if (!loadDemoProfile().profile.residence) addTx(w, COIN_REWARDS.signup.amount, 'signup');
  else saveWallet(w);
  return w;
}
function saveWallet(w: DemoWallet) { try { localStorage.setItem(KEYC, JSON.stringify(w)); } catch { /* 무시 */ } }
function addTx(w: DemoWallet, amount: number, kind: CoinKind, memo = '') {
  w.balance += amount;
  w.tx.unshift({ id: (w.tx[0]?.id ?? 0) + 1, amount, kind, memo: memo || COIN_LABEL[kind], balance: w.balance, ts: Date.now() });
  w.tx = w.tx.slice(0, 60);
  saveWallet(w);
  return w.balance;
}
function demoCoinStatus(w: DemoWallet): CoinStatus {
  const today = kstDay(Date.now());
  const t = w.att[today], y = w.att[kstDay(Date.now() - 86400_000)];
  const streak = t ?? y ?? 0;
  return {
    balance: w.balance,
    todayEarned: w.tx.filter((x) => x.amount > 0 && kstDay(x.ts) === today).reduce((a, x) => a + x.amount, 0),
    earned: w.tx.filter((x) => x.amount > 0).slice(0, 20), spent: w.tx.filter((x) => x.amount < 0).slice(0, 20),
    attendance: { claimedToday: !!t, streak, cycleDone: t ? ((streak - 1) % 7) + 1 : streak % 7, today },
    daily: { walk: { count: 0, max: 3 }, runner: { count: 0, max: 3 }, meetup: { count: 0, max: 1 } },
  };
}
