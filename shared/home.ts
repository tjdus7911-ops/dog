// 멍글 아파트 개인 집 — 가구 목록·배치 데이터 형식·검증 (서버와 화면이 함께 사용)
import type { DogAvatar, HumanAvatar } from './avatar';
export type HomeVisibility = 'public' | 'friends' | 'approval' | 'neighbors' | 'private';
export const HOME_VISIBILITY: { id: HomeVisibility; label: string; desc: string }[] = [
  { id: 'public', label: '전체 공개', desc: '누구나 방문할 수 있어요' },
  { id: 'friends', label: '친구만', desc: '친구만 방문할 수 있어요' },
  { id: 'approval', label: '승인제', desc: '방문 신청 → 내가 승인하면 들어올 수 있어요' },
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
  /** 애견샵에서 받아야 쓸 수 있는 가구 */
  shop?: boolean;
  /** 애견샵 소개 문구 */
  desc?: string;
  /** 애견샵 분류 */
  category?: 'bed' | 'decor';
}

/** 입주 선물로 받는 기본 가구 세트 */
export const FURNITURE: FurnitureType[] = [
  { id: 'dogbed', label: '강아지 침대', icon: '🛏️', count: 1, r: 0.55 },
  { id: 'sofa', label: '소파', icon: '🛋️', count: 1, r: 0.9 },
  { id: 'table', label: '동그란 탁자', icon: '🪵', count: 1, r: 0.5 },
  { id: 'rug', label: '러그', icon: '🟠', count: 1, r: 1.0 },
  { id: 'frame', label: '강아지 사진 액자', icon: '🖼️', count: 6, r: 0.35 },
  { id: 'plant', label: '화분', icon: '🪴', count: 2, r: 0.3 },
  { id: 'lamp', label: '스탠드 조명', icon: '💡', count: 1, r: 0.3 },
  { id: 'shelf', label: '책장', icon: '📚', count: 1, r: 0.6 },
  { id: 'ball', label: '공 장난감', icon: '🎾', count: 2, r: 0.15 },
  { id: 'bone', label: '뼈다귀 장난감', icon: '🦴', count: 1, r: 0.2 },
  { id: 'bowl', label: '밥그릇', icon: '🥣', count: 1, r: 0.2 },
  // ---- 애견샵에서 무료로 받는 가구 ----
  { id: 'doghouse', label: '빨간 지붕 강아지 집', icon: '🏠', count: 1, r: 0.6, shop: true, desc: '우리 강아지만의 아늑한 집' },
  { id: 'toybox', label: '장난감 상자', icon: '🧸', count: 1, r: 0.4, shop: true, desc: '공·인형이 가득한 상자' },
  { id: 'cushion', label: '하트 방석', icon: '💗', count: 2, r: 0.4, shop: true, desc: '푹신한 하트 모양 방석' },
  { id: 'treatjar', label: '간식 항아리', icon: '🍪', count: 1, r: 0.25, shop: true, desc: '뼈다귀 쿠키가 든 유리 항아리' },
  // ---- 애견샵 '침대' (사람 침대는 눕기·잠자기, 강아지 쿠션 침대는 쉬기·잠자기) ----
  { id: 'bed_cream', label: '크림색 싱글 침대', icon: '🛏️', count: 1, r: 0.95, shop: true, category: 'bed', desc: '포근한 크림색 이불의 싱글 침대' },
  { id: 'bed_pink', label: '핑크색 침대', icon: '🩷', count: 1, r: 0.95, shop: true, category: 'bed', desc: '하트 베개가 있는 파스텔 핑크 침대' },
  { id: 'bed_sky', label: '하늘색 침대', icon: '🩵', count: 1, r: 0.95, shop: true, category: 'bed', desc: '구름 무늬 하늘색 침대' },
  { id: 'bed_wood', label: '원목 프레임 침대', icon: '🪵', count: 1, r: 0.95, shop: true, category: 'bed', desc: '따뜻한 원목 헤드보드 침대' },
  { id: 'dog_cushion', label: '강아지 전용 쿠션 침대', icon: '🐾', count: 1, r: 0.5, shop: true, category: 'bed', desc: '몸을 둥글게 말고 자기 좋은 도넛 쿠션' },
];
export const SHOP_ITEMS = FURNITURE.filter((f) => f.shop).map(({ id, label, icon, desc, category }) => ({ id, label, icon, desc: desc ?? '', category: category ?? 'decor' }));
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
  /** 액자 전용: 걸린 사진(/uploads/...) · 액자 디자인 · 크기 배율 · 사진 맞춤(확대·위치) */
  photo?: string;
  style?: FrameStyle;
  scale?: number;
  fit?: { z: number; x: number; y: number };
}

/** 액자 디자인 */
export const FRAME_STYLES = [
  { id: 'wood', label: '기본 원목' },
  { id: 'white', label: '화이트 미니멀' },
  { id: 'pink', label: '파스텔 핑크' },
  { id: 'round', label: '둥근 원형' },
  { id: 'polaroid', label: '폴라로이드' },
] as const;
export type FrameStyle = (typeof FRAME_STYLES)[number]['id'];
export const FRAME_SCALE = { min: 0.7, max: 1.6 };
const UPLOAD_URL = /^\/uploads\/[0-9a-f]{32}\.(png|jpg|webp)$/;

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
export function validateLayout(v: unknown, owned?: ReadonlySet<string>): PlacedItem[] | null {
  if (!Array.isArray(v) || v.length > 40) return null;
  const seen = new Set<string>();
  const out: PlacedItem[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null;
    const it = raw as Record<string, unknown>;
    const f = typeof it.type === 'string' ? FURNITURE_BY_ID.get(it.type) : undefined;
    const n = Number(it.n), x = Number(it.x), z = Number(it.z), rot = Number(it.rot);
    if (!f || !Number.isInteger(n) || n < 0 || n >= f.count) return null;
    if (f.shop && owned && !owned.has(f.id)) return null;
    if (![x, z].every(Number.isFinite) || Math.abs(x) > ROOM_HALF_W || Math.abs(z) > ROOM_HALF_D) return null;
    if (!Number.isInteger(rot) || rot < 0 || rot > 3) return null;
    const key = itemKey({ type: f.id, n });
    if (seen.has(key)) return null;
    seen.add(key);
    const item: PlacedItem = { type: f.id, n, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, rot };
    if (f.id === 'frame') {
      if (it.photo !== undefined && it.photo !== null) {
        if (typeof it.photo !== 'string' || !UPLOAD_URL.test(it.photo)) return null;
        item.photo = it.photo;
      }
      if (it.style !== undefined) {
        if (!FRAME_STYLES.some((st) => st.id === it.style)) return null;
        item.style = it.style as FrameStyle;
      }
      if (it.scale !== undefined) {
        const sc = Number(it.scale);
        if (!Number.isFinite(sc) || sc < FRAME_SCALE.min || sc > FRAME_SCALE.max) return null;
        item.scale = Math.round(sc * 100) / 100;
      }
      if (it.fit !== undefined) {
        const ft = it.fit as Record<string, unknown> | null;
        const fz = Number(ft?.z), fx = Number(ft?.x), fy = Number(ft?.y);
        if (![fz, fx, fy].every(Number.isFinite) || fz < 1 || fz > 3 || Math.abs(fx) > 1 || Math.abs(fy) > 1) return null;
        item.fit = { z: Math.round(fz * 100) / 100, x: Math.round(fx * 100) / 100, y: Math.round(fy * 100) / 100 };
      }
    }
    out.push(item);
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
  /** 집주인이 애견샵에서 받은 가구 id (집주인에게만) */
  owned: string[];
  guestbook: GuestbookEntry[];
}

export const GUESTBOOK_MAX_LEN = 100;

// ---------------------------------------------------------------- 가구 상호작용 (공통)
/**
 * 가구마다 할 수 있는 일과 사람·강아지 자리를 데이터로 정의한다. 새 가구는 여기에 한 줄 추가하면 된다.
 * 좌표는 가구 기준(회전 0일 때 가구 앞쪽이 +z), y는 바닥에서의 높이.
 */
export type FurnAction = 'sit' | 'lie' | 'sleep' | 'dogRest' | 'dogSleep' | 'view';
export interface InteractSpot { x: number; z: number; y: number; rot: number }
export interface FurnInteract {
  actions: FurnAction[];
  /** 사람 자리 (여러 개면 비어 있는 곳부터) */
  human: InteractSpot[];
  /** 강아지 자리 (사람과 함께일 때 / 강아지 혼자 쉴 때) */
  dog: InteractSpot[];
  /** 다가가서 서는 곳 (일어날 때도 이 자리로) — 여러 곳이면 방 안쪽·가까운 곳 */
  approach: { x: number; z: number }[];
}
const BED: FurnInteract = {
  actions: ['lie', 'sleep'],
  // 발끝이 침대 아래쪽, 머리는 베개(-z) 쪽 — 매트리스 윗면 높이
  human: [{ x: 0, z: 0.6, y: 0.46, rot: 0 }],
  dog: [{ x: 0.9, z: 0.55, y: 0, rot: -Math.PI / 2 }],
  approach: [{ x: 1.15, z: 0.2 }, { x: -1.15, z: 0.2 }, { x: 0, z: 1.35 }],
};
export const FURNITURE_INTERACT: Record<string, FurnInteract> = {
  sofa: {
    actions: ['sit'],
    human: [{ x: -0.42, z: 0.06, y: 0.51, rot: 0 }, { x: 0.42, z: 0.06, y: 0.51, rot: 0 }],
    // 빈 자리가 있으면 소파 위, 없으면 소파 옆 바닥
    dog: [{ x: 0.42, z: 0.12, y: 0.51, rot: 0 }, { x: -0.42, z: 0.12, y: 0.51, rot: 0 }, { x: 1.2, z: 0.45, y: 0, rot: -0.4 }],
    approach: [{ x: 0, z: 0.95 }],
  },
  bed_cream: BED, bed_pink: BED, bed_sky: BED, bed_wood: BED,
  dogbed: { actions: ['dogRest', 'dogSleep'], human: [], dog: [{ x: 0, z: 0, y: 0.17, rot: Math.PI }], approach: [{ x: 0, z: 1.05 }, { x: 0, z: -1.05 }, { x: 1.05, z: 0 }, { x: -1.05, z: 0 }] },
  dog_cushion: { actions: ['dogRest', 'dogSleep'], human: [], dog: [{ x: 0, z: 0, y: 0.16, rot: Math.PI }], approach: [{ x: 0, z: 0.95 }, { x: 0, z: -0.95 }, { x: 0.95, z: 0 }, { x: -0.95, z: 0 }] },
  frame: { actions: ['view'], human: [], dog: [], approach: [{ x: 0, z: 0.9 }] },
  // 테이블: 앞으로 상호작용을 붙일 자리 (지금은 없음)
  table: { actions: [], human: [], dog: [], approach: [{ x: 0, z: 0.9 }] },
};

/** 가구 기준 좌표 → 방 좌표 */
export function toWorld(item: Pick<PlacedItem, 'x' | 'z' | 'rot'>, s: { x: number; z: number; y?: number; rot?: number }): InteractSpot {
  const a = item.rot * (Math.PI / 2);
  const c = Math.cos(a), sn = Math.sin(a);
  return { x: item.x + s.x * c + s.z * sn, z: item.z - s.x * sn + s.z * c, y: s.y ?? 0, rot: (s.rot ?? 0) + a };
}
export interface PlacedInteract { key: string; type: string; actions: FurnAction[]; human: InteractSpot[]; dog: InteractSpot[]; approach: InteractSpot[] }
/** 배치된 가구의 상호작용 자리 (방 좌표) */
export function furnitureSpots(layout: PlacedItem[]): PlacedInteract[] {
  return layout.filter((i) => FURNITURE_INTERACT[i.type]?.actions.length).map((i) => {
    const f = FURNITURE_INTERACT[i.type];
    return { key: itemKey(i), type: i.type, actions: f.actions, human: f.human.map((s) => toWorld(i, s)), dog: f.dog.map((s) => toWorld(i, s)), approach: f.approach.map((a) => toWorld(i, a)).filter((a, k) => k === 0 || (Math.abs(a.x) < ROOM_HALF_W - 0.35 && Math.abs(a.z) < ROOM_HALF_D - 0.35)) };
  });
}
/** 앉거나 누운 캐릭터의 높이: 가구 자리 근처면 그 자리 높이 (다른 사람 화면에서도 같은 높이로 보이게) */
export function spotHeight(layout: PlacedItem[], x: number, z: number, who: 'human' | 'dog', kinds?: FurnAction[]) {
  for (const p of furnitureSpots(layout)) {
    if (kinds && !p.actions.some((a) => kinds.includes(a))) continue;
    for (const s of who === 'human' ? p.human : p.dog) if (Math.hypot(s.x - x, s.z - z) < 0.3) return s.y;
  }
  return 0;
}
