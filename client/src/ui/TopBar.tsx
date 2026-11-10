import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { set, useStore } from '../store';
import { joinPark, lastPark, warpTo } from '../net/socket';
import { PLACES } from '@shared/spaces';
import { DogBadge } from './common';
import { logout } from './App';
import { goSignup } from './Interact';
import { DEMO, resetDemo } from '../demo';
import { residenceLabel } from '@shared/apartment';
import { openCommunity } from './Community';
import { isTouchDevice } from '../game/input';
import { CoinChip } from './Coins';
import { Icon, type IconName } from './icons';
import { closeMenu, dropdownPlacement, toggleMenu } from './menus';
import type { WarpId } from '@shared/world';
import { LogoMark } from './Logo';
import { installFromButton } from './Install';
import { canOfferInstall, usePwa } from '../pwa';

export function TopBar() {
  const me = useStore((s) => s.me)!;
  const pwa = usePwa();
  const panel = useStore((s) => s.panel);
  const notifUnread = useStore((s) => s.notifications.filter((n) => !n.read).length);
  const friendBadge = useStore((s) => s.incoming.length + s.friends.reduce((a, f) => a + f.unread, 0));
  const menuOpen = useStore((s) => s.activeMenu === 'profile');
  const guest = me.role === 'guest';
  const touch = isTouchDevice();
  const toggle = (p: typeof panel) => set({ panel: panel === p ? 'none' : p });

  return (
    <div className="absolute top-0 inset-x-0 z-20 p-2 md:p-3 flex items-center gap-1.5 md:gap-2 pointer-events-none">
      <div className="panel !rounded-full pl-2.5 pr-3 max-[339px]:px-0 max-[339px]:w-11 max-[339px]:h-11 max-[339px]:justify-center md:pl-3 md:pr-4 py-1.5 flex items-center gap-1.5 md:gap-2 pointer-events-auto whitespace-nowrap shrink-0" title="멍글마을">
        <LogoMark size={30} className="md:w-9 md:h-auto" />
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
      {/* 코인 칩: 잔액 + 오늘 출석 전이면 빨간 점 → 누르면 출석 체크·지갑 */}
      {!guest && <CoinChip />}
      {!DEMO && !guest && <button className="btn btn-ghost w-11 h-11 shrink-0 relative pointer-events-auto" onClick={() => { toggle('notifications'); }} aria-label="알림">
        🔔{notifUnread > 0 && <Badge n={notifUnread} />}
      </button>}
      {!DEMO && !guest && <button className={`btn ${panel === 'friends' ? 'btn-peach' : 'btn-ghost'} h-11 px-3 md:px-4 relative pointer-events-auto`} onClick={() => toggle('friends')} aria-label="친구">
        👥 <span className="hidden md:inline">친구</span>{friendBadge > 0 && <Badge n={friendBadge} />}
      </button>}

      {/* 둘러보기 중 표시 + 가입 버튼 */}
      {guest && <button className="btn btn-coral h-11 px-3 text-sm whitespace-nowrap pointer-events-auto" onClick={() => set({ joinPrompt: true })}>👀 둘러보기 중 · 가입</button>}
      <div className="relative pointer-events-auto">
        <button className="rounded-full" onClick={() => toggleMenu('profile')} aria-label="내 메뉴" aria-expanded={menuOpen} data-menu-trigger="profile"><DogBadge profile={me} size={44} /></button>
        {menuOpen && (
          <div className="absolute right-0 mt-2 panel p-2 w-52 max-w-[calc(100vw-24px)] max-h-[calc(100dvh-90px)] overflow-y-auto overscroll-contain pop" data-menu-root="profile" onClick={closeMenu}>
            <div className="px-3 py-2 text-sm"><b className="font-display">{me.nickname}</b> · 🐶 {me.dogName}
              <div className="text-xs text-cocoa-soft mt-0.5">🏠 {me.residence ? residenceLabel(me.residence) : '아직 입주 전'}</div>
            </div>
            <MenuItem onClick={() => openCommunity('meetups')}>🏘️ 멍글 동네 (모임·자랑)</MenuItem>
            {guest ? <>
              <MenuItem onClick={() => set({ joinPrompt: true })}>🐶 회원가입하고 입주하기</MenuItem>
              <MenuItem onClick={() => void goSignup()}>🚪 둘러보기 끝내기</MenuItem>
            </> : <>
            <MenuItem onClick={() => set({ wallet: 'attendance' })}>📅 출석 체크 · 🪙 코인 지갑</MenuItem>
            <MenuItem onClick={() => { set({ panel: 'none', benchMenu: null }); void joinPark('lobby-1'); }}>🏢 아파트 로비</MenuItem>
            {me.residence && <MenuItem onClick={() => set({ moveOpen: true })}>🚚 이사하기 (아파트 업그레이드)</MenuItem>}
            {!DEMO && <MenuItem onClick={() => set({ screenSubmit: {} })}>📺 광장 스크린에 올리기</MenuItem>}
            <MenuItem onClick={() => set({ panel: 'avatar' })}>✨ 아바타·강아지 꾸미기</MenuItem>
            <MenuItem onClick={() => set({ dogSheet: me.id })}>🐶 우리 강아지 프로필·사진첩</MenuItem>
            {DEMO ? <MenuItem onClick={resetDemo}>🔄 처음부터 다시 만들기</MenuItem> : <>
              <MenuItem onClick={() => set({ panel: 'settings' })}>🔒 개인정보·차단 설정</MenuItem>
              {me.role === 'admin' && <MenuItem onClick={() => set({ panel: 'admin' })}>🛡️ 운영 관리 (신고·스크린)</MenuItem>}
              {canOfferInstall(pwa) && <MenuItem onClick={() => void installFromButton()}>📲 홈 화면에 추가 (앱 설치)</MenuItem>}
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

/** 장소 선택에 보이는 마을 장소 (입구 앞으로 바로 이동) */
const WARP_ROWS: { id: WarpId; icon: IconName; label: string; sub: string }[] = [
  { id: 'plaza', icon: 'tree', label: '중앙 공원', sub: '분수 광장 앞' },
  { id: 'apartment', icon: 'building', label: '멍글 아파트', sub: '아파트 입구 앞 · 로비는 걸어서 들어가요' },
  { id: 'cafe', icon: 'coffee', label: '멍글 애견카페', sub: '카페 입구 앞' },
  { id: 'shop', icon: 'store', label: '멍글 애견샵', sub: '샵 입구 앞' },
  { id: 'runner', icon: 'flag', label: '멍글런너', sub: '경기장 입구 앞' },
];
const KIND_ICON: Record<string, IconName> = { park: 'tree', lobby: 'building', home: 'home', cafe: 'coffee', shop: 'store' };

/**
 * 상단 장소 선택 드롭다운 — 지금 있는 곳 표시, 마을 장소를 고르면 그 입구 앞으로 바로 이동, 공원 채널 바꾸기.
 * 화면 기준 좌표로 띄워(포털) 부모 영역에 잘리지 않고, 화면 좌우·하단 탭을 넘지 않게 위치·높이를 맞춘다.
 */
export function PlacePicker() {
  const park = useStore((s) => s.park);
  const parks = useStore((s) => s.parks);
  const open = useStore((s) => s.activeMenu === 'place');
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<ReturnType<typeof dropdownPlacement> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!btn.current) return;
      const nav = document.querySelector('nav[aria-label="주 메뉴"]');
      setPos(dropdownPlacement(btn.current.getBoundingClientRect(), { width: 304, maxHeight: 470, bottomReserve: nav ? nav.getBoundingClientRect().height + 8 : 12 }));
    };
    place();
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    return () => { window.removeEventListener('resize', place); window.visualViewport?.removeEventListener('resize', place); };
  }, [open]);
  const channels = (parks.length ? parks : PLACES.map((p) => ({ ...p, count: 0, capacity: 0 }))).filter((p) => p.kind === 'park');
  const inPark = park?.kind === 'park';
  const curChannel = channels.find((c) => c.id === (inPark ? park!.id : lastPark()));
  const label = park ? park.name : '입장 중…';
  async function run(key: string, f: () => Promise<unknown>) {
    setBusy(key);
    try { await f(); } finally { setBusy(null); }
    closeMenu();
  }
  const panel = open && pos && createPortal(
    <div role="listbox" aria-label="장소 이동" data-menu-root="place" data-testid="place-menu"
      className="fixed z-[70] rounded-2xl bg-[#FFFCF8] border border-[#EAE3DC] shadow-[0_10px_28px_rgba(81,71,63,0.14)] p-2 overflow-y-auto overscroll-contain scroll-soft pop text-[#51473F]"
      style={{ left: pos.left, width: pos.width, maxHeight: pos.maxHeight, top: pos.top, bottom: pos.bottom }}>
      <p className="px-2 pt-1 pb-1.5 text-[12px] text-[#8A8078]">장소를 고르면 그 장소 <b className="text-[#51473F]">입구 앞</b>으로 바로 이동해요</p>
      {park && !inPark && (
        <div role="option" aria-selected className="flex items-center gap-2.5 rounded-xl px-2.5 min-h-[48px] bg-[#FBE8E1]">
          <Icon name={KIND_ICON[park.kind] ?? 'home'} size={18} className="text-[#E58D76] shrink-0" />
          <span className="flex-1 min-w-0 leading-tight"><span className="block text-[14px] truncate">{park.name}</span><span className="block text-[11px] text-[#8A8078]">지금 있는 곳</span></span>
          <Icon name="check" size={18} strokeWidth={2.2} className="text-[#E58D76] shrink-0" />
        </div>
      )}
      <div className="h-px bg-[#EAE3DC] mx-2 my-1.5" />
      <p className="px-2 pb-1 text-[12px] text-[#8A8078]">마을 장소</p>
      {WARP_ROWS.map((w) => (
        <button key={w.id} role="option" aria-selected={false} disabled={!!busy} data-testid={`warp-${w.id}`}
          className="w-full flex items-center gap-2.5 rounded-xl px-2.5 min-h-[48px] text-left hover:bg-[#F7F1EA] active:bg-[#F7F1EA] disabled:opacity-50"
          onClick={() => void run(w.id, () => warpTo(w.id))}>
          <Icon name={w.icon} size={18} className="text-[#756B63] shrink-0" />
          <span className="flex-1 min-w-0 leading-tight">
            <span className="block text-[14px] truncate">{w.label}</span>
            <span className="block text-[11px] text-[#8A8078] truncate">{w.id === 'plaza' && curChannel && curChannel.capacity > 0 && !DEMO ? `${w.sub} · 지금 ${curChannel.count}명` : w.sub}</span>
          </span>
          {busy === w.id && <span className="text-[11px] text-[#8A8078] shrink-0">이동 중…</span>}
        </button>
      ))}
      {channels.length > 1 && (
        <>
          <div className="h-px bg-[#EAE3DC] mx-2 my-1.5" />
          <p className="px-2 pb-1 text-[12px] text-[#8A8078]">공원 채널 (사람이 많으면 다른 채널로)</p>
          <div className="grid grid-cols-3 gap-1.5 px-1 pb-1">
            {channels.map((c, i) => {
              const here = inPark && c.id === park!.id;
              const full = !here && c.capacity > 0 && c.count >= c.capacity;
              return (
                <button key={c.id} disabled={full || !!busy} aria-pressed={here} data-testid={`channel-${c.id}`}
                  className={`min-h-[44px] rounded-xl border text-[13px] disabled:opacity-40 ${here ? 'border-[#E58D76] bg-[#FBE8E1]' : 'border-[#EAE3DC] bg-[#FFFCF8]'}`}
                  onClick={() => (here ? closeMenu() : void run(c.id, () => warpTo('plaza', c.id)))}>
                  {busy === c.id ? '이동 중…' : `공원 ${i + 1}${c.capacity > 0 && !DEMO ? ` · ${c.count}명` : ''}`}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
  return (
    <div className="relative pointer-events-auto min-w-0">
      <button ref={btn} className="btn btn-ghost px-3 md:px-4 h-11 text-sm whitespace-nowrap max-w-[60vw] sm:max-w-[300px]" onClick={() => toggleMenu('place')}
        aria-haspopup="listbox" aria-expanded={open} data-menu-trigger="place" data-testid="place-picker">
        <span className="truncate">{park ? `${park.icon ?? '📍'} ${label}` : label}{inPark && !DEMO && park!.capacity > 0 ? ` · ${park!.count}명` : ''}</span> ▾
      </button>
      {panel}
    </div>
  );
}
