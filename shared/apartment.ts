// 멍글 아파트 — 동·층·호실 구성 (서버 배정 검증과 화면 표시에 함께 사용)
// 동·호실은 가상 공간 정보이며 실제 거주 주소와 관련이 없다.
export interface BuildingInfo { id: string; name: string; floors: number; unitsPerFloor: number; color: string }

/** 1동 원룸 · 2동 투룸 · 3동 쓰리룸 (동이 곧 집 등급). 동을 추가하면 그대로 확장된다. */
export const APARTMENT_BUILDINGS: BuildingInfo[] = [
  { id: '1', name: '멍글 아파트 1동', floors: 4, unitsPerFloor: 4, color: '#f39a7b' },
  { id: '2', name: '멍글 아파트 2동', floors: 4, unitsPerFloor: 4, color: '#a9cfa0' },
  { id: '3', name: '멍글 아파트 3동', floors: 4, unitsPerFloor: 4, color: '#b9a6e6' },
];

/** 호실 번호: 층 + 두 자리 (예: 3층 2호 → "302") */
export const unitId = (floor: number, n: number) => `${floor}${String(n).padStart(2, '0')}`;

export function unitsOf(b: BuildingInfo) {
  const out: { unit: string; floor: number; n: number }[] = [];
  for (let f = b.floors; f >= 1; f--) for (let n = 1; n <= b.unitsPerFloor; n++) out.push({ unit: unitId(f, n), floor: f, n });
  return out;
}

export function isValidUnit(building: string, unit: string) {
  const b = APARTMENT_BUILDINGS.find((x) => x.id === building);
  if (!b || typeof unit !== 'string') return false;
  return unitsOf(b).some((u) => u.unit === unit);
}

export const residenceLabel = (r: { building: string; unit: string } | null | undefined) => {
  if (!r) return '';
  return `${r.building}동 ${r.unit}호`;
};

/** 로비 안내판에 표시하는 호실 정보 */
export interface UnitInfo {
  unit: string;
  floor: number;
  occupied: boolean;
  /** 입주자 정보 (빈 집이거나, 서로 차단한 사이면 null) */
  resident: { id: number; nickname: string; dogName: string; dogCoat: string; dogPhoto: string | null; mine: boolean; visibility?: string; neighbor?: string } | null;
}
