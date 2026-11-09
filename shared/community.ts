// 멍글 동네 (커뮤니티) — 강아지 자랑 · 산책 모임 · 강아지 모임 공용 타입과 선택지
// 위치는 사용자가 고른 '동네' 단위로만 다룬다 (정확한 주소·실시간 위치는 받지 않음).

export const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'] as const;
export const ONLINE_REGION = '온라인';

export interface AuthorSummary {
  id: number;
  nickname: string;
  dogName: string;
  dogPhoto: string | null;
  dogCoat: string;
  residence: { building: string; unit: string } | null;
}

export interface PostView {
  id: number;
  author: AuthorSummary;
  text: string;
  image: string | null;
  ts: number;
  likes: number;
  likedByMe: boolean;
  savedByMe: boolean;
  comments: number;
  clubId: number | null;
  /** 광장 스크린 공개 동의 여부 / 스크린 상태 */
  screen: 'none' | 'pending' | 'approved' | 'rejected' | 'hidden';
  canDelete: boolean;
}

export interface CommentView {
  id: number;
  author: AuthorSummary;
  text: string;
  ts: number;
  canDelete: boolean;
}

export const POST_MAX_LEN = 500;
export const COMMENT_MAX_LEN = 200;

// ---------- 산책 모임 ----------
export type MeetupKind = 'offline' | 'online';
export const SIZE_RULES = [
  { id: 'any', label: '크기 상관없음' },
  { id: 'small', label: '소형견만' },
  { id: 'medium', label: '중형견만' },
  { id: 'large', label: '대형견만' },
] as const;
export const TEMPER_RULES = [
  { id: 'any', label: '성향 상관없음' },
  { id: 'calm', label: '얌전한 친구' },
  { id: 'active', label: '활발한 친구' },
  { id: 'social', label: '사교성 좋은 친구' },
  { id: 'shy', label: '낯가리는 친구도 환영' },
] as const;

export type MemberStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface MeetupView {
  id: number;
  host: AuthorSummary;
  title: string;
  intro: string;
  kind: MeetupKind;
  region: string;
  place: string;
  /** 온라인 모임이 열리는 멍글마을 공원 id */
  park: string | null;
  startsAt: number;
  capacity: number;
  sizeRule: string;
  temperRule: string;
  approval: 'auto' | 'manual';
  status: 'open' | 'cancelled';
  approvedCount: number;
  pendingCount: number;
  myStatus: MemberStatus;
  isHost: boolean;
  ended: boolean;
  reviewCount: number;
  avgRating: number | null;
}

export interface MeetupDetail extends MeetupView {
  members: { user: AuthorSummary; status: MemberStatus; isHost: boolean }[];
  reviews: { user: AuthorSummary; rating: number; text: string; ts: number }[];
  myReview: boolean;
}

export interface MeetupMessage { id: number; user: AuthorSummary; text: string; ts: number }

// ---------- 강아지 모임 ----------
export const CLUB_CATEGORIES = [
  { id: 'breed', label: '견종별' },
  { id: 'size', label: '크기별' },
  { id: 'mix', label: '믹스견' },
  { id: 'region', label: '지역별' },
  { id: 'free', label: '자유 주제' },
] as const;
export type ClubCategory = (typeof CLUB_CATEGORIES)[number]['id'];

export interface ClubView {
  id: number;
  name: string;
  category: ClubCategory;
  intro: string;
  official: boolean;
  memberCount: number;
  postCount: number;
  isMember: boolean;
  isOwner: boolean;
}
export interface ClubDetail extends ClubView {
  members: { user: AuthorSummary; role: 'owner' | 'member' }[];
}
