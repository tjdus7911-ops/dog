// 멍글 아파트 — 입주(호실 선택) 화면 · 로비(3D 공간 + 호실 안내판)
// 동·호실은 가상 공간 정보이며 실제 주소와 연결하지 않는다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { residenceLabel, type BuildingInfo, type UnitInfo } from '@shared/apartment';
import type { MyProfile } from '@shared/protocol';
import { api } from '../lib/api';
import { get, set, toast, useStore } from '../store';
import { Human, newHumanDriver } from '../game/models/Human';
import { Dog, newDogDriver } from '../game/models/Dog';
import { DogAnim, HumanAnim } from '@shared/protocol';
import { geo, mat } from '../game/lowpoly';
import { local } from '../game/local';
import { APARTMENT_ENTRANCE } from '@shared/world';
import { DEMO } from '../demo';
import { standUp } from '../game/Players';
import { isTouchDevice } from '../game/input';

type BuildingData = BuildingInfo & { units: UnitInfo[] };

function useApartment() {
  const [data, setData] = useState<{ buildings: BuildingData[] } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<{ buildings: BuildingData[] }>('/api/apartment').then((d) => { setData(d); setError(''); }).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);
  return { data, error, reload: load };
}

/** 층별 호실 격자 (위층부터). selectable이면 빈 집을 고를 수 있다 */
function UnitGrid({ b, selected, onSelect, selectable }: { b: BuildingData; selected?: string | null; onSelect?: (u: string) => void; selectable: boolean }) {
  const floors = useMemo(() => {
    const m = new Map<number, UnitInfo[]>();
    for (const u of b.units) m.set(u.floor, [...(m.get(u.floor) ?? []), u]);
    return [...m.entries()].sort((a, c) => c[0] - a[0]);
  }, [b]);
  return (
    <div className="space-y-2">
      {floors.map(([floor, units]) => (
        <div key={floor} className="flex items-center gap-2">
          <div className="w-9 shrink-0 text-center font-display text-cocoa-soft">{floor}F</div>
          <div className="grid grid-cols-4 gap-2 flex-1">
            {units.map((u) => {
              const mine = u.resident?.mine;
              const canPick = selectable && !u.occupied;
              const isSel = selected === u.unit;
              return (
                <button key={u.unit} type="button" disabled={!canPick} onClick={() => canPick && onSelect?.(u.unit)}
                  className={`relative rounded-2xl px-2 py-2 text-left min-h-[64px] border-2 transition ${
                    isSel ? 'border-[#f4776a] bg-[#fff1ec] shadow-[0_3px_10px_rgba(244,119,106,.25)]'
                      : mine ? 'border-[#a9cfa0] bg-sage-soft'
                      : u.occupied ? 'border-transparent bg-white'
                      : selectable ? 'border-dashed border-[#e9d8c6] bg-white/70 hover:border-[#f4776a]' : 'border-dashed border-[#efe2d4] bg-white/50'
                  } ${!canPick && selectable && !mine ? 'cursor-not-allowed' : ''}`}>
                  <div className="font-display text-sm leading-none">{u.unit}호{mine && <span className="ml-1 text-[11px] text-sage-deep">(우리 집)</span>}</div>
                  {u.occupied ? (
                    u.resident ? (
                      <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
                        {u.resident.dogPhoto
                          ? <img src={u.resident.dogPhoto} alt="" className="w-6 h-6 rounded-full object-cover border border-white shrink-0" />
                          : <span className="w-6 h-6 rounded-full grid place-items-center text-[12px] border border-white shrink-0" style={{ background: u.resident.dogCoat }}>🐶</span>}
                        <div className="min-w-0 leading-tight">
                          <div className="text-[12px] font-display truncate">{u.resident.dogName}</div>
                          <div className="text-[10px] text-cocoa-soft truncate">{u.resident.nickname}</div>
                        </div>
                      </div>
                    ) : <div className="mt-1.5 text-[11px] text-cocoa-soft">입주 완료</div>
                  ) : <div className="mt-1.5 text-[11px] text-cocoa-soft">{selectable ? '입주 가능' : '빈 집'}</div>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 입주 화면: 빈 호실을 골라 입주 확정 */
export function MoveIn({ onDone, embedded }: { onDone: () => void; embedded?: boolean }) {
  const { data, error, reload } = useApartment();
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const b = data?.buildings.find((x) => x.id === (buildingId ?? data.buildings[0]?.id));
  const free = b?.units.filter((u) => !u.occupied).length ?? 0;

  async function confirm() {
    if (!b || !selected) return;
    setBusy(true);
    try {
      const r = await api<{ profile: MyProfile }>('/api/apartment/move-in', { body: { building: b.id, unit: selected } });
      set({ me: r.profile });
      toast(`🎉 ${residenceLabel(r.profile.residence)}에 입주했어요! 이웃들과 친하게 지내요`);
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
      setSelected(null);
      reload();
    } finally { setBusy(false); }
  }

  const body = (
    <div className={embedded ? '' : 'panel p-5 md:p-6 w-full max-w-[560px]'}>
      {!embedded && (
        <div className="text-center mb-4">
          <div className="text-4xl">🏢</div>
          <h1 className="font-display text-2xl md:text-3xl mt-1">멍글 아파트 입주하기</h1>
          <p className="text-sm text-cocoa-soft mt-1">우리 강아지와 살 집을 골라 주세요. 한 호실에는 한 가족만 살 수 있어요.</p>
        </div>
      )}
      {error && <p className="text-sm text-[#c4553a] bg-[#fff0ec] rounded-xl px-3 py-2">{error}</p>}
      {!data && !error && <p className="text-center text-cocoa-soft py-8">호실 정보를 불러오는 중…</p>}
      {data && b && (
        <>
          {data.buildings.length > 1 && (
            <div className="flex gap-2 mb-3">{data.buildings.map((x) => (
              <button key={x.id} type="button" className={`btn px-3 py-1.5 text-sm ${x.id === b.id ? 'btn-peach' : 'btn-ghost'}`} onClick={() => { setBuildingId(x.id); setSelected(null); }}>{x.name}</button>
            ))}</div>
          )}
          <div className="flex items-center justify-between mb-2">
            <span className="font-display">{b.name}</span>
            <span className="text-xs text-cocoa-soft">입주 가능 {free}/{b.units.length}호</span>
          </div>
          <UnitGrid b={b} selectable selected={selected} onSelect={setSelected} />
          <p className="text-[11px] text-cocoa-soft mt-3">※ 동·호실은 멍글마을 안의 가상 주소예요. 실제 주소와는 관계없어요.</p>
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-ghost flex-1 py-3" onClick={onDone}>{embedded ? '닫기' : '나중에 하기'}</button>
            <button type="button" className="btn btn-coral flex-[2] py-3 text-lg" disabled={!selected || busy} onClick={confirm}>
              {busy ? '입주 처리 중…' : selected ? `${selected}호로 입주하기 🏠` : '호실을 골라 주세요'}
            </button>
          </div>
        </>
      )}
    </div>
  );
  if (embedded) return body;
  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_20%_10%,#fde3d6,transparent_45%),radial-gradient(circle_at_85%_90%,#e3efdc,transparent_45%)] bg-cream">
      <div className="min-h-full grid place-items-center p-4">{body}</div>
    </div>
  );
}

// ---------------- 로비 ----------------

function LobbyActors() {
  const me = useStore((s) => s.me)!;
  const hd = useRef(newHumanDriver());
  const dd = useRef(newDogDriver());
  hd.current.leash = false;
  useFrame((state) => {
    hd.current.anim = HumanAnim.Idle;
    dd.current.anim = DogAnim.Look;
    dd.current.look = Math.sin(state.clock.elapsedTime * 0.8) * 0.5;
  });
  return (
    <>
      <group position={[-0.35, 0, 1.2]} rotation={[0, 0.25, 0]}><Human avatar={me.human} driver={hd} /></group>
      <group position={[0.45, 0, 1.45]} rotation={[0, -0.35, 0]}><Dog avatar={me.dog} driver={dd} /></group>
    </>
  );
}

/** 로비 실내: 따뜻한 원목 바닥, 크림색 벽, 우편함 벽(호실 수만큼), 소파·화분·조명 */
function LobbyRoom({ units }: { units: UnitInfo[] }) {
  const sorted = [...units].sort((a, b) => b.floor - a.floor || a.unit.localeCompare(b.unit));
  const lamp = useMemo(() => new THREE.MeshLambertMaterial({ color: '#fff1b8', emissive: '#ffd77a', emissiveIntensity: 0.7 }), []);
  return (
    <group>
      <mesh geometry={geo.box(9, 0.1, 7)} material={mat('#d9b48c')} position={[0, -0.05, 0]} />
      {Array.from({ length: 9 }).map((_, i) => <mesh key={i} geometry={geo.box(0.02, 0.105, 7)} material={mat('#c99f76')} position={[-4 + i, -0.045, 0]} />)}
      <mesh geometry={geo.box(9, 4, 0.2)} material={mat('#fff1dc')} position={[0, 2, -3.5]} />
      <mesh geometry={geo.box(0.2, 4, 7)} material={mat('#fde3d6')} position={[-4.5, 2, 0]} />
      <mesh geometry={geo.box(0.2, 4, 7)} material={mat('#e3efdc')} position={[4.5, 2, 0]} />
      <mesh geometry={geo.box(9, 0.5, 0.25)} material={mat('#f7c9b4')} position={[0, 0.25, -3.38]} />
      {/* 러그 */}
      <mesh geometry={geo.circle(1.6, 24)} material={mat('#f4a6b8')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 1.2]} scale={[1.3, 1, 1]} />
      <mesh geometry={geo.circle(1.3, 24)} material={mat('#fac9d5')} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 1.2]} scale={[1.3, 1, 1]} />
      {/* 우편함 벽: 입주한 호실은 코랄, 빈 호실은 크림 */}
      <group position={[-2.2, 1.0, -3.36]}>
        <mesh geometry={geo.box(2.6, 2.3, 0.1)} material={mat('#b98559')} position={[0, 0.85, 0]} />
        {sorted.map((u, i) => {
          const r = Math.floor(i / 4), c = i % 4;
          return (
            <group key={u.unit} position={[-0.93 + c * 0.62, 1.75 - r * 0.52, 0.08]}>
              <mesh geometry={geo.box(0.54, 0.44, 0.08)} material={mat(u.resident?.mine ? '#a9cfa0' : u.occupied ? '#f39a7b' : '#fff8ef')} />
              <mesh geometry={geo.box(0.3, 0.04, 0.1)} material={mat('#5a4a44')} position={[0, 0.08, 0.01]} />
            </group>
          );
        })}
      </group>
      {/* 호실 안내판 */}
      <group position={[1.9, 1.9, -3.36]}>
        <mesh geometry={geo.box(2.2, 1.5, 0.08)} material={mat('#fff8ef')} />
        <mesh geometry={geo.box(2.3, 0.18, 0.1)} material={mat('#f39a7b')} position={[0, 0.8, 0]} />
        {Array.from({ length: 4 }).map((_, i) => <mesh key={i} geometry={geo.box(1.8, 0.06, 0.09)} material={mat('#e2cfae')} position={[0, 0.45 - i * 0.3, 0]} />)}
      </group>
      {/* 소파 */}
      <group position={[3.0, 0, 0.2]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh geometry={geo.box(2.0, 0.45, 0.8)} material={mat('#a9cfa0')} position={[0, 0.3, 0]} />
        <mesh geometry={geo.box(2.0, 0.6, 0.22)} material={mat('#97c08d')} position={[0, 0.7, -0.32]} />
        {[-1, 1].map((s) => <mesh key={s} geometry={geo.box(0.22, 0.55, 0.8)} material={mat('#97c08d')} position={[s * 0.95, 0.45, 0]} />)}
        <mesh geometry={geo.box(0.5, 0.35, 0.15)} material={mat('#fde3d6')} position={[-0.5, 0.62, -0.18]} rotation={[-0.2, 0, 0.1]} />
      </group>
      {/* 화분 */}
      {[[-3.8, -2.8], [3.8, -2.8]].map(([x, z]) => (
        <group key={x} position={[x, 0, z]}>
          <mesh geometry={geo.cyl(0.28, 0.22, 0.5, 8)} material={mat('#e98a5e')} position={[0, 0.25, 0]} />
          <mesh geometry={geo.ico(0.55, 1)} material={mat('#8fc27a')} position={[0, 0.95, 0]} />
        </group>
      ))}
      {/* 조명 */}
      {[-1.5, 1.5].map((x) => (
        <group key={x} position={[x, 3.4, -0.5]}>
          <mesh geometry={geo.cyl(0.01, 0.01, 0.8, 4)} material={mat('#5a4a44')} position={[0, 0.4, 0]} />
          <mesh geometry={geo.sphere(0.28, 10, 6, Math.PI / 2)} material={mat('#f39a7b')} />
          <mesh geometry={geo.ico(0.12, 1)} material={lamp} position={[0, -0.05, 0]} />
        </group>
      ))}
    </group>
  );
}

function CameraSway() {
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime * 0.15;
    camera.position.set(Math.sin(t) * 0.6, 2.4, 6.2);
    camera.lookAt(0, 1.1, -0.8);
  });
  return null;
}

export function Lobby() {
  const me = useStore((s) => s.me)!;
  const { data, error, reload } = useApartment();
  const [moving, setMoving] = useState(false);
  const b = data?.buildings[0];
  useEffect(() => { standUp(); }, []); // 벤치에 앉아 있었다면 자리 비우기

  function leave() {
    // 아파트 입구 앞으로 나간다
    local.x = APARTMENT_ENTRANCE.x; local.z = APARTMENT_ENTRANCE.z + 2.1; local.rot = 0;
    local.dogX = local.x + 0.8; local.dogZ = local.z + 0.3;
    local.moveTarget = null;
    set({ view: 'park' });
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col md:flex-row bg-cream">
      <div className="relative h-[42%] md:h-full md:flex-1 min-w-0">
        <Canvas camera={{ position: [0, 2.4, 6.2], fov: 42 }} dpr={[1, 2]}>
          <color attach="background" args={['#fff4e8']} />
          <hemisphereLight args={['#fffaf2', '#efe2cc', 2.0]} />
          <directionalLight position={[2, 5, 4]} intensity={1.1} color="#fff6e8" />
          <LobbyRoom units={b?.units ?? []} />
          <LobbyActors />
          <CameraSway />
        </Canvas>
        <div className="absolute top-3 left-3 panel !rounded-full px-4 py-2 font-display">🏢 {b?.name ?? '멍글 아파트'} · 로비</div>
        <button className="absolute top-3 right-3 btn btn-ghost px-4 h-11 text-sm" onClick={leave}>🌳 공원으로 나가기</button>
      </div>
      <aside className="md:w-[440px] flex-1 md:flex-none min-h-0 overflow-y-auto scroll-soft p-4 md:p-5 bg-cream-2/60">
        {moving ? (
          <MoveIn embedded onDone={() => { setMoving(false); reload(); }} />
        ) : (
          <>
            <h2 className="font-display text-xl">📋 호실 안내판</h2>
            <p className="text-xs text-cocoa-soft mt-0.5">입주한 이웃과 강아지를 확인해 보세요.</p>
            <div className="mt-3 rounded-2xl bg-white p-3 flex items-center gap-3">
              <span className="text-2xl">🏠</span>
              {me.residence ? (
                <div className="flex-1"><div className="font-display">우리 집 · {residenceLabel(me.residence)}</div><div className="text-xs text-cocoa-soft">{me.dogName}와(과) 함께 살고 있어요</div></div>
              ) : (
                <>
                  <div className="flex-1 text-sm">아직 입주하지 않았어요.</div>
                  <button className="btn btn-coral px-4 py-2 text-sm" onClick={() => setMoving(true)}>입주하기</button>
                </>
              )}
            </div>
            {error && <p className="text-sm text-[#c4553a] bg-[#fff0ec] rounded-xl px-3 py-2 mt-3">{error}</p>}
            {!data && !error && <p className="text-cocoa-soft py-6 text-center">불러오는 중…</p>}
            {b && <div className="mt-3"><UnitGrid b={b} selectable={false} /></div>}
            {DEMO && <p className="text-[11px] text-cocoa-soft mt-3">미리보기에서는 다른 주민 없이 내 집만 표시돼요.</p>}
            <div className="mt-4 rounded-2xl border-2 border-dashed border-[#e9d8c6] p-3 text-xs text-cocoa-soft leading-relaxed">
              <b className="font-display text-cocoa">곧 열려요</b> · 우리 집 꾸미기, 이웃 집 방문 신청, 방명록, 주민 게시판은 다음 단계에서 이 로비에 추가돼요.
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/** 공원에서 아파트 입구에 가까이 가면 '로비 들어가기' 버튼 */
export function EntrancePrompt() {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = Math.hypot(local.x - APARTMENT_ENTRANCE.x, local.z - APARTMENT_ENTRANCE.z);
      setNear(d < APARTMENT_ENTRANCE.r && get().view === 'park');
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  const mobileChat = useStore((s) => s.chatOpen) && isTouchDevice();
  if (!near || mobileChat) return null;
  return (
    <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-24 pop" style={{ bottom: isTouchDevice() ? 'calc(var(--safe-b) + 176px)' : undefined }}>
      <button className="btn btn-coral px-6 py-3 text-lg shadow-lg" onClick={() => set({ view: 'lobby', benchMenu: null })}>🏢 아파트 로비 들어가기</button>
    </div>
  );
}
