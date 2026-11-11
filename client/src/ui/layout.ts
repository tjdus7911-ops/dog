// 모바일 화면 배치 기준값 (하단 내비게이션 → 조이스틱·액션 버튼 → 안내 버튼 순으로 쌓임)
export const NAV_H = 62;
/** 조이스틱 보이는 원 / 손잡이 / 터치 인식 영역 */
export const JOY_VISUAL = 104;
export const JOY_KNOB = 44;
export const JOY_TOUCH = 150;
/** 액션 버튼 (인사·앉아 46px, 점프 52px) */
export const ACTION_SIZE = 52;
export const ACTION_SMALL = 46;
export const ACTION_GAP = 8;
/** 액션 버튼 묶음 높이 (접기 버튼 포함) */
export const ACTION_CLUSTER_H = 106;
const CTRL_GAP = 14;
/** 조이스틱·액션 버튼 아래쪽 위치 */
export const CTRL_BOTTOM = `calc(var(--safe-b) + ${NAV_H + CTRL_GAP}px)`;
/** 조이스틱·액션 버튼 위 (입구 안내·벤치 메뉴 등) */
export const ABOVE_CTRL = `calc(var(--safe-b) + ${NAV_H + CTRL_GAP + ACTION_CLUSTER_H + 14}px)`;
/** 두 번째 줄(위치 드롭다운) 위치 — 첫 줄 38px + 간격 */
export const PLACE_ROW_TOP = 56;
/** 상단 두 줄(로고줄 + 장소줄) 아래 */
export const MOBILE_TOP_ROWS = 100;

/** 실내 공간 상단의 작은 버튼 줄 위치 (모바일: 위치 드롭다운 아래 / PC: 첫 줄 아래) */
export const chipRowTop = (touch: boolean) => (touch ? `calc(var(--safe-t) + ${MOBILE_TOP_ROWS}px)` : '70px');
/** 실내 공간 상단의 작은 버튼 (승인 시안: 작고 단색, 36px) */
export const CHIP = 'hud rounded-full h-9 px-3 text-[13px] flex items-center gap-1.5 whitespace-nowrap pointer-events-auto';
