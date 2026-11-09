// 내 아바타의 실시간 상태 (React 렌더 없이 매 프레임 갱신)
import type { NetState } from '@shared/protocol';

export const local = {
  x: 0, z: 10, rot: Math.PI,
  dogX: 0.9, dogZ: 10.4, dogRot: Math.PI, dogAnim: 0,
  humanAnim: 0,
  /** 서버가 보낸 보정 위치 / 스폰 위치. LocalPlayer가 다음 프레임에 적용 */
  teleport: null as NetState | null,
  waveUntil: 0,
  sitUntil: 0,
  /** 바닥 클릭으로 정한 목적지 (키보드·조이스틱을 쓰면 취소) */
  moveTarget: null as { x: number; z: number } | null,
  /** 점프 높이·속도 */
  jumpY: 0,
  jumpV: 0,
  /** 카메라 yaw (미니맵 회전 표시용) */
  camYaw: 0,
};
