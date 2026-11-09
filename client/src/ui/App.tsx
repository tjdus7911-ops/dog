import { lazy, Suspense, useEffect, useState } from 'react';
import { api, tokenStore } from '../lib/api';
import { connect, disconnect } from '../net/socket';
import { set, useStore } from '../store';
import { installKeyboard } from '../game/input';
import { AuthScreen } from './AuthScreen';
import { ErrorBoundary, Toasts } from './common';
import type { MyProfile } from '@shared/protocol';

const Game = lazy(() => import('./Game'));
const AvatarEditor = lazy(() => import('./AvatarEditor'));

export function App() {
  const me = useStore((s) => s.me);
  const onboarding = useStore((s) => s.onboarding);
  const [booting, setBooting] = useState(!!tokenStore.get());

  useEffect(() => {
    installKeyboard();
    if (!tokenStore.get()) return;
    api<{ profile: MyProfile }>('/api/me')
      .then((r) => set({ me: r.profile }))
      .catch(() => tokenStore.set(null))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (me && !onboarding) connect();
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
            {onboarding ? <AvatarEditor mode="onboarding" /> : <Game />}
          </Suspense>
        </ErrorBoundary>
      )}
      <Toasts />
    </>
  );
}

function Splash() {
  return (
    <div className="h-full grid place-items-center bg-cream">
      <div className="text-center">
        <div className="text-5xl animate-bounce">🐾</div>
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
