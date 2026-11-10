// 모바일 화면 배치 기준값 (하단 내비게이션 → 조이스틱·액션 버튼 → 안내 버튼 순으로 쌓임)
export const NAV_H = 62;
/** 조이스틱 보이는 원 / 손잡이 / 터치 인식 영역 */
export const JOY_VISUAL = 110;
export const JOY_KNOB = 46;
export const JOY_TOUCH = 150;
/** 액션 버튼 (2×2) */
export const ACTION_SIZE = 54;
export const ACTION_GAP = 10;
const CTRL_GAP = 14;
/** 조이스틱·액션 버튼 아래쪽 위치 */
export const CTRL_BOTTOM = `calc(var(--safe-b) + ${NAV_H + CTRL_GAP}px)`;
/** 조이스틱·액션 버튼 위 (입구 안내·벤치 메뉴 등) */
export const ABOVE_CTRL = `calc(var(--safe-b) + ${NAV_H + CTRL_GAP + ACTION_SIZE * 2 + ACTION_GAP + 14}px)`;
/** 상단 두 줄(로고줄 + 장소줄) 아래 */
export const MOBILE_TOP_ROWS = 108;
