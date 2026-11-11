// 멍글런너 동작·판정점 규칙 — 화면(강아지 자세·장애물 위치)과 차트 검증이 같은 값을 쓴다.
//
// 판정점(박자 순간)의 정의:
//   장애물의 '강아지 쪽 앞면'이 판정선(강아지 코끝 바로 앞)에 닿는 순간 = 음악의 그 박자.
//   그 순간 조작하면 동작이 바로 시작되고, 장애물은 동작이 이루어지는 동안 강아지 몸을 지나간다.
//   (예전에는 장애물 '가운데'가 강아지 '가운데'에 오는 순간이 박자라, 박자에 눌러도 코끝이 먼저 부딪혀 보였다)

export const JUMP_MS = 460;
export const DUCK_MS = 560;
/** 점프 높이 (m) */
export const JUMP_H = 0.55;
/** 숙이기: 낮추는 데 걸리는 비율 / 일어서기 시작 비율 */
export const DUCK_IN = 0.12;
export const DUCK_OUT = 0.78;
/** 레인 이동 빠르기 (1/초, 지수 수렴) — 약 50ms에 절반 이상 이동 */
export const LANE_RATE = 18;
export const LANE_W = 1.35;

/** 강아지 코끝 (몸 중심에서 앞쪽, m) · 몸 전체 길이 (코끝~꼬리, m) */
export const DOG_NOSE = 0.4;
export const DOG_LEN = 0.78;
/**
 * 판정선: 코끝보다 이만큼(ms) 앞 — 박자에 조작하면 장애물이 코끝에 닿기 전에 동작이 시작됨.
 * PERFECT 범위 안에서 조금 늦게(+40ms) 눌러도 동작이 충분히 진행된 뒤 장애물이 몸에 닿도록 정한 값.
 */
export const LEAD_MS = 110;
/** 차트 규칙의 여유: 조금 일찍(PERFECT 범위) 다음 동작을 해도 앞 장애물과 부딪히지 않게 */
export const EARLY_MARGIN_MS = 80;

/** 장애물 앞뒤 길이 (m) — 화면 모델과 같은 크기 */
export const OBSTACLE_DEPTH = { log: 0.34, ribbon: 0.16, pot: 0.67, fence: 0.08 } as const;

/** 판정선 위치 (강아지 몸 중심 기준 z, 앞쪽이 음수) */
export const judgeLineZ = (speed: number) => -(DOG_NOSE + (LEAD_MS / 1000) * speed);
/** 장애물 가운데 z: 박자까지 남은 시간 dtMs, 달리는 속도(m/s) */
export const obstacleZ = (dtMs: number, speed: number, kind: keyof typeof OBSTACLE_DEPTH) =>
  judgeLineZ(speed) - (dtMs / 1000) * speed - OBSTACLE_DEPTH[kind] / 2;
/** 장애물이 강아지 몸과 겹치는 시간 (박자 기준 ms) [시작, 끝] */
export const overlapWindow = (t: number, speed: number, kind: keyof typeof OBSTACLE_DEPTH): [number, number] =>
  [t + LEAD_MS, t + LEAD_MS + ((DOG_LEN + OBSTACLE_DEPTH[kind]) / speed) * 1000];

const smooth01 = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

/** 점프 높이: 누르는 즉시 떠오르고(빠르게 올라가 천천히 정점) 착지 — e: 점프 시작 후 ms */
export function jumpHeight(e: number) {
  if (e < 0 || e >= JUMP_MS) return 0;
  const k = e / JUMP_MS;
  return JUMP_H * Math.pow(Math.sin(k * Math.PI), 0.7);
}
/** 숙이기 정도 0~1 — e: 숙이기 시작 후 ms */
export function duckAmount(e: number) {
  if (e < 0 || e >= DUCK_MS) return 0;
  const k = e / DUCK_MS;
  return k < DUCK_IN ? smooth01(k / DUCK_IN) : k < DUCK_OUT ? 1 : smooth01((1 - k) / (1 - DUCK_OUT));
}
/** 레인 이동 진행도 0~1 — e: 이동 입력 후 ms */
export const laneProgress = (e: number) => (e <= 0 ? 0 : 1 - Math.exp(-LANE_RATE * e / 1000));
