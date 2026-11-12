import { lazy, Suspense, useEffect, useState } from 'react';
import { api, tokenStore } from '../lib/api';
import { connect, disconnect } from '../net/socket';
import { set, useStore } from '../store';
import { installKeyboard } from '../game/input';
import { AuthScreen } from './AuthScreen';
import { ErrorBoundary, Toasts } from './common';
import type { MyProfile } from '@shared/protocol';
import { DEMO, loadDemoProfile } from '../demo';
import { InAppBanner, InstallGuideSheet } from './Install';
import { LogoMark } from './Logo';
import { useAutoAttendance } from './Coins';

const Game = lazy(() => import('./Game'));
const AvatarEditor = lazy(() => import('./AvatarEditor'));
const MoveIn = lazy(() => import('./Apartment').then((m) => ({ default: m.MoveIn })));
const AdminPage = lazy(() => import('./AdminPage'));
/** 관리자 페이지 주소 (/admin, /admin/users …) — 화면만 열리고, 운영 데이터는 서버가 운영자에게만 내려줌 */
const ADMIN_ROUTE = /^\/admin(\/|$)/.test(location.pathname);

export function App() {
  const me = useStore((s) => s.me);
  const onboarding = useStore((s) => s.onboarding);
  const moveInLater = useStore((s) => s.moveInLater);
  const needMoveIn = !!me && me.role !== 'guest' && !onboarding && !me.residence && !moveInLater;
  const [booting, setBooting] = useState(!DEMO && !!tokenStore.get());
  // 매일 출석: 로그인한 회원이 그날 처음 들어오면 자동 지급 (어느 화면에 있든)
  useAutoAttendance();

  useEffect(() => {
    installKeyboard();
    if (DEMO) {
      // 미리보기: 로그인 없이 바로 시작 (처음이면 아바타 만들기부터)
      const { profile, fresh } = loadDemoProfile();
      set({ me: profile, onboarding: fresh });
      return;
    }
    if (!tokenStore.get()) return;
    api<{ profile: MyProfile }>('/api/me')
      .then((r) => set({ me: r.profile }))
      .catch(() => tokenStore.set(null))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (me && !onboarding && !ADMIN_ROUTE) connect();
    return () => { if (!me) disconnect(); };
  }, [me?.id, onboarding]);

  return (
    <>
      {booting ? (
        <Splash />
      ) : !me ? (
        <AuthScreen />
      ) : (
        <ErrorBoundary>
          <Suspense fallback={<Splash />}>
            {ADMIN_ROUTE ? <AdminPage /> : onboarding ? <AvatarEditor mode="onboarding" /> : needMoveIn ? <MoveIn onDone={() => set({ moveInLater: true })} /> : <Game />}
          </Suspense>
        </ErrorBoundary>
      )}
      <InAppBanner />
      <InstallGuideSheet />
      <Toasts />
    </>
  );
}

function Splash() {
  return (
    <div className="h-full grid place-items-center bg-cream">
      <div className="text-center">
        <div className="animate-bounce inline-block"><LogoMark size={72} /></div>
        <p className="font-display text-2xl mt-3 text-cocoa">멍글마을</p>
        <p className="text-sm text-cocoa-soft mt-1">공원을 준비하고 있어요…</p>
      </div>
    </div>
  );
}

export async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* 이미 만료 */ }
  disconnect();
  tokenStore.set(null);
  set({ me: null, panel: 'none', friends: [], incoming: [], outgoing: [], blocked: [], notifications: [], dms: {}, dmWith: null, profilePopup: null, chat: [] });
}
