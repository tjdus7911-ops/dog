// 개인 집 방문 권한 — REST API와 실시간 공간 입장에서 같은 규칙을 사용한다.
import * as repo from './db';

export type VisitCheck =
  | { ok: true }
  | { ok: false; status: number; error: string; canRequest: boolean };

/**
 * 전체 공개: 누구나 / 친구만: 친구 / 이웃만: 승인된 이웃 / 비공개: 집주인만
 * 친구·이웃 공개 집은 '방문 신청' → 집주인 승인 후 2시간 동안 입장 가능
 */
export function canVisit(viewer: number, owner: number): VisitCheck {
  const res = repo.getResidence(owner);
  if (!res) return { ok: false, status: 404, error: '아직 입주하지 않은 사용자예요.', canRequest: false };
  if (viewer === owner) return { ok: true };
  if (repo.eitherBlocked(viewer, owner)) return { ok: false, status: 403, error: '방문할 수 없는 집이에요.', canRequest: false };
  const vis = repo.getHome(owner).visibility;
  if (vis === 'public') return { ok: true };
  if (vis === 'private') return { ok: false, status: 403, error: '비공개 집이에요. 집주인만 들어갈 수 있어요.', canRequest: false };
  if (vis === 'friends' && repo.areFriends(viewer, owner)) return { ok: true };
  if (vis === 'neighbors' && repo.areNeighbors(viewer, owner)) return { ok: true };
  if (repo.hasVisitPass(owner, viewer)) return { ok: true };
  return {
    ok: false, status: 403, canRequest: true,
    error: vis === 'friends' ? '친구에게만 공개된 집이에요. 방문을 신청하면 집주인이 승인한 뒤 들어갈 수 있어요.'
      : '이웃에게만 공개된 집이에요. 방문을 신청하면 집주인이 승인한 뒤 들어갈 수 있어요.',
  };
}
