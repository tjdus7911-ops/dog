// 실행 진입점: (설정된 경우) GitHub 저장소에서 데이터를 먼저 되살린 뒤 서버를 시작한다.
import { restore } from './persist';

// 이사 안내 모드(MUNGLE_MOVED_TO)인 예전 서버는 데이터를 쓰지 않으므로 되살리지도 않음 (새 서버의 백업을 건드리지 않게)
try {
  if (!process.env.MUNGLE_MOVED_TO?.trim()) await restore();
} catch (e) {
  // 복원에 실패한 채로 빈 DB로 시작하면 나중에 저장소의 데이터를 덮어쓸 수 있으므로 중단한다.
  console.error('💾 GitHub 데이터 복원 실패 — 설정(MUNGLE_GITHUB_REPO / MUNGLE_GITHUB_TOKEN)을 확인해 주세요.', e);
  process.exit(1);
}
await import('./index');
