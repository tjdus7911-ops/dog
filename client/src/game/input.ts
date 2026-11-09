// 키보드(WASD/방향키 + Shift) & 가상 조이스틱 입력
export const input = {
  keys: new Set<string>(),
  joy: { x: 0, y: 0, active: false },
  runToggle: false,
};

const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

let installed = false;
export function installKeyboard() {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (isTyping()) return;
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => input.keys.clear());
}

/** 이동 입력 벡터 (x: 오른쪽, y: 앞쪽), 달리기 여부 */
export function readMove(): { x: number; y: number; run: boolean } {
  const k = input.keys;
  let x = 0, y = 0;
  if (!isTyping()) {
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  } else k.clear();
  let run = k.has('ShiftLeft') || k.has('ShiftRight');
  if (input.joy.active) {
    x = input.joy.x; y = input.joy.y;
    // 조이스틱을 끝까지 밀거나 달리기 버튼이 켜져 있으면 달리기
    run = run || input.runToggle || Math.hypot(x, y) > 0.92;
  }
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x, y, run };
}

export const isTouchDevice = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
