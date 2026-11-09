// 멍글 아파트 개인 집 — 집 꾸미기 편집 화면, 집 정보 패널(좋아요·방명록·공개 범위·방문 신청)
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  FURNITURE, FURNITURE_BY_ID, GUESTBOOK_MAX_LEN, HOME_VISIBILITY, ROOM_HALF_D, ROOM_HALF_W, itemKey,
  type HomeView, type HomeVisibility, type PlacedItem,
} from '@shared/home';
import { residenceLabel } from '@shared/apartment';
import { api } from '../lib/api';
import { set, toast, useStore } from '../store';
import { geo } from '../game/lowpoly';
import { FurnitureModel } from '../game/Furniture';
import { HomeRoom } from '../game/Interiors';
import { setSpace } from '../game/space';
import { joinPark } from '../net/socket';
import { timeLabel } from './common';
import { DEMO } from '../demo';

const W = ROOM_HALF_W, D = ROOM_HALF_D;

function Furniture({ item, photo, selected, editing, onSelect, onDragStart }: {
  item: PlacedItem; photo: string | null; selected: boolean; editing: boolean;
  onSelect: () => void; onDragStart: () => void;
}) {
  const r = FURNITURE_BY_ID.get(item.type)?.r ?? 0.4;
  return (
    <group position={[item.x, 0, item.z]} rotation={[0, item.rot * (Math.PI / 2), 0]}
      onPointerDown={editing ? (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onSelect(); onDragStart(); } : undefined}>
      <FurnitureModel type={item.type} n={item.n} photo={photo} />
      {editing && (
        <mesh geometry={geo.ring(r + 0.05, r + 0.14, 32)} material={selectedRing(selected)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} />
      )}
    </group>
  );
}
const ringOn = new THREE.MeshBasicMaterial({ color: '#f4776a', transparent: true, opacity: 0.9, depthWrite: false });
const ringOff = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false });
const selectedRing = (on: boolean) => (on ? ringOn : ringOff);

/** 편집 중 드래그를 받는 바닥 판 */
function DragFloor({ active, onMove, onEnd }: { active: boolean; onMove: (x: number, z: number) => void; onEnd: () => void }) {
  const hit = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} material={hit}
      onPointerMove={(e) => { if (active) { e.stopPropagation(); onMove(e.point.x, e.point.z); } }}
      onPointerUp={() => active && onEnd()} onPointerLeave={() => active && onEnd()}>
      <planeGeometry args={[W * 2 + 6, D * 2 + 6]} />
    </mesh>
  );
}

/** 집 꾸미기 편집 화면 (집주인만, 전체 화면) */
export function HomeEditor() {
  const home = useStore((s) => s.home);
  const [draft, setDraft] = useState<PlacedItem[]>(() => home?.layout.map((i) => ({ ...i })) ?? []);
  const [sel, setSel] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!home) return null;

  const placed = new Set(draft.map(itemKey));
  // 기본 가구 + 애견샵에서 받은 가구
  const owned = new Set(home.owned ?? []);
  const storage = FURNITURE.filter((f) => !f.shop || owned.has(f.id)).flatMap((f) => Array.from({ length: f.count }, (_, n) => ({ f, n }))).filter(({ f, n }) => !placed.has(itemKey({ type: f.id, n })));
  const selItem = draft.find((i) => itemKey(i) === sel) ?? null;
  const close = () => set({ homeEdit: false });
  function update(key: string, patch: Partial<PlacedItem>) { setDraft((d) => d.map((i) => (itemKey(i) === key ? { ...i, ...patch } : i))); }
  function place(type: string, n: number) {
    const spots: [number, number][] = [[0, 0.5], [1.2, 0.5], [-1.2, 0.5], [0, -1], [1.2, -1], [-1.2, -1], [2.4, 1.5], [-2.4, 1.5]];
    const spot = spots.find(([x, z]) => draft.every((i) => Math.hypot(i.x - x, i.z - z) > 0.8)) ?? [0, 0.5];
    const item = { type, n, x: spot[0], z: spot[1], rot: 0 };
    setDraft((d) => [...d, item]);
    setSel(itemKey(item));
  }
  async function save() {
    setSaving(true);
    try {
      const r = await api<{ home: HomeView }>('/api/home/me/layout', { method: 'PUT', body: { layout: draft } });
      set({ home: r.home, homeEdit: false });
      setSpace('home', r.home.layout);
      toast('집 꾸미기를 저장했어요 🏠');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSaving(false); }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col md:flex-row bg-cream">
      <div className="relative h-[55%] md:h-full md:flex-1 min-w-0">
        <Canvas camera={{ position: [4.2, 5.6, 7.6], fov: 40 }} dpr={[1, 2]}>
          <color attach="background" args={['#fff4e8']} />
          <hemisphereLight args={['#fffaf2', '#efe2cc', 2.0]} />
          <directionalLight position={[3, 6, 4]} intensity={1.1} color="#fff6e8" />
          <HomeRoom />
          {draft.map((i) => (
            <Furniture key={itemKey(i)} item={i} photo={home.owner.dogPhoto} editing selected={sel === itemKey(i)}
              onSelect={() => setSel(itemKey(i))} onDragStart={() => setDragging(true)} />
          ))}
          <DragFloor active={dragging && !!sel}
            onMove={(x, z) => sel && update(sel, { x: THREE.MathUtils.clamp(Math.round(x * 10) / 10, -W + 0.3, W - 0.3), z: THREE.MathUtils.clamp(Math.round(z * 10) / 10, -D + 0.3, D - 0.3) })}
            onEnd={() => setDragging(false)} />
          <OrbitControls enabled={!dragging} enablePan={false} target={[0, 0.6, 0]} minDistance={5} maxDistance={12} minPolarAngle={0.5} maxPolarAngle={1.25}
            minAzimuthAngle={-0.2} maxAzimuthAngle={1.3} />
        </Canvas>
        <div className="absolute top-3 left-3 panel !rounded-full px-4 py-2 font-display">🛠️ 집 꾸미기</div>
        <div className="absolute inset-x-2 bottom-2 panel p-2.5">
          {selItem ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-sm flex-1 min-w-[100px]">{FURNITURE_BY_ID.get(selItem.type)?.icon} {FURNITURE_BY_ID.get(selItem.type)?.label}</span>
              <span className="text-[11px] text-cocoa-soft hidden sm:inline">끌어서 옮겨요</span>
              <button className="btn btn-ghost px-3 min-h-[44px] text-sm" onClick={() => update(itemKey(selItem), { rot: (selItem.rot + 1) % 4 })}>↻ 회전</button>
              <button className="btn btn-ghost px-3 min-h-[44px] text-sm" onClick={() => { setDraft((d) => d.filter((i) => itemKey(i) !== sel)); setSel(null); }}>📦 보관</button>
            </div>
          ) : <p className="text-xs text-cocoa-soft px-1">가구를 누르면 선택돼요. 선택한 가구는 끌어서 옮기고, 회전하거나 보관함에 넣을 수 있어요.</p>}
        </div>
      </div>
      <aside className="md:w-[380px] flex-1 md:flex-none min-h-0 overflow-y-auto scroll-soft p-4 bg-cream-2/60">
        <h2 className="font-display text-xl">📦 보관함 ({storage.length})</h2>
        <p className="text-xs text-cocoa-soft mt-0.5">눌러서 방에 놓아 보세요.</p>
        {storage.length === 0 && <p className="text-xs text-cocoa-soft mt-2">모든 가구를 꺼내 놓았어요.</p>}
        <div className="grid grid-cols-3 gap-2 mt-2">
          {storage.map(({ f, n }) => (
            <button key={`${f.id}#${n}`} className="rounded-2xl bg-white p-2 text-center border-2 border-dashed border-[#e9d8c6] hover:border-[#f4776a] min-h-[64px]" onClick={() => place(f.id, n)}>
              <div className="text-2xl">{f.icon}</div><div className="text-[11px] mt-0.5">{f.label}</div>
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn btn-ghost flex-1 py-3" onClick={close}>취소</button>
          <button className="btn btn-coral flex-[2] py-3" disabled={saving} onClick={save}>{saving ? '저장 중…' : '저장하기'}</button>
        </div>
      </aside>
    </div>
  );
}

/** 집 안 상단 버튼 + 집 정보 패널 (좋아요·방명록·공개 범위·방문 신청 처리) */
export function HomePanel() {
  const home = useStore((s) => s.home);
  const open = useStore((s) => s.homePanel);
  const version = useStore((s) => s.visitRequestsVersion);
  const [text, setText] = useState('');
  const [requests, setRequests] = useState<{ visitorId: number; nickname: string; dogName: string; ts: number }[]>([]);
  useEffect(() => {
    if (home?.isOwner && !DEMO) api<{ requests: typeof requests }>('/api/home/me/visit-requests').then((r) => setRequests(r.requests)).catch(() => {});
  }, [home?.isOwner, home?.ownerId, version]);
  if (!home) return null;
  const close = () => set({ homePanel: false });
  const setHome = (h: HomeView) => set({ home: h });

  async function setVisibility(v: HomeVisibility) {
    try { const r = await api<{ home: HomeView }>('/api/home/me/visibility', { method: 'PUT', body: { visibility: v } }); setHome(r.home); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  async function like() {
    try { const r = await api<{ liked: boolean; likes: number }>(`/api/home/${home!.ownerId}/like`, { body: {} }); setHome({ ...home!, likedByMe: r.liked, likes: r.likes }); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  async function writeGuestbook(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try { const r = await api<{ home: HomeView }>(`/api/home/${home!.ownerId}/guestbook`, { body: { text } }); setHome(r.home); setText(''); }
    catch (err) { toast((err as Error).message, 'error'); }
  }
  async function removeEntry(id: number) {
    if (!confirm('이 방명록을 지울까요?')) return;
    try { const r = await api<{ home: HomeView | null }>(`/api/home/${home!.ownerId}/guestbook/${id}`, { method: 'DELETE' }); if (r.home) setHome(r.home); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  async function decide(visitorId: number, approve: boolean) {
    try { const r = await api<{ requests: typeof requests }>(`/api/home/me/visit-requests/${visitorId}`, { body: { approve } }); setRequests(r.requests); toast(approve ? '방문을 승인했어요' : '방문 신청을 거절했어요'); }
    catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <>
      <div className="absolute z-20 left-2 md:left-3 top-[62px] md:top-[78px] flex gap-2 flex-wrap max-w-[calc(100vw-16px)]">
        <button className="btn btn-ghost px-4 min-h-[44px] text-sm" onClick={() => void joinPark('lobby-1')}>🚪 로비로 나가기</button>
        {!open && <button className="btn btn-coral px-4 min-h-[44px] text-sm relative" onClick={() => set({ homePanel: true })}>
          🏠 집 정보{requests.length > 0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#e2604f] text-white text-[11px] grid place-items-center">{requests.length}</span>}
        </button>}
        {home.isOwner && <button className="btn btn-ghost px-4 min-h-[44px] text-sm" onClick={() => set({ homeEdit: true, homePanel: false })}>🛠️ 꾸미기</button>}
      </div>
      {open && (
        <aside className="absolute z-30 inset-x-0 bottom-0 max-h-[70%] md:inset-x-auto md:right-3 md:top-[74px] md:bottom-3 md:w-[400px] md:max-h-none panel !rounded-b-none md:!rounded-[22px] p-4 overflow-y-auto scroll-soft pop"
          style={{ paddingBottom: 'calc(var(--safe-b) + 16px)' }}>
          <div className="flex items-center gap-3">
            {home.owner.dogPhoto
              ? <img src={home.owner.dogPhoto} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-white shadow" />
              : <span className="w-14 h-14 rounded-full grid place-items-center text-2xl border-2 border-white shadow" style={{ background: home.owner.dog.coat }}>🐶</span>}
            <div className="flex-1 min-w-0">
              <div className="font-display text-lg truncate">{home.owner.nickname} · 🐶 {home.owner.dogName}</div>
              <div className="text-xs text-cocoa-soft">멍글 아파트 {residenceLabel(home.residence)}</div>
            </div>
            <button className={`btn px-3 min-h-[44px] text-sm ${home.likedByMe ? 'btn-coral' : 'btn-ghost'}`} disabled={home.isOwner || DEMO} onClick={like}
              title={home.isOwner ? '내 집에는 누를 수 없어요' : '좋아요'}>❤️ {home.likes}</button>
            <button className="btn btn-ghost w-11 h-11 shrink-0" onClick={close} aria-label="집 정보 닫기">✕</button>
          </div>

          {home.isOwner && requests.length > 0 && (
            <div className="mt-3 rounded-2xl bg-white p-3">
              <div className="font-display text-sm mb-1.5">📨 받은 방문 신청</div>
              {requests.map((r) => (
                <div key={r.visitorId} className="flex items-center gap-2 py-1">
                  <span className="flex-1 text-sm">{r.nickname} · 🐶 {r.dogName} <span className="text-xs text-cocoa-soft">{timeLabel(r.ts)}</span></span>
                  <button className="btn btn-peach px-3 min-h-[40px] text-xs" onClick={() => decide(r.visitorId, true)}>승인</button>
                  <button className="btn btn-ghost px-3 min-h-[40px] text-xs" onClick={() => decide(r.visitorId, false)}>거절</button>
                </div>
              ))}
              <p className="text-[10px] text-cocoa-soft mt-1">승인하면 2시간 동안 들어올 수 있어요.</p>
            </div>
          )}

          {home.isOwner && (
            <div className="mt-3 rounded-2xl bg-white p-3">
              <div className="font-display text-sm mb-1.5">🔐 집 공개 범위</div>
              <div className="grid grid-cols-2 gap-1.5">
                {HOME_VISIBILITY.map((v) => (
                  <button key={v.id} onClick={() => setVisibility(v.id)}
                    className={`rounded-xl px-2 py-2 text-left border-2 min-h-[44px] ${home.visibility === v.id ? 'border-[#f4776a] bg-[#fff1ec]' : 'border-transparent bg-cream-2'}`}>
                    <div className="font-display text-sm">{v.label}</div>
                    <div className="text-[10px] text-cocoa-soft leading-tight">{v.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <h3 className="font-display text-lg mt-4">📖 방명록</h3>
          {DEMO ? <p className="text-xs text-cocoa-soft mt-1">미리보기에서는 방명록·좋아요를 쓸 수 없어요. (게임 서버에서 동작)</p> : (
            <form onSubmit={writeGuestbook} className="flex gap-2 mt-2">
              <input className="field !py-2.5 !rounded-full text-[16px] md:text-sm min-h-[44px]" value={text} maxLength={GUESTBOOK_MAX_LEN}
                placeholder={home.isOwner ? '방문객에게 한마디' : `${home.owner.nickname}님께 한마디 남기기`} onChange={(e) => setText(e.target.value)} />
              <button className="btn btn-peach px-4 text-sm shrink-0 min-h-[44px]" disabled={!text.trim()}>남기기</button>
            </form>
          )}
          <div className="mt-3 space-y-2">
            {home.guestbook.length === 0 && !DEMO && <p className="text-xs text-cocoa-soft text-center py-4">아직 방명록이 없어요. 첫 인사를 남겨 보세요!</p>}
            {home.guestbook.map((g) => (
              <div key={g.id} className="rounded-2xl bg-white px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <b className="font-display text-sm">{g.nickname}</b><span className="text-cocoa-soft">🐶 {g.dogName} · {timeLabel(g.ts)}</span>
                  <span className="flex-1" />
                  {g.canDelete && <button className="text-cocoa-soft underline min-h-[32px]" onClick={() => removeEntry(g.id)}>삭제</button>}
                </div>
                <p className="text-sm mt-0.5 break-words">{g.text}</p>
              </div>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
