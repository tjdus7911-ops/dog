// 클라이언트 ↔ 서버 실시간 프로토콜 정의
import type { DogAvatar, HumanAvatar } from './avatar';

export interface PrivacySettings {
  /** 친구에게 접속 상태 공개 */
  showOnline: boolean;
  /** 친구에게 현재 공원 위치 공개 (친구 위치로 이동 허용) */
  showLocation: boolean;
  /** 친구 신청 받기 */
  allowFriendRequests: boolean;
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  showOnline: true,
  showLocation: true,
  allowFriendRequests: true,
};

/** 다른 사용자에게 공개되는 정보만 담는다. (로그인 ID·내부 정보는 포함하지 않음) */
export interface PublicProfile {
  id: number;
  nickname: string;
  dogName: string;
  dogIntro: string;
  dogPhoto: string | null;
  human: HumanAvatar;
  dog: DogAvatar;
}

export interface MyProfile extends PublicProfile {
  privacy: PrivacySettings;
  role: 'user' | 'admin';
}

export type FriendStatus = 'none' | 'outgoing' | 'incoming' | 'friends' | 'blocked';

export interface ParkInfo {
  id: string;
  name: string;
  count: number;
  capacity: number;
}

/** 사람 애니메이션 상태 */
export const HumanAnim = { Idle: 0, Walk: 1, Run: 2, Wave: 3, Jump: 4 } as const;
/** 점프: 초기 속도(m/s)·중력 — 내 화면과 다른 사람 화면이 같은 궤적을 그리도록 공용 */
export const JUMP_VELOCITY = 4.4;
export const GRAVITY = 15;
/** 강아지 애니메이션 상태 */
export const DogAnim = { Stand: 0, Walk: 1, Run: 2, Sit: 3, Look: 4, Greet: 5 } as const;

/**
 * 위치 패킷 (배열로 전송해 대역폭 절약)
 * [x, z, rotY, humanAnim, dogX, dogZ, dogRotY, dogAnim]
 */
export type NetState = [number, number, number, number, number, number, number, number];

export interface PlayerSnapshot {
  profile: PublicProfile;
  state: NetState;
}

export interface ChatMessage {
  id: string;
  from: number;
  nickname: string;
  text: string;
  ts: number;
}

export interface DirectMessage {
  id: number;
  from: number;
  to: number;
  text: string;
  ts: number;
  read: boolean;
}

export interface FriendEntry {
  profile: PublicProfile;
  /** 친구가 공개를 허용한 경우에만 값이 있음 */
  online: boolean | null;
  parkId: string | null;
  parkName: string | null;
  unread: number;
}

export interface NotificationItem {
  id: string;
  kind: 'friend_request' | 'friend_accepted' | 'dm';
  fromId: number;
  fromNickname: string;
  text: string;
  ts: number;
}

export type Ack<T = {}> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export const PARKS: { id: string; name: string }[] = [
  { id: 'central-1', name: '중앙 공원 1' },
  { id: 'central-2', name: '중앙 공원 2' },
  { id: 'central-3', name: '중앙 공원 3' },
];

export const NET_TICK_MS = 100;
export const WALK_SPEED = 2.4;
export const RUN_SPEED = 4.8;
export const CHAT_MAX_LEN = 120;
export const BUBBLE_RANGE = 16;
