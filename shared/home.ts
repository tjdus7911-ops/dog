// 멍글 아파트 개인 집 — 가구 목록·배치 데이터 형식·검증 (서버와 화면이 함께 사용)
import type { DogAvatar, HumanAvatar } from './avatar';
export type HomeVisibility = 'public' | 'friends' | 'neighbors' | 'private';
export const HOME_VISIBILITY: { id: HomeVisibility; label: string; desc: string }[] = [
  { id: 'public', label: '전체 공개', desc: '누구나 방문할 수 있어요' },
  { id: 'friends', label: '친구만', desc: '친구만 방문할 수 있어요' },
  { id: 'neighbors', label: '이웃만', desc: '같은 아파트 동 주민만 방문할 수 있어요' },
  { id: 'private', label: '비공개', desc: '나만 들어갈 수 있어요' },
];

export interface FurnitureType {
  id: string;
  label: string;
  icon: string;
  /** 보유 개수 (배치하지 않은 것은 보관함에 있음) */
  count: number;
  /** 바닥에서 차지하는 반지름 (배치 검증용) */
  r: number;
}

/** 입주 선물로 받는 기본 가구 세트 */
export const FURNITURE: FurnitureType[] = [
  { id: 'dogbed', label: '강아지 침대', icon: '🛏️', count: 1, r: 0.55 },
  { id: 'sofa', label: '소파', icon: '🛋️', count: 1, r: 0.9 },
  { id: 'table', label: '동그란 탁자', icon: '🪵', count: 1, r: 0.5 },
  { id: 'rug', label: '러그', icon: '🟠', count: 1, r: 1.0 },
  { id: 'frame', label: '강아지 사진 액자', icon: '🖼️', count: 2, r: 0.35 },
  { id: 'plant', label: '화분', icon: '🪴', count: 2, r: 0.3 },
  { id: 'lamp', label: '스탠드 조명', icon: '💡', count: 1, r: 0.3 },
  { id: 'shelf', label: '책장', icon: '📚', count: 1, r: 0.6 },
  { id: 'ball', label: '공 장난감', icon: '🎾', count: 2, r: 0.15 },
  { id: 'bone', label: '뼈다귀 장난감', icon: '🦴', count: 1, r: 0.2 },
  { id: 'bowl', label: '밥그릇', icon: '🥣', count: 1, r: 0.2 },
];
export const FURNITURE_BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));

/** 방 크기 (바닥 중심 기준 반폭) */
export const ROOM_HALF_W = 3.6;
export const ROOM_HALF_D = 3.0;

export interface PlacedItem {
  /** 가구 종류 */
  type: string;
  /** 같은 종류 중 몇 번째 (0부터) */
  n: number;
  x: number;
  z: number;
  /** 회전 (90도 단위, 0~3) */
  rot: number;
}

export const itemKey = (i: Pick<PlacedItem, 'type' | 'n'>) => `${i.type}#${i.n}`;

/** 처음 입주했을 때 기본 배치 */
export const DEFAULT_LAYOUT: PlacedItem[] = [
  { type: 'rug', n: 0, x: 0, z: 0.4, rot: 0 },
  { type: 'dogbed', n: 0, x: -2.3, z: 1.6, rot: 0 },
  { type: 'sofa', n: 0, x: 1.4, z: -2.2, rot: 0 },
  { type: 'frame', n: 0, x: -1.2, z: -2.75, rot: 0 },
  { type: 'plant', n: 0, x: 3.1, z: -2.5, rot: 0 },
  { type: 'ball', n: 0, x: -1.4, z: 1.2, rot: 0 },
  { type: 'bowl', n: 0, x: -3.0, z: 0.4, rot: 0 },
];

/** 배치 데이터 검증: 보유 개수·방 범위·형식. 올바르면 정리된 배치를, 아니면 null */
export function validateLayout(v: unknown): PlacedItem[] | null {
  if (!Array.isArray(v) || v.length > 40) return null;
  const seen = new Set<string>();
  const out: PlacedItem[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null;
    const it = raw as Record<string, unknown>;
    const f = typeof it.type === 'string' ? FURNITURE_BY_ID.get(it.type) : undefined;
    const n = Number(it.n), x = Number(it.x), z = Number(it.z), rot = Number(it.rot);
    if (!f || !Number.isInteger(n) || n < 0 || n >= f.count) return null;
    if (![x, z].every(Number.isFinite) || Math.abs(x) > ROOM_HALF_W || Math.abs(z) > ROOM_HALF_D) return null;
    if (!Number.isInteger(rot) || rot < 0 || rot > 3) return null;
    const key = itemKey({ type: f.id, n });
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ type: f.id, n, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rot });
  }
  return out;
}

export interface GuestbookEntry {
  id: number;
  authorId: number;
  nickname: string;
  dogName: string;
  text: string;
  ts: number;
  /** 지금 보는 사람이 지울 수 있는지 (집주인 또는 작성자) */
  canDelete: boolean;
}

export interface HomeView {
  ownerId: number;
  owner: { nickname: string; dogName: string; dogPhoto: string | null; human: HumanAvatar; dog: DogAvatar };
  residence: { building: string; unit: string };
  visibility: HomeVisibility;
  layout: PlacedItem[];
  likes: number;
  likedByMe: boolean;
  isOwner: boolean;
  guestbook: GuestbookEntry[];
}

export const GUESTBOOK_MAX_LEN = 100;
