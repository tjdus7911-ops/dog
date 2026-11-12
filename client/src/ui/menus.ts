// 메뉴 열고 닫기 규칙 — 드롭다운·바텀시트는 한 번에 하나만 (store.activeMenu 하나로 관리)
//  · A가 열린 채 B를 누르면 A는 닫히고 B가 열림 / 같은 버튼을 다시 누르면 닫힘
//  · 메뉴 바깥을 누르면 닫힘 (3D 화면을 눌러 닫을 때는 그 터치가 이동·카메라 회전으로 이어지지 않게 막음)
//  · 장소 이동 · 다른 창(모달·패널) 열림 → 닫힘 / 뒤로가기 → 열린 메뉴부터 닫힘 / PC Esc → 닫힘
//  · 모달 안의 확인창처럼 의도된 겹침은 이 규칙과 상관없이 그대로
import { useEffect } from 'react';
import { get, set, useStore, type MenuId } from '../store';
import { isTouchDevice } from '../game/input';

type State = ReturnType<typeof get>;

export function toggleMenu(id: MenuId) {
  const s = get();
  if (s.activeMenu === id) { set({ activeMenu: null }); return; }
  // 아래에서 올라오는 시트(더보기·내 집)는 모바일 채팅·친구 창과 겹치지 않게 닫고 엶
  const sheet = id === 'more' || id === 'home';
  set({ activeMenu: id, benchMenu: null, dogMenu: null, furnMenu: null, ...(sheet ? { panel: 'none' as const, ...(isTouchDevice() ? { chatOpen: false } : {}) } : {}) });
}
export const closeMenu = () => { if (get().activeMenu) set({ activeMenu: null }); };
/** 메뉴 항목을 누르면: 메뉴를 닫고 그 동작 실행 */
export const fromMenu = (fn: () => void) => () => { closeMenu(); fn(); };

/**
 * 다른 페이지(예: 관리자 페이지 /admin)로 이동.
 * 메뉴·창을 닫으면 뒤로가기 기록 정리(history.back)가 뒤따라 일어나는데, 그게 막 시작한 페이지 이동을 취소해 버림.
 * → 메뉴·창을 먼저 닫고, 기록 정리가 끝난 뒤(popstate, 없으면 잠시 뒤)에 이동한다.
 */
export function goToPage(url: string) {
  closeMenu();
  set({ panel: 'none' });
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', go);
    location.assign(url);
  };
  window.addEventListener('popstate', go);
  setTimeout(go, 350);
}

/** 메뉴를 닫게 하는 다른 창들 (새로 열리면 메뉴는 닫힘) */
const OVERLAYS: ((s: State) => unknown)[] = [
  (s) => s.panel !== 'none', (s) => s.mapOpen, (s) => s.eventsOpen, (s) => s.wallet, (s) => s.moveOpen,
  (s) => s.community, (s) => s.homeEdit, (s) => s.homePanel, (s) => s.shopOpen, (s) => s.screenSubmit, (s) => s.screenDetail,
  (s) => s.dogSheet, (s) => s.profilePopup, (s) => s.joinPrompt, (s) => s.viewer, (s) => s.runner, (s) => s.photoMode,
  (s) => isTouchDevice() && s.chatOpen, (s) => s.dogMenu !== null, (s) => s.furnMenu, (s) => s.benchMenu !== null,
];

/** 뒤로가기로 닫는 순서 (위에 있는 것부터) */
const CLOSABLE: { open: (s: State) => boolean; close: () => void }[] = [
  { open: (s) => !!s.activeMenu, close: () => set({ activeMenu: null }) },
  { open: (s) => !!s.profilePopup, close: () => set({ profilePopup: null }) },
  { open: (s) => s.dogSheet !== null, close: () => set({ dogSheet: null }) },
  { open: (s) => !!s.wallet, close: () => set({ wallet: null }) },
  { open: (s) => s.moveOpen, close: () => set({ moveOpen: false }) },
  { open: (s) => s.mapOpen, close: () => set({ mapOpen: false }) },
  { open: (s) => s.eventsOpen, close: () => set({ eventsOpen: false }) },
  { open: (s) => s.panel !== 'none', close: () => set({ panel: 'none' }) },
  { open: (s) => s.homePanel, close: () => set({ homePanel: false }) },
  { open: (s) => s.shopOpen, close: () => set({ shopOpen: false }) },
  { open: (s) => !!s.community, close: () => set({ community: null }) },
  { open: (s) => isTouchDevice() && s.chatOpen, close: () => set({ chatOpen: false }) },
];
const topClosable = (s: State) => CLOSABLE.find((c) => c.open(s)) ?? null;

/** 게임 화면에 한 번 붙여 두는 규칙 처리기 */
export function MenuGuards() {
  useEffect(() => {
    let pushed = false;
    let ignorePop = 0;
    // 뒤로가기: 열린 것이 있으면 기록을 하나 쌓아 두고, 뒤로가기가 오면 그 기록 대신 위의 것부터 닫음
    const syncHistory = () => {
      const open = topClosable(get()) !== null;
      if (open && !pushed) { history.pushState({ mungleMenu: true }, ''); pushed = true; }
      else if (!open && pushed) {
        pushed = false;
        if (history.state?.mungleMenu) { ignorePop++; history.back(); }
      }
    };
    const unsub = useStore.subscribe((s, prev) => {
      if (s.activeMenu && s.activeMenu === prev.activeMenu && OVERLAYS.some((f) => f(s) && !f(prev))) set({ activeMenu: null });
      if (s.activeMenu && prev.park?.id && s.park?.id !== prev.park.id) set({ activeMenu: null });
      syncHistory();
    });
    const onPop = () => {
      if (ignorePop > 0) { ignorePop--; return; }
      // 우리 기록이 아직 남아 있으면 위에 쌓인 다른 화면(사진 크게 보기 등)의 뒤로가기
      if (history.state?.mungleMenu) return;
      if (get().viewer) return;
      pushed = false;
      topClosable(get())?.close();
      syncHistory();
    };
    // 메뉴 바깥 누르기 → 닫기 (다른 메뉴 버튼이면 그 버튼은 그대로 동작해서 바로 열림)
    let swallowUntil = 0;
    const onDown = (e: PointerEvent) => {
      const id = get().activeMenu;
      if (!id) return;
      const t = e.target as Element | null;
      if (!t || t.closest(`[data-menu-root="${id}"]`) || t.closest(`[data-menu-trigger="${id}"]`)) return;
      set({ activeMenu: null });
      // 3D 화면·어두운 막을 눌러 닫은 경우: 그 터치로 걸어가거나 카메라가 돌지 않게
      if (t.closest('[data-scene]') || t.closest('[data-menu-backdrop]')) {
        e.stopPropagation(); e.preventDefault();
        swallowUntil = performance.now() + 700;
      }
    };
    const swallow = (e: Event) => { if (performance.now() < swallowUntil) { e.stopPropagation(); if (e.type === 'click') swallowUntil = 0; } };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && get().activeMenu) { e.preventDefault(); set({ activeMenu: null }); } };
    window.addEventListener('popstate', onPop);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', swallow, true);
    document.addEventListener('click', swallow, true);
    window.addEventListener('keydown', onKey);
    return () => {
      unsub();
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', swallow, true);
      document.removeEventListener('click', swallow, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}

/**
 * 드롭다운 위치: 버튼 아래(공간이 모자라면 위)로, 화면 좌우를 넘지 않게, 최대 높이 안에서 스크롤.
 * 부모의 overflow·쌓임 순서에 잘리지 않도록 화면 기준(fixed) 좌표로 계산한다.
 */
export function dropdownPlacement(anchor: DOMRect, opts: { width: number; maxHeight: number; bottomReserve: number; align?: 'start' | 'end' }) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const m = 12;
  const width = Math.min(opts.width, vw - m * 2);
  const left = Math.max(m, Math.min(opts.align === 'end' ? anchor.right - width : anchor.left, vw - width - m));
  const below = vh - opts.bottomReserve - anchor.bottom - 8;
  const above = anchor.top - 8 - m;
  const up = below < Math.min(240, opts.maxHeight) && above > below;
  const maxHeight = Math.max(120, Math.min(opts.maxHeight, up ? above : below));
  return up
    ? { left, width, maxHeight, bottom: vh - anchor.top + 6, top: undefined as number | undefined }
    : { left, width, maxHeight, top: anchor.bottom + 6, bottom: undefined as number | undefined };
}
