// 키보드(WASD/방향키 + Shift) & 가상 조이스틱 입력
export const input = {
  keys: new Set<string>(),
  joy: { x: 0, y: 0, active: false },
  runToggle: false,
  /** 점프 요청 (스페이스 키 / 점프 버튼) — 다음 프레임에 처리 */
  jump: false,
  /** 이동 입력 잠금 — 모바일에서 채팅창이 열려 있는 동안 (채팅 열림 상태 하나로 UI·입력을 함께 제어) */
  locked: false,
};

/** 이동 입력 잠금 설정: 잠글 때 진행 중인 조이스틱·키 입력도 함께 해제 */
const lockReasons = new Set<string>();
export function setMoveLocked(locked: boolean, reason = 'chat') {
  if (locked) lockReasons.add(reason); else lockReasons.delete(reason);
  input.locked = lockReasons.size > 0;
  if (locked) {
    input.joy.x = 0; input.joy.y = 0; input.joy.active = false;
    input.keys.clear();
    input.jump = false;
  }
}

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
    if (e.code === 'Space') {
      e.preventDefault(); // 페이지 스크롤·버튼 눌림 방지
      if (!e.repeat) input.jump = true;
    }
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => input.keys.clear());
}

/** 이동 입력 벡터 (x: 오른쪽, y: 앞쪽), 달리기 여부 */
export function readMove(): { x: number; y: number; run: boolean } {
  if (input.locked) return { x: 0, y: 0, run: false };
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
