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
  /** moveTarget 에 도착한 뒤 이어서 갈 지점들 (예: 팔각정 출입구 → 가운데 → 자리 앞) */
  moveVia: [] as { x: number; z: number }[],
  /** 벤치: 앉으러 가는 좌석 / 앉아 있는 좌석 id */
  seatGoal: null as string | null,
  seated: null as string | null,
  /** 점프 높이·속도 */
  jumpY: 0,
  jumpV: 0,
  /** 카메라 yaw (미니맵 회전 표시용) */
  camYaw: 0,
  /** 지금 하고 있는 동작 (쓰다듬기·줍기·버리기) — 끝날 때까지 이동 입력을 받지 않음 */
  action: null as { anim: number; until: number; petLow: number; faceX: number; faceZ: number } | null,
  /** 배변봉투를 들고 있는지 (서버 상태) */
  bag: false,
  /** 서버가 시작한 내 강아지 배변 (LocalPlayer가 다음 프레임에 적용) */
  poopStart: 0,
  /** 내 강아지가 쓰다듬기를 받음: 바라볼 곳 */
  petHold: null as { x: number; z: number } | null,
};
