// 실시간 멀티플레이 · 채팅 · 친구 · 차단/신고 (Socket.IO)
import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import * as repo from './db';
import { userFromToken } from './auth';
import { filterProfanity, RateLimiter, sanitize, SpamGuard } from './moderation';
import {
  BIN_REACH, CHAT_MAX_LEN, DOG_ANIM_MAX, HUMAN_ANIM_MAX, HumanAnim, NET_TICK_MS, PARKS, PET_REACH, POOP_REACH, RUN_SPEED,
  type ChatMessage, type PetEvent, type PoopInfo, type FriendEntry, type NetState, type ParkInfo, type PlayerSnapshot, type PublicProfile, type SeatMap,
} from '../../shared/protocol';
import { APARTMENT_ENTRANCE, BIN_BY_ID, CAFE_ENTRANCE, SHOP_ENTRANCE, SEAT_BY_ID, SEAT_REACH, WORLD_RADIUS, spawnPoint } from '../../shared/world';
import { PLACES, SPAWNS, homeSpaceId, insideSpace, parseSpace, type SpaceKind } from '../../shared/spaces';
import { canVisit } from './access';

const CAPACITY = Number(process.env.MUNGLE_PARK_CAPACITY ?? 30);
const HOME_CAPACITY = 10;
const REPORT_REASONS = ['욕설/비하', '도배/스팸', '불쾌한 닉네임/사진', '사칭/사기', '기타'];
/** 배변 이벤트: 산책(걷기·달리기) 누적 시간이 MIN~MAX초 사이의 임의 값에 도달하면 CHANCE 확률로 발생 */
const POOP_MIN_S = Number(process.env.MUNGLE_POOP_MIN_S ?? 300);
const POOP_MAX_S = Number(process.env.MUNGLE_POOP_MAX_S ?? 600);
const POOP_CHANCE = Number(process.env.MUNGLE_POOP_CHANCE ?? 0.6);
const POOP_SQUAT_MS = Number(process.env.MUNGLE_POOP_SQUAT_MS ?? 2600);
const ROOM_POOP_MAX = 40;
const nextPoopAt = () => POOP_MIN_S + Math.random() * Math.max(0, POOP_MAX_S - POOP_MIN_S);
/** 다른 사용자 강아지 쓰다듬기 허용 범위 (보호자 설정) */
export type PetPolicy = 'all' | 'friends' | 'none';

interface Player {
  userId: number;
  socket: Socket;
  profile: PublicProfile;
  state: NetState;
  lastTs: number;
  dirty: boolean;
  /** 이번 공간에서 산책한 누적 시간(초)과 다음 배변 기준 */
  walkSecs: number;
  poopAt: number;
  /** 배변 자세 중 (서버가 시작한 이벤트) */
  pooping: boolean;
}

interface Room {
  id: string;
  name: string;
  kind: SpaceKind;
  icon: string;
  /** 개인 집이면 집주인 id */
  ownerId?: number;
  players: Map<number, Player>;
  /** 신고 시 맥락으로 첨부할 최근 채팅 */
  recentChat: ChatMessage[];
  /** 벤치 좌석 점유: 좌석 id → 사용자 id */
  seats: Map<string, number>;
  /** 아직 치우지 않은 배변 */
  poops: Map<string, PoopInfo & { ts: number }>;
}

interface Session {
  userId: number;
  role: string;
  socket: Socket;
  parkId: string | null;
  blocked: Set<number>; // 내가 차단
  blockedBy: Set<number>; // 나를 차단
  /** 배변봉투를 들고 있는지 (서버가 관리) */
  bag: boolean;
  /** 비회원 둘러보기 */
  guest: boolean;
  lastPet: number;
}

export function setupRealtime(io: Server) {
  // 상설 장소(공원·아파트 로비)는 미리 만들고, 개인 집은 누군가 들어갈 때 만들고 비면 정리한다
  const rooms = new Map<string, Room>(PLACES.map((p) => [p.id, { id: p.id, name: p.name, kind: p.kind, icon: p.icon, players: new Map(), recentChat: [], seats: new Map(), poops: new Map() }]));
  const capacityOf = (r: Room) => (r.kind === 'home' ? HOME_CAPACITY : CAPACITY);
  function getOrCreateRoom(spaceId: string): Room | null {
    const existing = rooms.get(spaceId);
    if (existing) return existing;
    const sp = parseSpace(spaceId);
    if (!sp || sp.kind !== 'home' || !sp.ownerId) return null;
    const owner = repo.getPublicProfile(sp.ownerId);
    const res = repo.getResidence(sp.ownerId);
    if (!owner || !res) return null;
    const room: Room = { id: spaceId, name: `${owner.nickname}네 집 (${res.unit}호)`, kind: 'home', icon: '🏠', ownerId: sp.ownerId, players: new Map(), recentChat: [], seats: new Map(), poops: new Map() };
    rooms.set(spaceId, room);
    return room;
  }
  const sessions = new Map<number, Session>();
  const spam = new SpamGuard();
  const dmSpam = new SpamGuard(8, 10000, 15000);
  const friendLimiter = new RateLimiter(20, 60_000);
  const reportLimiter = new RateLimiter(10, 3600_000);
  const lookupLimiter = new RateLimiter(120, 60_000);

  const parkInfo = (r: Room): ParkInfo => ({ id: r.id, name: r.name, count: r.players.size, capacity: capacityOf(r), kind: r.kind, icon: r.icon, ownerId: r.ownerId });
  const hidden = (s: Session, other: number) => s.blocked.has(other) || s.blockedBy.has(other);

  // ---------- 인증 ----------
  io.use((socket, next) => {
    const u = userFromToken(socket.handshake.auth?.token);
    if (!u) return next(new Error('unauthorized'));
    if ('banned' in u) return next(new Error('banned'));
    socket.data.userId = u.id;
    socket.data.role = u.role;
    next();
  });

  // ---------- 친구에게 접속/위치 알림 (개인정보 설정 반영) ----------
  function presenceFor(userId: number) {
    const s = sessions.get(userId);
    const priv = repo.getPrivacy(userId);
    const online = priv.showOnline ? !!s : null;
    const cur = s?.parkId ? rooms.get(s.parkId) : undefined;
    // 개인 집 위치는 알리지 않음 (공원·아파트 로비만)
    const park = priv.showOnline && priv.showLocation && cur && cur.kind !== 'home' ? cur : null;
    return { userId, online, parkId: park?.id ?? null, parkName: park?.name ?? null };
  }
  function notifyFriendsPresence(userId: number) {
    const p = presenceFor(userId);
    for (const fid of repo.friendIds(userId)) sessions.get(fid)?.socket.emit('presence', p);
  }

  /** 사용자가 앉아 있던 좌석을 비우고 방에 알림 */
  function releaseSeat(room: Room, userId: number) {
    let changed = false;
    for (const [seat, uid] of room.seats) if (uid === userId) { room.seats.delete(seat); changed = true; }
    if (changed) io.to(room.id).emit('seats', Object.fromEntries(room.seats) satisfies SeatMap);
    return changed;
  }

  function leavePark(s: Session) {
    if (!s.parkId) return;
    const room = rooms.get(s.parkId)!;
    releaseSeat(room, s.userId);
    // 정리 정책: 보호자가 공간을 떠나면(이동·접속 종료) 치우지 않은 배변도 함께 정리
    for (const [id, poop] of room.poops) if (poop.ownerId === s.userId) { room.poops.delete(id); io.to(room.id).emit('poop:remove', { id, reason: 'left' }); }
    room.players.delete(s.userId);
    s.socket.leave(room.id);
    io.to(room.id).emit('players:leave', { id: s.userId });
    s.parkId = null;
    if (room.kind === 'home') {
      // 빈 집 공간은 정리
      if (room.players.size === 0) rooms.delete(room.id);
    } else io.emit('park:count', parkInfo(room));
  }

  /** 방 안에서 차단 관계를 제외하고 전송 */
  function emitToRoomFiltered(room: Room, fromId: number, event: string, payload: unknown) {
    for (const p of room.players.values()) {
      const s = sessions.get(p.userId);
      if (!s || hidden(s, fromId)) continue;
      p.socket.emit(event, payload);
    }
  }

  // ---------- 위치 브로드캐스트 틱 ----------
  setInterval(() => {
    for (const room of rooms.values()) {
      const changed: Record<number, NetState> = {};
      let any = false;
      for (const p of room.players.values()) {
        if (p.dirty) { changed[p.userId] = p.state; p.dirty = false; any = true; }
      }
      if (any) io.to(room.id).volatile.emit('states', changed);
    }
  }, NET_TICK_MS);

  /** 입장 시 함께 보내는 공간 상태: 치우지 않은 배변, 봉투를 든 사람 */
  function roomExtras(room: Room) {
    return {
      poops: [...room.poops.values()].map(({ id, ownerId, x, z }) => ({ id, ownerId, x, z })),
      bags: [...room.players.keys()].filter((id) => sessions.get(id)?.bag),
    };
  }

  // ---------- 배변 이벤트 (서버에서만 생성) ----------
  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.kind !== 'park' || room.poops.size >= ROOM_POOP_MAX) continue;
      for (const p of room.players.values()) {
        const s = sessions.get(p.userId);
        if (!s || s.guest || p.pooping || p.walkSecs < p.poopAt) continue;
        p.walkSecs = 0;
        p.poopAt = nextPoopAt();
        if ([...room.poops.values()].some((x) => x.ownerId === p.userId)) continue; // 한 번에 하나만
        if (Math.random() > POOP_CHANCE) continue;
        const id = crypto.randomUUID();
        const x = Math.round(p.state[4] * 100) / 100, z = Math.round(p.state[5] * 100) / 100;
        p.pooping = true;
        io.to(room.id).emit('poop:begin', { id, ownerId: p.userId, x, z });
        setTimeout(() => {
          p.pooping = false;
          // 그사이 보호자가 떠났다면 만들지 않음
          if (room.players.get(p.userId) !== p || room.poops.size >= ROOM_POOP_MAX) return;
          const poop = { id, ownerId: p.userId, x, z, ts: Date.now() };
          room.poops.set(id, poop);
          io.to(room.id).emit('poop:add', { id, ownerId: p.userId, x, z } satisfies PoopInfo);
        }, POOP_SQUAT_MS);
      }
    }
  }, Number(process.env.MUNGLE_POOP_TICK_MS ?? 5000)).unref();

  io.on('connection', (socket) => {
    const userId: number = socket.data.userId;

    // 같은 계정의 이전 접속은 종료 (한 계정 = 한 아바타)
    const prev = sessions.get(userId);
    if (prev) {
      prev.socket.emit('kicked', { reason: '다른 창이나 기기에서 접속해 이 연결이 종료되었어요.' });
      leavePark(prev);
      prev.socket.disconnect(true);
    }
    const session: Session = {
      userId, role: socket.data.role, socket, parkId: null,
      blocked: new Set(repo.blockedIds(userId)), blockedBy: new Set(repo.blockedByIds(userId)),
      bag: prev?.bag ?? false, guest: socket.data.role === 'guest', lastPet: 0,
    };
    sessions.set(userId, session);
    notifyFriendsPresence(userId);

    const fail = (ack: unknown, error: string) => typeof ack === 'function' && ack({ ok: false, error });
    const okAck = (ack: unknown, data: object = {}) => typeof ack === 'function' && ack({ ok: true, ...data });
    /** 비회원 둘러보기에서는 막힌 기능 */
    const memberOnly = (ack: unknown) => {
      if (!session.guest) return false;
      if (typeof ack === 'function') ack({ ok: false, error: '이 기능은 멍글마을 주민만 이용할 수 있어요.', code: 'members_only' });
      return true;
    };
    const targetId = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && v !== userId ? (v as number) : null);

    socket.on('park:list', (_: unknown, ack: unknown) => okAck(ack, { parks: [...rooms.values()].filter((x) => x.kind !== 'home').map(parkInfo) }));

    // ---------- 공원 입장 ----------
    // ---------- 장소 입장 (공원 / 아파트 로비 / 개인 집) — 한 사용자는 한 공간에만 있음 ----------
    socket.on('park:join', (data: { parkId?: string; from?: string } | undefined, ack: unknown) => {
      const profile = repo.getPublicProfile(userId);
      if (!profile) return fail(ack, '프로필을 찾을 수 없어요.');
      let room: Room | undefined;
      if (data?.parkId) {
        const sp = parseSpace(data.parkId);
        if (!sp) return fail(ack, '존재하지 않는 장소예요.');
        if (session.guest && sp.kind !== 'park') { memberOnly(ack); return; }
        if (sp.kind === 'home') {
          const c = canVisit(userId, sp.ownerId!);
          if (!c.ok) return fail(ack, c.error);
        }
        room = getOrCreateRoom(data.parkId) ?? undefined;
        if (!room) return fail(ack, '존재하지 않는 장소예요.');
        if (room.id !== session.parkId && room.players.size >= capacityOf(room)) return fail(ack, `${room.name}은(는) 정원(${capacityOf(room)}명)이 가득 찼어요.`);
      } else {
        room = [...rooms.values()].find((r) => r.kind === 'park' && r.players.size < CAPACITY);
        if (!room) return fail(ack, '모든 공원이 가득 찼어요. 잠시 후 다시 시도해 주세요.');
      }
      if (room.id === session.parkId) {
        // 같은 장소 재입장: 중복 입장 없이 현재 상태만 돌려줌
        const others = [...room.players.values()].filter((p) => p.userId !== userId && !hidden(session, p.userId)).map((p) => ({ profile: p.profile, state: p.state }));
        return okAck(ack, { park: parkInfo(room), spawn: room.players.get(userId)!.state, players: others, seats: Object.fromEntries(room.seats) satisfies SeatMap, ...roomExtras(room) });
      }
      leavePark(session);
      // 건물에서 나오면 그 건물 입구 앞에 선다
      const door = data?.from === 'lobby' ? APARTMENT_ENTRANCE : data?.from === 'cafe' ? CAFE_ENTRANCE : data?.from === 'shop' ? SHOP_ENTRANCE : null;
      const [x, z] = room.kind === 'park'
        ? (door ? [door.x + ((userId % 5) - 2) * 0.5, door.z + 2.2] : spawnPoint(userId + Date.now() % 1000))
        : [SPAWNS[room.kind][0] + ((userId % 5) - 2) * 0.35, SPAWNS[room.kind][1]];
      const face = room.kind === 'park' && !door ? Math.PI : 0;
      const state: NetState = [x, z, face, 0, x + 0.7, z + 0.3, face, 0];
      const player: Player = { userId, socket, profile, state, lastTs: Date.now(), dirty: true, walkSecs: 0, poopAt: nextPoopAt(), pooping: false };
      const others: PlayerSnapshot[] = [...room.players.values()]
        .filter((p) => !hidden(session, p.userId))
        .map((p) => ({ profile: p.profile, state: p.state }));
      room.players.set(userId, player);
      socket.join(room.id);
      session.parkId = room.id;
      emitToRoomFiltered(room, userId, 'players:join', { profile, state } satisfies PlayerSnapshot);
      if (room.kind !== 'home') io.emit('park:count', parkInfo(room));
      notifyFriendsPresence(userId);
      okAck(ack, { park: parkInfo(room), spawn: state, players: others, seats: Object.fromEntries(room.seats) satisfies SeatMap, ...roomExtras(room) });
      // 봉투를 들고 다른 공간으로 왔다면 그 공간 사람들에게도 보이게
      if (session.bag) io.to(room.id).emit('bag', { userId, holding: true });
    });

    socket.on('park:leave', (_: unknown, ack: unknown) => { leavePark(session); notifyFriendsPresence(userId); okAck(ack); });

    // ---------- 위치/모션 동기화 (서버 측 검증) ----------
    socket.on('state', (s: unknown) => {
      if (!session.parkId) return;
      const p = rooms.get(session.parkId)!.players.get(userId);
      if (!p) return;
      if (!Array.isArray(s) || s.length !== 8 || !s.every((n) => typeof n === 'number' && Number.isFinite(n))) return;
      const now = Date.now();
      const dt = Math.min(1, (now - p.lastTs) / 1000);
      let [x, z, rot, ha, dx, dz, drot, da] = s as NetState;
      const curRoom = rooms.get(session.parkId)!;
      // 공간 경계 (공원: 원형 / 실내: 방 크기)
      if (curRoom.kind === 'park') {
        const r = Math.hypot(x, z);
        if (r > WORLD_RADIUS + 0.5) { x *= WORLD_RADIUS / r; z *= WORLD_RADIUS / r; }
      } else if (!insideSpace(curRoom.kind, x, z)) {
        socket.emit('correct', p.state);
        return;
      }
      // 순간이동/속도 조작 방지: 이동 거리가 최대 속도를 크게 넘으면 거부하고 보정 위치 전송
      const moved = Math.hypot(x - p.state[0], z - p.state[1]);
      if (moved > RUN_SPEED * 1.6 * dt + 0.8) {
        socket.emit('correct', p.state);
        return;
      }
      // 강아지는 목줄 길이 이내로 제한
      const dd = Math.hypot(dx - x, dz - z);
      if (dd > 4) { dx = x + ((dx - x) / dd) * 4; dz = z + ((dz - z) / dd) * 4; }
      const round = (v: number) => Math.round(v * 100) / 100;
      // 앉기 상태는 실제로 좌석을 차지한 경우만 인정, 좌석에서 멀어지면 자리 해제
      const room = rooms.get(session.parkId)!;
      const seatId = [...room.seats].find(([, uid]) => uid === userId)?.[0];
      const seat = seatId ? SEAT_BY_ID.get(seatId) : undefined;
      if (seat && Math.hypot(x - seat.x, z - seat.z) > 1.2) releaseSeat(room, userId);
      const seated = !!seat && room.seats.get(seat.id) === userId;
      let anim = ha >= 0 && ha <= HUMAN_ANIM_MAX ? ha | 0 : 0;
      if (anim === HumanAnim.Sit && !seated) anim = 0;
      let danim = da >= 0 && da <= DOG_ANIM_MAX ? da | 0 : 0;
      // 배변 자세는 서버가 시작한 이벤트 동안에만 인정 (버튼만 눌러 배변 상태를 만들 수 없음)
      if (danim === 7 && !p.pooping) danim = 0;
      // 산책 시간 누적 (걷기·달리기)
      if (anim === HumanAnim.Walk || anim === HumanAnim.Run) p.walkSecs += dt;
      p.state = [round(x), round(z), round(rot), anim, round(dx), round(dz), round(drot), danim];
      p.lastTs = now;
      p.dirty = true;
    });

    // ---------- 벤치 앉기 ----------
    socket.on('seat:sit', (data: { seatId?: unknown } | undefined, ack: unknown) => {
      if (!session.parkId) return fail(ack, '공원에 입장한 뒤 앉을 수 있어요.');
      const room = rooms.get(session.parkId)!;
      const p = room.players.get(userId);
      const seat = typeof data?.seatId === 'string' ? SEAT_BY_ID.get(data.seatId) : undefined;
      if (!p || !seat || room.kind !== 'park') return fail(ack, '존재하지 않는 자리예요.');
      if (Math.hypot(p.state[0] - seat.x, p.state[1] - seat.z) > SEAT_REACH) return fail(ack, '벤치에 조금 더 가까이 가 주세요.');
      const owner = room.seats.get(seat.id);
      if (owner !== undefined && owner !== userId) return fail(ack, '이미 다른 사람이 앉아 있는 자리예요.');
      for (const [sid, uid] of room.seats) if (uid === userId) room.seats.delete(sid); // 다른 자리에 앉아 있었다면 옮김
      room.seats.set(seat.id, userId);
      io.to(room.id).emit('seats', Object.fromEntries(room.seats) satisfies SeatMap);
      okAck(ack, { seatId: seat.id });
    });
    socket.on('seat:leave', (_: unknown, ack: unknown) => {
      if (session.parkId) releaseSeat(rooms.get(session.parkId)!, userId);
      okAck(ack);
    });

    // ---------- 강아지 쓰다듬기 (내 강아지 / 다른 사용자 강아지) ----------
    socket.on('pet', (data: { targetId?: unknown } | undefined, ack: unknown) => {
      if (memberOnly(ack)) return;
      if (!session.parkId) return fail(ack, '공간에 입장한 뒤 이용할 수 있어요.');
      const room = rooms.get(session.parkId)!;
      const me = room.players.get(userId);
      const tid = Number(data?.targetId);
      const target = Number.isInteger(tid) ? room.players.get(tid) : undefined;
      if (!me || !target) return fail(ack, '근처에 있는 강아지만 쓰다듬을 수 있어요.');
      if (tid !== userId) {
        if (hidden(session, tid)) return fail(ack, '쓰다듬을 수 없는 강아지예요.');
        const policy = repo.getDogProfile(tid).allowPetting;
        if (policy === 'none' || (policy === 'friends' && !repo.areFriends(userId, tid))) return fail(ack, policy === 'friends' ? '보호자가 친구에게만 쓰다듬기를 허용했어요.' : '보호자가 쓰다듬기를 허용하지 않았어요.');
      }
      if (target.pooping) return fail(ack, '지금은 강아지가 볼일을 보는 중이에요.');
      if (Math.hypot(me.state[0] - target.state[4], me.state[1] - target.state[5]) > PET_REACH) return fail(ack, '강아지에게 조금 더 가까이 가 주세요.');
      const now = Date.now();
      if (now - session.lastPet < 1800) return fail(ack, '잠시 후 다시 쓰다듬어 주세요.');
      session.lastPet = now;
      const ev: PetEvent = { fromId: userId, targetId: tid, size: target.profile.dog.size, ts: now };
      emitToRoomFiltered(room, userId, 'pet', ev);
      okAck(ack, { event: ev });
    });

    // ---------- 배변봉투로 줍기 → 휴지통에 버리기 ----------
    socket.on('poop:pickup', (data: { id?: unknown } | undefined, ack: unknown) => {
      if (!session.parkId) return fail(ack, '공원에서만 할 수 있어요.');
      const room = rooms.get(session.parkId)!;
      const poop = typeof data?.id === 'string' ? room.poops.get(data.id) : undefined;
      const me = room.players.get(userId);
      if (!poop || !me) return fail(ack, '이미 치웠거나 없는 배변이에요.');
      if (poop.ownerId !== userId) return fail(ack, '내 강아지의 배변만 치울 수 있어요.');
      if (Math.hypot(me.state[0] - poop.x, me.state[1] - poop.z) > POOP_REACH) return fail(ack, '조금 더 가까이 가 주세요.');
      room.poops.delete(poop.id); // 먼저 지워서 중복 줍기 방지
      session.bag = true;
      io.to(room.id).emit('poop:remove', { id: poop.id, reason: 'picked' });
      io.to(room.id).emit('bag', { userId, holding: true });
      okAck(ack);
    });
    socket.on('bag:dispose', (data: { binId?: unknown } | undefined, ack: unknown) => {
      if (!session.parkId) return fail(ack, '공원 휴지통에 버려 주세요.');
      const room = rooms.get(session.parkId)!;
      const me = room.players.get(userId);
      const bin = typeof data?.binId === 'string' ? BIN_BY_ID.get(data.binId) : undefined;
      if (!session.bag) return fail(ack, '버릴 배변봉투가 없어요.');
      if (!me || !bin || room.kind !== 'park') return fail(ack, '휴지통을 찾을 수 없어요.');
      if (Math.hypot(me.state[0] - bin.x, me.state[1] - bin.z) > BIN_REACH) return fail(ack, '휴지통에 조금 더 가까이 가 주세요.');
      session.bag = false;
      io.to(room.id).emit('bin', { binId: bin.id, userId });
      io.to(room.id).emit('bag', { userId, holding: false });
      okAck(ack);
    });

    // ---------- 공개 채팅 ----------
    socket.on('chat:public', (text: unknown, ack: unknown) => {
      if (memberOnly(ack)) return;
      if (!session.parkId) return fail(ack, '공원에 입장한 뒤 채팅할 수 있어요.');
      const clean = sanitize(text, CHAT_MAX_LEN);
      if (!clean) return fail(ack, '메시지를 입력해 주세요.');
      const g = spam.check(userId, clean);
      if (!g.ok) return fail(ack, g.error);
      const room = rooms.get(session.parkId)!;
      const player = room.players.get(userId)!;
      const msg: ChatMessage = {
        id: crypto.randomUUID(), from: userId, nickname: player.profile.nickname, text: filterProfanity(clean).text, ts: Date.now(),
      };
      room.recentChat.push(msg);
      if (room.recentChat.length > 100) room.recentChat.shift();
      emitToRoomFiltered(room, userId, 'chat', msg);
      okAck(ack);
    });

    // ---------- 프로필 조회 ----------
    socket.on('profile:get', (data: { userId?: unknown }, ack: unknown) => {
      if (!lookupLimiter.allow(`p${userId}`)) return fail(ack, '요청이 너무 많아요.');
      const id = Number.isInteger(data?.userId) ? (data.userId as number) : null;
      if (!id) return fail(ack, '잘못된 요청이에요.');
      const profile = repo.getPublicProfile(id);
      if (!profile) return fail(ack, '사용자를 찾을 수 없어요.');
      okAck(ack, { profile, status: id === userId ? 'none' : repo.friendStatus(userId, id) });
    });

    // ---------- 친구 ----------
    const myPublic = () => repo.getPublicProfile(userId)!;
    const sendFriendEvent = (to: number, kind: string) => sessions.get(to)?.socket.emit('friend:event', { kind, from: myPublic(), ts: Date.now() });

    socket.on('friend:request', (data: { userId?: unknown }, ack: unknown) => {
      if (memberOnly(ack)) return;
      const to = targetId(data?.userId);
      if (!to || !repo.findUser(to)) return fail(ack, '잘못된 요청이에요.');
      if (!friendLimiter.allow(`f${userId}`)) return fail(ack, '잠시 후 다시 시도해 주세요.');
      if (repo.isBlocked(userId, to)) return fail(ack, '차단을 해제한 뒤 신청할 수 있어요.');
      if (repo.isBlocked(to, userId)) return fail(ack, '친구 신청을 보낼 수 없는 사용자예요.');
      const status = repo.friendStatus(userId, to);
      if (status === 'friends') return fail(ack, '이미 친구예요.');
      if (status === 'outgoing') return fail(ack, '이미 신청했어요.');
      if (status === 'incoming') {
        repo.makeFriends(userId, to);
        sendFriendEvent(to, 'accepted');
        notifyFriendsPresence(userId); notifyFriendsPresence(to);
        return okAck(ack, { status: 'friends' });
      }
      if (!repo.getPrivacy(to).allowFriendRequests) return fail(ack, '친구 신청을 받지 않는 사용자예요.');
      repo.addRequest(userId, to);
      sendFriendEvent(to, 'request');
      okAck(ack, { status: 'outgoing' });
    });

    socket.on('friend:cancel', (data: { userId?: unknown }, ack: unknown) => {
      const to = targetId(data?.userId);
      if (!to) return fail(ack, '잘못된 요청이에요.');
      repo.deleteRequest(userId, to);
      sessions.get(to)?.socket.emit('friend:event', { kind: 'cancelled', from: myPublic(), ts: Date.now() });
      okAck(ack, { status: 'none' });
    });

    socket.on('friend:accept', (data: { userId?: unknown }, ack: unknown) => {
      if (memberOnly(ack)) return;
      const from = targetId(data?.userId);
      if (!from || !repo.hasRequest(from, userId)) return fail(ack, '받은 친구 신청이 없어요.');
      if (repo.eitherBlocked(userId, from)) return fail(ack, '수락할 수 없는 신청이에요.');
      repo.makeFriends(userId, from);
      sendFriendEvent(from, 'accepted');
      notifyFriendsPresence(userId); notifyFriendsPresence(from);
      okAck(ack, { status: 'friends' });
    });

    socket.on('friend:decline', (data: { userId?: unknown }, ack: unknown) => {
      const from = targetId(data?.userId);
      if (!from) return fail(ack, '잘못된 요청이에요.');
      repo.deleteRequest(from, userId);
      okAck(ack, { status: 'none' });
    });

    socket.on('friend:remove', (data: { userId?: unknown }, ack: unknown) => {
      const other = targetId(data?.userId);
      if (!other) return fail(ack, '잘못된 요청이에요.');
      repo.removeFriend(userId, other);
      sessions.get(other)?.socket.emit('friend:event', { kind: 'removed', from: myPublic(), ts: Date.now() });
      okAck(ack, { status: 'none' });
    });

    socket.on('friend:list', (_: unknown, ack: unknown) => {
      const unread = repo.unreadCounts(userId);
      const friends: FriendEntry[] = repo.friendIds(userId).map((fid) => {
        const pr = presenceFor(fid);
        return { profile: repo.getPublicProfile(fid)!, online: pr.online, parkId: pr.parkId, parkName: pr.parkName, unread: unread[fid] ?? 0 };
      });
      const incoming = repo.incomingRequests(userId)
        .filter((r) => !session.blocked.has(r.from_id))
        .map((r) => ({ profile: repo.getPublicProfile(r.from_id)!, ts: r.created_at }));
      const outgoing = repo.outgoingRequests(userId).map((id) => repo.getPublicProfile(id)!).filter(Boolean);
      okAck(ack, { friends, incoming, outgoing });
    });

    /** 친구가 있는 공원 찾기 — 친구 관계 + 상대 개인정보 설정을 서버에서 검증 */
    socket.on('friend:locate', (data: { userId?: unknown }, ack: unknown) => {
      const fid = targetId(data?.userId);
      if (!fid || !repo.areFriends(userId, fid)) return fail(ack, '친구만 위치를 확인할 수 있어요.');
      const priv = repo.getPrivacy(fid);
      if (!priv.showOnline || !priv.showLocation) return fail(ack, '친구가 위치를 공개하지 않았어요.');
      const pr = presenceFor(fid);
      if (!pr.parkId) return fail(ack, '친구가 지금 공원에 있지 않아요.');
      okAck(ack, { parkId: pr.parkId, parkName: pr.parkName });
    });

    // ---------- 차단 / 신고 ----------
    socket.on('block', (data: { userId?: unknown }, ack: unknown) => {
      const other = targetId(data?.userId);
      if (!other || !repo.findUser(other)) return fail(ack, '잘못된 요청이에요.');
      repo.block(userId, other);
      session.blocked.add(other);
      const os = sessions.get(other);
      if (os) {
        os.blockedBy.add(userId);
        // 같은 공원이면 서로의 화면에서 제거
        if (os.parkId && os.parkId === session.parkId) {
          os.socket.emit('players:leave', { id: userId });
          socket.emit('players:leave', { id: other });
        }
      }
      okAck(ack, { status: 'blocked' });
    });

    socket.on('unblock', (data: { userId?: unknown }, ack: unknown) => {
      const other = targetId(data?.userId);
      if (!other) return fail(ack, '잘못된 요청이에요.');
      repo.unblock(userId, other);
      session.blocked.delete(other);
      const os = sessions.get(other);
      os?.blockedBy.delete(userId);
      // 같은 공원에 있고 서로 숨김 관계가 해제되었다면 다시 표시
      if (os && os.parkId && os.parkId === session.parkId && !hidden(session, other)) {
        const room = rooms.get(session.parkId)!;
        const me = room.players.get(userId), them = room.players.get(other);
        if (me && them) {
          socket.emit('players:join', { profile: them.profile, state: them.state });
          os.socket.emit('players:join', { profile: me.profile, state: me.state });
        }
      }
      okAck(ack, { status: repo.friendStatus(userId, other) });
    });

    socket.on('block:list', (_: unknown, ack: unknown) => {
      okAck(ack, { users: [...session.blocked].map((id) => repo.getPublicProfile(id)).filter(Boolean) });
    });

    socket.on('report', (data: { userId?: unknown; reason?: unknown; detail?: unknown }, ack: unknown) => {
      const other = targetId(data?.userId);
      if (!other || !repo.findUser(other)) return fail(ack, '잘못된 요청이에요.');
      if (typeof data.reason !== 'string' || !REPORT_REASONS.includes(data.reason)) return fail(ack, '신고 사유를 선택해 주세요.');
      if (!reportLimiter.allow(`r${userId}`)) return fail(ack, '신고는 시간당 10회까지 가능해요.');
      const detail = sanitize(data.detail ?? '', 300) ?? '';
      // 맥락: 같은 공원에서 대상이 보낸 최근 공개 채팅 (서버 기록 기준, 클라이언트 입력 신뢰 안 함)
      const room = session.parkId ? rooms.get(session.parkId) : null;
      const context = room ? room.recentChat.filter((m) => m.from === other).slice(-10).map((m) => `[${new Date(m.ts).toISOString()}] ${m.text}`).join('\n') : '';
      repo.addReport(userId, other, data.reason, detail, context);
      okAck(ack);
    });

    // ---------- 1:1 채팅 (친구 전용) ----------
    socket.on('dm:send', (data: { to?: unknown; text?: unknown }, ack: unknown) => {
      if (memberOnly(ack)) return;
      const to = targetId(data?.to);
      if (!to) return fail(ack, '잘못된 요청이에요.');
      if (!repo.areFriends(userId, to)) return fail(ack, '친구에게만 메시지를 보낼 수 있어요.');
      if (repo.eitherBlocked(userId, to)) return fail(ack, '메시지를 보낼 수 없어요.');
      const clean = sanitize(data.text, 300);
      if (!clean) return fail(ack, '메시지를 입력해 주세요.');
      const g = dmSpam.check(userId, clean);
      if (!g.ok) return fail(ack, g.error);
      const msg = repo.saveMessage(userId, to, filterProfanity(clean).text);
      sessions.get(to)?.socket.emit('dm', { ...msg, fromNickname: myPublic().nickname });
      okAck(ack, { message: msg });
    });

    socket.on('dm:history', (data: { with?: unknown }, ack: unknown) => {
      const other = targetId(data?.with);
      if (!other || !repo.areFriends(userId, other)) return fail(ack, '친구와의 대화만 볼 수 있어요.');
      repo.markRead(userId, other);
      okAck(ack, { messages: repo.history(userId, other) });
    });

    socket.on('dm:read', (data: { with?: unknown }, ack: unknown) => {
      const other = targetId(data?.with);
      if (other) repo.markRead(userId, other);
      okAck(ack);
    });

    socket.on('disconnect', () => {
      if (sessions.get(userId)?.socket !== socket) return; // 이미 새 접속으로 교체됨
      leavePark(session);
      sessions.delete(userId);
      notifyFriendsPresence(userId);
    });
  });

  return {
    /** 프로필이 수정되면 같은 공원 사용자에게 갱신 전파 */
    profileChanged(userId: number) {
      const s = sessions.get(userId);
      if (!s?.parkId) return;
      const room = rooms.get(s.parkId)!;
      const p = room.players.get(userId);
      const profile = repo.getPublicProfile(userId);
      if (!p || !profile) return;
      p.profile = profile;
      emitToRoomFiltered(room, userId, 'profile:update', profile);
    },
    privacyChanged(userId: number) { notifyFriendsPresence(userId); },
    /** 광장 스크린 콘텐츠가 바뀌면 모두에게 알림 */
    screenUpdated() { io.emit('screen:updated'); },
    /** 특정 사용자에게 실시간 알림 (방문 신청·이웃 신청 등) */
    notify(userId: number, event: string, payload: unknown) { sessions.get(userId)?.socket.emit(event, payload); },
    /** 집 꾸미기가 바뀌면 그 집에 있는 사람들에게 알림 */
    homeUpdated(ownerId: number) { io.to(homeSpaceId(ownerId)).emit('home:updated', { ownerId }); },
    /** 방문 권한이 사라진 사람은 집에서 내보냄 (공개 범위 변경·차단 등) */
    recheckHome(ownerId: number) {
      const room = rooms.get(homeSpaceId(ownerId));
      if (!room) return;
      for (const pl of [...room.players.values()]) {
        if (canVisit(pl.userId, ownerId).ok) continue;
        const s = sessions.get(pl.userId);
        if (!s) continue;
        leavePark(s);
        s.socket.emit('space:kicked', { reason: '집주인이 공개 범위를 바꿔서 로비로 나왔어요.' });
      }
    },
    kick(userId: number, reason: string) {
      const s = sessions.get(userId);
      if (!s) return;
      s.socket.emit('kicked', { reason });
      leavePark(s);
      s.socket.disconnect(true);
    },
    parks: () => [...rooms.values()].map(parkInfo),
  };
}
