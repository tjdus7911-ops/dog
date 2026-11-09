import { create } from 'zustand';
import type {
  ChatMessage, DirectMessage, FriendEntry, FriendStatus, MyProfile, NotificationItem, ParkInfo, PublicProfile,
} from '@shared/protocol';

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
  chatOpen: true,
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
