// 멍글 아파트 개인 집 — 집 꾸미기 편집 화면, 집 정보 패널(좋아요·방명록·공개 범위·방문 신청)
import { homeSpaceId } from '@shared/spaces';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  FRAME_SCALE, FRAME_STYLES, FURNITURE, FURNITURE_BY_ID, GUESTBOOK_MAX_LEN, HOME_VISIBILITY, ROOM_HALF_D, ROOM_HALF_W, itemKey,
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
import { resizeImage } from '../lib/image';
import { Modal } from './common';

const W = ROOM_HALF_W, D = ROOM_HALF_D;

function Furniture({ item, photo, selected, editing, onSelect, onDragStart }: {
  item: PlacedItem; photo: string | null; selected: boolean; editing: boolean;
  onSelect: () => void; onDragStart: () => void;
}) {
  const r = FURNITURE_BY_ID.get(item.type)?.r ?? 0.4;
  return (
    <group position={[item.x, 0, item.z]} rotation={[0, item.rot * (Math.PI / 2), 0]}
      onPointerDown={editing ? (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onSelect(); onDragStart(); } : undefined}>
      <FurnitureModel type={item.type} n={item.n} photo={photo} item={item} />
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
  const [picker, setPicker] = useState<string | null>(null);
  const [frameTool, setFrameTool] = useState<'style' | 'size' | 'fit' | 'move' | null>(null);
  useEffect(() => setFrameTool(null), [sel]);
  // PC(넓은 화면): 3D 화면 위에 메뉴 / 모바일: 3D 화면 아래에 메뉴
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
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

  const selBar = (
    <>
          {selItem && selItem.type === 'frame' ? (
            <FrameMenu item={selItem} tool={frameTool} setTool={setFrameTool}
              onPhoto={() => setPicker(itemKey(selItem))}
              onUpdate={(patch) => update(itemKey(selItem), patch)}
              onRemove={() => { setDraft((d) => d.filter((i) => itemKey(i) !== sel)); setSel(null); }} />
          ) : selItem ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-sm flex-1 min-w-[100px]">{FURNITURE_BY_ID.get(selItem.type)?.icon} {FURNITURE_BY_ID.get(selItem.type)?.label}</span>
              <span className="text-[11px] text-cocoa-soft hidden sm:inline">끌어서 옮겨요</span>
              <button className="btn btn-ghost px-3 min-h-[44px] text-sm" onClick={() => update(itemKey(selItem), { rot: (selItem.rot + 1) % 4 })}>↻ 회전</button>
              <button className="btn btn-ghost px-3 min-h-[44px] text-sm" onClick={() => { setDraft((d) => d.filter((i) => itemKey(i) !== sel)); setSel(null); }}>📦 보관</button>
            </div>
          ) : <p className="text-xs text-cocoa-soft px-1">가구를 누르면 선택돼요. 선택한 가구는 끌어서 옮기고, 회전하거나 보관함에 넣을 수 있어요.</p>}
    </>
  );
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
        {wide && <div className="absolute inset-x-2 bottom-2 panel p-2.5">{selBar}</div>}
      </div>
      <aside className="md:w-[380px] flex-1 md:flex-none min-h-0 overflow-y-auto scroll-soft p-4 bg-cream-2/60">
        {/* 모바일: 선택한 가구 메뉴를 3D 화면 아래에 두어 액자가 가려지지 않게 */}
        {!wide && <div className="panel p-2.5 mb-3">{selBar}</div>}
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
        {picker && (
          <FramePhotoPicker current={draft.find((i) => itemKey(i) === picker)?.photo ?? null} onClose={() => setPicker(null)}
            onPick={(url) => { update(picker, { photo: url, fit: { z: 1, x: 0, y: 0 } }); setPicker(null); setFrameTool('fit'); }} />
        )}
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
  const myHome = useStore((s) => (s.me?.residence ? s.me.id : null));
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
      <div className="absolute z-20 left-2 md:left-3 top-[108px] md:top-[78px] flex gap-2 flex-wrap max-w-[calc(100vw-16px)]">
        <button className="btn btn-ghost px-4 min-h-[44px] text-sm" onClick={() => void joinPark('lobby-1')}>🚪 로비로 나가기</button>
        {!open && <button className="btn btn-coral px-4 min-h-[44px] text-sm relative" onClick={() => set({ homePanel: true })}>
          🏠 집 정보{requests.length > 0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#e2604f] text-white text-[11px] grid place-items-center">{requests.length}</span>}
        </button>}
        {home.isOwner && <button className="btn btn-ghost px-4 min-h-[44px] text-sm" onClick={() => set({ homeEdit: true, homePanel: false })}>🛠️ 꾸미기</button>}
        {/* 친구 집에 놀러 온 방문자: 바로 내 집으로 */}
        {!home.isOwner && myHome && <button className="btn btn-sage px-4 min-h-[44px] text-sm" onClick={() => void joinPark(homeSpaceId(myHome))}>🏠 내 집으로 돌아가기</button>}
      </div>
      {open && (
        <aside className="above-nav absolute z-30 inset-x-0 bottom-0 max-h-[min(70%,calc(100%-224px))] md:inset-x-auto md:right-3 md:top-[74px] md:bottom-3 md:w-[400px] md:max-h-none panel !rounded-b-none md:!rounded-[22px] p-4 overflow-y-auto scroll-soft pop"
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

// ---------------------------------------------------------------- 액자 사진
const FRAME_ICON: Record<string, string> = { wood: '🟫', white: '⬜', pink: '🩷', round: '⭕', polaroid: '📷' };

/** 액자를 선택했을 때 메뉴: 사진 넣기/변경 · 디자인 · 회전 · 크기 · 위치 · 제거 (+ 사진 맞추기) */
function FrameMenu({ item, tool, setTool, onPhoto, onUpdate, onRemove }: {
  item: PlacedItem; tool: 'style' | 'size' | 'fit' | 'move' | null; setTool: (t: 'style' | 'size' | 'fit' | 'move' | null) => void;
  onPhoto: () => void; onUpdate: (p: Partial<PlacedItem>) => void; onRemove: () => void;
}) {
  const fit = item.fit ?? { z: 1, x: 0, y: 0 };
  const scale = item.scale ?? 1;
  const b = (on: boolean) => `btn min-h-[44px] px-1.5 text-[12px] whitespace-nowrap ${on ? 'btn-peach' : 'btn-ghost'}`;
  const nudge = (dx: number, dz: number) => onUpdate({ x: THREE.MathUtils.clamp(Math.round((item.x + dx) * 10) / 10, -W + 0.3, W - 0.3), z: THREE.MathUtils.clamp(Math.round((item.z + dz) * 10) / 10, -D + 0.3, D - 0.3) });
  return (
    <div data-testid="frame-menu">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-display text-sm flex-1">🖼️ 강아지 사진 액자 {item.n + 1}</span>
        {item.photo && <span className="text-[11px] text-cocoa-soft">사진이 걸려 있어요</span>}
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
        <button className={b(false)} onClick={onPhoto}>{item.photo ? '📷 사진 변경' : '🖼️ 사진 넣기'}</button>
        <button className={b(tool === 'style')} onClick={() => setTool(tool === 'style' ? null : 'style')}>🎨 디자인</button>
        <button className={b(false)} onClick={() => onUpdate({ rot: (item.rot + 1) % 4 })}>🔄 회전</button>
        <button className={b(tool === 'size')} onClick={() => setTool(tool === 'size' ? null : 'size')}>📐 크기</button>
        <button className={b(tool === 'move')} onClick={() => setTool(tool === 'move' ? null : 'move')}>📍 위치</button>
        <button className={b(tool === 'fit')} disabled={!item.photo} onClick={() => setTool(tool === 'fit' ? null : 'fit')}>🔍 맞추기</button>
        <button className={b(false) + ' text-[#c4553a]'} onClick={onRemove}>🗑️ 제거</button>
      </div>
      {tool === 'style' && (
        <div className="grid grid-cols-5 gap-1.5 mt-2">
          {FRAME_STYLES.map((st) => (
            <button key={st.id} className={`rounded-xl border-2 py-1.5 text-[11px] ${(item.style ?? 'wood') === st.id ? 'border-[#f4776a] bg-[#fff3ee]' : 'border-[#f1e2d2] bg-white'}`} onClick={() => onUpdate({ style: st.id })}>
              <div className="text-lg">{FRAME_ICON[st.id]}</div>{st.label}
            </button>
          ))}
        </div>
      )}
      {tool === 'size' && (
        <label className="flex items-center gap-2 mt-2 text-sm">📐 크기
          <input type="range" className="flex-1 accent-[#f4776a]" min={FRAME_SCALE.min} max={FRAME_SCALE.max} step={0.05} value={scale} onChange={(e) => onUpdate({ scale: Number(e.target.value) })} />
          <span className="w-12 text-right">{Math.round(scale * 100)}%</span>
        </label>
      )}
      {tool === 'move' && (
        <div className="flex items-center gap-2 mt-2 text-sm">
          <span className="flex-1 text-cocoa-soft text-xs">액자를 끌어서 옮기거나 화살표로 조금씩 움직여요.</span>
          {([['←', -0.1, 0], ['↑', 0, -0.1], ['↓', 0, 0.1], ['→', 0.1, 0]] as const).map(([l, dx, dz]) => (
            <button key={l} className="btn btn-ghost w-11 h-11" onClick={() => nudge(dx, dz)} aria-label={`${l} 이동`}>{l}</button>
          ))}
        </div>
      )}
      {tool === 'fit' && item.photo && (
        <div className="grid gap-1 mt-2 text-sm">
          <label className="flex items-center gap-2">🔍 확대<input type="range" className="flex-1 accent-[#f4776a]" min={1} max={3} step={0.05} value={fit.z} onChange={(e) => onUpdate({ fit: { ...fit, z: Number(e.target.value) } })} /></label>
          <label className="flex items-center gap-2">↔ 좌우<input type="range" className="flex-1 accent-[#f4776a]" min={-1} max={1} step={0.05} value={fit.x} onChange={(e) => onUpdate({ fit: { ...fit, x: Number(e.target.value) } })} /></label>
          <label className="flex items-center gap-2">↕ 위아래<input type="range" className="flex-1 accent-[#f4776a]" min={-1} max={1} step={0.05} value={fit.y} onChange={(e) => onUpdate({ fit: { ...fit, y: Number(e.target.value) } })} /></label>
          <p className="text-[11px] text-cocoa-soft">사진 비율은 그대로, 액자 칸 안에서만 확대·이동돼요.</p>
        </div>
      )}
    </div>
  );
}

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** 액자 사진 고르기: 강아지 프로필 사진 / 내가 올린 사진 / 새 사진 올리기 */
function FramePhotoPicker({ current, onPick, onClose }: { current: string | null; onPick: (url: string) => void; onClose: () => void }) {
  const [data, setData] = useState<{ uploads: { id: number; url: string }[]; dogPhotos: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => api<{ uploads: { id: number; url: string }[]; dogPhotos: string[] }>('/api/home/me/photos').then(setData).catch((e) => setErr((e as Error).message));
  useEffect(() => { if (DEMO) setData({ uploads: [], dogPhotos: [] }); else void load(); }, []);
  async function upload(f: File) {
    setErr('');
    // 형식·용량 확인 (서버에서도 다시 검사)
    if (!PHOTO_TYPES.includes(f.type)) { setErr('JPG, PNG, WebP 사진만 올릴 수 있어요.'); return; }
    if (f.size > 15 * 1024 * 1024) { setErr('15MB 이하 사진을 골라 주세요.'); return; }
    if (DEMO) { setErr('미리보기에서는 사진을 올릴 수 없어요. (게임 서버에서 동작)'); return; }
    setBusy(true);
    try {
      const r = await api<{ photo: { id: number; url: string } }>('/api/home/me/photos', { body: { dataUrl: await resizeImage(f, 1280) } });
      setData((d) => d && { ...d, uploads: [r.photo, ...d.uploads] });
      onPick(r.photo.url);
    } catch (e) { setErr(`${(e as Error).message} 기존 사진은 그대로예요.`); } finally { setBusy(false); }
  }
  async function remove(id: number) {
    if (!confirm('이 사진을 보관함에서 지울까요?')) return;
    try { await api(`/api/home/me/photos/${id}`, { method: 'DELETE' }); setData((d) => d && { ...d, uploads: d.uploads.filter((u) => u.id !== id) }); }
    catch (e) { setErr((e as Error).message); }
  }
  const Thumb = ({ url, onDel }: { url: string; onDel?: () => void }) => (
    <div className={`relative aspect-square rounded-xl overflow-hidden border-2 ${url === current ? 'border-[#f4776a]' : 'border-transparent'}`}>
      <button className="w-full h-full" onClick={() => onPick(url)} aria-label="이 사진 걸기"><img src={url} alt="" className="w-full h-full object-cover" /></button>
      {onDel && <button className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-white/90 text-xs" onClick={onDel} aria-label="사진 지우기">✕</button>}
    </div>
  );
  return (
    <Modal onClose={onClose} className="max-w-[440px] p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-xl flex-1">🖼️ 액자에 넣을 사진</h2>
        <button className="btn btn-ghost w-10 h-10" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      <button className="btn btn-coral w-full py-3 mt-3" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? '올리는 중…' : '📤 휴대폰·PC에서 새 사진 올리기'}</button>
      <p className="text-[11px] text-cocoa-soft mt-1 text-center">JPG · PNG · WebP</p>
      {err && <p className="text-sm text-[#c4553a] bg-[#fff0ec] rounded-xl px-3 py-2 mt-2">{err}</p>}
      {!data ? <p className="text-cocoa-soft py-6 text-center">불러오는 중…</p> : (
        <>
          <div className="font-display text-sm mt-4 mb-1.5">🐶 강아지 프로필 사진</div>
          {data.dogPhotos.length ? <div className="grid grid-cols-4 gap-1.5">{data.dogPhotos.map((u) => <Thumb key={u} url={u} />)}</div>
            : <p className="text-xs text-cocoa-soft">강아지 프로필에 등록한 사진이 없어요.</p>}
          <div className="font-display text-sm mt-4 mb-1.5">📁 내가 올린 사진</div>
          {data.uploads.length ? <div className="grid grid-cols-4 gap-1.5">{data.uploads.map((u) => <Thumb key={u.id} url={u.url} onDel={() => remove(u.id)} />)}</div>
            : <p className="text-xs text-cocoa-soft">아직 올린 사진이 없어요.</p>}
        </>
      )}
    </Modal>
  );
}
