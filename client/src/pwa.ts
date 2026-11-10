// 홈 화면 앱(PWA): 서비스 워커 등록 · 설치 가능 상태 · 기기·브라우저별 설치 방법
//  · 안드로이드 크롬·삼성 인터넷, PC 크롬·엣지: 브라우저의 설치 창을 바로 띄움 (beforeinstallprompt)
//  · 아이폰·아이패드: 자동 설치 창이 없어서 '공유 → 홈 화면에 추가' 안내
//  · 카카오톡·인스타그램 등 앱 안의 브라우저: 설치가 안 되므로 기본 브라우저로 여는 방법 안내
import { useSyncExternalStore } from 'react';
import { DEMO } from './demo';

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
export type InApp = 'kakao' | 'instagram' | 'facebook' | 'naver' | 'line' | 'band' | 'other';
export type InstallGuide = 'ios' | 'android' | 'desktop' | 'inapp';

interface PwaState {
  /** 브라우저가 준 설치 창 (있을 때만 버튼 한 번으로 설치) */
  deferred: InstallPromptEvent | null;
  /** 이미 홈 화면 앱으로 실행 중 */
  standalone: boolean;
  installed: boolean;
  /** 열려 있는 설치 안내 시트 */
  guide: InstallGuide | null;
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const device = {
  ios: /iPhone|iPad|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  android: /Android/i.test(ua),
  /** 아이폰에서 사파리가 아닌 브라우저 (크롬·파이어폭스·엣지 등) */
  iosOther: /CriOS|FxiOS|EdgiOS|OPiOS|Whale/i.test(ua),
  samsung: /SamsungBrowser/i.test(ua),
};
export const mobile = device.ios || device.android;

export function detectInApp(): InApp | null {
  if (/KAKAOTALK/i.test(ua)) return 'kakao';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'facebook';
  if (/NAVER\(inapp/i.test(ua)) return 'naver';
  if (/\bLine\//i.test(ua)) return 'line';
  if (/BAND\//i.test(ua)) return 'band';
  if (/everytimeApp|DaumApps|; wv\)/i.test(ua)) return 'other';
  return null;
}
export const inApp = detectInApp();
export const IN_APP_NAME: Record<InApp, string> = { kakao: '카카오톡', instagram: '인스타그램', facebook: '페이스북', naver: '네이버 앱', line: '라인', band: '밴드', other: '앱' };

const isStandalone = () => {
  try { return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true; } catch { return false; }
};

let state: PwaState = { deferred: null, standalone: isStandalone(), installed: false, guide: null };
const subs = new Set<() => void>();
function patch(p: Partial<PwaState>) { state = { ...state, ...p }; subs.forEach((f) => f()); }
export function usePwa() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);
}

/** 설치 안내를 보여 줄지: 이미 앱으로 열었으면 숨김. PC는 브라우저가 설치를 지원할 때만 */
export function canOfferInstall(s: PwaState) {
  if (DEMO || s.standalone || s.installed) return false;
  return mobile || !!inApp || !!s.deferred;
}

/** 앱 시작 시 한 번: 설치 창 받아 두기 · 서비스 워커 등록 */
export function initPwa() {
  if (DEMO) return; // 미리보기(다른 주소에서 열리는 체험판)에서는 설치·서비스 워커 없음
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); patch({ deferred: e as InstallPromptEvent }); });
  window.addEventListener('appinstalled', () => patch({ installed: true, deferred: null, guide: null }));
  try { matchMedia('(display-mode: standalone)').addEventListener('change', () => patch({ standalone: isStandalone() })); } catch { /* 오래된 브라우저 */ }
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* 서비스 워커 없이도 동작 */ });
    if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
  }
}

/** '홈 화면에 추가' 버튼: 바로 설치되는 곳은 설치 창, 아니면 기기에 맞는 안내 */
export async function startInstall(): Promise<'accepted' | 'dismissed' | 'guide'> {
  if (inApp) { patch({ guide: 'inapp' }); return 'guide'; }
  const d = state.deferred;
  if (d) {
    try {
      await d.prompt();
      const { outcome } = await d.userChoice;
      patch({ deferred: null, installed: state.installed || outcome === 'accepted' });
      return outcome;
    } catch { patch({ deferred: null }); }
  }
  patch({ guide: device.ios ? 'ios' : device.android ? 'android' : 'desktop' });
  return 'guide';
}
export const closeInstallGuide = () => patch({ guide: null });

/** 앱 안 브라우저에서 기본 브라우저로 열기 (지원하는 앱만, 아니면 null) */
export function externalOpenUrl(): string | null {
  const url = location.href;
  if (inApp === 'kakao') return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
  if (inApp === 'line') return url + (url.includes('?') ? '&' : '?') + 'openExternalBrowser=1';
  if (device.android) return `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`;
  return null;
}
