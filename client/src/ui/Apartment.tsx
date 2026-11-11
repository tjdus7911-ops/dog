// 멍글 아파트 — 입주(호실 선택) 화면 · 로비(3D 공간 + 호실 안내판)
// 동·호실은 가상 공간 정보이며 실제 주소와 연결하지 않는다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { residenceLabel, type BuildingInfo, type UnitInfo } from '@shared/apartment';
import { HOME_VISIBILITY, PLANS, PLAN_TAGLINE, planOf, tierOfBuilding, type HomeTier } from '@shared/home';
import { coinFmt, type CoinStatus } from '@shared/coins';
import { loadCoins } from './Coins';
import type { MyProfile, PublicProfile } from '@shared/protocol';
import type { DogAvatar } from '@shared/avatar';
import { api, ApiError } from '../lib/api';
import { set, toast, useStore } from '../store';
import { homeSpaceId } from '@shared/spaces';
import { DEMO } from '../demo';
import { joinPark, lastPark, openProfile } from '../net/socket';
import { Icon } from './icons';
import { CHIP, chipRowTop } from './layout';
import { isTouchDevice } from '../game/input';
import { Modal } from './common';
import { Preview } from './Move';

type BuildingData = BuildingInfo & { units: UnitInfo[] };

function useApartment() {
  const [data, setData] = useState<{ buildings: BuildingData[]; freeAccess?: boolean } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<{ buildings: BuildingData[]; freeAccess?: boolean }>('/api/apartment').then((d) => { setData(d); setError(''); }).catch((e) => setError((e as Error).message));
  }, []);
  const version = useStore((s) => s.visitRequestsVersion);
  useEffect(load, [load, version]);
  return { data, error, reload: load };
}

/** 층별 호실 격자 (위층부터). selectable이면 빈 집을 고를 수 있다 */
function UnitGrid({ b, selected, onSelect, selectable, onVisit }: { b: BuildingData; selected?: string | null; onSelect?: (u: string) => void; selectable: boolean; onVisit?: (userId: number) => void }) {
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
              const canVisit = !selectable && !!onVisit && !!u.resident;
              const isSel = selected === u.unit;
              return (
                <button key={u.unit} type="button" disabled={!canPick && !canVisit}
                  onClick={() => { if (canPick) onSelect?.(u.unit); else if (canVisit) onVisit!(u.resident!.id); }}
                  title={canVisit ? (u.resident!.mine ? '우리 집으로 가기' : '이 집 방문하기') : undefined}
                  className={`relative rounded-2xl px-2 py-2 text-left min-h-[64px] border-2 transition ${
                    isSel ? 'border-[#f4776a] bg-[#fff1ec] shadow-[0_3px_10px_rgba(244,119,106,.25)]'
                      : mine ? 'border-[#a9cfa0] bg-sage-soft'
                      : u.occupied ? `border-transparent bg-white ${canVisit ? 'hover:border-[#f4776a] active:scale-[.98]' : ''}`
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
                  ) : <div className="mt-1.5 text-[10px] sm:text-[11px] text-cocoa-soft whitespace-nowrap">{selectable ? '입주 가능' : '빈 집'}</div>}
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
/** 둘러보기 방문자가 입주하려고 할 때 안내 */
export const GUEST_MOVEIN_MSG = '아파트 입주는 회원만 가능해요!\n회원가입하면 500 멍글코인을 드려요.';

export function MoveIn({ onDone, embedded }: { onDone: () => void; embedded?: boolean }) {
  const { data, error, reload } = useApartment();
  const [buildingId, setBuildingId] = useState('1');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const guest = useStore((s) => s.me?.role === 'guest');
  // 원룸·투룸·쓰리룸 중에서 골라 입주 (유료: 고른 집 종류의 입주비 / 무료 이용 설정이면 0)
  const freeAccess = !!data?.freeAccess;
  const tier = tierOfBuilding(buildingId);
  const b = data?.buildings.find((x) => x.id === buildingId);
  const free = b?.units.filter((u) => !u.occupied).length ?? 0;
  const coins = useStore((s) => s.coins);
  useEffect(() => { if (!guest) void loadCoins(); }, [guest]);
  const price = freeAccess ? 0 : PLANS[tier].price;
  const short = !guest && !!coins && coins.balance < price;

  async function confirm() {
    if (!b || !selected || busyRef.current) return;
    // 둘러보기 방문자는 실제 입주 불가 → 가입 안내
    if (guest) { set({ joinPrompt: GUEST_MOVEIN_MSG }); return; }
    busyRef.current = true; // 연속 클릭으로 요청이 두 번 가지 않게 (서버도 한 번만 결제)
    setBusy(true);
    try {
      const r = await api<{ profile: MyProfile; coins?: CoinStatus }>('/api/apartment/move-in', { body: { building: b.id, unit: selected } });
      set({ me: r.profile, ...(r.coins ? { coins: r.coins } : {}) });
      toast(`🎉 ${residenceLabel(r.profile.residence)}에 입주했어요!${price > 0 ? ` (−${coinFmt(price)} 멍글코인)` : ''} 이웃들과 친하게 지내요`);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.data?.code === 'members_only') set({ joinPrompt: GUEST_MOVEIN_MSG });
      else toast((e as Error).message, 'error');
      setSelected(null);
      reload();
      void loadCoins();
    } finally { busyRef.current = false; setBusy(false); }
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
          <div className="grid grid-cols-3 gap-2 mb-2" role="radiogroup" aria-label="집 종류" data-testid="movein-types">
            {([1, 2, 3] as HomeTier[]).map((t) => {
              const on = buildingId === PLANS[t].building;
              const cost = freeAccess ? 0 : PLANS[t].price;
              const can = guest || !coins || freeAccess || coins.balance >= cost;
              return (
                <button key={t} type="button" role="radio" aria-checked={on} data-testid={`movein-type-${t}`}
                  onClick={() => { setBuildingId(PLANS[t].building); setSelected(null); }}
                  className={`rounded-2xl border-2 px-2 py-2.5 text-left transition ${on ? 'border-[#E58D76] bg-[#FBE8E1]' : 'border-[#EAE3DC] bg-white'}`}>
                  <span className="block font-display text-[15px]">{PLANS[t].type}</span>
                  <span className="block text-[11px] text-cocoa-soft leading-snug mt-0.5">{PLAN_TAGLINE[t]}</span>
                  {freeAccess
                    ? <span className="inline-block mt-1.5 rounded-full bg-[#E58D76] text-white text-[10px] px-2 py-0.5">무료 이용</span>
                    : <span className={`inline-block mt-1.5 rounded-full text-[11px] px-2 py-0.5 font-display ${can ? 'bg-[#fff4cf] text-[#b9851a]' : 'bg-cream-2 text-cocoa-soft'}`} data-testid={`movein-price-${t}`}>🪙 {coinFmt(cost)}</span>}
                </button>
              );
            })}
          </div>
          {/* 고른 집 종류 내부 미리보기 (기본 가구 배치) */}
          <div className="h-36 md:h-44 rounded-2xl overflow-hidden border border-[#EAE3DC] mb-2" data-testid="movein-preview"><Preview key={tier} tier={tier} /></div>
          {!freeAccess && (
            <div className="rounded-2xl bg-[linear-gradient(135deg,#fff4cf,#fde3d6)] px-3 py-2 mb-3 text-sm flex items-center gap-2" data-testid="movein-cost">
              <span className="text-2xl">🔑</span>
              <span className="flex-1 leading-tight"><b>{PLANS[tier].type} 입주비 {coinFmt(price)} 멍글코인</b><br /><span className="text-xs text-cocoa-soft">입주할 때 한 번 차감돼요</span></span>
              {guest ? <span className="text-xs text-cocoa-soft whitespace-nowrap">둘러보기 중</span> : coins && <span className="font-display text-[#e2a21c] whitespace-nowrap" data-testid="movein-balance">보유 🪙 {coinFmt(coins.balance)}</span>}
            </div>
          )}
          {short && <p className="text-sm text-[#c4553a] bg-[#fff0ec] rounded-xl px-3 py-2 mb-2" data-testid="movein-short">{PLANS[tier].type} 입주까지 {coinFmt(price - coins!.balance)}코인이 부족해요. 출석 체크와 산책·멍글런너로 코인을 모아 보세요!</p>}
          <div className="flex items-center justify-between mb-2">
            <span className="font-display">{b.name}</span>
            <span className="text-xs text-cocoa-soft">입주 가능 {free}/{b.units.length}호</span>
          </div>
          <UnitGrid b={b} selectable selected={selected} onSelect={setSelected} />
          <p className="text-[11px] text-cocoa-soft mt-3">※ 동·호실은 멍글마을 안의 가상 주소예요. 실제 주소와는 관계없어요.</p>
          <div className="flex gap-2 mt-4">
            <button type="button" className="btn btn-ghost flex-1 py-3" onClick={onDone}>{embedded ? '닫기' : '나중에 하기'}</button>
            <button type="button" className="btn btn-coral flex-[2] py-3 text-lg" disabled={!selected || busy || short} onClick={confirm} data-testid="movein-confirm">
              {busy ? '입주 처리 중…' : selected ? (freeAccess || guest ? `${b?.id}동 ${selected}호로 입주하기 🏠` : `${b?.id}동 ${selected}호 입주 (🪙${coinFmt(price)})`) : '호실을 골라 주세요'}
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

// ---------------- 로비 (3D 로비 공간 위의 안내판 패널) ----------------

type NeighborSt = 'none' | 'outgoing' | 'incoming' | 'neighbors' | 'unavailable';
interface Access {
  allowed: boolean; reason: string | null; canRequest: boolean; request: string | null; visibility: string;
  owner: { id: number; nickname: string; dogName: string; dogIntro: string; dogPhoto: string | null; dog: DogAvatar; residence: { building: string; unit: string } };
  neighbor: NeighborSt;
}

/** 호실 카드: 집주인·강아지 프로필, 입장/방문 신청, 이웃 신청 */
function UnitCard({ ownerId, onClose, door }: { ownerId: number; onClose: () => void; door?: boolean }) {
  const me = useStore((s) => s.me)!;
  const [a, setA] = useState<Access | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<Access>(`/api/home/${ownerId}/access`).then(setA).catch((e) => { toast((e as Error).message, 'error'); onClose(); });
  }, [ownerId, onClose]);
  useEffect(load, [load]);
  const mine = ownerId === me.id;

  async function enter() {
    setBusy(true);
    const ok = await joinPark(homeSpaceId(ownerId));
    setBusy(false);
    if (ok) onClose();
  }
  async function requestVisit() {
    setBusy(true);
    try { await api(`/api/home/${ownerId}/visit-request`, { body: {} }); toast('방문을 신청했어요. 집주인이 승인하면 알려 드릴게요'); load(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function neighbor(action: string, ask?: string) {
    if (ask && !confirm(ask)) return;
    try { await api(`/api/neighbors/${ownerId}/${action}`, { body: {} }); load(); set((x) => ({ visitRequestsVersion: x.visitRequestsVersion + 1 })); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  const visLabel = HOME_VISIBILITY.find((v) => v.id === a?.visibility)?.label ?? '';

  return (
    <Modal onClose={onClose} className="max-w-[380px] p-5">
      {!a ? <p className="text-center text-cocoa-soft py-8">불러오는 중…</p> : (
        <>
          <div className="flex items-center gap-3">
            {a.owner.dogPhoto
              ? <img src={a.owner.dogPhoto} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-white shadow" />
              : <span className="w-16 h-16 rounded-full grid place-items-center text-3xl border-2 border-white shadow" style={{ background: a.owner.dog.coat }}>🐶</span>}
            <div className="flex-1 min-w-0">
              <div className="font-display text-xl truncate">{a.owner.nickname}</div>
              <div className="text-sm text-cocoa-soft">🐶 {a.owner.dogName} · {residenceLabel(a.owner.residence)}</div>
              <div className="text-xs text-cocoa-soft mt-0.5">🔐 {visLabel}</div>
            </div>
            <button className="btn btn-ghost w-11 h-11 shrink-0" onClick={onClose} aria-label="닫기">✕</button>
          </div>
          {door && <div className="mt-3 rounded-2xl bg-[#f3f7ef] px-3 py-2 text-sm">🚪 <b>{residenceLabel(a.owner.residence)}</b> 문 앞이에요. {mine || a.allowed ? '바로 들어갈 수 있어요.' : a.canRequest ? '집주인 승인이 필요한 집이에요.' : '지금은 들어갈 수 없는 집이에요.'}</div>}
          {a.owner.dogIntro && <p className="mt-3 text-sm bg-cream-2 rounded-2xl px-3 py-2">{a.owner.dogIntro}</p>}

          <div className="mt-4 grid gap-2">
            {mine || a.allowed ? (
              <button className="btn btn-coral py-3 text-lg" disabled={busy} onClick={enter}>{mine ? '🏠 우리 집 들어가기' : door ? '🚪 방문하기' : '🚪 집에 들어가기'}</button>
            ) : a.canRequest ? (
              a.request === 'pending'
                ? <span className="btn bg-cream-2 py-3 text-cocoa-soft">⏳ 방문 신청 중 · 집주인 승인을 기다려요</span>
                : <button className="btn btn-coral py-3" disabled={busy || DEMO} onClick={requestVisit}>{door ? '🚪 방문하기 (방문 요청 보내기)' : '📨 방문 신청하기'}{a.request === 'declined' ? ' (다시)' : ''}</button>
            ) : null}
            {!a.allowed && !mine && <p className="text-xs text-cocoa-soft text-center">{a.reason}</p>}
            {!mine && a.neighbor !== 'unavailable' && (
              a.neighbor === 'none' ? <button className="btn btn-ghost py-2.5 border border-[#f1e2d2]" onClick={() => neighbor('request')}>🏘️ 이웃 신청</button>
                : a.neighbor === 'outgoing' ? <button className="btn btn-ghost py-2.5 border border-[#f1e2d2]" onClick={() => neighbor('cancel')}>⏳ 이웃 신청 중 · 취소</button>
                : a.neighbor === 'incoming' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button className="btn btn-peach py-2.5" onClick={() => neighbor('accept')}>이웃 신청 수락</button>
                    <button className="btn btn-ghost py-2.5" onClick={() => neighbor('decline')}>거절</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="btn bg-sage-soft text-sage-deep py-2.5 flex-1">🏘️ 이웃</span>
                    <button className="text-sm text-cocoa-soft underline px-2" onClick={() => neighbor('remove', `${a.owner.nickname}님과 이웃을 끊을까요?`)}>이웃 끊기</button>
                  </div>
                )
            )}
            {!mine && <button className="text-sm text-cocoa-soft underline" onClick={() => { onClose(); void openProfile(ownerId); }}>프로필 · 친구 신청 보기</button>}
          </div>
        </>
      )}
    </Modal>
  );
}

/** 받은 이웃 신청 (같은 동 주민) */
function NeighborBox() {
  const version = useStore((s) => s.visitRequestsVersion);
  const [d, setD] = useState<{ neighbors: PublicProfile[]; incoming: PublicProfile[] } | null>(null);
  useEffect(() => { if (!DEMO) api<{ neighbors: PublicProfile[]; incoming: PublicProfile[] }>('/api/neighbors').then(setD).catch(() => {}); }, [version]);
  if (!d || (d.incoming.length === 0 && d.neighbors.length === 0)) return null;
  async function act(id: number, action: string) {
    try { await api(`/api/neighbors/${id}/${action}`, { body: {} }); set((x) => ({ visitRequestsVersion: x.visitRequestsVersion + 1 })); }
    catch (e) { toast((e as Error).message, 'error'); }
  }
  return (
    <div className="mt-3 rounded-2xl bg-white p-3">
      {d.incoming.length > 0 && (
        <>
          <div className="font-display text-sm mb-1.5">🏘️ 받은 이웃 신청</div>
          {d.incoming.map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-1">
              <span className="flex-1 text-sm">{p.nickname} · 🐶 {p.dogName} <span className="text-cocoa-soft text-xs">{residenceLabel(p.residence)}</span></span>
              <button className="btn btn-peach px-3 min-h-[40px] text-xs" onClick={() => act(p.id, 'accept')}>수락</button>
              <button className="btn btn-ghost px-3 min-h-[40px] text-xs" onClick={() => act(p.id, 'decline')}>거절</button>
            </div>
          ))}
        </>
      )}
      {d.neighbors.length > 0 && (
        <div className={d.incoming.length ? 'mt-2' : ''}>
          <div className="font-display text-sm mb-1">🏘️ 내 이웃 {d.neighbors.length}명</div>
          <div className="flex flex-wrap gap-1.5">{d.neighbors.map((p) => <span key={p.id} className="text-xs rounded-full bg-sage-soft px-2.5 py-1">{p.nickname} · {residenceLabel(p.residence)}</span>)}</div>
        </div>
      )}
    </div>
  );
}

/** 로비 안내판 패널 (3D 로비 위에 표시). 모바일은 하단 시트, PC는 오른쪽 패널 */
export function LobbyPanel() {
  const me = useStore((s) => s.me)!;
  const open = useStore((s) => s.lobbyPanel);
  const { data, error } = useApartment();
  const [moving, setMoving] = useState(false);
  const [card, setCard] = useState<{ id: number; door?: boolean } | null>(null);
  const focus = useStore((s) => s.lobbyFocus);
  // 친구 목록에서 '집 놀러 가기' → 로비에 오면 그 집 문 앞 안내
  useEffect(() => { if (focus !== null) { setCard({ id: focus, door: true }); set({ lobbyFocus: null, lobbyPanel: false }); } }, [focus]);
  const [tab, setTab] = useState<string | null>(null);
  const b = data?.buildings.find((x) => x.id === (tab ?? me.residence?.building ?? '1')) ?? data?.buildings[0];
  const close = () => set({ lobbyPanel: false });

  return (
    <>
      {/* 로비 상단 버튼 */}
      <div className="absolute z-20 left-3 flex gap-1.5 pointer-events-none" style={{ top: chipRowTop(isTouchDevice()) }}>
        <button className={CHIP} onClick={() => void joinPark(lastPark(), 'lobby')}><Icon name="tree" size={16} className="hud-icon" />광장으로 나가기</button>
        {!open && <button className={CHIP} onClick={() => set({ lobbyPanel: true })} data-testid="lobby-board"><Icon name="building" size={16} className="hud-icon" />호실 안내판</button>}
      </div>
      {open && (
        <aside className="above-nav absolute z-30 inset-x-0 bottom-0 max-h-[min(72%,calc(100%-224px))] md:inset-x-auto md:right-3 md:top-[74px] md:bottom-3 md:w-[420px] md:max-h-none panel !rounded-b-none md:!rounded-[22px] p-4 overflow-y-auto scroll-soft pop"
          style={{ paddingBottom: 'calc(var(--safe-b) + 16px)' }}>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl flex-1">📋 멍글 아파트 호실 안내판</h2>
            <button className="btn btn-ghost w-11 h-11" onClick={close} aria-label="안내판 닫기">✕</button>
          </div>
          {moving ? <MoveIn embedded onDone={() => setMoving(false)} /> : (
            <>
              <div className="mt-2 rounded-2xl bg-white p-3 flex items-center gap-3">
                <span className="text-2xl">🏠</span>
                {me.residence ? (
                  <>
                    <div className="flex-1 min-w-0"><div className="font-display">우리 집 · {residenceLabel(me.residence)}</div><div className="text-xs text-cocoa-soft">{me.dogName}와(과) 함께 살아요</div></div>
                    <div className="flex flex-col gap-1">
                      <button className="btn btn-coral px-4 min-h-[44px] text-sm" onClick={() => void joinPark(homeSpaceId(me.id))}>들어가기</button>
                      <button className="btn btn-ghost px-3 min-h-[36px] text-xs" onClick={() => set({ moveOpen: true })}>🚚 이사하기</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex-1 text-sm">아직 입주하지 않았어요.</div>
                    <button className="btn btn-coral px-4 min-h-[44px] text-sm" onClick={() => setMoving(true)}>입주하기</button>
                  </>
                )}
              </div>
              <NeighborBox />
              {error && <p className="text-sm text-[#c4553a] bg-[#fff0ec] rounded-xl px-3 py-2 mt-3">{error}</p>}
              {!data && !error && <p className="text-cocoa-soft py-6 text-center">불러오는 중…</p>}
              {data && (
                <div className="grid grid-cols-3 gap-1 bg-cream-2 rounded-full p-1 text-sm mt-3" role="tablist" aria-label="동 선택">
                  {data.buildings.map((x) => (
                    <button key={x.id} role="tab" aria-selected={x.id === b?.id} className={`btn py-1.5 ${x.id === b?.id ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setTab(x.id)}>
                      {x.id}동 <span className="text-[11px]">{planOf(tierOfBuilding(x.id)).type}</span>{me.residence?.building === x.id ? ' 🏠' : ''}
                    </button>
                  ))}
                </div>
              )}
              {b && <p className="text-[11px] text-cocoa-soft mt-1.5">{b.id === me.residence?.building ? '🏘️ 우리 동 이웃들이에요.' : `${b.name} 주민들이에요.`} 입주 {b.units.filter((u) => u.occupied).length}/{b.units.length}호</p>}
              {b && <div className="mt-2"><UnitGrid b={b} selectable={false} onVisit={(id) => setCard({ id })} /></div>}
              {b && <p className="text-[11px] text-cocoa-soft mt-2">주민이 사는 호실을 누르면 집주인과 강아지 프로필을 보고 들어가거나 방문을 신청할 수 있어요.</p>}
              {DEMO && <p className="text-[11px] text-cocoa-soft mt-2">미리보기에서는 다른 주민 없이 내 집만 표시돼요.</p>}
            </>
          )}
        </aside>
      )}
      {card !== null && <UnitCard ownerId={card.id} door={card.door} onClose={() => setCard(null)} />}
    </>
  );
}

