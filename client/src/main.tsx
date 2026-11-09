import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 자동 화면 테스트용 훅: 브라우저 저장소에 mungle.e2e=1 이 있을 때만 노출 (일반 사용자에게는 없음)
try {
  if (localStorage.getItem('mungle.e2e') === '1') {
    void Promise.all([import('./store'), import('./game/local'), import('./game/CameraRig')]).then(([s, l, c]) => {
      (window as unknown as Record<string, unknown>).__mungleTest = { set: s.set, get: s.get, local: l.local, cam: c.cam };
    });
  }
} catch { /* 저장소 사용 불가 */ }
