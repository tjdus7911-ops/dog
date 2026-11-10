// 멍글런너 '함께 달리기' — 실시간 멀티플레이 공용 규칙·데이터 형식 (서버와 화면이 같이 사용)
// 같은 곡·같은 장애물 패턴을 서버 기준 시작 시각에 맞춰 동시에 달리고, 판정은 싱글과 같은 judgeRun을 쓴다.
import type { DogAvatar } from './avatar';
import type { Grade, RunnerAction, RunnerDifficulty } from './runner';

/** 한 방 최대 인원 */
export const MR_MAX = 4;
/** 출발 카운트다운 (초) */
export const MR_COUNTDOWN_MS = 3000;
/** 시작 신호가 모든 기기에 닿을 여유 (카운트다운 앞에 붙음) */
export const MR_LEAD_MS = 900;
/** 순위 보상 (1~4위) — 하루 보상 횟수는 혼자 달리기와 합쳐서 3번 */
export const MR_REWARD = [100, 70, 50, 40] as const;
/** 정상 완주 기준: 끝까지 함께 있고, 장애물의 20% 이상을 통과 (자리만 지키는 보상 수집 방지) */
export const MR_MIN_PASS = 0.2;
/** 방 코드: 헷갈리는 글자(0·O·1·I) 없이 6자리 */
export const MR_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const isRoomCode = (v: unknown): v is string => typeof v === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(v);

/** 공개 범위 — 지금은 코드로만 참가(private). 공개방·빠른 매칭은 같은 구조에 'public'을 더해 확장 */
export type MRVisibility = 'private' | 'public';
export type MRState = 'lobby' | 'playing';

export interface MRPlayer {
  id: number;
  nickname: string;
  dogName: string;
  dogPhoto: string | null;
  dog: DogAvatar;
  ready: boolean;
  host: boolean;
  connected: boolean;
}
export interface MRRoom {
  code: string;
  visibility: MRVisibility;
  hostId: number;
  courseId: string;
  difficulty: RunnerDifficulty;
  state: MRState;
  /** 몇 번째 판인지 (같은 방에서 다시 할 때마다 +1) */
  round: number;
  /** 서버 시각(ms): 음악 0초가 되는 순간 */
  startAt: number | null;
  players: MRPlayer[];
}
/** 달리는 중 순위판 (서버가 입력 기록으로 계산) */
export interface MRStanding { id: number; score: number; combo: number; maxCombo: number; judged: number; connected: boolean; left: boolean }
export interface MRResult {
  id: number;
  nickname: string;
  dogName: string;
  /** 정상 완주자 순위 (1부터), 완주 못 하면 null */
  rank: number | null;
  score: number;
  accuracy: number;
  maxCombo: number;
  counts: Record<Grade, number>;
  completed: boolean;
  /** 완주로 인정되지 않은 이유 */
  reason: string | null;
  /** 받은 코인 (하루 보상 횟수를 다 쓴 경우 0) */
  coin: number;
}
export interface MRInputMsg { id: number; t: number; a: RunnerAction }
