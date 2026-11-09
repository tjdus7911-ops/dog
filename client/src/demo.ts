// 미리보기(데모) 모드 — 서버 없이 아바타 만들기와 혼자 산책만 체험하는 빌드 (VITE_DEMO=1)
// 실시간 멀티플레이·채팅·친구처럼 서버가 필요한 기능은 화면에서 숨기고 안내한다.
// AI 강아지 사진 분석은 Claude 앱 안에서 열었을 때 보는 사람의 Claude로 실행한다 (sample 기능).
import { DEFAULT_DOG, DEFAULT_HUMAN, validateDog, validateHuman } from '@shared/avatar';
import { DEFAULT_PRIVACY, type MyProfile } from '@shared/protocol';
import { APARTMENT_BUILDINGS, isValidUnit, unitsOf } from '@shared/apartment';
import { interpretDogFeatures, jsonPrompt, type DogPhotoKind } from '@shared/dogAnalysis';

export const DEMO = import.meta.env.VITE_DEMO === '1';

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
      mine,
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
    const next = { ...cur, residence: { building: String(building), unit: String(unit) } };
    saveDemoProfile(next);
    return { profile: next };
  }
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
