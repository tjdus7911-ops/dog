// 서버 실시간 연결 & 이벤트 → 스토어 반영
import { io, type Socket } from 'socket.io-client';
import { get, notify, set, toast } from '../store';
import { membersOnly, tokenStore } from '../lib/api';
import { clearRemotes, pushSnapshot, removeRemote, rendered } from './remote';
import { local } from '../game/local';
import { DEMO } from '../demo';
import { api } from '../lib/api';
import { setSpace } from '../game/space';
import { cam } from '../game/CameraRig';
import { PLACES, SPAWNS, homeSpaceId } from '@shared/spaces';
import { APARTMENT_ENTRANCE, BIN_BY_ID, CAFE_ENTRANCE, SHOP_ENTRANCE } from '@shared/world';
import { ACTION_MS, PET_LOW, binOpenAt, petLow, playPet } from '../game/fx';
import { onLayoutChanged, resetFurniture } from '../game/furniture';
import { DOG_SCALE } from '../game/models/Dog';
import type { MeetupMessage } from '@shared/community';
import type { HomeView } from '@shared/home';
import type {
  ChatMessage, DirectMessage, FriendEntry, FriendStatus, NetState, ParkInfo, PetEvent, PlayerSnapshot, PoopInfo, PublicProfile, SeatMap,
} from '@shared/protocol';
import { HumanAnim } from '@shared/protocol';

membersOnly.open = () => set({ joinPrompt: true });

let socket: Socket | null = null;

type AckRes<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

export function request<T = {}>(ev: string, data?: unknown): Promise<AckRes<T>> {
  return new Promise((resolve) => {
    if (!socket?.connected) return resolve({ ok: false, error: '서버와 연결되어 있지 않아요.' });
    socket.timeout(8000).emit(ev, data, (err: unknown, res: AckRes<T>) => {
      // 둘러보기 방문자가 주민 전용 기능을 누르면 가입 안내
      if (!err && !res.ok && res.code === 'members_only') membersOnly.open();
      resolve(err ? { ok: false, error: '서버 응답이 없어요. 잠시 후 다시 시도해 주세요.' } : res);
    });
  });
}

export function sendState(s: NetState) {
  socket?.volatile.emit('state', s);
}

export function connect() {
  if (DEMO) {
    // 미리보기: 서버 연결 없이 혼자 산책
    set({ connection: 'online', parks: PLACES.map((p) => ({ ...p, count: p.kind === 'park' && p.id === 'central-1' ? 1 : 0, capacity: 1 })), players: {} });
    void joinPark('central-1');
    startDemoPoop();
    return;
  }
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
    // 재접속: 있던 장소로 돌아가되, 들어갈 수 없게 됐으면(집 공개 범위 변경 등) 공원으로
    if (!(await joinPark(prevPark, undefined, true))) await joinPark();
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
  s.on('space:kicked', ({ reason }: { reason: string }) => { toast(reason); void joinPark('lobby-1'); });
  s.on('home:updated', ({ ownerId }: { ownerId: number }) => { if (get().park?.ownerId === ownerId) void loadHome(ownerId); });
  s.on('visit:request', (v: { fromId: number; nickname: string; dogName: string }) => {
    notify({ id: `visit-${v.fromId}-${Date.now()}`, kind: 'system', fromId: v.fromId, fromNickname: v.nickname, text: `${v.nickname}님이 우리 집 방문을 신청했어요. 집 정보에서 승인할 수 있어요.`, ts: Date.now() });
    toast(`🏠 ${v.nickname}님이 우리 집 방문을 신청했어요`);
    set((x) => ({ visitRequestsVersion: x.visitRequestsVersion + 1 }));
  });
  s.on('visit:decided', (v: { homeId: number; nickname: string; approve: boolean }) => {
    toast(v.approve ? `✅ ${v.nickname}님이 방문을 승인했어요! 로비에서 입장할 수 있어요` : `${v.nickname}님이 이번 방문 신청을 거절했어요`);
  });
  s.on('neighbor:update', (v: { kind: 'request' | 'accepted'; nickname: string }) => {
    toast(v.kind === 'request' ? `🏘️ ${v.nickname}님이 이웃 신청을 보냈어요` : `🏘️ ${v.nickname}님과 이웃이 되었어요`);
    set((x) => ({ visitRequestsVersion: x.visitRequestsVersion + 1 }));
  });
  s.on('runner:updated', () => set((x) => ({ runnerVersion: x.runnerVersion + 1 })));
  s.on('screen:updated', () => set((x) => ({ screenVersion: x.screenVersion + 1 })));
  s.on('screen:decided', (v: { title: string; approved: boolean }) => toast(v.approved ? `📺 '${v.title}'이(가) 광장 스크린에 올라갔어요!` : `'${v.title}' 스크린 신청이 반려되었어요`));
  // ---------- 멍글 동네 ----------
  s.on('community:notice', (v: { text: string }) => {
    notify({ id: `cm-${Date.now()}-${Math.random()}`, kind: 'system', fromId: 0, fromNickname: '멍글 동네', text: v.text, ts: Date.now() });
    toast(`🏘️ ${v.text}`);
    set((x) => ({ communityVersion: x.communityVersion + 1 }));
  });
  s.on('meetup:message', (v: { meetupId: number; title: string; message: MeetupMessage }) => {
    const c = get().community;
    if (c?.tab === 'meetups' && c.meetupId === v.meetupId) set((x) => ({ meetupLive: [...x.meetupLive, { meetupId: v.meetupId, message: v.message }] }));
    else toast(`💬 [${v.title}] ${v.message.user.nickname}: ${v.message.text.slice(0, 24)}`);
  });
  s.on('meetup:starting', (v: { meetupId: number; title: string; kind: string; park: string | null; place: string }) => {
    notify({ id: `ms-${v.meetupId}`, kind: 'system', fromId: 0, fromNickname: '멍글 동네', text: `'${v.title}' 모임이 곧 시작해요! (${v.place})`, ts: Date.now() });
    set({ meetupAlert: v });
  });
  // ---------- 쓰다듬기 · 배변 · 배변봉투 · 휴지통 ----------
  s.on('pet', (e: PetEvent) => { if (e.fromId !== get().me?.id) onPet(e); });
  s.on('poop:begin', (v: PoopInfo) => {
    if (v.ownerId !== get().me?.id) return;
    local.poopStart = performance.now();
    toast(`💩 ${get().me?.dogName ?? '강아지'}가 볼일을 보고 있어요. 다 보면 치워 주세요!`);
  });
  s.on('poop:add', (v: PoopInfo) => set((st) => ({ poops: { ...st.poops, [v.id]: v } })));
  s.on('poop:remove', ({ id }: { id: string }) => set((st) => { const poops = { ...st.poops }; delete poops[id]; return { poops }; }));
  s.on('bag', ({ userId, holding }: { userId: number; holding: boolean }) => {
    if (userId === get().me?.id) local.bag = holding;
    set((st) => { const bags = { ...st.bags }; if (holding) bags[userId] = true; else delete bags[userId]; return { bags }; });
  });
  s.on('bin', ({ binId }: { binId: string }) => binOpenAt.set(binId, performance.now()));
  s.on('seats', (seats: SeatMap) => {
    set({ seats });
    // 서버에서 내 자리가 해제됐다면(멀리 이동 등) 로컬 상태도 정리
    const me = get().me?.id;
    if (local.seated && seats[local.seated] !== me) { local.seated = null; set({ seated: null }); }
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
    set((st) => ({
      chat: [...st.chat.slice(-99), m], bubbles: { ...st.bubbles, [m.from]: { text: m.text, ts: Date.now() } },
      chatUnread: !st.chatOpen && m.from !== st.me?.id ? st.chatUnread + 1 : st.chatUnread,
    }));
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
/**
 * 장소 이동 (공원 / 아파트 로비 / 개인 집). 서버가 권한·정원을 확인하고, 한 사람은 한 장소에만 있게 한다.
 * @param from 'lobby' 이면 공원의 아파트 입구 앞에서 시작
 */
let joining = false;
export type DoorFrom = 'lobby' | 'cafe' | 'shop';
export async function joinPark(parkId?: string, from?: DoorFrom, quiet = false): Promise<boolean> {
  if (joining) return false; // 이동 중 중복 요청 방지
  joining = true;
  try {
    return await doJoin(parkId, from, quiet);
  } finally { joining = false; }
}
async function doJoin(parkId: string | undefined, from: DoorFrom | undefined, quiet: boolean) {
  if (DEMO) return demoJoin(parkId ?? 'central-1', from);
  const res = await request<{ park: ParkInfo; spawn: NetState; players: PlayerSnapshot[]; seats?: SeatMap; poops?: PoopInfo[]; bags?: number[] }>('park:join', parkId ? { parkId, from } : undefined);
  if (!res.ok) {
    if (!quiet && res.code !== 'members_only') toast(res.error, 'error');
    if (!get().park && parkId && !quiet) return doJoin(undefined, undefined, true); // 지정 장소 입장 실패 시 빈 공원으로
    return false;
  }
  if (local.seated) void request('seat:leave');
  enterSpace(res.park, res.spawn);
  const players: Record<number, PublicProfile> = {};
  for (const p of res.players) { players[p.profile.id] = p.profile; pushSnapshot(p.profile.id, p.state); }
  const me = get().me?.id;
  local.bag = !!me && (res.bags ?? []).includes(me);
  set({ players, seats: res.seats ?? {}, poops: Object.fromEntries((res.poops ?? []).map((p) => [p.id, p])), bags: Object.fromEntries((res.bags ?? []).map((id) => [id, true as const])) });
  const list = await request<{ parks: ParkInfo[] }>('park:list');
  if (list.ok) set({ parks: list.parks });
  return true;
}

/** 새 공간에 들어갈 때 공통 처리: 이전 공간 아바타 정리, 이동 규칙·카메라 초기화, 사람·강아지 함께 이동 */
function enterSpace(park: ParkInfo, spawn: NetState) {
  clearRemotes();
  local.teleport = spawn;
  local.seated = null; local.seatGoal = null; local.moveTarget = null;
  local.jumpY = 0; local.jumpV = 0;
  cam.pendingReset = park.kind;
  setSpace(park.kind);
  const moved = get().park?.id !== park.id;
  local.action = null; local.poopStart = 0; local.petHold = null;
  resetFurniture();
  set({ park, players: {}, poops: {}, dogMenu: null, furnMenu: null, chat: [], chatUnread: 0, bubbles: {}, seats: {}, seated: null, benchMenu: null, home: null, homeEdit: false, lobbyPanel: park.kind === 'lobby', shopOpen: false, ...(moved ? { community: null } : {}) });
  if (park.kind === 'home' && park.ownerId) void loadHome(park.ownerId);
}

/** 미리보기: 서버 없이 장소 전환 (내 집만 들어갈 수 있음) */
function demoJoin(id: string, from?: DoorFrom) {
  const place = PLACES.find((p) => p.id === id);
  const me = get().me!;
  let park: ParkInfo;
  if (place) park = { ...place, count: 1, capacity: 1 };
  else if (id === `home-${me.id}` && me.residence) park = { id, name: `${me.nickname}네 집 (${me.residence.unit}호)`, kind: 'home', icon: '🏠', ownerId: me.id, count: 1, capacity: 1 };
  else { toast('미리보기에서는 다른 집에 들어갈 수 없어요.', 'error'); return false; }
  const door = from === 'lobby' ? APARTMENT_ENTRANCE : from === 'cafe' ? CAFE_ENTRANCE : from === 'shop' ? SHOP_ENTRANCE : null;
  const [x, z] = park.kind === 'park' ? (door ? [door.x, door.z + 2.2] : [0.6, 10]) : SPAWNS[park.kind];
  const face = park.kind === 'park' && !door ? Math.PI : 0;
  enterSpace(park, [x, z, face, 0, x + 0.7, z + 0.3, face, 0]);
  return true;
}

/** 개인 집 정보(가구·집주인) 불러오기 → 가구 충돌 반영 */
export async function loadHome(ownerId: number) {
  try {
    const r = await api<{ home: HomeView }>(`/api/home/${ownerId === get().me?.id ? 'me' : ownerId}`);
    if (get().park?.ownerId !== ownerId) return;
    set({ home: r.home });
    setSpace('home', r.home.layout);
    onLayoutChanged(r.home.layout);
  } catch (e) { toast((e as Error).message, 'error'); }
}

/** 다른 사람 집 방문: 권한 확인 후 입장 */
export async function visitHome(ownerId: number) {
  if (await joinPark(homeSpaceId(ownerId))) return true;
  return false;
}

/** 벤치 좌석에 앉기 (서버가 거리·빈자리 확인) */
export async function sitOnSeat(seatId: string) {
  if (DEMO) { set({ seated: seatId, seats: { [seatId]: get().me?.id ?? 1 } }); return true; }
  const res = await request<{ seatId: string }>('seat:sit', { seatId });
  if (!res.ok) { toast(res.error, 'error'); return false; }
  set({ seated: seatId });
  return true;
}
export async function leaveSeat() {
  set({ seated: null });
  if (DEMO) { set({ seats: {} }); return; }
  await request('seat:leave');
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

// ---------- 쓰다듬기 · 배변 줍기 · 봉투 버리기 ----------
/** 강아지 위치 (내 강아지는 로컬, 다른 강아지는 화면에 그려진 위치) */
export function dogPos(userId: number): { x: number; z: number } | undefined {
  if (userId === get().me?.id) return { x: local.dogX, z: local.dogZ };
  const r = rendered.get(userId);
  return r ? { x: r.dx, z: r.dz } : undefined;
}
function dogSize(userId: number) {
  const me = get().me;
  return userId === me?.id ? me.dog.size : get().players[userId]?.dog.size ?? 'medium';
}
/** 쓰다듬기 이벤트 반영: 하트·강아지 반응, 내 강아지면 멈춰서 상대를 바라봄 */
function onPet(e: PetEvent) {
  const at = dogPos(e.targetId);
  petLow.set(e.fromId, PET_LOW[e.size]);
  playPet(e.targetId, at, DOG_SCALE[dogSize(e.targetId)]);
  if (e.targetId === get().me?.id) {
    const from = e.fromId === e.targetId ? { x: local.x, z: local.z } : rendered.get(e.fromId);
    if (from) local.petHold = { x: from.x, z: from.z };
  }
}
function startAction(anim: number, ms: number, face: { x: number; z: number } | undefined, low = 0.6) {
  local.moveTarget = null;
  local.action = { anim, until: performance.now() + ms, petLow: low, faceX: face?.x ?? local.x + Math.sin(local.rot), faceZ: face?.z ?? local.z + Math.cos(local.rot) };
}
let busy = false;
/** 강아지 쓰다듬기 (내 강아지·다른 강아지) — 서버가 거리·허용 여부를 확인 */
export async function petDog(targetId: number) {
  if (busy || local.action) return false;
  const size = dogSize(targetId);
  if (DEMO) {
    const e: PetEvent = { fromId: get().me!.id, targetId, size, ts: Date.now() };
    startAction(HumanAnim.Pet, ACTION_MS.pet, dogPos(targetId), PET_LOW[size]);
    onPet(e);
    return true;
  }
  busy = true;
  try {
    const res = await request<{ event: PetEvent }>('pet', { targetId });
    if (!res.ok) { if (res.code !== 'members_only') toast(res.error, 'error'); return false; }
    startAction(HumanAnim.Pet, ACTION_MS.pet, dogPos(targetId), PET_LOW[size]);
    onPet(res.event);
    return true;
  } finally { busy = false; }
}
/** 내 강아지 배변 줍기 */
export async function pickupPoop(id: string) {
  if (busy || local.action) return false;
  const p = get().poops[id];
  if (DEMO) {
    if (!p) return false;
    startAction(HumanAnim.Scoop, ACTION_MS.scoop, p);
    set((st) => { const poops = { ...st.poops }; delete poops[id]; return { poops, bags: { ...st.bags, [st.me!.id]: true } }; });
    local.bag = true;
    toast('🛍️ 배변봉투에 담았어요. 근처 휴지통에 버려 주세요!');
    return true;
  }
  busy = true;
  try {
    const res = await request('poop:pickup', { id });
    if (!res.ok) { toast(res.error, 'error'); return false; }
    startAction(HumanAnim.Scoop, ACTION_MS.scoop, p);
    toast('🛍️ 배변봉투에 담았어요. 근처 휴지통에 버려 주세요!');
    return true;
  } finally { busy = false; }
}
/** 휴지통에 봉투 버리기 */
export async function disposeBag(binId: string) {
  if (busy || local.action) return false;
  const bin = BIN_BY_ID.get(binId);
  if (DEMO) {
    startAction(HumanAnim.Toss, ACTION_MS.toss, bin);
    binOpenAt.set(binId, performance.now());
    local.bag = false;
    set((st) => { const bags = { ...st.bags }; delete bags[st.me!.id]; return { bags }; });
    toast('깨끗한 산책 완료! 🐾');
    return true;
  }
  busy = true;
  try {
    const res = await request('bag:dispose', { binId });
    if (!res.ok) { toast(res.error, 'error'); return false; }
    startAction(HumanAnim.Toss, ACTION_MS.toss, bin);
    toast('깨끗한 산책 완료! 🐾');
    return true;
  } finally { busy = false; }
}

/** 미리보기(서버 없음): 서버의 배변 규칙을 흉내 내 혼자 산책할 때도 배변 → 줍기 → 버리기를 해 볼 수 있게 */
let demoPoopTimer = 0;
function startDemoPoop() {
  if (demoPoopTimer) return;
  let walked = 0, n = 0;
  demoPoopTimer = window.setInterval(() => {
    const st = get();
    if (st.park?.kind !== 'park' || !st.me) return;
    if (local.humanAnim === HumanAnim.Walk || local.humanAnim === HumanAnim.Run) walked += 1;
    if (walked < 40 || Object.values(st.poops).some((p) => p.ownerId === st.me!.id)) return;
    walked = 0;
    const x = Math.round(local.dogX * 100) / 100, z = Math.round(local.dogZ * 100) / 100;
    local.poopStart = performance.now();
    toast(`💩 ${st.me.dogName}가 볼일을 보고 있어요. 다 보면 치워 주세요!`);
    window.setTimeout(() => {
      const id = `demo-${++n}`;
      set((s2) => ({ poops: { ...s2.poops, [id]: { id, ownerId: st.me!.id, x, z } } }));
    }, 2600);
  }, 1000);
}
