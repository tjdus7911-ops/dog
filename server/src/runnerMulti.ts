// 멍글런너 '함께 달리기' — 실시간 멀티플레이 서버 (Socket.IO)
// - 방 코드로 최대 4명, 방장이 곡·난이도 선택, 전원 준비 → 서버가 정한 시작 시각(음악 0초)을 모두에게 전달
// - 각자 자기 기기의 음악 시계로 입력 시각을 기록해 보내고, 서버는 같은 judgeRun으로 점수·순위를 계산 (보낸 점수는 쓰지 않음)
// - 입력은 다른 참가자에게 그대로 전달 → 각 화면이 다른 강아지의 레인·점프를 같은 규칙으로 재현
// - 중도 이탈·연결 끊김·재접속·방장 퇴장 처리, 끝나면 서버가 최종 판정·순위·코인 지급
// - 리듬 페이스: 판정 결과로 플레이어마다 달린 거리를 서버가 직접 계산 (shared/runnerPace) → 순위는 거리 → 정확도 → 점수.
//   화면이 보내는 거리·점수는 받지 않으므로 거리를 조작할 수 없다.
import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import * as repo from './db';
import { earnAmount } from './coins';
import { COURSE_BY_ID, JUDGE, buildChart, courseSpeed, isDifficulty, judgeRun, type Chart, type RunnerDifficulty, type RunnerInput } from '../../shared/runner';
import { PaceSim, paceDistance } from '../../shared/runnerPace';
import {
  MR_CODE_CHARS, MR_COUNTDOWN_MS, MR_LEAD_MS, MR_MAX, MR_MIN_PASS, MR_REWARD, byDistance, isRoomCode, roundDist,
  type MRPlayer, type MRResult, type MRRoom, type MRStanding,
} from '../../shared/runnerMulti';

/** 서버 판정에서 아직 도착하지 않았을 수 있는 입력을 기다리는 여유 (실시간 순위판용) */
const LIVE_LAG_MS = 450;
/** 곡이 끝난 뒤 마지막 입력이 도착할 여유 */
const END_GRACE_MS = Number(process.env.MUNGLE_MR_END_GRACE_MS ?? 1500);
/** 로비에서 연결이 끊긴 사람을 기다리는 시간 */
const LOBBY_GRACE_MS = Number(process.env.MUNGLE_MR_LOBBY_GRACE_MS ?? 20000);
/** 입력 시각 검사: 미래(시계 오차 허용) / 너무 늦게 도착한 입력 */
const FUTURE_SLACK_MS = 900;
const LATE_LIMIT_MS = 3000;
/** 테스트용: 곡 길이를 줄여 빠르게 끝냄 (운영에서는 쓰지 않음) */
const DURATION_OVERRIDE = Number(process.env.MUNGLE_MR_DURATION_MS ?? 0);

interface Member extends MRPlayer {
  joinedAt: number;
  socketId: string | null;
  inputs: RunnerInput[];
  /** 이번 판 도중 나감 (결과에는 '중도 이탈'로 남음) */
  left: boolean;
  /** 나간 음악 시각 (그 뒤로는 거리가 늘지 않음) */
  leftAt: number;
  /** 판정 결과 → 페이스·거리 (서버 계산) */
  sim: PaceSim | null;
  lobbyTimer: NodeJS.Timeout | null;
}
interface Room extends Omit<MRRoom, 'players'> {
  players: Member[];
  chart: Chart | null;
  createdAt: number;
  lastActive: number;
  timer: NodeJS.Timeout | null;
}

export interface MultiDeps { notify: (userId: number, event: string, payload: unknown) => void }

export function setupRunnerMulti(io: Server, deps: MultiDeps) {
  const rooms = new Map<string, Room>();
  const userRoom = new Map<number, string>();
  const chan = (code: string) => `rm:${code}`;

  const view = (r: Room): MRRoom => ({
    code: r.code, visibility: r.visibility, hostId: r.hostId, courseId: r.courseId, difficulty: r.difficulty, state: r.state, round: r.round, startAt: r.startAt,
    players: r.players.filter((p) => !p.left).map(({ id, nickname, dogName, dogPhoto, dog, ready, host, connected }) => ({ id, nickname, dogName, dogPhoto, dog, ready, host, connected })),
  });
  const broadcast = (r: Room) => io.to(chan(r.code)).emit('rm:room', view(r));
  const active = (r: Room) => r.players.filter((p) => !p.left);
  const chartNow = (r: Room) => Date.now() - (r.startAt ?? Date.now());
  const durationOf = (r: Room) => (DURATION_OVERRIDE > 0 ? Math.min(DURATION_OVERRIDE, r.chart!.duration) : r.chart!.duration);

  function newCode() {
    for (;;) {
      const bytes = crypto.randomBytes(6);
      const code = Array.from(bytes, (b) => MR_CODE_CHARS[b % MR_CODE_CHARS.length]).join('');
      if (!rooms.has(code)) return code;
    }
  }
  function member(userId: number, socketId: string): Member | null {
    const p = repo.getPublicProfile(userId);
    if (!p) return null;
    return { id: userId, nickname: p.nickname, dogName: p.dogName, dogPhoto: p.dogPhoto, dog: p.dog, ready: false, host: false, connected: true, joinedAt: Date.now(), socketId, inputs: [], left: false, leftAt: Infinity, sim: null, lobbyTimer: null };
  }
  function setHost(r: Room) {
    const cand = active(r).filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0] ?? active(r).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!cand) return;
    r.hostId = cand.id;
    for (const p of r.players) p.host = p.id === cand.id;
  }
  function closeRoom(r: Room) {
    if (r.timer) clearInterval(r.timer);
    for (const p of r.players) { if (p.lobbyTimer) clearTimeout(p.lobbyTimer); if (userRoom.get(p.id) === r.code) userRoom.delete(p.id); }
    io.in(chan(r.code)).socketsLeave(chan(r.code));
    rooms.delete(r.code);
  }
  /** 방에서 완전히 빠짐 (로비) / 이번 판에서 이탈 (경기 중) */
  function removeMember(r: Room, userId: number, why: 'leave' | 'timeout') {
    const p = r.players.find((x) => x.id === userId);
    if (!p) return;
    if (p.lobbyTimer) { clearTimeout(p.lobbyTimer); p.lobbyTimer = null; }
    if (r.state === 'playing') { p.left = true; p.leftAt = chartNow(r); p.connected = false; p.ready = false; }
    else r.players = r.players.filter((x) => x.id !== userId);
    if (userRoom.get(userId) === r.code) userRoom.delete(userId);
    if (p.socketId) io.sockets.sockets.get(p.socketId)?.leave(chan(r.code));
    p.socketId = null;
    if (!active(r).length) { closeRoom(r); return; }
    if (r.hostId === userId) setHost(r);
    io.to(chan(r.code)).emit('rm:notice', { text: `${p.nickname}님이 ${why === 'timeout' ? '연결이 끊겨 나갔어요' : '방을 나갔어요'}` });
    broadcast(r);
    maybeStart(r);
  }

  /** 전원 준비(2명 이상) → 시작 시각 확정 */
  function maybeStart(r: Room) {
    if (r.state !== 'lobby') return;
    const ps = active(r);
    if (ps.length < 2 || !ps.every((p) => p.ready && p.connected)) return;
    r.chart = buildChart(r.courseId, r.difficulty);
    if (!r.chart) return;
    r.state = 'playing';
    r.round += 1;
    r.startAt = Date.now() + MR_LEAD_MS + MR_COUNTDOWN_MS;
    const speed = courseSpeed(r.courseId, r.difficulty);
    for (const p of r.players) { p.inputs = []; p.sim = new PaceSim(r.chart, speed, r.difficulty); p.leftAt = Infinity; }
    io.to(chan(r.code)).emit('rm:start', { round: r.round, startAt: r.startAt, courseId: r.courseId, difficulty: r.difficulty, serverNow: Date.now() });
    broadcast(r);
    r.timer = setInterval(() => tick(r), 250);
  }

  function standings(r: Room, now: number): MRStanding[] {
    const list = active(r).concat(r.players.filter((p) => p.left)).map((p) => {
      // 나간 사람은 나간 시각에서 거리가 멈춤
      const until = Math.max(0, Math.min(now, p.leftAt));
      const j = judgeRun(r.chart!, p.inputs, until);
      const st = p.sim!.advance(j.events, until).state;
      return { id: p.id, rank: 0, distance: roundDist(st.dist), pace: Math.round(st.pace * 1000) / 1000, score: j.score, accuracy: j.accuracy, combo: j.combo, maxCombo: j.maxCombo, judged: j.events.length, connected: p.connected, left: p.left };
    });
    // 순위: 이탈하지 않은 사람 먼저, 그 안에서 거리 → 정확도 → 점수
    list.sort((a, b) => Number(a.left) - Number(b.left) || byDistance(a, b));
    list.forEach((x, i) => { x.rank = i + 1; });
    return list;
  }
  function tick(r: Room) {
    if (r.state !== 'playing' || !r.chart) return;
    const now = chartNow(r);
    io.to(chan(r.code)).emit('rm:standings', { round: r.round, t: now - LIVE_LAG_MS, list: standings(r, now - LIVE_LAG_MS) });
    if (now >= durationOf(r) + END_GRACE_MS) finish(r);
  }

  /** 최종 판정: 서버가 입력 기록으로 다시 계산 → 정상 완주자만 순위·코인 */
  function finish(r: Room) {
    if (r.timer) { clearInterval(r.timer); r.timer = null; }
    const chart = r.chart!;
    const dur = durationOf(r);
    const speed = courseSpeed(r.courseId, r.difficulty);
    const results: MRResult[] = r.players.map((p) => {
      const j = judgeRun(chart, p.inputs.filter((x) => x.t <= dur), dur + 500);
      // 거리: 음악이 끝나는 순간까지 (나간 사람은 나간 순간까지) — 처음부터 다시 계산해 확정
      const distance = roundDist(paceDistance(chart, j.events, Math.min(dur, p.leftAt), speed, r.difficulty));
      const timed = j.events.filter((e) => e.delta !== null);
      const passed = j.events.filter((e) => e.grade !== 'miss').length;
      const total = chart.obstacles.filter((o) => o.t <= dur).length || 1;
      let reason: string | null = null;
      if (p.left) reason = '중도 이탈';
      else if (!p.connected) reason = '연결 끊김';
      else if (timed.length >= 15 && timed.every((e) => Math.abs(e.delta!) <= 4)) reason = '비정상 기록';
      else if (j.score > chart.maxScore || timed.some((e) => Math.abs(e.delta!) > JUDGE.good)) reason = '비정상 기록';
      else if (passed / total < MR_MIN_PASS) reason = '통과한 장애물이 너무 적어요';
      return { id: p.id, nickname: p.nickname, dogName: p.dogName, rank: null, distance, score: j.score, accuracy: j.accuracy, maxCombo: j.maxCombo, counts: j.counts, completed: !reason, reason, coin: 0 };
    });
    // 최종 순위: 달린 거리 → 정확도 → 점수 (→ 최대 콤보 → 먼저 들어온 사람)
    const done = results.filter((x) => x.completed).sort((a, b) => byDistance(a, b) || b.maxCombo - a.maxCombo || a.id - b.id);
    done.forEach((x, i) => {
      x.rank = i + 1;
      const e = earnAmount(x.id, 'runner', `mr-${r.code}-${r.round}`, MR_REWARD[i] ?? MR_REWARD[MR_REWARD.length - 1], `함께 달리기 ${i + 1}위`);
      x.coin = e?.amount ?? 0;
    });
    const out = [...done, ...results.filter((x) => !x.completed).sort(byDistance)];
    io.to(chan(r.code)).emit('rm:result', { round: r.round, results: out });
    // 다음 판 준비: 이탈한 사람은 정리, 준비 상태 초기화
    for (const p of r.players.filter((x) => x.left)) if (userRoom.get(p.id) === r.code) userRoom.delete(p.id);
    r.players = r.players.filter((p) => !p.left);
    r.state = 'lobby'; r.startAt = null;
    for (const p of r.players) p.ready = false;
    // 끝날 때 연결이 끊겨 있던 사람은 로비 대기 시간 뒤 정리
    for (const p of r.players) if (!p.connected) scheduleLobbyDrop(r, p);
    if (!r.players.length) { closeRoom(r); return; }
    if (!r.players.some((p) => p.id === r.hostId)) setHost(r);
    broadcast(r);
  }
  function scheduleLobbyDrop(r: Room, p: Member) {
    if (p.lobbyTimer) clearTimeout(p.lobbyTimer);
    p.lobbyTimer = setTimeout(() => { p.lobbyTimer = null; if (!p.connected && rooms.get(r.code) === r && r.state === 'lobby') removeMember(r, p.id, 'timeout'); }, LOBBY_GRACE_MS);
  }

  // 오래 쓰지 않은 방 정리
  setInterval(() => { for (const r of rooms.values()) if (r.state === 'lobby' && Date.now() - r.lastActive > 2 * 3600_000) closeRoom(r); }, 600_000).unref();

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as number;
    const guest = socket.data.role === 'guest';
    const ok = (ack: unknown, data: object = {}) => typeof ack === 'function' && ack({ ok: true, ...data });
    const fail = (ack: unknown, error: string, code?: string) => typeof ack === 'function' && ack({ ok: false, error, ...(code ? { code } : {}) });
    const myRoom = () => { const c = userRoom.get(userId); return c ? rooms.get(c) ?? null : null; };
    const me = (r: Room) => r.players.find((p) => p.id === userId) ?? null;
    const memberOnly = (ack: unknown) => fail(ack, '함께 달리기는 멍글마을 주민만 이용할 수 있어요.', 'members_only');

    // 다시 접속했을 때: 들어가 있던 방에 소켓 연결만 다시 (화면이 rm:resume으로 상태를 받아 감)
    const prev = myRoom();
    if (prev) { const p = me(prev); if (p && !p.left) { p.socketId = socket.id; } }

    /** 서버 시계 (화면이 지연을 재서 시계 차이를 맞춤) */
    socket.on('rm:clock', (_: unknown, ack: unknown) => ok(ack, { now: Date.now() }));

    socket.on('rm:create', (d: { courseId?: unknown; difficulty?: unknown } | undefined, ack: unknown) => {
      if (guest) return memberOnly(ack);
      if (myRoom()) return fail(ack, '이미 들어가 있는 방이 있어요. 먼저 나와 주세요.', 'in_room');
      const courseId = typeof d?.courseId === 'string' && COURSE_BY_ID.get(d.courseId)?.available ? d.courseId : 'elise';
      const difficulty: RunnerDifficulty = isDifficulty(d?.difficulty) ? d.difficulty : 'normal';
      const m = member(userId, socket.id);
      if (!m) return fail(ack, '프로필을 찾을 수 없어요.');
      m.host = true;
      const code = newCode();
      const r: Room = { code, visibility: 'private', hostId: userId, courseId, difficulty, state: 'lobby', round: 0, startAt: null, players: [m], chart: null, createdAt: Date.now(), lastActive: Date.now(), timer: null };
      rooms.set(code, r);
      userRoom.set(userId, code);
      socket.join(chan(code));
      ok(ack, { room: view(r) });
    });

    socket.on('rm:join', (d: { code?: unknown } | undefined, ack: unknown) => {
      if (guest) return memberOnly(ack);
      const code = typeof d?.code === 'string' ? d.code.trim().toUpperCase() : '';
      if (!isRoomCode(code)) return fail(ack, '방 코드 6자리를 확인해 주세요.');
      const r = rooms.get(code);
      if (!r) return fail(ack, '없는 방이에요. 코드를 다시 확인해 주세요.', 'not_found');
      const cur = myRoom();
      if (cur && cur !== r) return fail(ack, '이미 다른 방에 들어가 있어요. 먼저 나와 주세요.', 'in_room');
      const existing = me(r);
      if (existing && !existing.left) {
        existing.socketId = socket.id; existing.connected = true;
        if (existing.lobbyTimer) { clearTimeout(existing.lobbyTimer); existing.lobbyTimer = null; }
        socket.join(chan(code)); broadcast(r);
        return ok(ack, { room: view(r) });
      }
      if (r.state !== 'lobby') return fail(ack, '이미 달리기가 시작된 방이에요. 끝난 뒤 다시 들어와 주세요.', 'started');
      if (active(r).length >= MR_MAX) return fail(ack, `방이 가득 찼어요. (최대 ${MR_MAX}명)`, 'full');
      if (r.players.some((p) => repo.eitherBlocked(userId, p.id))) return fail(ack, '들어갈 수 없는 방이에요.', 'blocked');
      const m = member(userId, socket.id);
      if (!m) return fail(ack, '프로필을 찾을 수 없어요.');
      r.players.push(m);
      r.lastActive = Date.now();
      userRoom.set(userId, code);
      socket.join(chan(code));
      broadcast(r);
      ok(ack, { room: view(r) });
    });

    socket.on('rm:leave', (_: unknown, ack: unknown) => {
      const r = myRoom();
      if (r) removeMember(r, userId, 'leave');
      ok(ack);
    });

    socket.on('rm:ready', (d: { ready?: unknown } | undefined, ack: unknown) => {
      const r = myRoom();
      const p = r && me(r);
      if (!r || !p) return fail(ack, '방에 들어가 있지 않아요.');
      if (r.state !== 'lobby') return fail(ack, '이미 시작했어요.');
      p.ready = d?.ready === true;
      r.lastActive = Date.now();
      broadcast(r);
      ok(ack);
      maybeStart(r);
    });

    /** 방장: 곡·난이도 (바꾸면 모두 준비 해제) */
    socket.on('rm:settings', (d: { courseId?: unknown; difficulty?: unknown } | undefined, ack: unknown) => {
      const r = myRoom();
      if (!r || r.hostId !== userId) return fail(ack, '방장만 바꿀 수 있어요.');
      if (r.state !== 'lobby') return fail(ack, '달리는 중에는 바꿀 수 없어요.');
      if (typeof d?.courseId === 'string') {
        if (!COURSE_BY_ID.get(d.courseId)?.available) return fail(ack, '아직 음원이 준비되지 않은 곡이에요.');
        r.courseId = d.courseId;
      }
      if (isDifficulty(d?.difficulty)) r.difficulty = d.difficulty;
      for (const p of r.players) p.ready = false;
      broadcast(r);
      ok(ack);
    });

    /** 친구 초대: 멍글마을 친구에게 알림 (방 코드 포함) */
    socket.on('rm:invite', (d: { userId?: unknown } | undefined, ack: unknown) => {
      const r = myRoom();
      const to = Number(d?.userId);
      if (!r) return fail(ack, '방에 들어가 있지 않아요.');
      if (!Number.isInteger(to) || !repo.areFriends(userId, to)) return fail(ack, '친구에게만 초대를 보낼 수 있어요.');
      if (active(r).length >= MR_MAX) return fail(ack, '방이 가득 찼어요.');
      if (r.state !== 'lobby') return fail(ack, '달리기가 끝난 뒤 초대해 주세요.');
      const p = repo.getPublicProfile(userId)!;
      deps.notify(to, 'runner:invite', { code: r.code, fromId: userId, nickname: p.nickname, dogName: p.dogName, courseId: r.courseId });
      ok(ack);
    });

    /** 달리는 중 입력: 시각 검사 → 저장 → 다른 참가자에게 전달 */
    socket.on('rm:input', (d: { round?: unknown; t?: unknown; a?: unknown } | undefined) => {
      const r = myRoom();
      const p = r && me(r);
      if (!r || !p || p.left || r.state !== 'playing' || d?.round !== r.round) return;
      const t = Number(d?.t), a = d?.a;
      if (!Number.isInteger(t) || !['L', 'R', 'J', 'D'].includes(a as string)) return;
      const now = chartNow(r);
      const last = p.inputs[p.inputs.length - 1]?.t ?? -Infinity;
      if (t < last || t > now + FUTURE_SLACK_MS || t < now - LATE_LIMIT_MS || t < -1000 || p.inputs.length > r.chart!.obstacles.length * 8 + 80) return;
      p.inputs.push({ t, a: a as RunnerInput['a'] });
      socket.to(chan(r.code)).emit('rm:input', { id: userId, t, a });
    });

    /** 다시 접속·새로고침: 방 상태 + 모든 참가자 입력을 돌려줌. 끊긴 동안 쌓인 내 입력도 받음 */
    socket.on('rm:resume', (d: { code?: unknown; round?: unknown; inputs?: unknown } | undefined, ack: unknown) => {
      const r = isRoomCode(d?.code) ? rooms.get(d.code) : undefined;
      const p = r && me(r);
      if (!r || !p || p.left || userRoom.get(userId) !== r.code) return fail(ack, '이 방은 이미 끝났거나 나온 방이에요.', 'gone');
      p.socketId = socket.id; p.connected = true;
      if (p.lobbyTimer) { clearTimeout(p.lobbyTimer); p.lobbyTimer = null; }
      socket.join(chan(r.code));
      if (r.state === 'playing' && d?.round === r.round && Array.isArray(d?.inputs)) {
        const now = chartNow(r);
        let last = p.inputs[p.inputs.length - 1]?.t ?? -Infinity;
        for (const x of d.inputs as RunnerInput[]) {
          if (!x || !Number.isInteger(x.t) || !['L', 'R', 'J', 'D'].includes(x.a) || x.t <= last || x.t > now + FUTURE_SLACK_MS) continue;
          p.inputs.push({ t: x.t, a: x.a }); last = x.t;
          socket.to(chan(r.code)).emit('rm:input', { id: userId, t: x.t, a: x.a });
        }
      }
      broadcast(r);
      ok(ack, { room: view(r), serverNow: Date.now(), inputs: Object.fromEntries(r.players.map((x) => [x.id, x.inputs])) });
    });

    socket.on('disconnect', () => {
      const r = myRoom();
      const p = r && me(r);
      if (!r || !p || p.socketId !== socket.id) return;
      p.connected = false; p.socketId = null;
      if (r.state === 'lobby') { p.ready = false; scheduleLobbyDrop(r, p); }
      // 방장이 끊기면 연결된 다른 사람에게 방장을 넘김
      if (r.hostId === userId && active(r).some((x) => x.connected)) setHost(r);
      broadcast(r);
    });
  });

  return {
    /** 테스트·관리용 */
    roomCount: () => rooms.size,
  };
}
