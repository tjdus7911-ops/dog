// 멍글마을 공간(장소) — 공원·아파트 로비·개인 집을 같은 방식으로 다룬다.
// 장소가 늘어나면 PLACES에 추가하고, 이동 범위/충돌은 spaceCollider에 규칙을 추가하면 된다.
import { PARKS } from './protocol';
import { resolveCollision, WORLD_RADIUS } from './world';
import { FURNITURE_BY_ID, ROOM_HALF_D, ROOM_HALF_W, type PlacedItem } from './home';

export type SpaceKind = 'park' | 'lobby' | 'home' | 'cafe' | 'shop';

export interface Place {
  id: string;
  kind: SpaceKind;
  name: string;
  icon: string;
}

/** 상단 장소 선택 메뉴에 보이는 장소 (개인 집은 로비에서 들어감) */
export const PLACES: Place[] = [
  ...PARKS.map((p) => ({ ...p, kind: 'park' as const, icon: '🌳' })),
  { id: 'lobby-1', kind: 'lobby', name: '멍글 아파트', icon: '🏢' },
  { id: 'cafe-1', kind: 'cafe', name: '멍글 애견카페', icon: '☕' },
  { id: 'shop-1', kind: 'shop', name: '멍글 애견샵', icon: '🛍️' },
];

export const homeSpaceId = (ownerId: number) => `home-${ownerId}`;

/** 공간 id 해석: 공원 / 아파트 로비(동) / 개인 집(집주인 id) */
export function parseSpace(id: unknown): { kind: SpaceKind; building?: string; ownerId?: number } | null {
  if (typeof id !== 'string') return null;
  if (PARKS.some((p) => p.id === id)) return { kind: 'park' };
  const lobby = /^lobby-(\w{1,8})$/.exec(id);
  if (lobby && PLACES.some((p) => p.id === id)) return { kind: 'lobby', building: lobby[1] };
  const pl = PLACES.find((p) => p.id === id);
  if (pl && (pl.kind === 'cafe' || pl.kind === 'shop')) return { kind: pl.kind };
  const home = /^home-(\d{1,10})$/.exec(id);
  if (home) return { kind: 'home', ownerId: Number(home[1]) };
  return null;
}

/** 실내 공간 크기 (중심 기준 반폭) */
export const LOBBY_HALF_W = 4.1;
export const LOBBY_HALF_D = 3.0;
export const SPAWNS: Record<Exclude<SpaceKind, 'park'>, [number, number]> = { lobby: [0, 2.3], home: [0.8, 2.2], cafe: [0, 2.3], shop: [0, 2.3] };
/** 애견카페·애견샵 실내 크기 */
export const SHOP_HALF_W = 4.1;
export const SHOP_HALF_D = 3.0;

/** 애견카페: 카운터 + 동그란 테이블 3개 / 애견샵: 카운터 + 진열대 */
export const CAFE_TABLES = [{ x: -2.4, z: 0.2 }, { x: 0.2, z: -0.6 }, { x: 2.6, z: 0.6 }];
export const CAFE_COUNTER = { x: 0, z: -2.5, hw: 1.8, hd: 0.4 };
export const SHOP_COUNTER = { x: 2.2, z: -2.4, hw: 1.3, hd: 0.45 };
export const SHOP_SHELVES = [{ x: -3.6, z: -0.6, hw: 0.35, hd: 1.4 }, { x: -1.2, z: -2.6, hw: 1.2, hd: 0.3 }];

/** 로비 가구(소파·화분) 충돌 */
const LOBBY_OBSTACLES = [
  { x: 3.0, z: 0.2, hw: 0.45, hd: 1.05 },
  { x: -3.8, z: -2.8, hw: 0.35, hd: 0.35 },
  { x: 3.8, z: -2.8, hw: 0.35, hd: 0.35 },
];

/** 충돌을 무시하는 작은 소품 / 바닥 장식 */
const WALKABLE = new Set(['rug', 'ball', 'bone']);

function pushOutBox(x: number, z: number, r: number, b: { x: number; z: number; hw: number; hd: number }): [number, number] {
  const cx = Math.max(b.x - b.hw, Math.min(x, b.x + b.hw));
  const cz = Math.max(b.z - b.hd, Math.min(z, b.z + b.hd));
  const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return [x, z];
  if (d2 > 1e-8) { const d = Math.sqrt(d2); return [cx + (dx / d) * r, cz + (dz / d) * r]; }
  const px = b.hw - Math.abs(x - b.x), pz = b.hd - Math.abs(z - b.z);
  return px < pz ? [b.x + Math.sign(x - b.x || 1) * (b.hw + r), z] : [x, b.z + Math.sign(z - b.z || 1) * (b.hd + r)];
}

export type Collider = (x: number, z: number, r: number) => [number, number];

/** 공간별 이동 가능 범위 + 장애물 */
export function spaceCollider(kind: SpaceKind, layout: PlacedItem[] = []): Collider {
  if (kind === 'park') return resolveCollision;
  const hw = kind === 'home' ? ROOM_HALF_W - 0.25 : kind === 'lobby' ? LOBBY_HALF_W : SHOP_HALF_W;
  const hd = kind === 'home' ? ROOM_HALF_D - 0.25 : kind === 'lobby' ? LOBBY_HALF_D : SHOP_HALF_D;
  const circles = kind === 'home'
    ? layout.filter((i) => !WALKABLE.has(i.type)).map((i) => ({ x: i.x, z: i.z, r: (FURNITURE_BY_ID.get(i.type)?.r ?? 0.4) * 0.85 }))
    : kind === 'cafe' ? CAFE_TABLES.map((t) => ({ ...t, r: 0.55 })) : [];
  const boxes = kind === 'lobby' ? LOBBY_OBSTACLES : kind === 'cafe' ? [CAFE_COUNTER] : kind === 'shop' ? [SHOP_COUNTER, ...SHOP_SHELVES] : [];
  return (x, z, r) => {
    for (let k = 0; k < 2; k++) {
      for (const c of circles) {
        const dx = x - c.x, dz = z - c.z, min = c.r + r, d2 = dx * dx + dz * dz;
        if (d2 < min * min) { const d = Math.sqrt(d2) || 1e-4; x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; }
      }
      for (const b of boxes) [x, z] = pushOutBox(x, z, r, b);
      x = Math.max(-hw + r, Math.min(hw - r, x));
      z = Math.max(-hd + r, Math.min(hd - r, z));
    }
    return [x, z];
  };
}

/** 서버 검증용: 공간 안에 있는 좌표인지 (여유 포함) */
export function insideSpace(kind: SpaceKind, x: number, z: number) {
  if (kind === 'park') return Math.hypot(x, z) <= WORLD_RADIUS + 0.5;
  const hw = kind === 'home' ? ROOM_HALF_W : kind === 'lobby' ? LOBBY_HALF_W : SHOP_HALF_W;
  const hd = kind === 'home' ? ROOM_HALF_D : kind === 'lobby' ? LOBBY_HALF_D : SHOP_HALF_D;
  return Math.abs(x) <= hw + 0.3 && Math.abs(z) <= hd + 0.3;
}
