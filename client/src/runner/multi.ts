// 멍글런너 '함께 달리기' — 화면 쪽 상태·서버 통신
// 서버 시계와 내 시계 차이를 재서, 서버가 정한 시작 시각(음악 0초)에 모두가 같이 출발한다.
import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import type { RunnerAction, RunnerDifficulty, RunnerInput } from '@shared/runner';
import type { MRInputMsg, MRResult, MRRoom, MRStanding } from '@shared/runnerMulti';
import { emitRaw, request } from '../net/socket';
import { get as getApp, set as setApp, toast } from '../store';

export interface StartSignal { round: number; startAt: number; courseId: string; difficulty: RunnerDifficulty; resumed?: boolean; myInputs?: RunnerInput[] }
interface MultiState {
  room: MRRoom | null;
  start: StartSignal | null;
  results: { round: number; results: MRResult[] } | null;
}
export const useMulti = create<MultiState>()(() => ({ room: null, start: null, results: null }));
const set = useMulti.setState;
const get = useMulti.getState;

/** 달리는 중 매 프레임 읽는 값 (화면 갱신 없이 변경) */
export const multiLive = {
  inputs: {} as Record<number, RunnerInput[]>,
  standings: [] as MRStanding[],
  round: 0,
};

// ---------------------------------------------------------------- 서버 시계 맞추기
let offset = 0;
export const serverNow = () => Date.now() + offset;
/** 왕복 시간이 가장 짧은 측정값으로 시계 차이 계산 (네트워크 지연의 절반을 보정) */
export async function syncClock() {
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await request<{ now: number }>('rm:clock');
    const t1 = Date.now();
    if (r.ok && t1 - t0 < best) { best = t1 - t0; offset = r.now - (t0 + t1) / 2; }
  }
  return { offset, rtt: best };
}

const KEY = 'mungle.runner.room';
const remember = (code: string | null) => { try { code ? sessionStorage.setItem(KEY, code) : sessionStorage.removeItem(KEY); } catch { /* 무시 */ } };
const remembered = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };

function applyRoom(room: MRRoom) {
  set({ room });
  remember(room.code);
}

/** 소켓이 만들어질 때마다 연결 (socket.ts에서 호출) */
export function attachMulti(s: Socket) {
  s.on('rm:room', (room: MRRoom) => { if (get().room?.code === room.code || !get().room) applyRoom(room); });
  s.on('rm:start', (d: StartSignal & { serverNow: number }) => {
    multiLive.inputs = {}; multiLive.standings = []; multiLive.round = d.round;
    set({ start: { round: d.round, startAt: d.startAt, courseId: d.courseId, difficulty: d.difficulty }, results: null });
  });
  s.on('rm:input', (m: MRInputMsg) => { (multiLive.inputs[m.id] ??= []).push({ t: m.t, a: m.a }); });
  s.on('rm:standings', (d: { round: number; list: MRStanding[] }) => { if (d.round === multiLive.round) multiLive.standings = d.list; });
  s.on('rm:result', (d: { round: number; results: MRResult[] }) => set({ results: d, start: null }));
  s.on('rm:notice', (d: { text: string }) => toast(`🏃 ${d.text}`));
  s.on('runner:invite', (d: { code: string; nickname: string; dogName: string }) => {
    setApp({ runnerInvite: { code: d.code, nickname: d.nickname, dogName: d.dogName } });
  });
  // 다시 연결되면: 들어가 있던 방으로 복귀 (달리는 중이면 끊긴 동안 누른 입력도 함께 보냄)
  s.on('connect', () => { void resume(); });
}

/** 다시 접속·새로고침 복구 */
export async function resume() {
  const code = get().room?.code ?? remembered();
  if (!code) return;
  const start = get().start;
  const r = await request<{ room: MRRoom; serverNow: number; inputs: Record<number, RunnerInput[]> }>('rm:resume', { code, round: start?.round, inputs: pending.splice(0) });
  if (!r.ok) {
    if (get().room) toast('함께 달리기 방이 끝났어요.', 'error');
    remember(null); set({ room: null, start: null });
    return;
  }
  applyRoom(r.room);
  await syncClock();
  const me = getApp().me?.id ?? 0;
  if (r.room.state === 'playing' && r.room.startAt) {
    multiLive.round = r.room.round;
    for (const [id, list] of Object.entries(r.inputs)) if (Number(id) !== me) multiLive.inputs[Number(id)] = list;
    // 새로고침으로 화면이 처음부터 열린 경우: 진행 중인 판으로 바로 들어감
    if (!start || start.round !== r.room.round) {
      set({ start: { round: r.room.round, startAt: r.room.startAt, courseId: r.room.courseId, difficulty: r.room.difficulty, resumed: true, myInputs: r.inputs[me] ?? [] } });
      setApp({ runner: true });
    }
  }
}

// ---------------------------------------------------------------- 방 조작
async function call<T>(ev: string, data?: unknown) {
  const r = await request<T>(ev, data);
  if (!r.ok) throw new Error(r.error);
  return r;
}
export async function createRoom(courseId: string, difficulty: RunnerDifficulty) {
  const r = await call<{ room: MRRoom }>('rm:create', { courseId, difficulty });
  set({ results: null, start: null }); applyRoom(r.room);
  void syncClock();
}
export async function joinRoom(code: string) {
  const r = await call<{ room: MRRoom }>('rm:join', { code: code.trim().toUpperCase() });
  set({ results: null, start: null }); applyRoom(r.room);
  void syncClock();
}
export async function leaveRoom() {
  await request('rm:leave');
  remember(null);
  set({ room: null, start: null, results: null });
}
export const setReady = (ready: boolean) => call('rm:ready', { ready });
export const setSettings = (s: { courseId?: string; difficulty?: RunnerDifficulty }) => call('rm:settings', s);
export const invite = (userId: number) => call('rm:invite', { userId });

/** 끊긴 동안 누른 입력 (다시 연결되면 함께 보냄) */
const pending: RunnerInput[] = [];
export function sendInput(round: number, t: number, a: RunnerAction) {
  if (!emitRaw('rm:input', { round, t, a })) pending.push({ t, a });
}
export const clearResults = () => set({ results: null });
