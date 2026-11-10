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
  /** 멍글 아파트 동·호실 (가상 공간 정보, 미입주 시 null) */
  residence: Residence | null;
  /** 비회원 둘러보기 방문자 */
  guest?: boolean;
}

export interface Residence { building: string; unit: string }

export interface MyProfile extends PublicProfile {
  privacy: PrivacySettings;
  role: 'user' | 'admin' | 'guest';
}

export type FriendStatus = 'none' | 'outgoing' | 'incoming' | 'friends' | 'blocked';

/** 지금 있는 장소 (공원 / 아파트 로비 / 개인 집) */
export interface ParkInfo {
  id: string;
  name: string;
  count: number;
  capacity: number;
  kind: 'park' | 'lobby' | 'home' | 'cafe' | 'shop';
  icon: string;
  /** 개인 집이면 집주인 id */
  ownerId?: number;
}

/** 사람 애니메이션 상태 */
export const HumanAnim = { Idle: 0, Walk: 1, Run: 2, Wave: 3, Jump: 4, Sit: 5, Pet: 6, Scoop: 7, Toss: 8 } as const;
export const HUMAN_ANIM_MAX = 8;
/** 점프: 초기 속도(m/s)·중력 — 내 화면과 다른 사람 화면이 같은 궤적을 그리도록 공용 */
export const JUMP_VELOCITY = 4.4;
export const GRAVITY = 15;
/** 강아지 애니메이션 상태 */
export const DogAnim = { Stand: 0, Walk: 1, Run: 2, Sit: 3, Look: 4, Greet: 5, Lie: 6, Poop: 7 } as const;
export const DOG_ANIM_MAX = 7;

/** 산책 중 강아지 배변 (서버가 만들고 보호자만 치울 수 있음) */
export interface PoopInfo { id: string; ownerId: number; x: number; z: number }
/** 쓰다듬기 이벤트 (같은 공간 모두에게) */
export interface PetEvent { fromId: number; targetId: number; size: 'small' | 'medium' | 'large'; ts: number }
/** 배변·쓰다듬기 거리 기준 */
export const PET_REACH = 2.2;
export const POOP_REACH = 2.0;
export const BIN_REACH = 2.2;
/** 벤치 좌석 점유 현황: 좌석 id → 사용자 id */
export type SeatMap = Record<string, number>;

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
  kind: 'friend_request' | 'friend_accepted' | 'dm' | 'system';
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

// ---------- 강아지 프로필 (공개 범위에 따라 보이는 항목이 다름) ----------
export type DogProfileVisibility = 'all' | 'friends' | 'private';
export type PetPolicy = 'all' | 'friends' | 'none';
export const DOG_TRAITS = ['활발해요', '얌전해요', '사람을 좋아해요', '친구 강아지를 좋아해요', '낯을 가려요', '산책 최고', '간식 최고', '겁이 많아요', '장난꾸러기', '애교쟁이'] as const;
export const DOG_PHOTO_MAX = 8;
export interface DogProfileSettings {
  /** 나이(살), 0은 1살 미만, null은 비공개/모름 */
  age: number | null;
  gender: 'male' | 'female' | null;
  traits: string[];
  /** 사진첩 (/uploads/...) */
  photos: string[];
  visibility: DogProfileVisibility;
  allowPetting: PetPolicy;
}
export const DEFAULT_DOG_PROFILE: DogProfileSettings = { age: null, gender: null, traits: [], photos: [], visibility: 'all', allowPetting: 'all' };
export interface DogProfileView {
  ownerId: number;
  ownerNickname: string;
  name: string;
  breed: string;
  /** 대표 사진 + 사진첩 (보이는 범위 안에서) */
  photos: string[];
  coat: string;
  intro: string;
  age: number | null;
  gender: 'male' | 'female' | null;
  traits: string[];
  /** 공개 범위 때문에 숨겨진 항목이 있는지 */
  limited: boolean;
  canPet: boolean;
  friendStatus: FriendStatus;
  isMe: boolean;
  guest: boolean;
}
