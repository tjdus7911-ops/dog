// 채팅 욕설 필터 · 도배 방지
// 단어 목록은 기본 예시 수준이며, 운영 시 별도 파일/DB로 관리하도록 분리하는 것을 권장한다.

const BANNED = [
  '씨발', '시발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '개새끼', '개새', '좆', '존나', 'ㅈㄴ', '미친놈', '미친년', '지랄', 'ㅈㄹ',
  '닥쳐', '꺼져', '엿먹', '느금', '니애미', '애미', '애비', '썅', '등신', '멍청이',
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'cunt', 'motherfucker',
];

// 중간에 공백·특수문자를 끼워 넣는 우회를 막기 위해 글자 사이에 구분자를 허용하는 정규식으로 만든다.
const SEP = '[\\s._\\-*~!@#$%^&()0-9]*';
const PATTERNS = BANNED.map((w) => new RegExp(Array.from(w).map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(SEP), 'gi'));

export function filterProfanity(text: string): { text: string; flagged: boolean } {
  let flagged = false;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => {
      flagged = true;
      return '♥'.repeat(Math.min(Array.from(m).length, 4));
    });
  }
  return { text: out, flagged };
}

/** 메시지 정리: 제어문자 제거, 공백 정리, 길이 제한 */
export function sanitize(text: unknown, max: number): string | null {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return Array.from(t).slice(0, max).join('');
}

/** 사용자별 도배 방지: 짧은 시간 내 메시지 수 + 같은 내용 반복 + 위반 시 일시 음소거 */
export class SpamGuard {
  private hist = new Map<number, { times: number[]; last: string; repeats: number; mutedUntil: number }>();
  constructor(private max = 5, private windowMs = 8000, private muteMs = 15000) {}

  check(userId: number, text: string): { ok: true } | { ok: false; error: string } {
    const now = Date.now();
    const h = this.hist.get(userId) ?? { times: [], last: '', repeats: 0, mutedUntil: 0 };
    this.hist.set(userId, h);
    if (h.mutedUntil > now) {
      return { ok: false, error: `도배 방지를 위해 ${Math.ceil((h.mutedUntil - now) / 1000)}초 후에 다시 보낼 수 있어요.` };
    }
    h.times = h.times.filter((t) => now - t < this.windowMs);
    const norm = text.replace(/\s/g, '').toLowerCase();
    h.repeats = norm === h.last ? h.repeats + 1 : 0;
    h.last = norm;
    if (h.times.length >= this.max || h.repeats >= 2) {
      h.mutedUntil = now + this.muteMs;
      h.times = [];
      h.repeats = 0;
      return { ok: false, error: '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해 주세요.' };
    }
    h.times.push(now);
    return { ok: true };
  }
}

/** 간단한 고정 창 레이트 리미터 (로그인·신고·친구 신청 등) */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string) {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
