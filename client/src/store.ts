import type { CoinStatus } from '@shared/coins';
import { create } from 'zustand';
import type { HomeView } from '@shared/home';
import type { ScreenSlide } from '@shared/screen';
import type { MeetupMessage } from '@shared/community';
import type {
  ChatMessage, DirectMessage, FriendEntry, FriendStatus, MyProfile, NotificationItem, ParkInfo, PoopInfo, PublicProfile, SeatMap,
} from '@shared/protocol';

/** 사진 크게 보기 (광장 스크린·액자·강아지 프로필 공통) */
export interface ViewerState {
  photos: string[];
  index: number;
  title?: string;
  caption?: string;
  /** '강아지 프로필 보기' 버튼 대상 */
  dogOwnerId?: number;
}

export type CommunityTab = 'meetups' | 'clubs' | 'posts';
/** 한 번에 하나만 열리는 메뉴: 장소 선택 · 내 메뉴(프로필) · 더보기 · 내 집 */
export type MenuId = 'place' | 'profile' | 'more' | 'home';
/** 멍글 동네 화면 상태: 탭 + 열어 본 모임/강아지 모임 */
export interface CommunityView { tab: CommunityTab; meetupId?: number; clubId?: number; compose?: boolean }

export type Panel = 'none' | 'friends' | 'avatar' | 'settings' | 'admin' | 'notifications';

interface Toast { id: number; text: string; tone: 'info' | 'error' }

interface State {
  me: MyProfile | null;
  onboarding: boolean;
  connection: 'offline' | 'connecting' | 'online' | 'kicked';
  kickReason: string | null;

  park: ParkInfo | null;
  parks: ParkInfo[];
  /** 같은 공원에 있는 다른 사용자 (렌더링 대상). 위치는 net/remote.ts 의 버퍼에 별도 보관 */
  players: Record<number, PublicProfile>;

  chat: ChatMessage[];
  bubbles: Record<number, { text: string; ts: number }>;

  friends: FriendEntry[];
  incoming: { profile: PublicProfile; ts: number }[];
  outgoing: PublicProfile[];
  blocked: PublicProfile[];

  notifications: (NotificationItem & { read: boolean })[];
  dmWith: PublicProfile | null;
  dms: Record<number, DirectMessage[]>;

  panel: Panel;
  profilePopup: { profile: PublicProfile; status: FriendStatus } | null;
  reportTarget: PublicProfile | null;
  toasts: Toast[];
  chatOpen: boolean;

  /** 벤치 좌석 점유 현황 (서버) / 열린 벤치 메뉴 / 내가 앉은 좌석 */
  seats: SeatMap;
  benchMenu: number | null;
  seated: string | null;
  /** 개인 집에 있을 때 그 집 정보 (가구·집주인) */
  home: HomeView | null;
  /** 집 꾸미기 편집 화면 열림 */
  homeEdit: boolean;
  /** 로비 호실 안내판 패널 열림 */
  lobbyPanel: boolean;
  /** 집 정보 패널 열림 */
  homePanel: boolean;
  /** 방문·이웃 신청 갱신 신호 / 광장 스크린 갱신 신호 */
  visitRequestsVersion: number;
  screenVersion: number;
  /** 사진 촬영 모드 (UI 숨김) */
  photoMode: boolean;
  /** 광장 스크린: 상세 보기 / 올리기 신청 화면 */
  screenDetail: ScreenSlide | 'empty' | null;
  screenSubmit: { photo?: string } | null;
  /** 입주 화면을 이번 접속에서 '나중에 하기'로 넘겼는지 */
  moveInLater: boolean;
  /** 멍글 동네(커뮤니티) 화면 — 열려 있으면 조이스틱·액션 버튼을 숨기고 이동 입력을 잠금 */
  community: CommunityView | null;
  communityVersion: number;
  /** 열려 있는 모임 채팅에 실시간으로 들어온 메시지 */
  meetupLive: { meetupId: number; message: MeetupMessage }[];
  /** 곧 시작하는 모임 안내 */
  meetupAlert: { meetupId: number; title: string; kind: string; park: string | null; place: string } | null;
  /** 애견샵 카운터 패널 */
  shopOpen: boolean;
  /** 모바일 하단 '더보기' 메뉴 / 마을 지도 / 이벤트(동네 일정) 창 */
  /** 지금 열린 메뉴 하나 (장소 선택·내 메뉴·더보기·내 집) — 한 번에 하나만 (ui/menus.ts) */
  activeMenu: MenuId | null;
  mapOpen: boolean;
  eventsOpen: boolean;
  /** 채팅을 닫아 둔 동안 새로 온 공원 채팅 수 */
  chatUnread: number;
  /** 지금 공간의 배변 (서버) / 배변봉투를 든 사용자 */
  poops: Record<string, PoopInfo>;
  bags: Record<number, true>;
  /** 다른 강아지를 눌렀을 때 메뉴 (그 강아지 보호자 id) */
  dogMenu: number | null;
  /** 강아지 프로필 시트 (보호자 id) / 내 강아지 프로필 편집 */
  dogSheet: number | null;
  dogEdit: boolean;
  /** 사진 크게 보기 */
  viewer: ViewerState | null;
  /** 둘러보기 방문자가 주민 전용 기능을 눌렀을 때 가입 안내 */
  joinPrompt: boolean;
  /** 친구 집 놀러 가기: 로비에 도착하면 이 집 문 앞 안내를 바로 띄움 */
  lobbyFocus: number | null;
  /** 멍글런너 화면 (로비·게임·결과) 열림 / 랭킹 갱신 신호 */
  runner: boolean;
  /** 멍글런너를 열면서 랭킹 창부터 보여 줄지 (광장 스크린에서 누름) */
  runnerRank: boolean;
  /** 친구가 보낸 함께 달리기 초대 / 멍글런너를 열면서 바로 참가할 방 코드 */
  runnerInvite: { code: string; nickname: string; dogName: string } | null;
  runnerJoin: string | null;
  runnerVersion: number;
  /** 멍글 코인: 지갑 상태 / 열린 창 (출석·지갑) / 획득 애니메이션 / 이사 선택 화면 */
  coins: CoinStatus | null;
  wallet: 'attendance' | 'wallet' | null;
  coinFx: { id: number; amount: number; label: string }[];
  moveOpen: boolean;
  /** 집 가구: 쓰고 있는 가구·동작 / 강아지 혼자 쉬는 가구 / 열린 가구 메뉴 */
  furnUse: { key: string; action: 'sit' | 'lie' | 'sleep' } | null;
  dogTaskKey: string | null;
  furnMenu: string | null;
}

export const useStore = create<State>()(() => ({
  me: null,
  onboarding: false,
  connection: 'offline',
  kickReason: null,
  park: null,
  parks: [],
  players: {},
  chat: [],
  bubbles: {},
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
  notifications: [],
  dmWith: null,
  dms: {},
  panel: 'none',
  profilePopup: null,
  reportTarget: null,
  toasts: [],
  // 모바일은 채팅을 닫은 상태로 시작 (조이스틱·액션 버튼 우선)
  chatOpen: typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches,
  seats: {},
  benchMenu: null,
  seated: null,
  home: null,
  homeEdit: false,
  lobbyPanel: false,
  homePanel: false,
  visitRequestsVersion: 0,
  screenVersion: 0,
  photoMode: false,
  screenDetail: null,
  screenSubmit: null,
  moveInLater: false,
  community: null,
  communityVersion: 0,
  meetupLive: [],
  meetupAlert: null,
  shopOpen: false,
  activeMenu: null,
  mapOpen: false,
  eventsOpen: false,
  chatUnread: 0,
  poops: {},
  bags: {},
  dogMenu: null,
  dogSheet: null,
  dogEdit: false,
  viewer: null,
  joinPrompt: false,
  lobbyFocus: null,
  runner: false,
  coins: null,
  wallet: null,
  coinFx: [],
  moveOpen: false,
  runnerRank: false,
  runnerInvite: null,
  runnerJoin: null,
  runnerVersion: 0,
  furnUse: null,
  dogTaskKey: null,
  furnMenu: null,
}));

export const set = useStore.setState;
export const get = useStore.getState;

let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
}

export function notify(n: NotificationItem) {
  set((s) => ({ notifications: [{ ...n, read: false }, ...s.notifications].slice(0, 40) }));
}
