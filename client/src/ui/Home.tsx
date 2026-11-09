// 멍글 아파트 개인 집 — 3D 실내, 집 꾸미기(배치·이동·회전·보관·저장), 방문·좋아요·방명록·공개 설정
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  FURNITURE, FURNITURE_BY_ID, GUESTBOOK_MAX_LEN, HOME_VISIBILITY, ROOM_HALF_D, ROOM_HALF_W, itemKey,
  type HomeView, type HomeVisibility, type PlacedItem,
} from '@shared/home';
import { residenceLabel } from '@shared/apartment';
import { DogAnim, HumanAnim } from '@shared/protocol';
import { api } from '../lib/api';
import { set, toast, useStore } from '../store';
import { geo, mat } from '../game/lowpoly';
import { FurnitureModel } from '../game/Furniture';
import { Human, newHumanDriver } from '../game/models/Human';
import { Dog, newDogDriver } from '../game/models/Dog';
import { timeLabel } from './common';
import { DEMO } from '../demo';

const W = ROOM_HALF_W, D = ROOM_HALF_D;

function Room() {
  return (
    <group>
      {/* 원목 바닥 */}
      <mesh geometry={geo.box(W * 2, 0.1, D * 2)} material={mat('#e3c39c')} position={[0, -0.05, 0]} />
      {Array.from({ length: 8 }).map((_, i) => <mesh key={i} geometry={geo.box(0.02, 0.102, D * 2)} material={mat('#d2ae85')} position={[-W + (i + 1) * (W * 2) / 9, -0.045, 0]} />)}
      {/* 뒷벽 + 왼쪽 벽 (앞·오른쪽은 열어 둠) */}
      <mesh geometry={geo.box(W * 2 + 0.2, 3.2, 0.2)} material={mat('#fff1dc')} position={[0, 1.6, -D - 0.1]} />
      <mesh geometry={geo.box(0.2, 3.2, D * 2 + 0.2)} material={mat('#fde3d6')} position={[-W - 0.1, 1.6, 0]} />
      <mesh geometry={geo.box(W * 2 + 0.2, 0.22, 0.24)} material={mat('#f7c9b4')} position={[0, 0.11, -D - 0.08]} />
      <mesh geometry={geo.box(0.24, 0.22, D * 2 + 0.2)} material={mat('#f7c9b4')} position={[-W - 0.08, 0.11, 0]} />
      {/* 창문: 밖에 하늘·나무 */}
      <group position={[1.6, 1.85, -D + 0.01]}>
        <mesh geometry={geo.box(1.7, 1.25, 0.06)} material={mat('#ffffff')} />
        <mesh geometry={geo.box(1.5, 1.05, 0.07)} material={mat('#bfe3f7')} />
        <mesh geometry={geo.ico(0.28, 1)} material={mat('#8fc27a')} position={[-0.4, -0.3, 0.05]} />
        <mesh geometry={geo.box(0.05, 1.05, 0.09)} material={mat('#ffffff')} />
        <mesh geometry={geo.box(1.5, 0.05, 0.09)} material={mat('#ffffff')} />
        {[-1, 1].map((s) => <mesh key={s} geometry={geo.box(0.32, 1.35, 0.05)} material={mat('#f4a6b8')} position={[s * 0.95, 0, 0.08]} />)}
      </group>
      {/* 벽 선반 + 발바닥 장식 */}
      <mesh geometry={geo.box(1.2, 0.06, 0.25)} material={mat('#c99a6b')} position={[-W + 0.15, 1.9, -0.6]} rotation={[0, Math.PI / 2, 0]} />
      <mesh geometry={geo.cyl(0.16, 0.16, 0.04, 8)} material={mat('#f39a7b')} position={[-1.8, 2.3, -D + 0.02]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

/** 집주인 아바타와 강아지 (강아지 침대가 있으면 그 위에서 쉼) */
function Residents({ home, layout }: { home: HomeView; layout: PlacedItem[] }) {
  const hd = useRef(newHumanDriver());
  const dd = useRef(newDogDriver());
  hd.current.leash = false;
  const bed = layout.find((i) => i.type === 'dogbed');
  useFrame((state) => {
    hd.current.anim = HumanAnim.Idle;
    dd.current.anim = bed ? DogAnim.Lie : DogAnim.Sit;
    dd.current.look = Math.sin(state.clock.elapsedTime * 0.7) * 0.5;
  });
  return (
    <>
      <group position={[0.2, 0, 1.6]} rotation={[0, -0.3, 0]}><Human avatar={home.owner.human} driver={hd} /></group>
      <group position={bed ? [bed.x, 0.12, bed.z] : [-0.7, 0, 1.8]} rotation={[0, bed ? bed.rot * (Math.PI / 2) + 0.4 : 0.3, 0]}>
        <Dog avatar={home.owner.dog} driver={dd} />
      </group>
    </>
  );
}

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

export function Home() {
  const ownerId = useStore((s) => s.homeOwner);
  const me = useStore((s) => s.me)!;
  const [home, setHome] = useState<HomeView | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlacedItem[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState('');
  const isMine = ownerId === me.id;
  const path = isMine ? 'me' : String(ownerId);

  useEffect(() => {
    setHome(null); setError('');
    api<{ home: HomeView }>(`/api/home/${path}`).then((r) => setHome(r.home)).catch((e) => setError((e as Error).message));
  }, [path]);

  const layout = editing ? draft : home?.layout ?? [];
  const placed = new Set(layout.map(itemKey));
  const storage = FURNITURE.flatMap((f) => Array.from({ length: f.count }, (_, n) => ({ f, n }))).filter(({ f, n }) => !placed.has(itemKey({ type: f.id, n })));
  const selItem = layout.find((i) => itemKey(i) === sel) ?? null;

  const back = () => set({ view: 'lobby', homeOwner: null });
  function startEdit() { if (!home) return; setDraft(home.layout.map((i) => ({ ...i }))); setEditing(true); setSel(null); }
  function update(key: string, patch: Partial<PlacedItem>) { setDraft((d) => d.map((i) => (itemKey(i) === key ? { ...i, ...patch } : i))); }
  function place(type: string, n: number) {
    // 빈 곳을 찾아 놓기 (방 가운데 근처부터)
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
      setHome(r.home); setEditing(false); setSel(null);
      toast('집 꾸미기를 저장했어요 🏠');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSaving(false); }
  }
  async function setVisibility(v: HomeVisibility) {
    try { const r = await api<{ home: HomeView }>('/api/home/me/visibility', { method: 'PUT', body: { visibility: v } }); setHome(r.home); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  async function like() {
    if (!home) return;
    try { const r = await api<{ liked: boolean; likes: number }>(`/api/home/${home.ownerId}/like`, { body: {} }); setHome({ ...home, likedByMe: r.liked, likes: r.likes }); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  async function writeGuestbook(e: FormEvent) {
    e.preventDefault();
    if (!home || !text.trim()) return;
    try { const r = await api<{ home: HomeView }>(`/api/home/${home.ownerId}/guestbook`, { body: { text } }); setHome(r.home); setText(''); }
    catch (err) { toast((err as Error).message, 'error'); }
  }
  async function removeEntry(id: number) {
    if (!home || !confirm('이 방명록을 지울까요?')) return;
    try { const r = await api<{ home: HomeView | null }>(`/api/home/${home.ownerId}/guestbook/${id}`, { method: 'DELETE' }); if (r.home) setHome(r.home); }
    catch (e) { toast((e as Error).message, 'error'); }
  }

  if (error) {
    return (
      <div className="absolute inset-0 z-30 grid place-items-center bg-cream p-6">
        <div className="panel p-6 text-center max-w-sm">
          <div className="text-4xl">🔒</div>
          <p className="mt-2">{error}</p>
          <button className="btn btn-peach px-5 py-2.5 mt-4" onClick={back}>로비로 돌아가기</button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col md:flex-row bg-cream">
      <div className="relative h-[52%] md:h-full md:flex-1 min-w-0">
        <Canvas camera={{ position: [4.2, 5.6, 7.6], fov: 40 }} dpr={[1, 2]}>
          <color attach="background" args={['#fff4e8']} />
          <hemisphereLight args={['#fffaf2', '#efe2cc', 2.0]} />
          <directionalLight position={[3, 6, 4]} intensity={1.1} color="#fff6e8" />
          <Room />
          {home && layout.map((i) => (
            <Furniture key={itemKey(i)} item={i} photo={home.owner.dogPhoto} editing={editing} selected={sel === itemKey(i)}
              onSelect={() => setSel(itemKey(i))} onDragStart={() => setDragging(true)} />
          ))}
          {home && !editing && <Residents home={home} layout={layout} />}
          {editing && (
            <DragFloor active={dragging && !!sel}
              onMove={(x, z) => sel && update(sel, { x: THREE.MathUtils.clamp(Math.round(x * 10) / 10, -W + 0.3, W - 0.3), z: THREE.MathUtils.clamp(Math.round(z * 10) / 10, -D + 0.3, D - 0.3) })}
              onEnd={() => setDragging(false)} />
          )}
          <OrbitControls enabled={!dragging} enablePan={false} target={[0, 0.6, 0]} minDistance={5} maxDistance={12} minPolarAngle={0.5} maxPolarAngle={1.25}
            minAzimuthAngle={-0.2} maxAzimuthAngle={1.3} />
        </Canvas>
        <div className="absolute top-3 left-3 panel !rounded-full px-4 py-2 font-display max-w-[60%] truncate">
          🏠 {home ? `${home.owner.nickname}네 집 · ${residenceLabel(home.residence)}` : '집에 들어가는 중…'}
        </div>
        <button className="absolute top-3 right-3 btn btn-ghost px-4 h-11 text-sm" onClick={back} disabled={editing}>← 로비</button>
        {editing && (
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
        )}
      </div>

      <aside className="md:w-[400px] flex-1 md:flex-none min-h-0 overflow-y-auto scroll-soft p-4 bg-cream-2/60">
        {!home ? <p className="text-center text-cocoa-soft py-8">불러오는 중…</p> : editing ? (
          <>
            <h2 className="font-display text-xl">🛠️ 집 꾸미기</h2>
            <p className="text-xs text-cocoa-soft mt-0.5">보관함의 가구를 눌러 방에 놓아 보세요.</p>
            <h3 className="font-display mt-3 mb-1.5">📦 보관함 ({storage.length})</h3>
            {storage.length === 0 && <p className="text-xs text-cocoa-soft">모든 가구를 꺼내 놓았어요.</p>}
            <div className="grid grid-cols-3 gap-2">
              {storage.map(({ f, n }) => (
                <button key={`${f.id}#${n}`} className="rounded-2xl bg-white p-2 text-center border-2 border-dashed border-[#e9d8c6] hover:border-[#f4776a] min-h-[64px]" onClick={() => place(f.id, n)}>
                  <div className="text-2xl">{f.icon}</div><div className="text-[11px] mt-0.5">{f.label}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-4 sticky bottom-0">
              <button className="btn btn-ghost flex-1 py-3" onClick={() => { setEditing(false); setSel(null); }}>취소</button>
              <button className="btn btn-coral flex-[2] py-3" disabled={saving} onClick={save}>{saving ? '저장 중…' : '저장하기'}</button>
            </div>
          </>
        ) : (
          <>
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
            </div>

            {home.isOwner && (
              <div className="mt-4 rounded-2xl bg-white p-3">
                <button className="btn btn-coral w-full py-3" onClick={startEdit}>🛠️ 집 꾸미기</button>
                <div className="font-display text-sm mt-3 mb-1.5">🔐 집 공개 범위</div>
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

            <h3 className="font-display text-lg mt-5">📖 방명록</h3>
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
          </>
        )}
      </aside>
    </div>
  );
}
