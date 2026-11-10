// 집 가구 상호작용 (공통): 소파 앉기 · 침대 눕기/잠자기 · 강아지 침대 쉬기/잠자기 · 액자 사진 보기
// 가구별 자리·동작 데이터는 shared/home.ts 의 FURNITURE_INTERACT 하나로 관리한다.
import { ROOM_HALF_D, ROOM_HALF_W, furnitureSpots, type FurnAction, type InteractSpot, type PlacedInteract, type PlacedItem } from '@shared/home';
import { get, set, toast } from '../store';
import { local } from './local';
import { rendered } from '../net/remote';

export interface FurnUse {
  key: string;
  action: 'sit' | 'lie' | 'sleep';
  human: InteractSpot;
  dog: (InteractSpot & { mode: 'sit' | 'rest' | 'sleep' }) | null;
  approach: InteractSpot;
}
export interface DogTask { key: string; spot: InteractSpot; mode: 'rest' | 'sleep' }

/** 지금 쓰고 있는 가구 / 가구로 걸어가는 중 / 강아지 혼자 쉬는 중 (LocalPlayer가 매 프레임 사용) */
export const furn = {
  use: null as FurnUse | null,
  goal: null as FurnUse | null,
  goalT: 0,
  dog: null as DogTask | null,
};

export const ACTION_LABEL: Record<FurnAction, string> = {
  sit: '🛋️ 앉기', lie: '🛏️ 눕기', sleep: '😴 잠자기', dogRest: '🐶 강아지 쉬기', dogSleep: '💤 강아지 재우기', view: '🖼️ 사진 보기',
};

const layout = () => get().home?.layout ?? [];
const spotsOf = (key: string, l: PlacedItem[] = layout()) => furnitureSpots(l).find((p) => p.key === key) ?? null;
/** 다른 사람(강아지)이 이미 쓰는 자리인지 */
function taken(s: InteractSpot, who: 'human' | 'dog') {
  let t = false;
  rendered.forEach((r) => { if (Math.hypot((who === 'human' ? r.x : r.dx) - s.x, (who === 'human' ? r.z : r.dz) - s.z) < 0.3) t = true; });
  return t;
}
function syncStore() {
  set({ furnUse: furn.use ? { key: furn.use.key, action: furn.use.action } : null, dogTaskKey: furn.dog?.key ?? null });
}

/** 가구 동작 실행 (메뉴 버튼) */
export function applyFurniture(key: string, action: FurnAction) {
  const p = spotsOf(key);
  if (!p) return;
  if (action === 'view') {
    const item = layout().find((i) => `${i.type}#${i.n}` === key);
    const home = get().home;
    const url = item?.photo ?? home?.owner.dogPhoto;
    if (url && home) set({ viewer: { photos: [url], index: 0, title: `🖼️ ${home.owner.dogName}`, caption: `${home.owner.nickname}님 집 액자` } });
    else toast('아직 사진이 걸려 있지 않은 액자예요.');
    return;
  }
  if (action === 'dogRest' || action === 'dogSleep') {
    const spot = p.dog.find((s) => !taken(s, 'dog'));
    if (!spot) { toast('다른 강아지가 쓰고 있어요.'); return; }
    furn.dog = { key, spot, mode: action === 'dogSleep' ? 'sleep' : 'rest' };
    syncStore();
    toast(action === 'dogSleep' ? `💤 ${get().me?.dogName}가 쿠션에서 잠들어요` : `🐶 ${get().me?.dogName}가 쿠션에서 쉬어요`);
    return;
  }
  // 이미 이 가구를 쓰는 중이면 동작만 바꿈 (눕기 ↔ 잠자기)
  if (furn.use?.key === key) {
    furn.use = { ...furn.use, action, dog: furn.use.dog && { ...furn.use.dog, mode: action === 'sleep' ? 'sleep' : furn.use.dog.mode === 'sit' ? 'sit' : 'rest' } };
    syncStore();
    return;
  }
  const human = p.human.find((s) => !taken(s, 'human'));
  if (!human) { toast('빈자리가 없어요.'); return; }
  const use = planUse(p, action, human, nearestApproach(p));
  stopFurniture(false);
  local.seatGoal = null;
  // 가구 앞까지 걸어간 뒤 자리에 앉음 (가까우면 바로)
  if (Math.hypot(local.x - use.approach.x, local.z - use.approach.z) < 0.9) activate(use);
  else { furn.goal = use; furn.goalT = performance.now(); local.moveTarget = { x: use.approach.x, z: use.approach.z }; }
}

/** 다가갈 자리: 방 안에 있는 곳 중 지금 위치에서 가장 가까운 곳 (벽 쪽이 아닌 열린 쪽) */
function nearestApproach(p: PlacedInteract) {
  const inRoom = p.approach.filter((a) => Math.abs(a.x) < ROOM_HALF_W - 0.35 && Math.abs(a.z) < ROOM_HALF_D - 0.35);
  const list = inRoom.length ? inRoom : p.approach;
  return list.reduce((b, a) => (Math.hypot(a.x - local.x, a.z - local.z) < Math.hypot(b.x - local.x, b.z - local.z) ? a : b));
}
function planUse(p: PlacedInteract, action: FurnAction, human: InteractSpot, approach: InteractSpot): FurnUse {
  const a = action as FurnUse['action'];
  // 강아지 자리: 사람이 앉은 자리와 겹치지 않고 비어 있는 곳 (소파는 옆자리 → 없으면 옆 바닥)
  const ds = p.dog.find((s) => Math.hypot(s.x - human.x, s.z - human.z) > 0.3 && !taken(s, 'dog'));
  const mode: 'sit' | 'rest' | 'sleep' = a === 'sit' ? 'sit' : a === 'sleep' ? 'sleep' : 'rest';
  return { key: p.key, action: a, human, dog: ds ? { ...ds, mode } : null, approach };
}
function activate(use: FurnUse) {
  furn.goal = null;
  furn.use = use;
  local.moveTarget = null;
  syncStore();
}

/** 매 프레임: 걸어가던 가구에 도착했는지 확인 */
export function stepFurnitureGoal() {
  const g = furn.goal;
  if (!g) return;
  const d = Math.hypot(local.x - g.approach.x, local.z - g.approach.z);
  if (d < 0.5) { activate(g); return; }
  // 직접 움직이거나 막혀서 멈추면: 가까우면 앉고, 아니면 취소
  if (!local.moveTarget && performance.now() - furn.goalT > 300) {
    if (d < 1.6) activate(g);
    else { furn.goal = null; toast('가구에 다가가지 못했어요. 조금 더 가까이 가 주세요.'); }
  }
}

/** 일어나기 (이동 입력·일어나기 버튼·가구 변경) — 가구 앞자리로 내려옴 */
export function stopFurniture(sync = true) {
  if (furn.use) { local.x = furn.use.approach.x; local.z = furn.use.approach.z; }
  furn.use = null;
  furn.goal = null;
  if (sync) syncStore();
}
export function stopDogTask() { furn.dog = null; syncStore(); }

/** 공간을 옮기면 모두 초기화 */
export function resetFurniture() { furn.use = null; furn.goal = null; furn.dog = null; syncStore(); }

/** 가구가 옮겨지거나 치워지면 쓰던 상태를 안전하게 정리 */
export function onLayoutChanged(l: PlacedItem[]) {
  const moved = (key: string, s: InteractSpot, who: 'human' | 'dog') => {
    const p = spotsOf(key, l);
    return !p || !(who === 'human' ? p.human : p.dog).some((x) => Math.hypot(x.x - s.x, x.z - s.z) < 0.05 && Math.abs(x.rot - s.rot) < 0.01);
  };
  let changed = false;
  if (furn.use && moved(furn.use.key, furn.use.human, 'human')) {
    const p = spotsOf(furn.use.key, l);
    furn.use = null;
    if (p) { const a = nearestApproach(p); local.x = a.x; local.z = a.z; }
    changed = true;
  }
  if (furn.goal && !spotsOf(furn.goal.key, l)) { furn.goal = null; changed = true; }
  if (furn.dog && moved(furn.dog.key, furn.dog.spot, 'dog')) { furn.dog = null; changed = true; }
  if (changed) { syncStore(); toast('가구가 바뀌어서 자리에서 일어났어요.'); }
}
