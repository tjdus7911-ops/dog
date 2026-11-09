// 중앙 공원 레이아웃 & 충돌 데이터 — 결정적(seeded)으로 생성해 모든 클라이언트가 같은 공원을 본다.

export const WORLD_RADIUS = 36; // 이동 가능 반경
export const GROUND_RADIUS = 60;
export const PLAZA_RADIUS = 7;
export const FOUNTAIN_RADIUS = 2.6;
export const RING_RADIUS = 14;
export const PATH_WIDTH = 2.6;
export const RADIAL_ANGLES = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2];

export interface Circle { x: number; z: number; r: number }
export interface Box { x: number; z: number; hw: number; hd: number }

export interface TreeDef { x: number; z: number; kind: 'cherry' | 'round' | 'pine'; scale: number; rot: number }
export interface BenchDef { x: number; z: number; rot: number }
export interface LampDef { x: number; z: number }
export interface BuildingDef { x: number; z: number; w: number; d: number; rot: number; kind: 'apartment' | 'cafe' | 'shop'; roof: string; wall: string }
export interface FlowerBed { x: number; z: number; r: number }

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BUILDINGS: BuildingDef[] = [
  // 멍글 아파트 1동 (기존 '강아지 집' 자리) — 입구는 광장 쪽(+z)
  { x: 0, z: -27.5, w: 10, d: 6, rot: 0, kind: 'apartment', roof: '#f39a7b', wall: '#fff1dc' },
  { x: -22, z: -13, w: 5, d: 4.5, rot: 0, kind: 'cafe', roof: '#8fb88a', wall: '#fbe9d4' },
  { x: 22, z: -13, w: 5, d: 4.5, rot: 0, kind: 'shop', roof: '#f4a6b8', wall: '#fff6e8' },
];

/** 점 (px,pz) 에서 원점에서 뻗은 방사형 길까지 거리 */
function distToRadial(px: number, pz: number, angle: number) {
  const dx = Math.sin(angle), dz = Math.cos(angle);
  const t = Math.max(0, px * dx + pz * dz);
  const cx = dx * t, cz = dz * t;
  return Math.hypot(px - cx, pz - cz);
}

export function isOnPath(x: number, z: number, margin = 0) {
  const r = Math.hypot(x, z);
  if (r < PLAZA_RADIUS + margin) return true;
  if (Math.abs(r - RING_RADIUS) < PATH_WIDTH / 2 + margin) return true;
  if (r < 34) for (const a of RADIAL_ANGLES) if (distToRadial(x, z, a) < PATH_WIDTH / 2 + margin) return true;
  return false;
}

/** 광장 대형 스크린 (방사형 길 위에 기둥 2개로 세움, 화면은 광장 쪽을 봄) */
export const BIG_SCREEN = { x: 0, z: -11.4, w: 5.4, h: 3.0, y: 3.4, postX: 2.9 };
/** 포토존: 광장 가장자리의 하트·발바닥 배경판 (서 있는 자리 = stand) */
const PZ_ANGLE = Math.PI * 1.5 - 0.45;
export const PHOTO_ZONE = {
  x: Math.sin(PZ_ANGLE) * 6.3, z: Math.cos(PZ_ANGLE) * 6.3, rot: PZ_ANGLE + Math.PI,
  standX: Math.sin(PZ_ANGLE) * 5.0, standZ: Math.cos(PZ_ANGLE) * 5.0, r: 1.6,
};

function insideBuilding(x: number, z: number, margin: number) {
  if (Math.abs(x - BIG_SCREEN.x) < BIG_SCREEN.postX + margin && Math.abs(z - BIG_SCREEN.z) < 0.6 + margin) return true;
  return BUILDINGS.some((b) => Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin);
}

const rand = mulberry32(20261109);

export const BENCHES: BenchDef[] = [];
for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
  const r1 = PLAZA_RADIUS + 0.9;
  BENCHES.push({ x: Math.sin(a) * r1, z: Math.cos(a) * r1, rot: a + Math.PI });
  const r2 = RING_RADIUS + PATH_WIDTH / 2 + 0.8;
  BENCHES.push({ x: Math.sin(a + 0.3) * r2, z: Math.cos(a + 0.3) * r2, rot: a + 0.3 + Math.PI });
}

/** 벤치 좌석 — 벤치 하나에 2자리. 좌석 위치·방향과 강아지 대기 위치를 함께 정의 (서버 검증에도 사용) */
export interface SeatDef { id: string; bench: number; x: number; z: number; rot: number; dogX: number; dogZ: number; dogRot: number; frontX: number; frontZ: number }
/** 벤치 기준 좌표(lx: 오른쪽, lz: 앞쪽) → 월드 좌표 */
function benchToWorld(b: BenchDef, lx: number, lz: number): [number, number] {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
}
export const SEATS: SeatDef[] = [];
BENCHES.forEach((b, i) => {
  for (const [k, lx] of [[0, -0.38], [1, 0.38]] as const) {
    const [x, z] = benchToWorld(b, lx, -0.02);
    const side = lx < 0 ? -1 : 1;
    const [dogX, dogZ] = benchToWorld(b, lx + side * 0.2, 1.05);
    const [frontX, frontZ] = benchToWorld(b, lx, 1.0);
    SEATS.push({ id: `b${i}s${k}`, bench: i, x, z, rot: b.rot, dogX, dogZ, dogRot: b.rot + side * 0.35, frontX, frontZ });
  }
});
export const SEAT_BY_ID = new Map(SEATS.map((s) => [s.id, s]));
/** 좌석에 앉으려면 이 거리 안에 있어야 함 (서버 검증) */
export const SEAT_REACH = 2.5;
export const SEAT_HEIGHT = 0.46;

/** 아파트 입구 (로비로 들어가는 지점) */
export const APARTMENT = BUILDINGS.find((b) => b.kind === 'apartment')!;
export const APARTMENT_ENTRANCE = { x: APARTMENT.x, z: APARTMENT.z + APARTMENT.d / 2 + 0.9, r: 1.8 };

export const LAMPS: LampDef[] = [];
for (const a of RADIAL_ANGLES) {
  for (const d of [9.5, 21]) {
    const side = PATH_WIDTH / 2 + 0.6;
    const px = Math.sin(a) * d + Math.cos(a) * side;
    const pz = Math.cos(a) * d - Math.sin(a) * side;
    LAMPS.push({ x: px, z: pz });
  }
}

export const FLOWER_BEDS: FlowerBed[] = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
  FLOWER_BEDS.push({ x: Math.sin(a) * 10.4, z: Math.cos(a) * 10.4, r: 1.4 });
}
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2 + 0.2;
  FLOWER_BEDS.push({ x: Math.sin(a) * 19, z: Math.cos(a) * 19, r: 1.6 });
}

export const TREES: TreeDef[] = [];
{
  let guard = 0;
  while (TREES.length < 70 && guard++ < 4000) {
    const a = rand() * Math.PI * 2;
    const r = 9 + rand() * 30;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (isOnPath(x, z, 1.6)) continue;
    if (insideBuilding(x, z, 2.5)) continue;
    if (TREES.some((t) => Math.hypot(t.x - x, t.z - z) < 3.4)) continue;
    if (BENCHES.some((b) => Math.hypot(b.x - x, b.z - z) < 2.4)) continue;
    if (FLOWER_BEDS.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 1.2)) continue;
    const roll = rand();
    const kind: TreeDef['kind'] = r > 30 ? (roll < 0.5 ? 'pine' : 'round') : roll < 0.45 ? 'cherry' : roll < 0.8 ? 'round' : 'pine';
    TREES.push({ x, z, kind, scale: 0.85 + rand() * 0.5, rot: rand() * Math.PI * 2 });
  }
}

export const COLLIDERS_CIRCLE: Circle[] = [
  { x: 0, z: 0, r: FOUNTAIN_RADIUS + 0.3 },
  ...TREES.map((t) => ({ x: t.x, z: t.z, r: 0.45 * t.scale })),
  ...LAMPS.map((l) => ({ x: l.x, z: l.z, r: 0.25 })),
  ...BENCHES.map((b) => ({ x: b.x, z: b.z, r: 0.75 })),
  // 대형 스크린 기둥, 포토존 배경판
  { x: BIG_SCREEN.x - BIG_SCREEN.postX, z: BIG_SCREEN.z, r: 0.3 },
  { x: BIG_SCREEN.x + BIG_SCREEN.postX, z: BIG_SCREEN.z, r: 0.3 },
  { x: PHOTO_ZONE.x, z: PHOTO_ZONE.z, r: 0.55 },
];

export const COLLIDERS_BOX: Box[] = BUILDINGS.map((b) => ({ x: b.x, z: b.z, hw: b.w / 2 + 0.1, hd: b.d / 2 + 0.1 }));

/** 원형 몸체(r)를 장애물과 월드 경계 밖으로 밀어낸다. */
export function resolveCollision(x: number, z: number, r: number): [number, number] {
  for (let iter = 0; iter < 2; iter++) {
    for (const c of COLLIDERS_CIRCLE) {
      const dx = x - c.x, dz = z - c.z;
      const min = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 0.0001;
        x = c.x + (dx / d) * min;
        z = c.z + (dz / d) * min;
      }
    }
    for (const b of COLLIDERS_BOX) {
      const cx = Math.max(b.x - b.hw, Math.min(x, b.x + b.hw));
      const cz = Math.max(b.z - b.hd, Math.min(z, b.z + b.hd));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r; z = cz + (dz / d) * r;
        } else {
          // 박스 내부: 가장 가까운 면으로 밀어냄
          const px = b.hw - Math.abs(x - b.x), pz = b.hd - Math.abs(z - b.z);
          if (px < pz) x = b.x + Math.sign(x - b.x || 1) * (b.hw + r);
          else z = b.z + Math.sign(z - b.z || 1) * (b.hd + r);
        }
      }
    }
  }
  const dist = Math.hypot(x, z);
  if (dist > WORLD_RADIUS) { x *= WORLD_RADIUS / dist; z *= WORLD_RADIUS / dist; }
  return [x, z];
}

/** 스폰 위치: 분수대 남쪽 길 위, 약간씩 흩어지게 */
export function spawnPoint(seed: number): [number, number] {
  const a = ((seed * 137.5) % 360) * (Math.PI / 180);
  return resolveCollision(Math.sin(a) * 1.4, 10 + Math.cos(a) * 1.2, 0.4);
}
