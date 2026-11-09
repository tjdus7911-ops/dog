// 실행 진입점: (설정된 경우) GitHub 저장소에서 데이터를 먼저 되살린 뒤 서버를 시작한다.
import { restore } from './persist';

try {
  await restore();
} catch (e) {
  // 복원에 실패한 채로 빈 DB로 시작하면 나중에 저장소의 데이터를 덮어쓸 수 있으므로 중단한다.
  console.error('💾 GitHub 데이터 복원 실패 — 설정(MUNGLE_GITHUB_REPO / MUNGLE_GITHUB_TOKEN)을 확인해 주세요.', e);
  process.exit(1);
}
await import('./index');
