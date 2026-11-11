import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';
import { initPwa } from './pwa';

// 홈 화면 앱: 브라우저의 설치 창 이벤트가 화면보다 먼저 올 수 있어 가장 먼저 준비
initPwa();

// 모델 작업대: 자동 화면 테스트 표시(mungle.e2e)가 있을 때만 ?lab 으로 열림
let lab = false;
try { lab = new URLSearchParams(location.search).has('lab') && localStorage.getItem('mungle.e2e') === '1'; } catch { /* 무시 */ }
const ModelLab = lazy(() => import('./ui/ModelLab'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {lab ? <Suspense fallback={null}><ModelLab /></Suspense> : <App />}
  </StrictMode>,
);

// 자동 화면 테스트용 훅: 브라우저 저장소에 mungle.e2e=1 이 있을 때만 노출 (일반 사용자에게는 없음)
try {
  if (localStorage.getItem('mungle.e2e') === '1') {
    void Promise.all([import('./store'), import('./game/local'), import('./game/CameraRig'), import('./net/remote')]).then(([s, l, c, r]) => {
      (window as unknown as Record<string, unknown>).__mungleTest = { set: s.set, get: s.get, local: l.local, cam: c.cam, rendered: r.rendered };
    });
  }
} catch { /* 저장소 사용 불가 */ }
