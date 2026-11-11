// 아파트 이사 — 1동 원룸 → 2동 투룸 → 3동 쓰리룸 선택 화면 (3D 내부 미리보기 · 가격 · 특징 · 이사 확인)
// 코인 차감·호실 배정·새집 배치는 서버가 한 번에 처리하고, 화면은 결과만 반영한다.
import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PLANS, PLAN_TAGLINE, itemKey, type HomeTier, type HomeView } from '@shared/home';
import { coinFmt, type CoinStatus } from '@shared/coins';
import { homeSpaceId } from '@shared/spaces';
import type { MyProfile } from '@shared/protocol';
import { api, ApiError } from '../lib/api';
import { get, set, toast, useStore } from '../store';
import { HomeRoom } from '../game/Interiors';
import { FurnitureModel } from '../game/Furniture';
import { joinPark } from '../net/socket';
import { showCoinFx } from './Coins';
import { DEMO } from '../demo';

type Status = 'current' | 'available' | 'insufficient' | 'locked' | 'past' | 'full';
interface PlanInfo { tier: HomeTier; building: string; name: string; type: string; rooms: number; price: number; features: string[]; capacity: number; free: number; status: Status; need: number }
interface PlansRes { balance: number; current: HomeTier | null; residence: { building: string; unit: string } | null; plans: PlanInfo[]; freeAccess?: boolean }

/** 3D 내부 미리보기 (기본 가구 배치) — 한 번만 그리는 정지 화면이라 가볍다 */
export function Preview({ tier }: { tier: HomeTier }) {
  const plan = PLANS[tier];
  const k = Math.max(plan.halfW / 3.6, plan.halfD / 3.0);
  return (
    <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [5.2 * k, 7.4 * k, 8.6 * k], fov: 34 }} onCreated={({ camera }) => camera.lookAt(0, 0, 0.2)}>
      <color attach="background" args={['#fff4e8']} />
      <hemisphereLight args={['#fffaf2', '#efe2cc', 2.1]} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} color="#fff6e8" />
      <HomeRoom tier={tier} />
      {plan.defaultLayout.map((i) => (
        <group key={itemKey(i)} position={[i.x, 0, i.z]} rotation={[0, i.rot * (Math.PI / 2), 0]}>
          <FurnitureModel type={i.type} n={i.n} photo={null} item={i} />
        </group>
      ))}
    </Canvas>
  );
}

const BADGE: Record<Status, [string, string]> = {
  current: ['🏠 지금 살고 있어요', 'bg-sage-soft text-sage-deep'],
  available: ['✨ 이사 가능', 'bg-[#fde3d6] text-[#e2604f]'],
  insufficient: ['🪙 코인을 모으는 중', 'bg-[#fff4cf] text-[#b9851a]'],
  locked: ['🔒 아직 이사할 수 없어요', 'bg-cream-2 text-cocoa-soft'],
  past: ['📦 지난 집', 'bg-cream-2 text-cocoa-soft'],
  full: ['🚧 빈 집 없음', 'bg-cream-2 text-cocoa-soft'],
};

export function MoveModal() {
  const open = useStore((s) => s.moveOpen);
  const [data, setData] = useState<PlansRes | null>(null);
  const [err, setErr] = useState('');
  const [confirmTier, setConfirmTier] = useState<HomeTier | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; unit: string; building: string } | null>(null);
  const requestId = useMemo(() => (confirmTier ? `mv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` : ''), [confirmTier]);
  const load = () => { setErr(''); api<PlansRes>('/api/apartment/plans').then(setData).catch((e) => setErr((e as Error).message)); };
  useEffect(() => { if (open) { setDone(null); setData(null); load(); } }, [open]);
  if (!open) return null;
  const close = () => { if (!busy) set({ moveOpen: false }); };

  async function move(p: PlanInfo) {
    setBusy(true);
    try {
      const r = await api<{ residence: { building: string; unit: string }; profile: MyProfile; coins: CoinStatus; home: HomeView }>('/api/apartment/move', { body: { building: p.building, requestId } });
      set({ me: r.profile, coins: r.coins });
      setConfirmTier(null);
      setDone({ name: p.name, unit: r.residence.unit, building: r.residence.building });
      if (!data?.freeAccess) showCoinFx(-p.price, `${p.name} 이사`);
      // 새집으로 바로 들어가기
      void joinPark(homeSpaceId(r.profile.id));
    } catch (e) {
      const d = e instanceof ApiError ? e.data : null;
      if (d?.coins) set({ coins: d.coins as CoinStatus });
      toast((e as Error).message, 'error');
      setConfirmTier(null);
      load();
    } finally { setBusy(false); }
  }

  const prevName = (t: HomeTier) => (t > 1 ? PLANS[(t - 1) as HomeTier].name : '');
  const confirmPlan = data?.plans.find((p) => p.tier === confirmTier) ?? null;
  return (
    <div className="fixed inset-0 z-50 bg-[#5a403355] grid place-items-center p-2 md:p-4" onPointerDown={(e) => e.target === e.currentTarget && close()} data-testid="move-modal">
      <div className="panel pop w-full max-w-[1000px] max-h-[94vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-4">
          <h2 className="font-display text-xl md:text-2xl flex-1 whitespace-nowrap">🚚 <span className="hidden sm:inline">멍글아파트 </span>이사하기</h2>
          {data && <span className="rounded-full bg-[#fff4cf] px-3 py-1 font-display text-[#b9851a] whitespace-nowrap" data-testid="move-balance">🪙 {coinFmt(data.balance)}</span>}
          <button className="btn btn-ghost w-10 h-10" onClick={close} aria-label="닫기">✕</button>
        </div>
        <p className="px-4 text-xs text-cocoa-soft mt-1">{data?.freeAccess
          ? '지금은 원룸·투룸·쓰리룸 모두 무료로 이용할 수 있어요. 언제든 원하는 집으로 이사할 수 있고, 가구·사진·친구·방명록·기록은 모두 그대로 옮겨져요.'
          : '1동 원룸 → 2동 투룸 → 3동 쓰리룸 순서로 이사할 수 있어요. 가구·사진·친구·방명록·기록은 모두 그대로 옮겨져요.'}</p>
        {DEMO && <p className="mx-4 mt-1 rounded-xl bg-[#eef5fb] text-[#4b6a86] px-3 py-1.5 text-[11px]">미리보기 코인은 이 기기에만 저장돼요. 실제 이사는 게임 서버에서 처리돼요.</p>}
        {done ? (
          <div className="p-6 text-center" data-testid="move-done">
            <div className="text-6xl pop">🎉</div>
            <div className="font-display text-2xl mt-2">{done.name} {done.unit}호로 이사했어요!</div>
            <p className="text-sm text-cocoa-soft mt-1">새집에는 기본 가구가 놓였고, 사진 액자는 새 벽에 걸었어요. 다른 가구는 꾸미기의 보관함에서 꺼내 원하는 곳에 놓아 주세요.</p>
            <div className="flex gap-2 justify-center mt-4">
              <button className="btn btn-ghost px-5 py-3" onClick={() => { set({ moveOpen: false }); void joinPark(homeSpaceId(get().me!.id)); }}>🏠 새집 둘러보기</button>
              <button className="btn btn-coral px-5 py-3" onClick={() => { set({ moveOpen: false, homeEdit: true }); }}>🛠️ 바로 꾸미기</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto scroll-soft p-3 md:p-4">
            {err && <p className="text-sm text-[#c4553a] bg-[#fff0ec] rounded-xl px-3 py-2">{err}</p>}
            {!data && !err && <p className="text-center text-cocoa-soft py-10">아파트 정보를 불러오는 중…</p>}
            {data && (
              <div className="grid gap-3 md:grid-cols-3">
                {data.plans.map((p) => {
                  const [label, cls] = BADGE[p.status];
                  return (
                    <article key={p.tier} className={`rounded-3xl bg-white border-2 overflow-hidden flex flex-col ${p.status === 'current' ? 'border-[#a9cfa0]' : p.status === 'available' ? 'border-[#f39a7b]' : 'border-[#f1e2d2]'}`} data-testid={`plan-${p.tier}`}>
                      <div className="relative h-[170px] md:h-[190px] bg-[#fff4e8]">
                        <Preview tier={p.tier} />
                        <span className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-display ${cls}`}>{label}</span>
                      </div>
                      <div className="p-3 flex-1 flex flex-col">
                        <div className="flex items-baseline gap-2">
                          <h3 className="font-display text-lg">{p.name}</h3>
                          <span className="text-sm text-cocoa-soft">{p.type} · 방 {p.rooms}개</span>
                        </div>
                        <p className="text-[13px] text-cocoa-soft">{PLAN_TAGLINE[p.tier]}</p>
                        {data.freeAccess
                          ? <span className="self-start mt-1 rounded-full bg-[#E58D76] text-white text-[11px] px-2.5 py-0.5" data-testid={`plan-free-${p.tier}`}>무료 이용</span>
                          : <div className="font-display text-[#e2a21c] text-lg">{p.tier === 1 ? `입주비 🪙 ${coinFmt(p.price)}` : `이사 비용 🪙 ${coinFmt(p.price)}`}</div>}
                        <ul className="text-[13px] mt-1 space-y-0.5 flex-1">
                          {p.features.map((f) => <li key={f}>· {f}</li>)}
                          <li className="text-cocoa-soft text-[12px]">· 친구 최대 {p.capacity}명 방문 · 빈 집 {p.free}호</li>
                        </ul>
                        <div className="mt-2">
                          {p.status === 'insufficient' && <p className="text-[12px] rounded-xl bg-[#fff4cf] px-3 py-2 mb-2" data-testid="move-need">이사까지 {coinFmt(p.need)}코인 남았어요! 산책과 멍글런너를 즐기며 코인을 모아보세요.</p>}
                          {p.status === 'locked' && <p className="text-[12px] text-cocoa-soft mb-2">{data.current === null ? '먼저 1동 원룸에 입주해 주세요.' : `${prevName(p.tier)}에 먼저 살아야 이사할 수 있어요.`}</p>}
                          {p.status === 'past' && <p className="text-[12px] text-cocoa-soft mb-2">이미 살았던 동으로 돌아가는 기능은 아직 준비 중이에요.</p>}
                          {p.status === 'full' && <p className="text-[12px] text-cocoa-soft mb-2">지금은 빈 집이 없어요. 잠시 후 다시 확인해 주세요.</p>}
                          {p.status === 'available' && data.current !== null ? (
                            <button className="btn btn-coral w-full py-3" onClick={() => setConfirmTier(p.tier)} data-testid={`move-${p.tier}`}>🚚 이사하기</button>
                          ) : p.status === 'current' ? (
                            <button className="btn btn-ghost w-full py-3" onClick={() => { set({ moveOpen: false }); void joinPark(homeSpaceId(get().me!.id)); }}>🏠 우리 집 들어가기</button>
                          ) : (
                            <button className="btn w-full py-3 bg-cream-2 text-cocoa-soft" disabled>{p.status === 'insufficient' ? `🪙 ${coinFmt(p.need)}코인 더 필요해요` : '이사할 수 없어요'}</button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {confirmPlan && (
        <div className="fixed inset-0 z-[55] grid place-items-center bg-[#5a403355] p-4" onPointerDown={(e) => e.target === e.currentTarget && !busy && setConfirmTier(null)}>
          <div className="panel p-5 w-full max-w-[380px] text-center pop" role="dialog" aria-modal="true" data-testid="move-confirm">
            <div className="text-5xl">🚚</div>
            <p className="font-display text-lg mt-2 leading-snug">
              {data?.freeAccess
                ? `${confirmPlan.name} ${confirmPlan.type}으로 이사하시겠어요? 지금은 무료예요. 기존 가구와 소중한 추억은 모두 새집으로 옮겨집니다.`
                : `${confirmPlan.name}으로 이사하시겠어요? 이사 비용 ${coinFmt(confirmPlan.price)}코인이 사용되며, 기존 가구와 소중한 추억은 모두 새집으로 옮겨집니다.`}
            </p>
            <p className="text-[12px] text-cocoa-soft mt-2">새집에는 기본 가구가 놓이고, 사진 액자는 새 벽에 걸려요. 다른 가구는 보관함에서 꺼내 원하는 곳에 다시 놓을 수 있어요. 지금 사는 {data?.residence ? `${data.residence.building}동 ${data.residence.unit}호` : '집'}는 다른 주민이 입주할 수 있게 돼요.</p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button className="btn btn-ghost py-3" disabled={busy} onClick={() => setConfirmTier(null)}>취소</button>
              <button className="btn btn-coral py-3" disabled={busy} onClick={() => void move(confirmPlan)} data-testid="move-confirm-yes">{busy ? '이사하는 중…' : data?.freeAccess ? '무료로 이사하기' : `🪙 ${coinFmt(confirmPlan.price)} 이사하기`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
