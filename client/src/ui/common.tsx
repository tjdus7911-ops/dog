import { useEffect, type ReactNode } from 'react';
import type { PublicProfile } from '@shared/protocol';
import { useStore } from '../store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none px-4">
      {toasts.map((t) => (
        <div key={t.id} className={`pop panel !rounded-full px-4 py-2 text-sm font-display ${t.tone === 'error' ? '!bg-[#fff0ec] text-[#c4553a]' : ''}`}>
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

export function Modal({ children, onClose, className = '' }: { children: ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[#5a403333] p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
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
