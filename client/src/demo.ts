// 미리보기(데모) 모드 — 서버 없이 아바타 만들기와 혼자 산책만 체험하는 빌드 (VITE_DEMO=1)
// 실시간 멀티플레이·채팅·친구·AI 분석처럼 서버가 필요한 기능은 화면에서 숨기고 안내한다.
import { DEFAULT_DOG, DEFAULT_HUMAN, validateDog, validateHuman } from '@shared/avatar';
import { DEFAULT_PRIVACY, type MyProfile } from '@shared/protocol';

export const DEMO = import.meta.env.VITE_DEMO === '1';

const KEY = 'mungle.demo.profile';

export function loadDemoProfile(): { profile: MyProfile; fresh: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { profile: { ...p, human: validateHuman(p.human) ?? DEFAULT_HUMAN, dog: validateDog(p.dog) ?? DEFAULT_DOG }, fresh: false };
    }
  } catch { /* 저장소 사용 불가 */ }
  return {
    fresh: true,
    profile: {
      id: 1, nickname: '멍글이', dogName: '사슴이', dogIntro: '', dogPhoto: null,
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
  if (path === '/api/dog-analysis/status') return { available: false, demo: true };
  throw new Error('미리보기에서는 서버 기능을 사용할 수 없어요.');
}
