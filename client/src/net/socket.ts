// 서버 실시간 연결 & 이벤트 → 스토어 반영
import { io, type Socket } from 'socket.io-client';
import { get, notify, set, toast } from '../store';
import { tokenStore } from '../lib/api';
import { clearRemotes, pushSnapshot, removeRemote } from './remote';
import { local } from '../game/local';
import type {
  ChatMessage, DirectMessage, FriendEntry, FriendStatus, NetState, ParkInfo, PlayerSnapshot, PublicProfile,
} from '@shared/protocol';

let socket: Socket | null = null;

type AckRes<T> = ({ ok: true } & T) | { ok: false; error: string };

export function request<T = {}>(ev: string, data?: unknown): Promise<AckRes<T>> {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: '서버와 연결되어 있지 않아요.' });
    socket.timeout(8000).emit(ev, data, (err: unknown, res: AckRes<T>) => {
      resolve(err ? { ok: false, error: '서버 응답이 없어요. 잠시 후 다시 시도해 주세요.' } : res);
    });
  });
}

export function sendState(s: NetState) {
  socket?.volatile.emit('state', s);
}

export function connect() {
  disconnect();
  const token = tokenStore.get();
  if (!token) return;
  set({ connection: 'connecting', kickReason: null });
  const s = io({ auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
  socket = s;

  s.on('connect', async () => {
    set({ connection: 'online' });
    const prevPark = get().park?.id;
    await refreshFriends();
    await refreshBlocked();
    await joinPark(prevPark);
  });
  s.on('disconnect', () => {
    if (get().connection !== 'kicked') set({ connection: 'connecting' });
    set({ players: {} });
    clearRemotes();
  });
  s.on('connect_error', (e) => {
    if (e.message === 'unauthorized' || e.message === 'banned') {
      s.disconnect();
      set({ connection: 'kicked', kickReason: e.message === 'banned' ? '이용이 정지된 계정이에요.' : '로그인이 만료되었어요. 다시 로그인해 주세요.' });
    }
  });
  s.on('kicked', ({ reason }: { reason: string }) => {
    set({ connection: 'kicked', kickReason: reason, players: {}, park: null });
    clearRemotes();
  });

  // ---------- 공원 ----------
  s.on('players:join', ({ profile, state }: PlayerSnapshot) => {
    pushSnapshot(profile.id, state);
    set((st) => ({ players: { ...st.players, [profile.id]: profile } }));
  });
  s.on('players:leave', ({ id }: { id: number }) => {
    removeRemote(id);
    set((st) => {
      const players = { ...st.players };
      delete players[id];
      return { players };
    });
  });
  s.on('states', (map: Record<string, NetState>) => {
    const now = performance.now();
    const me = get().me?.id;
    for (const k in map) {
      const id = Number(k);
      if (id !== me && get().players[id]) pushSnapshot(id, map[k], now);
    }
  });
  s.on('correct', (st: NetState) => { local.teleport = st; });
  s.on('park:count', (p: ParkInfo) => {
    set((st) => ({
      parks: st.parks.some((x) => x.id === p.id) ? st.parks.map((x) => (x.id === p.id ? p : x)) : [...st.parks, p],
      park: st.park?.id === p.id ? p : st.park,
    }));
  });
  s.on('profile:update', (p: PublicProfile) => {
    set((st) => (st.players[p.id] ? { players: { ...st.players, [p.id]: p } } : {}));
  });

  // ---------- 채팅 ----------
  s.on('chat', (m: ChatMessage) => {
    set((st) => ({ chat: [...st.chat.slice(-99), m], bubbles: { ...st.bubbles, [m.from]: { text: m.text, ts: Date.now() } } }));
  });

  // ---------- 친구 ----------
  s.on('friend:event', ({ kind, from, ts }: { kind: string; from: PublicProfile; ts: number }) => {
    if (kind === 'request') {
      notify({ id: `fr-${from.id}-${ts}`, kind: 'friend_request', fromId: from.id, fromNickname: from.nickname, text: `${from.nickname}님이 친구 신청을 보냈어요.`, ts });
      toast(`💌 ${from.nickname}님의 친구 신청`);
    } else if (kind === 'accepted') {
      notify({ id: `fa-${from.id}-${ts}`, kind: 'friend_accepted', fromId: from.id, fromNickname: from.nickname, text: `${from.nickname}님과 친구가 되었어요!`, ts });
      toast(`🐾 ${from.nickname}님과 친구가 되었어요`);
    }
    refreshFriends();
    syncPopupStatus(from.id);
  });
  s.on('presence', (p: { userId: number; online: boolean | null; parkId: string | null; parkName: string | null }) => {
    set((st) => ({ friends: st.friends.map((f) => (f.profile.id === p.userId ? { ...f, online: p.online, parkId: p.parkId, parkName: p.parkName } : f)) }));
  });
  s.on('dm', (m: DirectMessage & { fromNickname: string }) => {
    const st = get();
    const viewing = st.dmWith?.id === m.from;
    set((x) => ({ dms: { ...x.dms, [m.from]: [...(x.dms[m.from] ?? []), m] } }));
    if (viewing) {
      request('dm:read', { with: m.from });
    } else {
      set((x) => ({ friends: x.friends.map((f) => (f.profile.id === m.from ? { ...f, unread: f.unread + 1 } : f)) }));
      notify({ id: `dm-${m.id}`, kind: 'dm', fromId: m.from, fromNickname: m.fromNickname, text: m.text, ts: m.ts });
      toast(`💬 ${m.fromNickname}: ${m.text.slice(0, 30)}`);
    }
  });
}

export function disconnect() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  clearRemotes();
  set({ connection: 'offline', players: {}, park: null });
}

// ---------- 동작 ----------
export async function joinPark(parkId?: string) {
  const res = await request<{ park: ParkInfo; spawn: NetState; players: PlayerSnapshot[] }>('park:join', parkId ? { parkId } : undefined);
  if (!res.ok) {
    toast(res.error, 'error');
    if (!get().park) {
      // 지정 공원 입장 실패 시 자동 배정 재시도
      if (parkId) return joinPark();
    }
    return false;
  }
  clearRemotes();
  const players: Record<number, PublicProfile> = {};
  for (const p of res.players) { players[p.profile.id] = p.profile; pushSnapshot(p.profile.id, p.state); }
  local.teleport = res.spawn;
  set({ park: res.park, players, chat: [], bubbles: {} });
  const list = await request<{ parks: ParkInfo[] }>('park:list');
  if (list.ok) set({ parks: list.parks });
  return true;
}

export async function sendChat(text: string) {
  const res = await request('chat:public', text);
  if (!res.ok) toast(res.error, 'error');
  return res.ok;
}

export async function refreshFriends() {
  const res = await request<{ friends: FriendEntry[]; incoming: { profile: PublicProfile; ts: number }[]; outgoing: PublicProfile[] }>('friend:list');
  if (res.ok) set({ friends: res.friends, incoming: res.incoming, outgoing: res.outgoing });
}

export async function refreshBlocked() {
  const res = await request<{ users: PublicProfile[] }>('block:list');
  if (res.ok) set({ blocked: res.users });
}

export async function openProfile(userId: number) {
  const res = await request<{ profile: PublicProfile; status: FriendStatus }>('profile:get', { userId });
  if (res.ok) set({ profilePopup: { profile: res.profile, status: res.status } });
  else toast(res.error, 'error');
}

async function syncPopupStatus(userId: number) {
  if (get().profilePopup?.profile.id !== userId) return;
  const res = await request<{ profile: PublicProfile; status: FriendStatus }>('profile:get', { userId });
  if (res.ok) set({ profilePopup: { profile: res.profile, status: res.status } });
}

/** 친구 관련 동작 공통 처리 */
export async function friendAction(ev: 'friend:request' | 'friend:cancel' | 'friend:accept' | 'friend:decline' | 'friend:remove' | 'block' | 'unblock', userId: number) {
  const res = await request<{ status: FriendStatus }>(ev, { userId });
  if (!res.ok) { toast(res.error, 'error'); return null; }
  const pop = get().profilePopup;
  if (pop?.profile.id === userId) set({ profilePopup: { ...pop, status: res.status } });
  if (ev === 'block' || ev === 'unblock') await refreshBlocked();
  await refreshFriends();
  return res.status;
}

export async function openDm(profile: PublicProfile) {
  set({ dmWith: profile, profilePopup: null });
  const res = await request<{ messages: DirectMessage[] }>('dm:history', { with: profile.id });
  if (res.ok) {
    set((s) => ({ dms: { ...s.dms, [profile.id]: res.messages }, friends: s.friends.map((f) => (f.profile.id === profile.id ? { ...f, unread: 0 } : f)) }));
  } else toast(res.error, 'error');
}

export async function sendDm(to: number, text: string) {
  const res = await request<{ message: DirectMessage }>('dm:send', { to, text });
  if (!res.ok) { toast(res.error, 'error'); return false; }
  set((s) => ({ dms: { ...s.dms, [to]: [...(s.dms[to] ?? []), res.message] } }));
  return true;
}

export async function goToFriend(userId: number) {
  const res = await request<{ parkId: string; parkName: string }>('friend:locate', { userId });
  if (!res.ok) { toast(res.error, 'error'); return; }
  if (get().park?.id === res.parkId) { toast(`이미 ${res.parkName}에 함께 있어요!`); return; }
  if (await joinPark(res.parkId)) toast(`${res.parkName}(으)로 이동했어요 🐾`);
}

export async function report(userId: number, reason: string, detail: string) {
  const res = await request('report', { userId, reason, detail });
  if (res.ok) toast('신고가 접수되었어요. 운영팀이 확인할게요.');
  else toast(res.error, 'error');
  return res.ok;
}
