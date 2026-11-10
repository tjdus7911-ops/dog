// 기능 플래그 — 서비스 초기에 잠시 끄는 기능 (데이터·서버 로직은 그대로, 사용자에게 보이는 진입점만 숨김)
export const FEATURES = {
  /** 강아지 모임(클럽): 초기 서비스에서 제외. true로 바꾸면 메뉴·탭이 다시 나타남 */
  dogClubs: false,
} as const;
