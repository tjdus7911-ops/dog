import { useEffect, type ReactNode, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react';
import type { PublicProfile } from '@shared/protocol';
import { useStore } from '../store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    // 화면 전체 폭을 기준으로 가운데 정렬 (예전에는 left:50% 기준이라 화면 절반 폭 안에서만 늘어나 짧은 문장도 두 줄이 됐음)
    // 글자 길이에 맞춰 폭이 늘고 줄며, 화면(좌우 16px 여백)을 넘지 않음 · 한글은 단어 단위로 줄바꿈 · 여러 줄이면 줄 길이를 고르게
    <div className="fixed inset-x-0 z-[60] flex flex-col items-center gap-2 pointer-events-none px-4" style={{ top: 'calc(var(--safe-t, 0px) + 80px)' }} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} data-testid="toast"
          className={`pop panel !rounded-[20px] w-fit max-w-[min(560px,100%)] px-4 py-2 text-sm leading-snug text-center font-display break-keep [overflow-wrap:break-word] [text-wrap:balance] ${t.tone === 'error' ? '!bg-[#fff0ec] text-[#c4553a]' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** 강아지 사진(없으면 털색 동그라미) */
export function DogBadge({ profile, size = 40 }: { profile: PublicProfile; size?: number }) {
  return profile.dogPhoto ? (
    <img src={profile.dogPhoto} alt={`${profile.dogName} 사진`} className="rounded-full object-cover border-2 border-white shadow-sm shrink-0" style={{ width: size, height: size }} />
  ) : (
    <div className="rounded-full grid place-items-center border-2 border-white shadow-sm shrink-0" style={{ width: size, height: size, background: profile.dog.coat, fontSize: size * 0.5 }}>🐶</div>
  );
}

/**
 * 어두운 바깥을 눌러 닫기: 누른 곳과 뗀 곳이 모두 바깥일 때만 닫는다.
 * 누르는 순간(pointerdown) 닫으면 같은 터치의 클릭이 아래 3D 화면(광장 스크린 등)에 떨어져 엉뚱한 창이 열리기 때문.
 */
export function backdropClose(close: () => void) {
  return {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => { e.currentTarget.dataset.downOut = e.target === e.currentTarget ? '1' : ''; },
    onClick: (e: RMouseEvent<HTMLElement>) => {
      const out = e.currentTarget.dataset.downOut === '1' && e.target === e.currentTarget;
      e.currentTarget.dataset.downOut = '';
      if (out) close();
    },
  };
}

export function Modal({ children, onClose, className = '' }: { children: ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[#5a403333] p-4"
      {...backdropClose(onClose)}>
      <div className={`panel pop w-full max-h-[90vh] overflow-y-auto scroll-soft ${className}`}>{children}</div>
    </div>
  );
}

export function PanelHeader({ icon, title, onClose, children }: { icon: string; title: string; onClose?: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xl">{icon}</span>
      <h2 className="font-display text-xl flex-1">{title}</h2>
      {children}
      {onClose && <button className="btn btn-ghost w-9 h-9 !shadow-none text-lg" onClick={onClose} aria-label="닫기">✕</button>}
    </div>
  );
}

export function timeLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

import { Component } from 'react';
/** 렌더 오류 시 흰 화면 대신 안내 표시 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[멍글마을] 화면 오류', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full grid place-items-center bg-cream p-6">
        <div className="panel p-6 max-w-sm text-center">
          <div className="text-4xl">🐾</div>
          <p className="font-display text-xl mt-2">화면을 그리는 중 문제가 생겼어요</p>
          <p className="text-xs text-cocoa-soft mt-1 break-words">{this.state.error.message}</p>
          <button className="btn btn-peach px-6 py-2.5 mt-4" onClick={() => location.reload()}>새로고침</button>
        </div>
      </div>
    );
  }
}
