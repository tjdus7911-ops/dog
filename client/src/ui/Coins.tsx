// 멍글 코인 — 상단 작은 코인 칩 · 출석 체크(7일 달력) · 코인 지갑 · 코인 획득 애니메이션
// 잔액·지급은 모두 서버가 정하고, 화면은 서버가 돌려준 값만 보여 준다.
import { useEffect, useState } from 'react';
import { COIN_ICON, COIN_REWARDS, WALK_GOAL, coinFmt, type CoinEarned, type CoinStatus, type CoinTx } from '@shared/coins';
import { api, ApiError } from '../lib/api';
import { get, set, toast, useStore } from '../store';
import { DEMO } from '../demo';
import { Modal } from './common';

export async function loadCoins() {
  const me = get().me;
  if (!me || me.role === 'guest') return;
  try { set({ coins: (await api<{ coins: CoinStatus }>('/api/coins')).coins }); } catch { /* 다음에 다시 */ }
}

let fxId = 0;
/** 코인 획득 애니메이션 (+금액, 이유) */
export function showCoinFx(amount: number, label: string) {
  const id = ++fxId;
  set((s) => ({ coinFx: [...s.coinFx.slice(-2), { id, amount, label }] }));
  window.setTimeout(() => set((s) => ({ coinFx: s.coinFx.filter((f) => f.id !== id) })), 2400);
}
/** 서버 알림(산책·멍글런너·모임 보상) */
export function onCoinEarned(e: CoinEarned) {
  showCoinFx(e.amount, e.label);
  set((s) => ({ coins: s.coins ? { ...s.coins, balance: e.balance, todayEarned: s.coins.todayEarned + e.amount } : s.coins }));
  void loadCoins();
}

const compact = (n: number) => (n >= 100000 ? `${Math.floor(n / 10000)}만` : n >= 10000 ? `${(n / 10000).toFixed(1)}만` : coinFmt(n));

/** 한국 날짜 (YYYY-MM-DD) */
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
/**
 * 매일 출석 자동 지급: 그날(한국 시간 자정 기준) 처음 들어오면 서버에 출석 요청 → +100 멍글코인 안내.
 * 서버가 계정·날짜별로 한 번만 기록하므로 새로고침·재로그인·여러 탭에서도 중복 지급되지 않는다.
 * 앱을 켜 둔 채 자정이 지나면 화면으로 돌아올 때 다시 확인한다. (둘러보기 방문자는 제외)
 */
export function useAutoAttendance() {
  const me = useStore((s) => s.me);
  useEffect(() => {
    if (!me || me.role === 'guest' || DEMO) return;
    let done = '';
    let alive = true;
    const run = async () => {
      const day = kstToday();
      if (done === day || !alive) return;
      done = day;
      try {
        const r = await api<{ streak: number; got: CoinEarned[]; coins: CoinStatus }>('/api/coins/attendance', { body: {} });
        set({ coins: r.coins });
        r.got.forEach((g, i) => window.setTimeout(() => showCoinFx(g.amount, g.kind === 'attendance' ? `출석 완료 · ${g.label}` : g.label), 600 + i * 900));
        toast(`📅 출석 완료! +${r.got[0]?.amount ?? 100} 멍글코인`);
      } catch (e) {
        const c = e instanceof ApiError ? (e.data?.coins as CoinStatus | undefined) : undefined;
        if (c) set({ coins: c }); // 이미 출석함(409) — 조용히 넘어감
        else done = ''; // 네트워크 오류 → 다음에 다시 시도
      }
    };
    void run();
    const vis = () => { if (!document.hidden) void run(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; document.removeEventListener('visibilitychange', vis); };
  }, [me?.id, me?.role]);
}

/** 상단 코인 칩: 잔액 + 오늘 출석 전이면 빨간 점 (큰 버튼을 늘리지 않음) */
export function CoinChip() {
  const coins = useStore((s) => s.coins);
  const me = useStore((s) => s.me);
  useEffect(() => { void loadCoins(); }, [me?.id]);
  if (!me || me.role === 'guest') return null;
  const dot = coins && !coins.attendance.claimedToday;
  return (
    <button className="hud h-[38px] md:h-11 pl-2 pr-3 rounded-full shrink-0 relative pointer-events-auto whitespace-nowrap text-[14px] flex items-center gap-1.5" data-testid="coin-chip"
      aria-label={`코인 ${coins ? coinFmt(coins.balance) : ''}개 · 출석 체크와 코인 지갑`} onClick={() => set({ wallet: dot ? 'attendance' : 'wallet' })}>
      {/* 코인은 고유 그림 유지 (라인 아이콘으로 바꾸지 않음) */}
      <span aria-hidden className="w-[19px] h-[19px] rounded-full bg-[radial-gradient(circle_at_35%_30%,#FFE08A,#F2B83B_70%)] border-[1.5px] border-[#E2A132] shadow-[inset_0_-1px_0_rgba(0,0,0,.08)]" />
      <span className="tabular-nums">{coins ? compact(coins.balance) : '…'}</span>
      {dot && <span className="dot-new" aria-label="오늘 출석 전" style={{ top: 2, right: 2 }} />}
    </button>
  );
}

/** 코인 획득 애니메이션: 동전이 톡톡 튀어 오르며 +금액 */
export function CoinFx() {
  const fx = useStore((s) => s.coinFx);
  if (!fx.length) return null;
  return (
    <div className="fixed inset-x-0 top-[18%] z-[60] flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
      {fx.map((f) => (
        <div key={f.id} className="coin-fx relative">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="coin-burst" style={{ ['--i' as string]: i }}>🪙</span>)}
          <div className="panel !rounded-full px-5 py-2 flex items-center gap-2 shadow-lg">
            <span className="text-2xl coin-spin">🪙</span>
            <span className={`font-display text-2xl tabular-nums ${f.amount > 0 ? 'text-[#e2a21c]' : 'text-[#6d84a3]'}`}>{f.amount > 0 ? '+' : ''}{coinFmt(f.amount)}</span>
            <span className="text-sm text-cocoa-soft">{f.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const timeLabel = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function TxRow({ t }: { t: CoinTx }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-[#f6ebe0] last:border-0">
      <span className="w-8 h-8 rounded-full bg-cream-2 grid place-items-center">{COIN_ICON[t.kind] ?? '🪙'}</span>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-sm truncate">{t.memo}</div>
        <div className="text-[11px] text-cocoa-soft">{timeLabel(t.ts)} · 잔액 {coinFmt(t.balance)}</div>
      </div>
      <span className={`font-display tabular-nums ${t.amount > 0 ? 'text-[#e2a21c]' : 'text-[#6d84a3]'}`}>{t.amount > 0 ? '+' : ''}{coinFmt(t.amount)}</span>
    </div>
  );
}

/** 출석 체크 + 코인 지갑 (탭) */
export function WalletModal() {
  const tab = useStore((s) => s.wallet);
  const coins = useStore((s) => s.coins);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<'earned' | 'spent'>('earned');
  useEffect(() => { if (tab) void loadCoins(); }, [tab]);
  if (!tab) return null;
  const close = () => set({ wallet: null });
  async function attend() {
    setBusy(true);
    try {
      const r = await api<{ streak: number; got: CoinEarned[]; coins: CoinStatus }>('/api/coins/attendance', { body: {} });
      set({ coins: r.coins });
      r.got.forEach((g, i) => window.setTimeout(() => showCoinFx(g.amount, g.label), i * 700));
    } catch (e) {
      const c = e instanceof ApiError ? (e.data?.coins as CoinStatus | undefined) : undefined;
      if (c) set({ coins: c });
      toast((e as Error).message, 'error');
    } finally { setBusy(false); }
  }
  const a = coins?.attendance;
  const nextDay = a ? (a.claimedToday ? a.cycleDone : a.cycleDone + 1) : 1;
  return (
    <Modal onClose={close} className="max-w-[420px] p-4">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-display text-xl flex-1">🪙 멍글 코인</h2>
        <button className="btn btn-ghost w-10 h-10" onClick={close} aria-label="닫기">✕</button>
      </div>
      <div className="grid grid-cols-2 gap-1 bg-cream-2 rounded-full p-1 text-sm" role="tablist">
        {([['attendance', '📅 출석 체크'], ['wallet', '👛 코인 지갑']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn py-1.5 ${tab === k ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => set({ wallet: k })}>{l}</button>
        ))}
      </div>
      {DEMO && <p className="mt-2 rounded-xl bg-[#eef5fb] text-[#4b6a86] px-3 py-1.5 text-[11px]">미리보기 코인은 이 기기에만 저장돼요. 실제 코인은 게임 서버에서 지급·기록돼요.</p>}
      {!coins ? <p className="text-center text-cocoa-soft py-8">불러오는 중…</p> : tab === 'attendance' ? (
        <div className="mt-3" data-testid="attendance">
          <div className="text-center">
            <div className="text-sm text-cocoa-soft">매일 출석하면 <b className="text-[#e2a21c]">{COIN_REWARDS.attendance.amount}코인</b> · 7일 연속이면 <b className="text-[#e2a21c]">+{COIN_REWARDS.streak7.amount}</b></div>
            <div className="font-display text-lg mt-1">🔥 연속 출석 <span className="text-[#e2604f]" data-testid="streak">{a!.streak}</span>일</div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 mt-3">
            {Array.from({ length: 7 }, (_, i) => {
              const day = i + 1;
              const done = day <= a!.cycleDone;
              const today = day === nextDay;
              return (
                <div key={day} className={`rounded-2xl py-2 text-center border-2 ${done ? 'bg-[#fde3d6] border-[#f6b9a0]' : today ? 'bg-white border-[#f39a7b] border-dashed' : 'bg-cream-2 border-transparent'}`}>
                  <div className="text-[10px] text-cocoa-soft">{day}일</div>
                  <div className={`text-xl leading-tight ${done ? 'stamp' : ''}`}>{done ? '🐾' : day === 7 ? '🎁' : '🪙'}</div>
                  <div className="text-[10px] font-display text-[#e2a21c]">{day === 7 ? '+400' : '+100'}</div>
                </div>
              );
            })}
          </div>
          <button className="btn btn-coral w-full py-3.5 text-lg mt-4" data-testid="attend-btn" disabled={busy || a!.claimedToday} onClick={() => void attend()}>
            {a!.claimedToday ? '✅ 오늘 출석 완료! 내일 또 만나요' : busy ? '도장 찍는 중…' : `🐾 출석하고 ${nextDay === 7 ? 400 : 100}코인 받기`}
          </button>
          <p className="text-[11px] text-cocoa-soft text-center mt-2">한국 시간 자정에 날짜가 바뀌어요. 하루를 건너뛰면 1일부터 다시 시작해요.</p>
        </div>
      ) : (
        <div className="mt-3" data-testid="wallet">
          <div className="rounded-3xl bg-[linear-gradient(135deg,#fff4cf,#fde3d6)] p-4 text-center">
            <div className="text-xs text-cocoa-soft">보유 코인</div>
            <div className="font-display text-4xl text-[#e2a21c] tabular-nums" data-testid="wallet-balance">🪙 {coinFmt(coins.balance)}</div>
            <div className="text-sm mt-0.5">오늘 받은 코인 <b className="tabular-nums">+{coinFmt(coins.todayEarned)}</b></div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 mt-2 text-center text-[11px]">
            {([['walk', '🐾 산책', `${WALK_GOAL.meters}m 걷기`], ['runner', '🏃 멍글런너', '완주'], ['meetup', '👥 동네 모임', '온라인 모임 5분']] as const).map(([k, l, how]) => (
              <div key={k} className="rounded-xl bg-cream-2 py-1.5">
                <div className="font-display text-xs">{l}</div>
                <div className="tabular-nums">{coins.daily[k].count}/{coins.daily[k].max} · +{COIN_REWARDS[k].amount}</div>
                <div className="text-cocoa-soft">{how}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 bg-cream-2 rounded-full p-1 text-xs mt-3">
            <button className={`btn py-1 ${list === 'earned' ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setList('earned')}>받은 내역</button>
            <button className={`btn py-1 ${list === 'spent' ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setList('spent')}>사용 내역</button>
          </div>
          <div className="mt-1 max-h-[34vh] overflow-y-auto scroll-soft">
            {(list === 'earned' ? coins.earned : coins.spent).map((t) => <TxRow key={t.id} t={t} />)}
            {!(list === 'earned' ? coins.earned : coins.spent).length && <p className="text-center text-sm text-cocoa-soft py-5">{list === 'earned' ? '아직 받은 코인이 없어요.' : '아직 사용한 코인이 없어요.'}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
