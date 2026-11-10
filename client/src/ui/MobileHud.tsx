// 모바일 화면 구성: 장소 줄(두 번째 줄) · 하단 고정 내비게이션 · 더보기 메뉴 · 우측 빠른 메뉴 · 마을 지도 · 동네 일정
// 3D 마을을 최대한 넓게 보이도록, 열린 창이 있으면 이동 조작 UI를 숨긴다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { drawBinsAndPoops } from './MiniMap';
import { get, set, toast, useStore } from '../store';
import { canOfferInstall, usePwa } from '../pwa';
import { installFromButton } from './Install';
import { joinPark, warpTo } from '../net/socket';
import { api } from '../lib/api';
import { local } from '../game/local';
import { isTouchDevice, setMoveLocked } from '../game/input';
import { rendered } from '../net/remote';
import { DEMO, resetDemo } from '../demo';
import { homeSpaceId } from '@shared/spaces';
import {
  APARTMENT_ENTRANCE, BIG_SCREEN, BUILDINGS, CAFE_ENTRANCE, FOUNTAIN_RADIUS, MEETING_BOARD, PATH_WIDTH, PHOTO_ZONE,
  PLAZA_RADIUS, RADIAL_ANGLES, RING_RADIUS, SHOP_ENTRANCE, TREES, WORLD_RADIUS,
  RUNNER_ARENA,
} from '@shared/world';
import type { MeetupView } from '@shared/community';
import type { WarpId } from '@shared/world';
import type { ScreenSlide } from '@shared/screen';
import { PlacePicker } from './TopBar';
import { openCommunity, fmtWhen } from './Community';
import { Modal, PanelHeader } from './common';
import { logout } from './App';
import { Icon } from './icons';
import { closeMenu, fromMenu, toggleMenu } from './menus';
import { FEATURES } from '@shared/features';
import { MOBILE_TOP_ROWS, NAV_H } from './layout';

// ---------------------------------------------------------------- 장소 줄 (모바일 상단 두 번째 줄)
export function PlaceBar() {
  const park = useStore((s) => s.park);
  return (
    <div className="absolute z-20 left-2 right-2 flex items-center gap-1.5 pointer-events-none" style={{ top: 'calc(var(--safe-t) + 60px)' }}>
      <PlacePicker />
      {park && (
        <span className="name-tag !text-[12px] !px-3 !py-1.5 shrink-0" aria-label="지금 이곳 인원">
          🐾 {park.kind === 'park' ? '산책 중' : '함께 있는 사람'} {park.count}명
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 하단 고정 내비게이션
async function goHome() {
  const me = get().me!;
  set({ activeMenu: null, panel: 'none', chatOpen: false });
  if (me.role === 'guest') { set({ joinPrompt: true }); return; }
  if (me.residence) { await joinPark(homeSpaceId(me.id)); return; }
  toast('아직 입주한 집이 없어요. 로비 안내판에서 빈 호실에 입주해 보세요 🏠');
  if (get().park?.kind !== 'lobby') await joinPark('lobby-1');
  set({ lobbyPanel: true });
}
async function goShop() {
  set({ activeMenu: null, panel: 'none', chatOpen: false });
  if (get().park?.kind !== 'shop' && !(await joinPark('shop-1'))) return;
  set({ shopOpen: true });
}

export function BottomNav() {
  const me = useStore((s) => s.me)!;
  const park = useStore((s) => s.park);
  const panel = useStore((s) => s.panel);
  const chatOpen = useStore((s) => s.chatOpen);
  const moreOpen = useStore((s) => s.activeMenu === 'more');
  const unread = useStore((s) => s.chatUnread);
  const friendBadge = useStore((s) => s.incoming.length + s.friends.reduce((a, f) => a + f.unread, 0));
  const items: { id: string; icon: string; label: string; active: boolean; badge?: number; onClick: () => void }[] = [
    { id: 'home', icon: '🏠', label: '내 집', active: park?.kind === 'home' && park.ownerId === me.id, onClick: () => void goHome() },
    { id: 'shop', icon: '🛍️', label: '상점', active: park?.kind === 'shop', onClick: () => void goShop() },
    {
      id: 'friends', icon: '🐾', label: '친구', active: panel === 'friends', badge: friendBadge,
      onClick: () => (DEMO ? toast('미리보기에서는 친구 기능을 쓸 수 없어요. (게임 서버에서 동작)') : me.role === 'guest' ? set({ joinPrompt: true }) : set({ panel: panel === 'friends' ? 'none' : 'friends', activeMenu: null, chatOpen: false })),
    },
    {
      id: 'chat', icon: '💬', label: '채팅', active: chatOpen, badge: unread,
      onClick: () => (DEMO ? toast('미리보기에서는 채팅을 쓸 수 없어요. (게임 서버에서 동작)') : set({ chatOpen: !chatOpen, activeMenu: null, panel: 'none' })),
    },
    { id: 'more', icon: '☰', label: '더보기', active: moreOpen, onClick: () => toggleMenu('more') },
  ];
  return (
    <nav aria-label="주 메뉴" className="absolute z-20 inset-x-0 bottom-0 bg-[#fffaf4]/92 backdrop-blur-md rounded-t-[22px] border-t-2 border-white shadow-[0_-6px_22px_rgba(90,64,51,.14)]"
      style={{ paddingBottom: 'var(--safe-b)' }}>
      <ul className="grid grid-cols-5" style={{ height: NAV_H }}>
        {items.map((it) => (
          <li key={it.id} className="flex">
            <button onClick={it.onClick} aria-pressed={it.active} data-menu-trigger={it.id === 'more' ? 'more' : undefined} data-testid={`nav-${it.id}`}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 select-none transition ${it.active ? 'text-peach-deep' : 'text-cocoa'}`}>
              <span className={`grid place-items-center w-11 h-7 rounded-full text-[19px] leading-none transition ${it.active ? 'bg-peach-soft' : ''}`}>{it.icon}</span>
              <span className={`text-[11px] font-display leading-none ${it.active ? 'text-peach-deep' : ''}`}>{it.label}</span>
              {!!it.badge && <span className="absolute top-1.5 left-1/2 ml-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ef6b5b] text-white text-[10px] grid place-items-center font-sans">{it.badge > 9 ? '9+' : it.badge}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------- 더보기
// 아래에서 올라오는 시트 · 섹션 제목과 얇은 구분선 · 아이콘 없이 · 2열로 촘촘하게 · 길면 시트 안에서만 스크롤.
// 다른 곳에서 바로 갈 수 있는 것은 빼 둠: 알림(상단 종) · 출석(상단 코인) · 애견카페(장소 선택) · 마을 지도(오른쪽 버튼)
export function MoreSheet() {
  const me = useStore((s) => s.me)!;
  const open = useStore((s) => s.activeMenu === 'more');
  const pwa = usePwa();
  useEffect(() => { setMoveLocked(open, 'more'); return () => setMoveLocked(false, 'more'); }, [open]);
  if (!open) return null;
  const guest = me.role === 'guest';
  const sections: { title: string; items: { label: string; onClick: () => void; hide?: boolean; soft?: boolean }[] }[] = [
    { title: '마을 생활', items: [
      { label: '동네 일정', onClick: fromMenu(() => set({ eventsOpen: true })) },
      { label: '아파트 로비', onClick: fromMenu(() => void joinPark('lobby-1')), hide: guest },
      { label: '이사하기', onClick: fromMenu(() => set({ moveOpen: true })), hide: !me.residence },
    ] },
    { title: '동네', items: [
      { label: '산책 모임', onClick: fromMenu(() => openCommunity('meetups')) },
      { label: '강아지 자랑', onClick: fromMenu(() => openCommunity('posts')) },
      { label: '강아지 모임', onClick: fromMenu(() => openCommunity('clubs')), hide: !FEATURES.dogClubs },
    ] },
    { title: '꾸미기', items: [
      { label: '아바타·강아지 꾸미기', onClick: fromMenu(() => set({ panel: 'avatar' })) },
      { label: '강아지 프로필·사진첩', onClick: fromMenu(() => set({ dogSheet: me.id })), hide: guest },
      { label: '광장 스크린 신청', onClick: fromMenu(() => set({ screenSubmit: {} })), hide: DEMO || guest },
    ] },
    { title: '설정', items: [
      { label: '개인정보·차단 설정', onClick: fromMenu(() => set({ panel: 'settings' })), hide: DEMO || guest },
      { label: '홈 화면에 추가', onClick: fromMenu(() => void installFromButton()), hide: !canOfferInstall(pwa) },
      { label: '운영 관리', onClick: fromMenu(() => set({ panel: 'admin' })), hide: DEMO || me.role !== 'admin' },
      DEMO ? { label: '처음부터 다시 만들기', onClick: fromMenu(resetDemo), soft: true } : { label: guest ? '둘러보기 끝내기' : '로그아웃', onClick: fromMenu(logout), soft: true },
    ] },
  ];
  return (
    <>
      <div className="absolute inset-x-0 top-0 z-20 bg-[#51473F24]" style={{ bottom: `calc(var(--safe-b) + ${NAV_H}px)` }} data-menu-backdrop onPointerDown={closeMenu} />
      <section aria-label="더보기" data-menu-root="more" data-testid="more-sheet"
        className="absolute z-20 inset-x-0 bg-[#FFFCF8] rounded-t-[20px] border-t border-[#EAE3DC] px-4 pt-2 pb-2.5 overflow-y-auto overscroll-contain scroll-soft text-[#51473F]"
        style={{ bottom: `calc(var(--safe-b) + ${NAV_H}px)`, maxHeight: `min(560px, calc(100% - var(--safe-t) - ${NAV_H + 70}px))` }}>
        <div className="mx-auto w-9 h-1 rounded-full bg-[#EAE3DC]" />
        <div className="flex items-center gap-2 min-h-[44px]">
          <h2 className="font-display text-[16px] flex-1">더보기</h2>
          <span className="text-[12px] text-[#8A8078] truncate max-w-[45%]">{me.nickname} · {me.dogName}</span>
          <button className="w-11 h-11 -mr-2 rounded-full grid place-items-center text-[#756B63]" onClick={closeMenu} aria-label="더보기 닫기"><Icon name="x" size={20} /></button>
        </div>
        {sections.map((sec) => {
          const items = sec.items.filter((x) => !x.hide);
          if (!items.length) return null;
          return (
            <div key={sec.title}>
              <h3 className="text-[12px] text-[#8A8078] pt-2.5 pb-0.5 px-0.5 font-normal">{sec.title}</h3>
              <div className="grid grid-cols-2 gap-x-4">
                {items.map((it) => (
                  <button key={it.label} onClick={it.onClick} className={`min-h-[46px] px-0.5 text-left text-[14px] border-b border-[#EAE3DC] active:bg-[#F7F1EA] ${it.soft ? 'text-[#8A8078]' : ''}`}>{it.label}</button>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- 우측 빠른 메뉴
function prefersCollapsed() {
  try { const v = localStorage.getItem('mungle.quick'); if (v) return v === 'closed'; } catch { /* 무시 */ }
  return typeof window !== 'undefined' && window.innerHeight < 640;
}
export function QuickMenu() {
  const touch = isTouchDevice();
  // 실내(로비·집·카페·샵)는 왼쪽 위에 장소 버튼 줄이 있어 그 아래로 내림
  const indoor = useStore((s) => s.park?.kind !== 'park');
  const [closed, setClosed] = useState(prefersCollapsed);
  const toggle = () => { setClosed(!closed); try { localStorage.setItem('mungle.quick', closed ? 'open' : 'closed'); } catch { /* 무시 */ } };
  const items = [
    { icon: '🗺️', label: '마을 지도', onClick: () => set({ mapOpen: true }) },
    { icon: '👥', label: '동네 모임', onClick: () => openCommunity('meetups') },
    { icon: '🐾', label: '강아지 자랑', onClick: () => openCommunity('posts') },
    { icon: '📅', label: '이벤트', onClick: () => set({ eventsOpen: true }) },
  ];
  return (
    <div className="absolute z-10 right-2 md:right-3 flex flex-col items-center gap-2"
      style={{ top: touch ? `calc(var(--safe-t) + ${MOBILE_TOP_ROWS + (indoor ? 58 : 0)}px)` : 78 }}>
      {!closed && items.map((it) => (
        <button key={it.label} onClick={it.onClick} aria-label={it.label}
          className="w-[54px] h-[54px] rounded-[18px] bg-[#fffaf4]/92 border-2 border-white shadow-[0_3px_10px_rgba(90,64,51,.16)] flex flex-col items-center justify-center gap-0.5 active:scale-95 transition">
          <span className="text-[19px] leading-none">{it.icon}</span>
          <span className="text-[9.5px] font-display leading-none whitespace-nowrap">{it.label}</span>
        </button>
      ))}
      <button onClick={toggle} aria-label={closed ? '빠른 메뉴 펼치기' : '빠른 메뉴 접기'} aria-expanded={!closed}
        className="w-[34px] h-[26px] rounded-full bg-[#fffaf4]/92 border-2 border-white shadow-sm text-[11px] text-cocoa-soft grid place-items-center">
        {closed ? '◂ ☰' : '▴'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- 마을 지도
// x·z: 이름표를 놓을 지도 위치 (광장 안 시설은 겹치지 않게 바깥쪽으로 비켜 표시), spot: 걸어갈 지점
const LANDMARKS: { icon: string; label: string; x: number; z: number; spot?: { x: number; z: number }; warp?: WarpId }[] = [
  { icon: '⛲', label: '분수 광장', x: 0, z: 4.5, spot: { x: 0, z: 4 } },
  { icon: '📺', label: '대형 스크린', x: BIG_SCREEN.x, z: BIG_SCREEN.z - 1.5, spot: { x: 0, z: -8.6 } },
  { icon: '📋', label: '모임 게시판', x: MEETING_BOARD.x + 6.5, z: MEETING_BOARD.z - 3, spot: { x: MEETING_BOARD.x * 0.78, z: MEETING_BOARD.z * 0.78 } },
  { icon: '📸', label: '포토존', x: PHOTO_ZONE.x - 5.5, z: PHOTO_ZONE.z - 3, spot: { x: PHOTO_ZONE.standX, z: PHOTO_ZONE.standZ } },
  { icon: '🏢', label: '멍글 아파트', x: APARTMENT_ENTRANCE.x, z: APARTMENT_ENTRANCE.z - 3.5, warp: 'apartment' },
  { icon: '☕', label: '애견카페', x: CAFE_ENTRANCE.x, z: CAFE_ENTRANCE.z - 3, warp: 'cafe' },
  { icon: '🛍️', label: '애견샵', x: SHOP_ENTRANCE.x, z: SHOP_ENTRANCE.z - 3, warp: 'shop' },
  { icon: '🏃', label: '멍글런너', x: RUNNER_ARENA.x, z: RUNNER_ARENA.z + 1, warp: 'runner' },
];

function drawPark(g: CanvasRenderingContext2D, size: number, friendIds: Set<number>) {
  const k = (size / 2 - 6) / (WORLD_RADIUS + 1);
  const P = (x: number, z: number): [number, number] => [size / 2 + x * k, size / 2 + z * k];
  g.clearRect(0, 0, size, size);
  g.fillStyle = '#b6db9c'; g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f3e6cf'; g.lineWidth = PATH_WIDTH * k; g.lineCap = 'round';
  g.beginPath(); g.arc(size / 2, size / 2, RING_RADIUS * k, 0, Math.PI * 2); g.stroke();
  for (const a of RADIAL_ANGLES) { g.beginPath(); g.moveTo(...P(0, 0)); g.lineTo(...P(Math.sin(a) * 34, Math.cos(a) * 34)); g.stroke(); }
  g.fillStyle = '#f3e6cf'; g.beginPath(); g.arc(size / 2, size / 2, PLAZA_RADIUS * k, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9ad6e8'; g.beginPath(); g.arc(size / 2, size / 2, FOUNTAIN_RADIUS * k, 0, Math.PI * 2); g.fill();
  for (const t of TREES) { g.fillStyle = t.kind === 'cherry' ? '#f4b6c6' : '#86b874'; g.beginPath(); g.arc(...P(t.x, t.z), 2.6, 0, Math.PI * 2); g.fill(); }
  for (const b of BUILDINGS) { g.fillStyle = b.roof; const [x, y] = P(b.x - b.w / 2, b.z - b.d / 2); g.fillRect(x, y, b.w * k, b.d * k); }
  drawBinsAndPoops(g, P, 4);
  rendered.forEach((r, id) => {
    const [x, y] = P(r.x, r.z);
    g.fillStyle = friendIds.has(id) ? '#5fa35a' : '#ffffff'; g.strokeStyle = '#5a4033'; g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.stroke();
  });
  const [mx, my] = P(local.x, local.z);
  g.save(); g.translate(mx, my); g.rotate(-local.rot + Math.PI);
  g.fillStyle = '#ef7a55'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -9); g.lineTo(7, 7); g.lineTo(0, 3.5); g.lineTo(-7, 7); g.closePath(); g.fill(); g.stroke();
  g.restore();
  return P;
}

export function VillageMap() {
  const open = useStore((s) => s.mapOpen);
  const park = useStore((s) => s.park);
  const me = useStore((s) => s.me);
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(300);
  const inPark = park?.kind === 'park';
  useEffect(() => {
    if (!open) return;
    setSize(Math.min(340, window.innerWidth - 64));
  }, [open]);
  useEffect(() => {
    if (!open || !inPark) return;
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr; c.height = size * dpr;
    const g = c.getContext('2d')!;
    const draw = () => { g.setTransform(dpr, 0, 0, dpr, 0, 0); drawPark(g, size, new Set(get().friends.map((f) => f.profile.id))); };
    draw();
    const id = window.setInterval(draw, 200);
    return () => window.clearInterval(id);
  }, [open, inPark, size]);
  if (!open) return null;
  const close = () => set({ mapOpen: false });
  const k = (size / 2 - 6) / (WORLD_RADIUS + 1);
  const walkTo = (x: number, z: number) => { local.moveTarget = { x, z }; local.seatGoal = null; close(); toast('🐾 그쪽으로 걸어가요'); };
  const places = [
    ...(inPark ? [] : [{ icon: '🌳', label: '중앙 공원으로', go: () => void warpTo('plaza') }]),
    { icon: '🏢', label: '아파트 입구', go: () => void warpTo('apartment') },
    { icon: '☕', label: '애견카페 입구', go: () => void warpTo('cafe') },
    { icon: '🛍️', label: '애견샵 입구', go: () => void warpTo('shop') },
    ...(me?.residence ? [{ icon: '🏠', label: '우리 집', go: () => void joinPark(homeSpaceId(me.id)) }] : []),
  ];
  return (
    <Modal onClose={close} className="max-w-[400px] p-4">
      <PanelHeader icon="🗺️" title="마을 지도" onClose={close} />
      {inPark ? (
        <>
          <div className="relative mx-auto" style={{ width: size, height: size }}>
            <canvas ref={ref} style={{ width: size, height: size }} className="rounded-full border-4 border-white shadow-md" />
            {LANDMARKS.map((l) => (
              <button key={l.label} onClick={() => (l.warp ? (close(), void warpTo(l.warp)) : l.spot && walkTo(l.spot.x, l.spot.z))} title={l.warp ? `${l.label} 입구 앞으로 이동` : `${l.label}(으)로 걸어가기`}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/95 shadow px-1.5 py-0.5 text-[10px] font-display whitespace-nowrap border border-[#f1e2d2]"
                style={{ left: size / 2 + l.x * k, top: size / 2 + l.z * k }}>
                {l.icon} {l.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-cocoa-soft text-center mt-2">🔶 나 · 🟢 친구 · ⚪ 다른 산책러 · 🟩 배변봉투 휴지통 — 건물을 누르면 입구 앞으로 바로 가요</p>
        </>
      ) : <p className="text-sm text-cocoa-soft bg-cream-2 rounded-2xl px-3 py-3">지금은 {park?.name ?? '실내'}에 있어요. 공원 지도는 공원에서 볼 수 있어요.</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {places.map((p) => <button key={p.label} className="btn btn-ghost min-h-[42px] text-sm" onClick={() => { close(); p.go(); }}>{p.icon} {p.label}</button>)}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- 이벤트 (실제 등록된 모임 일정 · 운영 공지)
export function EventsPanel() {
  const open = useStore((s) => s.eventsOpen);
  const [data, setData] = useState<{ meetups: MeetupView[]; notices: ScreenSlide[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setData(null); setError(null);
    Promise.all([
      api<{ meetups: MeetupView[] }>('/api/meetups?scope=upcoming'),
      DEMO ? Promise.resolve({ slides: [] as ScreenSlide[] }) : api<{ slides: ScreenSlide[] }>('/api/screen'),
    ]).then(([m, s]) => setData({
      meetups: m.meetups.filter((x) => x.startsAt > Date.now() - 3600_000 && x.startsAt < Date.now() + 14 * 86400_000).slice(0, 8),
      notices: s.slides.filter((x) => x.kind === 'notice'),
    })).catch((e) => setError((e as Error).message));
  }, [open]);
  if (!open) return null;
  const close = () => set({ eventsOpen: false });
  return (
    <Modal onClose={close} className="max-w-[420px] p-4">
      <PanelHeader icon="📅" title="이벤트 · 동네 일정" onClose={close} />
      {error && <p className="text-sm text-[#c4553a]">{error}</p>}
      {!data && !error && <p className="text-sm text-cocoa-soft py-6 text-center">불러오는 중…</p>}
      {data && (
        <>
          <Section title="📢 운영 공지">
            {data.notices.length ? data.notices.map((n) => (
              <div key={n.id} className="rounded-2xl bg-white px-3 py-2"><div className="font-display">{n.title}</div>{n.text && <div className="text-sm text-cocoa-soft">{n.text}</div>}</div>
            )) : <Empty>지금 진행 중인 공지·이벤트가 없어요.</Empty>}
          </Section>
          <Section title="🐾 2주 안에 열리는 모임">
            {data.meetups.length ? data.meetups.map((m) => (
              <button key={m.id} className="w-full text-left rounded-2xl bg-white px-3 py-2" onClick={() => { close(); openCommunity('meetups', { meetupId: m.id }); }}>
                <div className="text-[11px] text-cocoa-soft">{m.kind === 'online' ? '💻 온라인' : `🌳 ${m.region}`} · {fmtWhen(m.startsAt)}</div>
                <div className="font-display">{m.title}</div>
                <div className="text-xs text-cocoa-soft">👥 {m.approvedCount}/{m.capacity}명 · {m.place}</div>
              </button>
            )) : <Empty>예정된 모임이 없어요. 첫 모임을 열어 보세요!</Empty>}
          </Section>
          <button className="btn btn-peach w-full min-h-[44px] mt-1" onClick={() => { close(); openCommunity('meetups', {}); set((s) => ({ community: s.community ? { ...s.community, compose: true } : null })); }}>＋ 모임 만들기</button>
        </>
      )}
    </Modal>
  );
}
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mb-3"><h3 className="font-display text-sm mb-1.5">{title}</h3><div className="grid gap-1.5">{children}</div></section>
);
const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-cocoa-soft bg-cream-2 rounded-2xl px-3 py-2.5">{children}</p>;
