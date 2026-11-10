// 멍글 코인 — 보상 정책·거래 종류 (서버가 지급·차감을 모두 결정하고, 화면은 표시만 한다)
export type CoinKind = 'signup' | 'welcome' | 'attendance' | 'streak7' | 'walk' | 'runner' | 'meetup' | 'movein' | 'move';

/** 보상 정책: 금액 · 하루 최대 횟수 (0 = 제한 없음/1회성) */
export const COIN_REWARDS = {
  signup: { amount: 500, daily: 0, label: '신규 가입 선물' },
  welcome: { amount: 500, daily: 0, label: '코인 시스템 시작 선물 (입주비)' },
  attendance: { amount: 100, daily: 1, label: '출석 체크' },
  streak7: { amount: 300, daily: 1, label: '7일 연속 출석 보너스' },
  walk: { amount: 30, daily: 3, label: '산책 완료' },
  runner: { amount: 50, daily: 3, label: '멍글런너 완주' },
  meetup: { amount: 50, daily: 1, label: '동네 모임 참여' },
} as const;
export type EarnKind = keyof typeof COIN_REWARDS;

export const COIN_LABEL: Record<CoinKind, string> = {
  signup: '신규 가입 선물', welcome: '코인 시스템 시작 선물', attendance: '출석 체크', streak7: '7일 연속 출석 보너스',
  walk: '산책 완료', runner: '멍글런너 완주', meetup: '동네 모임 참여', movein: '멍글아파트 입주', move: '이사',
};
export const COIN_ICON: Record<CoinKind, string> = {
  signup: '🎁', welcome: '🎁', attendance: '📅', streak7: '🔥', walk: '🐾', runner: '🏃', meetup: '👥', movein: '🔑', move: '🚚',
};

/** 산책 완료 조건 (공원에서 실제로 걸은 거리·시간) */
export const WALK_GOAL = { meters: 150, seconds: 120 };
/** 동네 모임 참여 조건: 모임 공원에 함께 있었던 시간 */
export const MEETUP_GOAL_S = 300;

export interface CoinTx { id: number; amount: number; kind: CoinKind; memo: string; balance: number; ts: number }
export interface CoinStatus {
  balance: number;
  todayEarned: number;
  earned: CoinTx[];
  spent: CoinTx[];
  attendance: {
    claimedToday: boolean;
    /** 지금 이어지고 있는 연속 출석 일수 (오늘 아직 안 했으면 어제까지) */
    streak: number;
    /** 7일 달력: 이번 주기의 몇째 날까지 출석했는지 (0~7) */
    cycleDone: number;
    today: string;
  };
  /** 오늘 받은 횟수 / 하루 최대 */
  daily: Record<'walk' | 'runner' | 'meetup', { count: number; max: number }>;
}
/** 지급 알림 (서버 → 화면 애니메이션) */
export interface CoinEarned { amount: number; kind: CoinKind; label: string; balance: number }

/** 한국 시간 날짜 (YYYY-MM-DD): 자정에 날짜가 바뀜 */
export const kstDay = (ts: number) => new Date(ts + 9 * 3600_000).toISOString().slice(0, 10);
export const coinFmt = (n: number) => n.toLocaleString('ko-KR');
