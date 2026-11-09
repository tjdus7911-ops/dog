// 원격 플레이어 스냅샷 버퍼 & 보간 (React 상태 밖에서 매 프레임 접근)
import type { NetState } from '@shared/protocol';

/** 렌더 지연: 네트워크 틱(100ms)보다 약간 크게 잡아 두 스냅샷 사이를 보간 */
export const INTERP_DELAY = 140;
const MAX_EXTRAPOLATE = 250;

interface Snap { t: number; s: NetState }

export const buffers = new Map<number, Snap[]>();
/** 각 원격 플레이어가 화면에 실제로 그려진 위치 (미니맵·말풍선 거리·강아지 인사 판정에 사용) */
export const rendered = new Map<number, { x: number; z: number; dx: number; dz: number; danim: number }>();

export function pushSnapshot(id: number, s: NetState, t = performance.now()) {
  let b = buffers.get(id);
  if (!b) { b = []; buffers.set(id, b); }
  b.push({ t, s });
  if (b.length > 30) b.splice(0, b.length - 30);
}

export function removeRemote(id: number) {
  buffers.delete(id);
  rendered.delete(id);
}

export function clearRemotes() {
  buffers.clear();
  rendered.clear();
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** 보간된 상태 반환. 다음 스냅샷이 늦으면 짧게 외삽한 뒤 멈춘다(순간이동 방지). */
export function sample(id: number, now = performance.now()): NetState | null {
  const b = buffers.get(id);
  if (!b || b.length === 0) return null;
  const rt = now - INTERP_DELAY;
  if (b.length === 1 || rt <= b[0].t) return b[0].s;
  for (let i = b.length - 1; i > 0; i--) {
    const a = b[i - 1], c = b[i];
    if (rt >= a.t && rt <= c.t) {
      const k = (rt - a.t) / Math.max(1, c.t - a.t);
      return interp(a.s, c.s, k);
    }
  }
  // 최신 스냅샷 이후: 직전 속도로 짧게 외삽
  const last = b[b.length - 1];
  const prev = b[b.length - 2];
  const over = Math.min(rt - last.t, MAX_EXTRAPOLATE);
  const span = Math.max(1, last.t - prev.t);
  const k = 1 + over / span;
  // 이동 중이 아니면 외삽하지 않음
  if (last.s[3] === 0 && last.s[7] !== 1 && last.s[7] !== 2) return last.s;
  return interp(prev.s, last.s, Math.min(k, 1.6));
}

function interp(a: NetState, b: NetState, k: number): NetState {
  return [
    lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerpAngle(a[2], b[2], Math.min(k, 1)), k < 0.5 ? a[3] : b[3],
    lerp(a[4], b[4], k), lerp(a[5], b[5], k), lerpAngle(a[6], b[6], Math.min(k, 1)), k < 0.5 ? a[7] : b[7],
  ];
}
