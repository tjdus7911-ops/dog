// 공원 건물 입구(아파트·애견카페·애견샵) · 광장 모임 게시판 안내 · 카페/샵 실내 UI
import { ABOVE_CTRL, CHIP, chipRowTop } from './layout';
import { Icon } from './icons';
import { useEffect, useState } from 'react';
import { get, set, toast, useStore } from '../store';
import { local } from '../game/local';
import { isTouchDevice } from '../game/input';
import { joinPark, lastPark } from '../net/socket';
import { api } from '../lib/api';
import { APARTMENT_ENTRANCE, CAFE_ENTRANCE, MEETING_BOARD, RUNNER_ARENA, SHOP_ENTRANCE } from '@shared/world';
import { openCommunity } from './Community';

export const DOORS = [
  { e: APARTMENT_ENTRANCE, id: 'lobby-1', label: '🏢 아파트 로비 들어가기' },
  { e: CAFE_ENTRANCE, id: 'cafe-1', label: '☕ 애견카페 들어가기' },
  { e: SHOP_ENTRANCE, id: 'shop-1', label: '🛍️ 애견샵 들어가기' },
  { e: MEETING_BOARD, id: 'board', label: '📋 동네 모임 게시판 보기' },
  { e: RUNNER_ARENA.entrance, id: 'runner', label: '🏃 멍글런너 입장' },
] as const;

/** 공원에서 건물 입구·모임 게시판 가까이 가면 들어가기 버튼 */
export function EntrancePrompt() {
  const [near, setNear] = useState<(typeof DOORS)[number] | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = get().park?.kind === 'park' ? DOORS.find((x) => Math.hypot(local.x - x.e.x, local.z - x.e.z) < x.e.r) ?? null : null;
      setNear((cur) => (cur?.id === d?.id ? cur : d));
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  const mobileChat = useStore((s) => s.chatOpen) && isTouchDevice();
  const isPark = useStore((s) => s.park?.kind === 'park');
  if (!near || !isPark || mobileChat) return null;
  return (
    <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-24 pop" style={{ bottom: isTouchDevice() ? ABOVE_CTRL : undefined }}>
      <button className="btn btn-coral px-6 py-3 text-lg shadow-lg whitespace-nowrap" onClick={() => (near.id === 'board' ? openCommunity('meetups') : near.id === 'runner' ? set({ runner: true }) : void joinPark(near.id))}>{near.label}</button>
    </div>
  );
}

/** 애견카페 실내: 나가기 + 동네 모임 바로가기 */
export function CafeBar() {
  return (
    <div className="absolute z-20 left-3 flex gap-1.5 flex-wrap max-w-[calc(100vw-24px)] pointer-events-none" style={{ top: chipRowTop(isTouchDevice()) }}>
      <button className={CHIP} onClick={() => void joinPark(lastPark(), 'cafe')}><Icon name="tree" size={16} className="hud-icon" />광장으로 나가기</button>
      <button className={CHIP} onClick={() => openCommunity('meetups')}><Icon name="wave" size={16} className="hud-icon" />산책 모임 찾기</button>
    </div>
  );
}

interface ShopItem { id: string; label: string; icon: string; desc: string; claimed: boolean; category?: 'bed' | 'decor' }

/** 애견샵 실내: 나가기 + 카운터(입주 선물 가구 받기) */
export function ShopBar() {
  const open = useStore((s) => s.shopOpen);
  const me = useStore((s) => s.me)!;
  const [items, setItems] = useState<ShopItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    api<{ items: ShopItem[] }>('/api/shop').then((r) => setItems(r.items)).catch((e) => toast((e as Error).message, 'error'));
  }, [open]);
  async function claim(id: string) {
    setBusy(id);
    try {
      await api(`/api/shop/${id}/claim`, { body: {} });
      setItems((x) => x?.map((i) => (i.id === id ? { ...i, claimed: true } : i)) ?? null);
      toast('🎁 받았어요! 집 꾸미기 보관함에서 꺼내 배치해 보세요');
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(null);
  }
  return (
    <>
      <div className="absolute z-20 left-3 flex gap-1.5 pointer-events-none" style={{ top: chipRowTop(isTouchDevice()) }}>
        <button className={CHIP} onClick={() => void joinPark(lastPark(), 'shop')}><Icon name="tree" size={16} className="hud-icon" />광장으로 나가기</button>
        {!open && <button className={CHIP} onClick={() => set({ shopOpen: true })}><Icon name="store" size={16} className="hud-icon" />카운터</button>}
      </div>
      {open && (
        <aside className="above-nav absolute z-30 inset-x-0 bottom-0 max-h-[72%] md:inset-x-auto md:right-3 md:top-[74px] md:bottom-auto md:w-[400px] panel !rounded-b-none md:!rounded-[22px] p-4 overflow-y-auto scroll-soft pop"
          style={{ paddingBottom: 'calc(var(--safe-b) + 16px)' }}>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl flex-1">🛍️ 멍글 애견샵</h2>
            <button className="btn btn-ghost w-11 h-11" onClick={() => set({ shopOpen: false })} aria-label="닫기">✕</button>
          </div>
          <p className="text-sm text-cocoa-soft mt-1">멍글 아파트 주민에게 집 꾸미기 가구를 <b>무료</b>로 드려요. 받은 가구는 집 꾸미기 보관함에 들어가요.</p>
          {!me.residence && <p className="text-sm bg-cream-2 rounded-xl px-3 py-2 mt-2">🏢 아파트에 입주하면 받을 수 있어요.</p>}
          <div className="grid gap-2 mt-3">
            {items === null ? <p className="text-sm text-cocoa-soft">불러오는 중…</p> : [...items].sort((a, b) => (a.category === 'bed' ? 0 : 1) - (b.category === 'bed' ? 0 : 1)).map((i, k, arr) => (
              <div key={i.id} className="contents">
              {(k === 0 || arr[k - 1].category !== i.category) && <div className="font-display text-sm mt-1">{i.category === 'bed' ? '🛏️ 침대' : '🐾 소품'}</div>}
              <div className="rounded-2xl bg-white p-3 flex items-center gap-3">
                <span className="text-3xl">{i.icon}</span>
                <div className="flex-1 min-w-0"><div className="font-display">{i.label}</div><div className="text-xs text-cocoa-soft">{i.desc}</div></div>
                {i.claimed ? <span className="text-sm text-sage-deep font-display">받음 ✓</span>
                  : <button disabled={!me.residence || busy === i.id} className="btn btn-peach px-4 min-h-[42px] text-sm" onClick={() => claim(i.id)}>받기</button>}
              </div>
              </div>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
