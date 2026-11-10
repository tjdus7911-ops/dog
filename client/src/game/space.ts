// 지금 있는 공간의 이동 규칙 (공원 / 아파트 로비 / 개인 집) — 매 프레임 이동·충돌 계산에 사용
import { spaceCollider, type Collider, type SpaceKind } from '@shared/spaces';
import type { HomeTier, PlacedItem } from '@shared/home';

export const space: { kind: SpaceKind; tier: HomeTier; collide: Collider } = { kind: 'park', tier: 1, collide: spaceCollider('park') };

/** 집은 등급별 평면도(방 사이 벽·문)까지 충돌에 반영 */
export function setSpace(kind: SpaceKind, layout: PlacedItem[] = [], tier: HomeTier = 1) {
  space.kind = kind;
  space.tier = tier;
  space.collide = spaceCollider(kind, layout, tier);
}
