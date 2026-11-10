import { DEMO, demoApi } from '../demo';

const TOKEN_KEY = 'mungle.token';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* 저장소 사용 불가 환경 */ } },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: any = null) { super(message); }
}

/** 가입 안내 창 열기 (store 쪽에서 연결) */
export const membersOnly = { open: () => {} };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  if (DEMO) return demoApi(path, opts) as Promise<T>;
  const token = opts.token === undefined ? tokenStore.get() : opts.token;
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  // 둘러보기 방문자가 주민 전용 기능을 쓰려 하면 가입 안내 창
  if (data?.code === 'members_only') membersOnly.open();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? '서버와 통신하지 못했어요.', data);
  return data as T;
}
