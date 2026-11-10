import { useState } from 'react';
import { set, useStore } from '../store';
import { joinPark } from '../net/socket';
import { PLACES } from '@shared/spaces';
import { DogBadge } from './common';
import { logout } from './App';
import { goSignup } from './Interact';
import { DEMO, resetDemo } from '../demo';
import { residenceLabel } from '@shared/apartment';
import { openCommunity } from './Community';
import { isTouchDevice } from '../game/input';

export function TopBar() {
  const me = useStore((s) => s.me)!;
  const panel = useStore((s) => s.panel);
  const notifUnread = useStore((s) => s.notifications.filter((n) => !n.read).length);
  const friendBadge = useStore((s) => s.incoming.length + s.friends.reduce((a, f) => a + f.unread, 0));
  const [menuOpen, setMenuOpen] = useState(false);
  const guest = me.role === 'guest';
  const touch = isTouchDevice();
  const toggle = (p: typeof panel) => set({ panel: panel === p ? 'none' : p });

  return (
    <div className="absolute top-0 inset-x-0 z-20 p-2 md:p-3 flex items-center gap-1.5 md:gap-2 pointer-events-none">
      <div className="panel !rounded-full pl-2.5 pr-3 max-[339px]:px-0 max-[339px]:w-11 max-[339px]:h-11 max-[339px]:justify-center md:pl-3 md:pr-4 py-1.5 flex items-center gap-1.5 md:gap-2 pointer-events-auto whitespace-nowrap shrink-0" title="멍글마을">
        <span className="text-xl md:text-2xl" aria-hidden>🐾</span>
        <div className="leading-none max-[339px]:hidden">
          <div className="font-display text-lg md:text-2xl">멍글마을</div>
          <div className="text-[10px] text-cocoa-soft tracking-wide hidden sm:block">Mungle Village</div>
        </div>
        <span className="hidden lg:inline text-sm text-cocoa-soft ml-3">우리 강아지와 함께 걷고, 만나고, 자랑하는 3D 커뮤니티 ♡</span>
      </div>

      <div className="flex-1" />

      {DEMO && <span className="name-tag !text-xs !px-3 !py-1.5 pointer-events-auto hidden sm:inline">👀 미리보기 · 혼자 산책 모드</span>}
      {/* 장소 선택: 공원 · 멍글 아파트 (모바일은 두 번째 줄로 이동) */}
      {!touch && <PlacePicker />}
      {!touch && <CommunityButton />}
      {!DEMO && !guest && <button className="btn btn-ghost w-11 h-11 shrink-0 relative pointer-events-auto" onClick={() => { toggle('notifications'); }} aria-label="알림">
        🔔{notifUnread > 0 && <Badge n={notifUnread} />}
      </button>}
      {!DEMO && !guest && <button className={`btn ${panel === 'friends' ? 'btn-peach' : 'btn-ghost'} h-11 px-3 md:px-4 relative pointer-events-auto`} onClick={() => toggle('friends')} aria-label="친구">
        👥 <span className="hidden md:inline">친구</span>{friendBadge > 0 && <Badge n={friendBadge} />}
      </button>}

      {/* 둘러보기 중 표시 + 가입 버튼 */}
      {guest && <button className="btn btn-coral h-11 px-3 text-sm whitespace-nowrap pointer-events-auto" onClick={() => set({ joinPrompt: true })}>👀 둘러보기 중 · 가입</button>}
      <div className="relative pointer-events-auto">
        <button className="rounded-full" onClick={() => setMenuOpen(!menuOpen)} aria-label="내 메뉴"><DogBadge profile={me} size={44} /></button>
        {menuOpen && (
          <div className="absolute right-0 mt-2 panel p-2 w-52 pop" onClick={() => setMenuOpen(false)}>
            <div className="px-3 py-2 text-sm"><b className="font-display">{me.nickname}</b> · 🐶 {me.dogName}
              <div className="text-xs text-cocoa-soft mt-0.5">🏠 {me.residence ? residenceLabel(me.residence) : '아직 입주 전'}</div>
            </div>
            <MenuItem onClick={() => openCommunity('meetups')}>🏘️ 멍글 동네 (모임·자랑)</MenuItem>
            {guest ? <>
              <MenuItem onClick={() => set({ joinPrompt: true })}>🐶 회원가입하고 입주하기</MenuItem>
              <MenuItem onClick={() => void goSignup()}>🚪 둘러보기 끝내기</MenuItem>
            </> : <>
            <MenuItem onClick={() => { set({ panel: 'none', benchMenu: null }); void joinPark('lobby-1'); }}>🏢 아파트 로비</MenuItem>
            {!DEMO && <MenuItem onClick={() => set({ screenSubmit: {} })}>📺 광장 스크린에 올리기</MenuItem>}
            <MenuItem onClick={() => set({ panel: 'avatar' })}>✨ 아바타·강아지 꾸미기</MenuItem>
            <MenuItem onClick={() => set({ dogSheet: me.id })}>🐶 우리 강아지 프로필·사진첩</MenuItem>
            {DEMO ? <MenuItem onClick={resetDemo}>🔄 처음부터 다시 만들기</MenuItem> : <>
              <MenuItem onClick={() => set({ panel: 'settings' })}>🔒 개인정보·차단 설정</MenuItem>
              {me.role === 'admin' && <MenuItem onClick={() => set({ panel: 'admin' })}>🛡️ 운영 관리 (신고·스크린)</MenuItem>}
              <MenuItem onClick={logout}>🚪 로그아웃</MenuItem>
            </>}
            </>}
          </div>
        )}
      </div>
    </div>
  );
}

/** 메인 메뉴 '멍글 동네' 버튼 (열려 있으면 다시 누르면 닫힘) */
function CommunityButton() {
  const open = useStore((s) => !!s.community);
  return (
    <button className={`btn ${open ? 'btn-peach' : 'btn-ghost'} h-11 px-3 md:px-4 shrink-0 pointer-events-auto whitespace-nowrap`} aria-label="멍글 동네" aria-pressed={open}
      onClick={() => (open ? set({ community: null }) : openCommunity('meetups'))}>
      🏘️ <span className="hidden sm:inline">멍글 동네</span>
    </button>
  );
}

const MenuItem = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button className="w-full text-left rounded-xl px-3 py-2 text-sm hover:bg-cream-2" onClick={onClick}>{children}</button>
);

export const Badge = ({ n }: { n: number }) => (
  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#ef6b5b] text-white text-[11px] grid place-items-center font-sans">{n > 9 ? '9+' : n}</span>
);

/** 상단 장소 선택 드롭다운 — 현재 장소 표시, 체크 표시, 이동(공원 / 아파트 로비) */
export function PlacePicker() {
  const park = useStore((s) => s.park);
  const parks = useStore((s) => s.parks);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // 서버 장소 목록(실시간 인원) 기준, 없으면 기본 장소 목록
  const list = (parks.length ? parks : PLACES.map((p) => ({ ...p, count: 0, capacity: 0 }))).filter((p) => p.kind !== 'home');
  const curLabel = park ? `${park.icon ?? '📍'} ${park.name}` : '입장 중…';
  async function go(id: string) {
    setBusy(id);
    // 건물(로비·카페·샵)에서 공원으로 나가면 그 건물 입구 앞에서 시작
    const door = id.startsWith('central') && (park?.kind === 'lobby' || park?.kind === 'cafe' || park?.kind === 'shop') ? park.kind : undefined;
    if (await joinPark(id, door)) setOpen(false);
    setBusy(null);
  }
  return (
    <div className="relative pointer-events-auto min-w-0">
      <button className="btn btn-ghost px-3 md:px-4 h-11 text-sm whitespace-nowrap max-w-[46vw] sm:max-w-[260px] truncate" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="truncate">{curLabel}</span> ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-0" onClick={() => setOpen(false)} />
          <div role="listbox" className="absolute right-0 mt-2 panel p-2 w-[min(78vw,260px)] max-h-[min(60vh,360px)] overflow-y-auto scroll-soft pop z-10">
            <p className="text-xs text-cocoa-soft px-2 pb-1">장소 이동</p>
            {park?.kind === 'home' && (
              <div className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm bg-peach-soft">
                <span>🏠</span><span className="flex-1 truncate">{park.name}</span><span>✓</span>
              </div>
            )}
            {list.map((p) => {
              const here = p.id === park?.id;
              const full = !here && p.capacity > 0 && p.count >= p.capacity;
              return (
                <button key={p.id} role="option" aria-selected={here} disabled={full || !!busy}
                  onClick={() => (here ? setOpen(false) : go(p.id))}
                  className={`w-full flex items-center gap-2 rounded-xl px-3 min-h-[44px] text-sm hover:bg-cream-2 disabled:opacity-40 text-left ${here ? 'bg-peach-soft' : ''}`}>
                  <span>{p.icon}</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  {busy === p.id ? <span className="text-xs text-cocoa-soft">이동 중…</span>
                    : here ? <span className="text-[#e2604f] font-bold">✓</span>
                    : p.capacity > 0 && !DEMO ? <span className="text-xs text-cocoa-soft">{p.count}/{p.capacity}</span> : null}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
