import { create } from 'zustand';
import type { HomeView } from '@shared/home';
import type { ScreenSlide } from '@shared/screen';
import type { MeetupMessage } from '@shared/community';
import type {
  ChatMessage, DirectMessage, FriendEntry, FriendStatus, MyProfile, NotificationItem, ParkInfo, PublicProfile, SeatMap,
} from '@shared/protocol';

export type CommunityTab = 'meetups' | 'clubs' | 'posts';
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
  moreOpen: boolean;
  mapOpen: boolean;
  eventsOpen: boolean;
  /** 채팅을 닫아 둔 동안 새로 온 공원 채팅 수 */
  chatUnread: number;
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
  moreOpen: false,
  mapOpen: false,
  eventsOpen: false,
  chatUnread: 0,
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
