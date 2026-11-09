// 지금 있는 공간의 이동 규칙 (공원 / 아파트 로비 / 개인 집) — 매 프레임 이동·충돌 계산에 사용
import { spaceCollider, type Collider, type SpaceKind } from '@shared/spaces';
import type { PlacedItem } from '@shared/home';

export const space: { kind: SpaceKind; collide: Collider } = { kind: 'park', collide: spaceCollider('park') };

export function setSpace(kind: SpaceKind, layout: PlacedItem[] = []) {
  space.kind = kind;
  space.collide = spaceCollider(kind, layout);
}
