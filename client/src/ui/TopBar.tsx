import { useState } from 'react';
import { set, useStore } from '../store';
import { joinPark } from '../net/socket';
import { DogBadge } from './common';
import { logout } from './App';
import { DEMO, resetDemo } from '../demo';
import { residenceLabel } from '@shared/apartment';

export function TopBar() {
  const me = useStore((s) => s.me)!;
  const park = useStore((s) => s.park);
  const parks = useStore((s) => s.parks);
  const panel = useStore((s) => s.panel);
  const notifUnread = useStore((s) => s.notifications.filter((n) => !n.read).length);
  const friendBadge = useStore((s) => s.incoming.length + s.friends.reduce((a, f) => a + f.unread, 0));
  const [parkOpen, setParkOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggle = (p: typeof panel) => set({ panel: panel === p ? 'none' : p });

  return (
    <div className="absolute top-0 inset-x-0 z-20 p-2 md:p-3 flex items-center gap-1.5 md:gap-2 pointer-events-none">
      <div className="panel !rounded-full pl-2.5 pr-3 md:pl-3 md:pr-4 py-1.5 flex items-center gap-1.5 md:gap-2 pointer-events-auto whitespace-nowrap shrink-0">
        <span className="text-xl md:text-2xl">🐾</span>
        <div className="leading-none">
          <div className="font-display text-lg md:text-2xl">멍글마을</div>
          <div className="text-[10px] text-cocoa-soft tracking-wide hidden sm:block">Mungle Village</div>
        </div>
        <span className="hidden lg:inline text-sm text-cocoa-soft ml-3">우리 강아지와 함께 걷고, 만나고, 자랑하는 3D 커뮤니티 ♡</span>
      </div>

      <div className="flex-1" />

      {DEMO && <span className="name-tag !text-xs !px-3 !py-1.5 pointer-events-auto hidden sm:inline">👀 미리보기 · 혼자 산책 모드</span>}
      {/* 공원 선택 (실제 접속 인원 표시) */}
      {!DEMO && <div className="relative pointer-events-auto">
        <button className="btn btn-ghost px-3 md:px-4 h-11 text-sm whitespace-nowrap" onClick={() => setParkOpen(!parkOpen)}>
          📍 <span className="hidden sm:inline">{park?.name ?? '입장 중…'}</span><span className="sm:hidden">{park ? `공원${park.name.slice(-1)}` : '…'}</span> ▾
        </button>
        {parkOpen && (
          <div className="absolute right-0 mt-2 panel p-2 w-56 pop">
            <p className="text-xs text-cocoa-soft px-2 pb-1">공원 이동 (공원별 정원 제한)</p>
            {parks.map((p) => (
              <button key={p.id} disabled={p.id !== park?.id && p.count >= p.capacity}
                onClick={async () => { setParkOpen(false); if (p.id !== park?.id) await joinPark(p.id); }}
                className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-cream-2 disabled:opacity-40 ${p.id === park?.id ? 'bg-peach-soft' : ''}`}>
                <span>{p.name}{p.id === park?.id && ' (여기)'}</span>
                <span className="text-cocoa-soft">{p.count}/{p.capacity}</span>
              </button>
            ))}
          </div>
        )}
      </div>}

      {!DEMO && <button className="btn btn-ghost w-11 h-11 shrink-0 relative pointer-events-auto" onClick={() => { toggle('notifications'); }} aria-label="알림">
        🔔{notifUnread > 0 && <Badge n={notifUnread} />}
      </button>}
      {!DEMO && <button className={`btn ${panel === 'friends' ? 'btn-peach' : 'btn-ghost'} h-11 px-3 md:px-4 relative pointer-events-auto`} onClick={() => toggle('friends')} aria-label="친구">
        👥 <span className="hidden md:inline">친구</span>{friendBadge > 0 && <Badge n={friendBadge} />}
      </button>}

      <div className="relative pointer-events-auto">
        <button className="rounded-full" onClick={() => setMenuOpen(!menuOpen)} aria-label="내 메뉴"><DogBadge profile={me} size={44} /></button>
        {menuOpen && (
          <div className="absolute right-0 mt-2 panel p-2 w-52 pop" onClick={() => setMenuOpen(false)}>
            <div className="px-3 py-2 text-sm"><b className="font-display">{me.nickname}</b> · 🐶 {me.dogName}
              <div className="text-xs text-cocoa-soft mt-0.5">🏠 {me.residence ? residenceLabel(me.residence) : '아직 입주 전'}</div>
            </div>
            <MenuItem onClick={() => set({ view: 'lobby', panel: 'none', benchMenu: null })}>🏢 아파트 로비</MenuItem>
            <MenuItem onClick={() => set({ panel: 'avatar' })}>✨ 아바타·강아지 꾸미기</MenuItem>
            {DEMO ? <MenuItem onClick={resetDemo}>🔄 처음부터 다시 만들기</MenuItem> : <>
              <MenuItem onClick={() => set({ panel: 'settings' })}>🔒 개인정보·차단 설정</MenuItem>
              {me.role === 'admin' && <MenuItem onClick={() => set({ panel: 'admin' })}>🛡️ 신고 관리 (운영)</MenuItem>}
              <MenuItem onClick={logout}>🚪 로그아웃</MenuItem>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

const MenuItem = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button className="w-full text-left rounded-xl px-3 py-2 text-sm hover:bg-cream-2" onClick={onClick}>{children}</button>
);

export const Badge = ({ n }: { n: number }) => (
  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#ef6b5b] text-white text-[11px] grid place-items-center font-sans">{n > 9 ? '9+' : n}</span>
);
