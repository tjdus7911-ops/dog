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
import { closeMenu, dropdownPlacement, goToPage, toggleMenu } from './menus';
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
  const toggle = (p: typeof panel) => set({ panel: panel === p ? 'none' : p, activeMenu: null });

  // 승인 시안: 첫 줄은 로고 · 코인 · 알림 · 프로필만 (모바일 38px, PC 44px). 친구는 하단 '친구' 탭 (PC는 이 줄에)
  return (
    <div className="absolute top-0 inset-x-0 z-20 px-3 flex items-center gap-1.5 md:gap-2 pointer-events-none" style={{ paddingTop: 'calc(var(--safe-t) + 10px)' }}>
      <div className="hud rounded-full h-[38px] md:h-11 pl-1.5 pr-3 max-[359px]:pr-1.5 flex items-center gap-1 pointer-events-auto whitespace-nowrap shrink-0" title="멍글마을" data-testid="hud-logo">
        <LogoMark size={28} className="md:w-8 md:h-auto" />
        <span className="font-display text-[15px] md:text-[18px] leading-none max-[359px]:hidden">멍글마을</span>
        <span className="hidden xl:inline text-[13px] text-[#8A8078] ml-2">우리 강아지와 함께 걷고, 만나고, 자랑하는 3D 커뮤니티</span>
      </div>

      <div className="flex-1" />

      {DEMO && <span className="name-tag !text-xs !px-3 !py-1.5 pointer-events-auto hidden sm:inline">👀 미리보기 · 혼자 산책 모드</span>}
      {/* 장소 선택: PC는 이 줄에, 모바일은 두 번째 줄 */}
      {!touch && <PlacePicker />}
      {!touch && <CommunityButton />}
      {/* 코인: 잔액 + 오늘 출석 전이면 빨간 점 → 누르면 출석 체크·지갑 */}
      {!guest && <CoinChip />}
      {!DEMO && !guest && (
        <button className={`hud relative w-[38px] h-[38px] md:w-11 md:h-11 rounded-full grid place-items-center shrink-0 pointer-events-auto ${panel === 'notifications' ? 'hud-on' : ''}`} onClick={() => toggle('notifications')} aria-label={`알림${notifUnread ? ` ${notifUnread}개` : ''}`} data-testid="hud-bell">
          <Icon name="bell" size={19} className={panel === 'notifications' ? '' : 'hud-icon'} />
          {notifUnread > 0 && <Badge n={notifUnread} />}
        </button>
      )}
      {!DEMO && !guest && !touch && (
        <button className={`hud relative h-11 px-3.5 rounded-full flex items-center gap-1.5 shrink-0 pointer-events-auto text-[14px] ${panel === 'friends' ? 'hud-on' : ''}`} onClick={() => toggle('friends')} aria-label="친구">
          <Icon name="users" size={19} className={panel === 'friends' ? '' : 'hud-icon'} /><span>친구</span>{friendBadge > 0 && <Badge n={friendBadge} />}
        </button>
      )}

      {/* 둘러보기 중 표시 + 가입 버튼 */}
      {guest && <button className="btn btn-coral h-[38px] md:h-11 px-3 text-sm whitespace-nowrap pointer-events-auto" onClick={() => set({ joinPrompt: true })}>👀 둘러보기 중 · 가입</button>}
      <div className="relative pointer-events-auto shrink-0">
        <button className="rounded-full block ring-1 ring-[#EAE3DC] shadow-[0_2px_8px_rgba(81,71,63,.08)]" onClick={() => toggleMenu('profile')} aria-label="내 메뉴" aria-expanded={menuOpen} data-menu-trigger="profile">
          <DogBadge profile={me} size={touch ? 38 : 44} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-2 rounded-2xl bg-[#FFFCF8] border border-[#EAE3DC] shadow-[0_10px_28px_rgba(81,71,63,0.14)] p-1.5 w-56 max-w-[calc(100vw-24px)] max-h-[calc(100dvh-90px)] overflow-y-auto overscroll-contain pop text-[#51473F]" data-menu-root="profile" onClick={closeMenu}>
            <div className="px-3 py-2 text-[14px]"><b className="font-display">{me.nickname}</b> · {me.dogName}
              <div className="text-[12px] text-[#8A8078] mt-0.5">{me.residence ? residenceLabel(me.residence) : '아직 입주 전'}</div>
            </div>
            <div className="h-px bg-[#EAE3DC] mx-2 my-1" />
            <MenuItem onClick={() => openCommunity('meetups')}>멍글 동네 (모임·자랑)</MenuItem>
            {guest ? <>
              <MenuItem onClick={() => { set({ panel: 'none', benchMenu: null }); void joinPark('lobby-1'); }}>아파트 구경하기 (로비)</MenuItem>
              <MenuItem onClick={() => set({ joinPrompt: true })}>회원가입하고 입주하기</MenuItem>
              <MenuItem onClick={() => void goSignup()}>둘러보기 끝내기</MenuItem>
            </> : <>
            <MenuItem onClick={() => set({ wallet: 'attendance' })}>출석 체크 · 코인 지갑</MenuItem>
            <MenuItem onClick={() => { set({ panel: 'none', benchMenu: null }); void joinPark('lobby-1'); }}>아파트 로비</MenuItem>
            {me.residence && <MenuItem onClick={() => set({ moveOpen: true })}>이사하기</MenuItem>}
            {!DEMO && <MenuItem onClick={() => set({ screenSubmit: {} })}>광장 스크린에 올리기</MenuItem>}
            <MenuItem onClick={() => set({ panel: 'avatar' })}>아바타·강아지 꾸미기</MenuItem>
            <MenuItem onClick={() => set({ dogSheet: me.id })}>우리 강아지 프로필·사진첩</MenuItem>
            {DEMO ? <MenuItem onClick={resetDemo}>처음부터 다시 만들기</MenuItem> : <>
              <MenuItem onClick={() => set({ panel: 'settings' })}>개인정보·차단 설정</MenuItem>
              {me.role === 'admin' && <MenuItem onClick={() => set({ panel: 'admin' })}>운영 관리 (신고·스크린·설정)</MenuItem>}
              {me.role === 'admin' && <MenuItem onClick={() => goToPage('/admin')}>관리자 페이지</MenuItem>}
              {canOfferInstall(pwa) && <MenuItem onClick={() => void installFromButton()}>홈 화면에 추가 (앱 설치)</MenuItem>}
              <MenuItem soft onClick={logout}>로그아웃</MenuItem>
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
    <button className={`hud h-11 px-3.5 rounded-full flex items-center gap-1.5 shrink-0 pointer-events-auto whitespace-nowrap text-[14px] ${open ? 'hud-on' : ''}`} aria-label="멍글 동네" aria-pressed={open}
      onClick={() => (open ? set({ community: null }) : openCommunity('meetups'))}>
      <Icon name="wave" size={19} className={open ? '' : 'hud-icon'} /><span className="hidden lg:inline">멍글 동네</span>
    </button>
  );
}

const MenuItem = ({ children, onClick, soft }: { children: React.ReactNode; onClick: () => void; soft?: boolean }) => (
  <button className={`w-full text-left rounded-xl px-3 min-h-[44px] text-[14px] hover:bg-[#F7F1EA] active:bg-[#F7F1EA] ${soft ? 'text-[#8A8078]' : ''}`} onClick={onClick}>{children}</button>
);

export const Badge = ({ n }: { n: number }) => (
  <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-[#E86A5A] text-white text-[10px] leading-none grid place-items-center font-sans border-[1.5px] border-white">{n > 9 ? '9+' : n}</span>
);

/** 장소 선택에 보이는 마을 장소 (입구 앞으로 바로 이동) */
const WARP_ROWS: { id: WarpId; icon: IconName; label: string; sub: string }[] = [
  { id: 'plaza', icon: 'tree', label: '중앙 광장', sub: '분수 광장 앞' },
  { id: 'apartment', icon: 'building', label: '멍글 아파트', sub: '아파트 입구 앞 · 로비는 걸어서 들어가요' },
  { id: 'cafe', icon: 'coffee', label: '멍글 애견카페', sub: '카페 입구 앞' },
  { id: 'shop', icon: 'store', label: '멍글 애견샵', sub: '샵 입구 앞' },
  { id: 'runner', icon: 'flag', label: '멍글런너', sub: '경기장 입구 앞' },
];
const KIND_ICON: Record<string, IconName> = { park: 'tree', lobby: 'building', home: 'home', cafe: 'coffee', shop: 'store' };

/**
 * 상단 장소 선택 드롭다운 — 지금 있는 곳 표시, 마을 장소를 고르면 그 입구 앞으로 바로 이동, 광장 채널(1~4) 바꾸기.
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
          <span className="flex-1 min-w-0 leading-tight"><span className="block text-[14px] truncate">{park.name}</span><span className="block text-[11px] text-[#8A8078]">지금 있는 곳{park.count > 1 ? ` · 함께 있는 사람 ${park.count}명` : ''}</span></span>
          <Icon name="check" size={18} strokeWidth={2.2} className="text-[#E58D76] shrink-0" />
        </div>
      )}
      {park?.kind === 'home' && (
        <button className="w-full flex items-center gap-2.5 rounded-xl px-2.5 min-h-[44px] text-left hover:bg-[#F7F1EA]" data-testid="place-home-info"
          onClick={() => { closeMenu(); set({ homePanel: true }); }}>
          <span className="w-[18px]" /><span className="flex-1 text-[13px]">집 정보 · 방명록</span><Icon name="chevronRight" size={16} className="hud-icon" />
        </button>
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
          <p className="px-2 pb-1 text-[12px] text-[#8A8078]">광장 채널{channels[0].capacity > 0 && !DEMO ? ` · 광장마다 ${channels[0].capacity}명까지` : ''}</p>
          <div className="grid grid-cols-2 gap-1.5 px-1 pb-1">
            {channels.map((c) => {
              const here = inPark && c.id === park!.id;
              const full = !here && c.capacity > 0 && c.count >= c.capacity;
              const counted = c.capacity > 0 && !DEMO;
              return (
                <button key={c.id} disabled={full || !!busy} aria-pressed={here} aria-label={`${c.name}${counted ? ` ${c.count}/${c.capacity}명` : ''}${full ? ' 만원' : ''}`} data-testid={`channel-${c.id}`}
                  className={`min-h-[46px] rounded-xl border px-2.5 text-left leading-tight disabled:opacity-45 ${here ? 'border-[#E58D76] bg-[#FBE8E1]' : 'border-[#EAE3DC] bg-[#FFFCF8] hover:bg-[#F7F1EA]'}`}
                  onClick={() => (here ? closeMenu() : void run(c.id, () => warpTo('plaza', c.id)))}>
                  <span className="block text-[13px]">{busy === c.id ? '이동 중…' : c.name}{here && <span className="text-[#E58D76]"> · 여기</span>}</span>
                  {counted && <span className={`block text-[11px] ${full ? 'text-[#C9624A]' : 'text-[#8A8078]'}`}>{c.count}/{c.capacity}명{full ? ' (만원)' : ''}</span>}
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
      <button ref={btn} className={`hud rounded-full h-9 md:h-11 pl-3 pr-2.5 flex items-center gap-1.5 text-[14px] whitespace-nowrap max-w-[calc(100vw-24px)] sm:max-w-[340px] ${open ? 'hud-on' : ''}`} onClick={() => toggleMenu('place')}
        aria-haspopup="listbox" aria-expanded={open} data-menu-trigger="place" data-testid="place-picker">
        <Icon name={park ? KIND_ICON[park.kind] ?? 'home' : 'tree'} size={17} className={`shrink-0 ${open ? '' : 'hud-icon'}`} />
        <span className="truncate">{label}</span>
        {inPark && !DEMO && park!.capacity > 0 && <span className="text-[12px] text-[#8A8078] shrink-0">· {park!.count}명</span>}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} className={`shrink-0 ${open ? '' : 'hud-icon'}`} />
      </button>
      {panel}
    </div>
  );
}
