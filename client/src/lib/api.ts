const TOKEN_KEY = 'mungle.token';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* 저장소 사용 불가 환경 */ } },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const token = opts.token === undefined ? tokenStore.get() : opts.token;
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? '서버와 통신하지 못했어요.');
  return data as T;
}
