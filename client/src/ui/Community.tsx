// 멍글 동네 — 산책 모임 · 강아지 모임 · 강아지 자랑 (3개 탭)
// 열려 있는 동안 조이스틱·액션 버튼을 숨기고 이동 입력을 잠근다 (Game.tsx / setMoveLocked).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { get, set, toast, useStore, type CommunityTab } from '../store';
import { api } from '../lib/api';
import { resizeImage } from '../lib/image';
import { setMoveLocked } from '../game/input';
import { joinPark, openProfile } from '../net/socket';
import { DEMO } from '../demo';
import { PARKS } from '@shared/protocol';
import { FEATURES } from '@shared/features';
import { residenceLabel } from '@shared/apartment';
import {
  CLUB_CATEGORIES, COMMENT_MAX_LEN, POST_MAX_LEN, SIDO, SIZE_RULES, TEMPER_RULES,
  type AuthorSummary, type ClubDetail, type ClubView, type CommentView, type MeetupDetail, type MeetupMessage, type MeetupView, type PostView,
} from '@shared/community';
import { backdropClose } from './common';

const TABS: { id: CommunityTab; icon: string; label: string }[] = [
  { id: 'meetups', icon: '🐾', label: '산책 모임' },
  // 강아지 모임은 초기 서비스에서 숨김 (FEATURES.dogClubs) — 데이터·서버는 그대로
  ...(FEATURES.dogClubs ? [{ id: 'clubs' as const, icon: '🐶', label: '강아지 모임' }] : []),
  { id: 'posts', icon: '📸', label: '강아지 자랑' },
];

export const openCommunity = (tab: CommunityTab = 'meetups', extra: { meetupId?: number; clubId?: number } = {}) =>
  set({ community: { tab: tab === 'clubs' && !FEATURES.dogClubs ? 'meetups' : tab, ...extra }, panel: 'none', benchMenu: null, chatOpen: false });
const closeCommunity = () => set({ community: null });
const nav = (patch: Partial<NonNullable<ReturnType<typeof get>['community']>>) => set((s) => ({ community: s.community ? { ...s.community, ...patch } : null }));

export function fmtWhen(ts: number) {
  return new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
function ago(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
}

/** 데이터 불러오기 훅: 로딩/오류/다시 불러오기 */
function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const version = useStore((s) => s.communityVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, deps);
  useEffect(() => { void load(); }, [load, version]);
  return { data, setData, error, loading, reload: load };
}

async function call<T = any>(path: string, body?: unknown, method?: string): Promise<T | null> {
  try { return await api<T>(path, { body, method }); } catch (e) { toast((e as Error).message, 'error'); return null; }
}

export function Community() {
  const view = useStore((s) => s.community)!;
  useEffect(() => { setMoveLocked(true, 'community'); return () => setMoveLocked(false, 'community'); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !get().profilePopup) closeCommunity(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="absolute inset-0 z-30 flex items-stretch md:items-center justify-center md:p-6 bg-[#5a403322]" {...backdropClose(closeCommunity)}>
      <section aria-label="멍글 동네" className="panel !rounded-none md:!rounded-[26px] w-full md:max-w-[760px] h-full md:h-[min(88vh,820px)] flex flex-col pop !bg-[#fffaf4]"
        style={{ paddingTop: 'var(--safe-t)', paddingBottom: 'var(--safe-b)' }}>
        <header className="flex items-center gap-2 px-4 pt-3 pb-2">
          <span className="text-2xl" aria-hidden>🏘️</span>
          <h2 className="font-display text-2xl flex-1">멍글 동네</h2>
          <button className="btn btn-ghost w-11 h-11 text-lg" onClick={closeCommunity} aria-label="멍글 동네 닫기">✕</button>
        </header>
        <nav className={`px-3 pb-2 grid ${TABS.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5`} role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={view.tab === t.id}
              onClick={() => set({ community: { tab: t.id } })}
              className={`min-h-[46px] rounded-2xl font-display text-[15px] flex items-center justify-center gap-1.5 transition ${view.tab === t.id ? 'bg-peach text-white shadow-[0_3px_0_var(--color-peach-deep)]' : 'bg-white text-cocoa shadow-[0_3px_0_#ecdccc]'}`}>
              <span aria-hidden>{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>
        {DEMO && <p className="mx-4 mb-1 text-xs bg-cream-2 rounded-xl px-3 py-1.5 text-cocoa-soft">👀 미리보기에서는 이 기기에서 나 혼자만 보여요. 실제 서버 주소에서는 동네 사람들과 함께 쓸 수 있어요.</p>}
        <div className="flex-1 min-h-0 overflow-y-auto scroll-soft px-3 md:px-4 pb-4">
          {view.tab === 'meetups' && (view.meetupId ? <MeetupDetailView id={view.meetupId} /> : view.compose ? <MeetupForm /> : <MeetupList />)}
          {view.tab === 'clubs' && FEATURES.dogClubs && (view.clubId ? <ClubDetailView id={view.clubId} /> : view.compose ? <ClubForm /> : <ClubList />)}
          {view.tab === 'posts' && <PostsTab />}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- 공용
function Author({ a, sub }: { a: AuthorSummary; sub?: ReactNode }) {
  return (
    <button className="flex items-center gap-2 min-w-0 text-left" onClick={() => void openProfile(a.id)} title="프로필 보기">
      {a.dogPhoto
        ? <img src={a.dogPhoto} alt="" className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm shrink-0" />
        : <span className="w-10 h-10 rounded-full grid place-items-center border-2 border-white shadow-sm shrink-0 text-lg" style={{ background: a.dogCoat }}>🐶</span>}
      <span className="min-w-0">
        <span className="block font-display text-[15px] leading-tight truncate">{a.nickname} <span className="text-cocoa-soft text-xs">· 🐶 {a.dogName}</span></span>
        <span className="block text-[11px] text-cocoa-soft truncate">{sub}{a.residence ? `${sub ? ' · ' : ''}🏢 ${residenceLabel(a.residence)}` : ''}</span>
      </span>
    </button>
  );
}
const Chip = ({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) => (
  <button onClick={onClick} className={`shrink-0 rounded-full px-3 min-h-[36px] text-sm border-2 ${on ? 'bg-peach-soft border-peach text-cocoa' : 'bg-white border-[#f1e2d2] text-cocoa-soft'}`}>{children}</button>
);
const Empty = ({ icon, children }: { icon: string; children: ReactNode }) => (
  <div className="text-center text-cocoa-soft py-10"><div className="text-4xl mb-2">{icon}</div><div className="text-sm">{children}</div></div>
);
const Back = ({ onClick, label = '목록으로' }: { onClick: () => void; label?: string }) => (
  <button className="btn btn-ghost px-4 min-h-[40px] text-sm mb-3" onClick={onClick}>← {label}</button>
);
const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block mb-3"><span className="block text-sm font-display mb-1">{label}</span>{children}{hint && <span className="block text-[11px] text-cocoa-soft mt-1">{hint}</span>}</label>
);
function Loading({ error, loading, reload }: { error: string | null; loading: boolean; reload: () => void }) {
  if (error) return <div className="text-center py-8 text-sm text-[#c4553a]">{error}<div><button className="btn btn-ghost px-4 py-2 mt-2" onClick={reload}>다시 시도</button></div></div>;
  if (loading) return <div className="text-center py-8 text-sm text-cocoa-soft">불러오는 중…</div>;
  return null;
}

// ---------------------------------------------------------------- 산책 모임
const sizeLabel = (id: string) => SIZE_RULES.find((x) => x.id === id)?.label ?? '';
const temperLabel = (id: string) => TEMPER_RULES.find((x) => x.id === id)?.label ?? '';
const STATUS_LABEL: Record<string, string> = { approved: '참가 확정', pending: '승인 대기', rejected: '참가 불가', none: '' };

function MeetupList() {
  const [scope, setScope] = useState<'upcoming' | 'mine' | 'past'>('upcoming');
  const [region, setRegion] = useState('');
  const { data, error, loading, reload } = useLoad(
    () => api<{ meetups: MeetupView[] }>(`/api/meetups?scope=${scope}&region=${encodeURIComponent(region)}`).then((r) => r.meetups), [scope, region]);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm text-cocoa-soft flex-1">동네 친구들과 함께 걸어요. 오프라인 산책은 <b>동네 단위</b>로만 표시돼요.</p>
        <button className="btn btn-peach px-4 min-h-[44px] text-sm shrink-0" onClick={() => nav({ compose: true })}>＋ 모임 만들기</button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 scroll-soft">
        <Chip on={scope === 'upcoming'} onClick={() => setScope('upcoming')}>다가오는 모임</Chip>
        <Chip on={scope === 'mine'} onClick={() => setScope('mine')}>내 모임</Chip>
        <Chip on={scope === 'past'} onClick={() => setScope('past')}>지난 모임·후기</Chip>
        <select className="field !w-auto !py-1.5 !rounded-full text-sm shrink-0" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="지역">
          <option value="">전체 지역</option>
          <option value="온라인">💻 온라인 (멍글마을)</option>
          {SIDO.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <Loading error={error} loading={loading && !data} reload={reload} />
      {data && !data.length && <Empty icon="🐾">{scope === 'mine' ? '참가한 모임이 아직 없어요.' : '아직 열린 모임이 없어요. 첫 모임을 만들어 보세요!'}</Empty>}
      <div className="grid gap-2">
        {data?.map((m) => <MeetupCard key={m.id} m={m} />)}
      </div>
    </div>
  );
}

function MeetupCard({ m }: { m: MeetupView }) {
  const full = m.approvedCount >= m.capacity;
  return (
    <button className="panel !rounded-2xl p-3 text-left w-full hover:bg-white" onClick={() => nav({ meetupId: m.id })}>
      <div className="flex items-center gap-2 text-[11px] mb-1">
        <span className={`rounded-full px-2 py-0.5 font-display ${m.kind === 'online' ? 'bg-sage-soft text-sage-deep' : 'bg-peach-soft text-peach-deep'}`}>{m.kind === 'online' ? '💻 온라인' : '🌳 오프라인'}</span>
        <span className="text-cocoa-soft truncate">📍 {m.region}</span>
        {m.status === 'cancelled' && <span className="rounded-full px-2 py-0.5 bg-[#fff0ec] text-[#c4553a]">취소됨</span>}
        {m.myStatus !== 'none' && <span className="ml-auto rounded-full px-2 py-0.5 bg-cream-2">{m.isHost ? '👑 내가 만든 모임' : STATUS_LABEL[m.myStatus]}</span>}
      </div>
      <div className="font-display text-lg leading-tight">{m.title}</div>
      <div className="text-sm text-cocoa-soft mt-0.5">🗓️ {fmtWhen(m.startsAt)} · {m.place}</div>
      <div className="flex items-center gap-2 text-xs text-cocoa-soft mt-1.5">
        <span>👥 {m.approvedCount}/{m.capacity}{full ? ' (마감)' : ''}</span>
        {m.sizeRule !== 'any' && <span>· {sizeLabel(m.sizeRule)}</span>}
        {m.temperRule !== 'any' && <span>· {temperLabel(m.temperRule)}</span>}
        {m.reviewCount > 0 && <span>· ⭐ {m.avgRating} ({m.reviewCount})</span>}
        <span className="ml-auto truncate">모임장 {m.host.nickname}</span>
      </div>
    </button>
  );
}

function defaultStart() {
  const d = new Date(Date.now() + 86400_000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MeetupForm() {
  const me = useStore((s) => s.me)!;
  const [f, setF] = useState({
    title: '', intro: '', kind: 'offline' as 'offline' | 'online', sido: '', dong: '', place: '', park: PARKS[0].id,
    when: defaultStart(), capacity: 6, sizeRule: 'any', temperRule: 'any', approval: 'auto',
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ region: string }>('/api/me/region').then((r) => {
      const [sido, ...rest] = (r.region || '').split(' ');
      if ((SIDO as readonly string[]).includes(sido)) setF((x) => ({ ...x, sido, dong: rest.join(' ') }));
    }).catch(() => {});
  }, []);
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function submit() {
    const startsAt = new Date(f.when).getTime();
    if (!f.title.trim()) return toast('모임 이름을 입력해 주세요.', 'error');
    if (!Number.isFinite(startsAt)) return toast('날짜와 시간을 골라 주세요.', 'error');
    setBusy(true);
    if (f.kind === 'offline' && f.sido) void api('/api/me/region', { method: 'PUT', body: { sido: f.sido, dong: f.dong } }).catch(() => {});
    const r = await call<{ meetup: MeetupView }>('/api/meetups', { ...f, startsAt, capacity: Number(f.capacity) });
    setBusy(false);
    if (r) { toast('🐾 모임을 만들었어요!'); nav({ compose: false, meetupId: r.meetup.id }); }
  }
  return (
    <div>
      <Back onClick={() => nav({ compose: false })} />
      <h3 className="font-display text-xl mb-3">새 산책 모임</h3>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {(['offline', 'online'] as const).map((k) => (
          <button key={k} onClick={() => up({ kind: k })} className={`rounded-2xl p-3 text-left border-2 ${f.kind === k ? 'border-peach bg-peach-soft' : 'border-[#f1e2d2] bg-white'}`}>
            <div className="font-display">{k === 'offline' ? '🌳 오프라인 산책' : '💻 온라인 모임'}</div>
            <div className="text-[11px] text-cocoa-soft">{k === 'offline' ? '우리 동네에서 실제로 만나요' : '멍글마을 공원에서 아바타로 만나요'}</div>
          </button>
        ))}
      </div>
      <Field label="모임 이름"><input className="field" maxLength={30} value={f.title} onChange={(e) => up({ title: e.target.value })} placeholder="예) 토요일 아침 한강 산책" /></Field>
      <Field label="소개"><textarea className="field min-h-[72px]" maxLength={300} value={f.intro} onChange={(e) => up({ intro: e.target.value })} placeholder="코스, 준비물, 분위기 등을 알려 주세요" /></Field>
      {f.kind === 'offline' ? <>
        <div className="grid grid-cols-2 gap-2">
          <Field label="동네 (시·도)">
            <select className="field" value={f.sido} onChange={(e) => up({ sido: e.target.value })}>
              <option value="">선택</option>{SIDO.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="구·동 (선택)"><input className="field" maxLength={12} value={f.dong} onChange={(e) => up({ dong: e.target.value })} placeholder="예) 마포구" /></Field>
        </div>
        <Field label="모이는 곳" hint="🔒 집 주소 대신 공원·산책로 입구처럼 누구나 아는 공개 장소를 적어 주세요. 실시간 위치는 공유되지 않아요.">
          <input className="field" maxLength={40} value={f.place} onChange={(e) => up({ place: e.target.value })} placeholder="예) 망원한강공원 2번 출입구" />
        </Field>
      </> : (
        <Field label="만날 공원" hint="모임 시간에 이 공원 분수대 앞으로 모여요. 시작 전에 참가자에게 알림이 가요.">
          <select className="field" value={f.park} onChange={(e) => up({ park: e.target.value })}>{PARKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </Field>
      )}
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <Field label="날짜·시간"><input type="datetime-local" className="field" value={f.when} onChange={(e) => up({ when: e.target.value })} /></Field>
        <Field label="정원"><input type="number" min={2} max={30} className="field" value={f.capacity} onChange={(e) => up({ capacity: Number(e.target.value) })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="강아지 크기"><select className="field" value={f.sizeRule} onChange={(e) => up({ sizeRule: e.target.value })}>{SIZE_RULES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        <Field label="강아지 성향"><select className="field" value={f.temperRule} onChange={(e) => up({ temperRule: e.target.value })}>{TEMPER_RULES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
      </div>
      <Field label="참가 방식">
        <div className="grid grid-cols-2 gap-2">
          <Chip on={f.approval === 'auto'} onClick={() => up({ approval: 'auto' })}>바로 참가</Chip>
          <Chip on={f.approval === 'manual'} onClick={() => up({ approval: 'manual' })}>모임장 승인 후 참가</Chip>
        </div>
      </Field>
      <p className="text-xs text-cocoa-soft mb-3">모임장: {me.nickname} · 🐶 {me.dogName}</p>
      <button disabled={busy} className="btn btn-peach w-full min-h-[48px]" onClick={submit}>{busy ? '만드는 중…' : '모임 만들기'}</button>
    </div>
  );
}

function MeetupDetailView({ id }: { id: number }) {
  const { data: m, setData, error, loading, reload } = useLoad(() => api<{ meetup: MeetupDetail }>(`/api/meetups/${id}`).then((r) => r.meetup), [id]);
  const [busy, setBusy] = useState(false);
  if (!m) return <><Back onClick={() => nav({ meetupId: undefined })} /><Loading error={error} loading={loading} reload={reload} /></>;
  const act = async (path: string, body: object = {}, ask?: string) => {
    if (ask && !confirm(ask)) return;
    setBusy(true);
    const r = await call<{ meetup: MeetupDetail }>(`/api/meetups/${m.id}/${path}`, body);
    setBusy(false);
    if (r) setData(r.meetup);
  };
  const started = m.startsAt <= Date.now();
  const full = m.approvedCount >= m.capacity;
  const pending = m.members.filter((x) => x.status === 'pending');
  const approved = m.members.filter((x) => x.status === 'approved');
  return (
    <div>
      <Back onClick={() => nav({ meetupId: undefined })} />
      <div className="panel !rounded-2xl p-4">
        <div className="flex items-center gap-2 text-xs mb-1">
          <span className={`rounded-full px-2 py-0.5 font-display ${m.kind === 'online' ? 'bg-sage-soft text-sage-deep' : 'bg-peach-soft text-peach-deep'}`}>{m.kind === 'online' ? '💻 온라인 모임' : '🌳 오프라인 산책'}</span>
          {m.status === 'cancelled' && <span className="rounded-full px-2 py-0.5 bg-[#fff0ec] text-[#c4553a]">취소된 모임</span>}
          {m.myStatus !== 'none' && !m.isHost && <span className="rounded-full px-2 py-0.5 bg-cream-2">{STATUS_LABEL[m.myStatus]}</span>}
        </div>
        <h3 className="font-display text-2xl leading-tight">{m.title}</h3>
        {m.intro && <p className="text-sm mt-2 whitespace-pre-wrap">{m.intro}</p>}
        <dl className="text-sm mt-3 grid grid-cols-[64px_1fr] gap-y-1">
          <dt className="text-cocoa-soft">일시</dt><dd>{fmtWhen(m.startsAt)}</dd>
          <dt className="text-cocoa-soft">동네</dt><dd>{m.region}</dd>
          <dt className="text-cocoa-soft">장소</dt><dd>{m.place}</dd>
          <dt className="text-cocoa-soft">정원</dt><dd>{m.approvedCount}/{m.capacity}명 · {m.approval === 'manual' ? '모임장 승인' : '바로 참가'}</dd>
          <dt className="text-cocoa-soft">조건</dt><dd>{sizeLabel(m.sizeRule)} · {temperLabel(m.temperRule)}</dd>
        </dl>
        <div className="mt-3"><Author a={m.host} sub="👑 모임장" /></div>
        <div className="mt-4 flex flex-wrap gap-2">
          {m.status === 'open' && !started && !m.isHost && (m.myStatus === 'none'
            ? <button disabled={busy || full} className="btn btn-peach px-5 min-h-[46px]" onClick={() => act('join')}>{full ? '정원 마감' : m.approval === 'manual' ? '참가 신청' : '참가하기'}</button>
            : m.myStatus === 'rejected' ? null
            : <button disabled={busy} className="btn btn-ghost px-5 min-h-[46px]" onClick={() => act('leave', {}, '참가를 취소할까요?')}>{m.myStatus === 'pending' ? '신청 취소' : '참가 취소'}</button>)}
          {m.isHost && m.status === 'open' && !started && <button disabled={busy} className="btn btn-ghost px-5 min-h-[46px] text-[#c4553a]" onClick={() => act('cancel', {}, '모임을 취소할까요? 참가자에게 알림이 가요.')}>모임 취소</button>}
          {m.kind === 'online' && m.park && m.myStatus === 'approved' && m.status === 'open' && (
            <button className="btn btn-sage px-5 min-h-[46px]" onClick={async () => { if (await joinPark(m.park!)) set({ community: null }); }}>🌳 {PARKS.find((p) => p.id === m.park)?.name}으로 가기</button>
          )}
        </div>
      </div>

      {m.isHost && pending.length > 0 && (
        <section className="mt-3">
          <h4 className="font-display mb-1.5">참가 신청 {pending.length}</h4>
          <div className="grid gap-1.5">
            {pending.map((x) => (
              <div key={x.user.id} className="panel !rounded-2xl p-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0"><Author a={x.user} /></div>
                <button disabled={busy} className="btn btn-peach px-3 min-h-[40px] text-sm" onClick={() => act(`members/${x.user.id}`, { approve: true })}>승인</button>
                <button disabled={busy} className="btn btn-ghost px-3 min-h-[40px] text-sm" onClick={() => act(`members/${x.user.id}`, { approve: false })}>거절</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-3">
        <h4 className="font-display mb-1.5">참가자 {approved.length}</h4>
        <div className="flex flex-wrap gap-2">
          {approved.map((x) => <div key={x.user.id} className="panel !rounded-2xl px-2.5 py-1.5"><Author a={x.user} sub={x.isHost ? '👑 모임장' : undefined} /></div>)}
        </div>
      </section>

      {m.myStatus === 'approved' && m.status === 'open' && <MeetupChat id={m.id} />}
      {m.myStatus !== 'approved' && <p className="mt-3 text-xs text-cocoa-soft bg-cream-2 rounded-xl px-3 py-2">🔒 모임 채팅방은 참가가 확정된 멤버만 볼 수 있어요.</p>}

      <MeetupReviews m={m} onChange={setData} started={started} />
    </div>
  );
}

function MeetupChat({ id }: { id: number }) {
  const me = useStore((s) => s.me)!;
  const live = useStore((s) => s.meetupLive);
  const [msgs, setMsgs] = useState<MeetupMessage[] | null>(null);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    set({ meetupLive: [] });
    api<{ messages: MeetupMessage[] }>(`/api/meetups/${id}/messages`).then((r) => setMsgs(r.messages)).catch((e) => toast((e as Error).message, 'error'));
  }, [id]);
  const all = [...(msgs ?? []), ...live.filter((l) => l.meetupId === id && !(msgs ?? []).some((m) => m.id === l.message.id)).map((l) => l.message)];
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [all.length]);
  async function send() {
    const t = text.trim();
    if (!t) return;
    const r = await call<{ message: MeetupMessage }>(`/api/meetups/${id}/messages`, { text: t });
    if (r) { setMsgs((x) => [...(x ?? []), r.message]); setText(''); }
  }
  return (
    <section className="mt-3">
      <h4 className="font-display mb-1.5">💬 모임 채팅방</h4>
      <div ref={box} className="panel !rounded-2xl p-2.5 h-56 overflow-y-auto scroll-soft text-sm">
        {msgs === null ? <p className="text-cocoa-soft text-center py-6">불러오는 중…</p>
          : !all.length ? <p className="text-cocoa-soft text-center py-6">첫 인사를 남겨 보세요 🐾</p>
          : all.map((m) => (
            <div key={m.id} className={`mb-1.5 flex ${m.user.id === me.id ? 'justify-end' : ''}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 ${m.user.id === me.id ? 'bg-peach-soft' : 'bg-white'}`}>
                {m.user.id !== me.id && <div className="text-[11px] font-display text-cocoa-soft">{m.user.nickname}</div>}
                <div className="break-words">{m.text}</div>
              </div>
            </div>
          ))}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="field flex-1" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="모임 멤버에게 메시지" enterKeyHint="send" />
        <button className="btn btn-peach px-4 min-h-[44px]">보내기</button>
      </form>
    </section>
  );
}

function MeetupReviews({ m, onChange, started }: { m: MeetupDetail; onChange: (m: MeetupDetail) => void; started: boolean }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const canWrite = started && m.myStatus === 'approved' && !m.myReview && m.status === 'open';
  if (!canWrite && !m.reviews.length) return null;
  return (
    <section className="mt-4">
      <h4 className="font-display mb-1.5">⭐ 모임 후기 {m.reviews.length > 0 && <span className="text-sm text-cocoa-soft">평균 {m.avgRating}</span>}</h4>
      {canWrite && (
        <div className="panel !rounded-2xl p-3 mb-2">
          <div className="flex gap-1 mb-2" role="radiogroup" aria-label="별점">
            {[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rating === n} className="text-2xl" onClick={() => setRating(n)}>{n <= rating ? '⭐' : '☆'}</button>)}
          </div>
          <textarea className="field min-h-[60px]" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="함께한 산책은 어땠나요?" />
          <button className="btn btn-peach px-5 min-h-[44px] mt-2" onClick={async () => {
            const r = await call<{ meetup: MeetupDetail }>(`/api/meetups/${m.id}/reviews`, { rating, text });
            if (r) { onChange(r.meetup); toast('후기를 남겼어요'); }
          }}>후기 남기기</button>
        </div>
      )}
      <div className="grid gap-1.5">
        {m.reviews.map((r) => (
          <div key={r.user.id} className="panel !rounded-2xl p-2.5">
            <div className="flex items-center gap-2"><div className="flex-1 min-w-0"><Author a={r.user} /></div><span>{'⭐'.repeat(r.rating)}</span></div>
            {r.text && <p className="text-sm mt-1">{r.text}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 강아지 모임
function ClubList() {
  const [cat, setCat] = useState<string>('');
  const [mine, setMine] = useState(false);
  const { data, error, loading, reload } = useLoad(
    () => api<{ clubs: ClubView[] }>(`/api/clubs?${mine ? 'scope=mine' : `category=${cat}`}`).then((r) => r.clubs), [cat, mine]);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm text-cocoa-soft flex-1">견종·크기·동네·관심사가 같은 보호자들의 모임이에요.</p>
        <button className="btn btn-peach px-4 min-h-[44px] text-sm shrink-0" onClick={() => nav({ compose: true })}>＋ 모임 만들기</button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 scroll-soft">
        <Chip on={!mine && !cat} onClick={() => { setMine(false); setCat(''); }}>전체</Chip>
        <Chip on={mine} onClick={() => setMine(true)}>내 모임</Chip>
        {CLUB_CATEGORIES.map((c) => <Chip key={c.id} on={!mine && cat === c.id} onClick={() => { setMine(false); setCat(c.id); }}>{c.label}</Chip>)}
      </div>
      <Loading error={error} loading={loading && !data} reload={reload} />
      {data && !data.length && <Empty icon="🐶">{mine ? '가입한 모임이 없어요.' : '이 종류의 모임이 아직 없어요. 처음 만들어 보세요!'}</Empty>}
      <div className="grid sm:grid-cols-2 gap-2">
        {data?.map((c) => (
          <button key={c.id} className="panel !rounded-2xl p-3 text-left hover:bg-white" onClick={() => nav({ clubId: c.id })}>
            <div className="flex items-center gap-1.5 text-[11px] mb-0.5">
              <span className="rounded-full px-2 py-0.5 bg-sage-soft text-sage-deep font-display">{CLUB_CATEGORIES.find((x) => x.id === c.category)?.label}</span>
              {c.official && <span className="rounded-full px-2 py-0.5 bg-cream-2">멍글 기본 모임</span>}
              {c.isMember && <span className="ml-auto rounded-full px-2 py-0.5 bg-peach-soft">{c.isOwner ? '👑 모임장' : '가입함'}</span>}
            </div>
            <div className="font-display text-lg leading-tight">{c.name}</div>
            {c.intro && <div className="text-sm text-cocoa-soft line-clamp-2">{c.intro}</div>}
            <div className="text-xs text-cocoa-soft mt-1">👥 {c.memberCount}명 · 📝 글 {c.postCount}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ClubForm() {
  const [f, setF] = useState({ name: '', intro: '', category: 'breed' });
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Back onClick={() => nav({ compose: false })} />
      <h3 className="font-display text-xl mb-3">새 강아지 모임</h3>
      <Field label="모임 종류">
        <div className="flex flex-wrap gap-1.5">{CLUB_CATEGORIES.map((c) => <Chip key={c.id} on={f.category === c.id} onClick={() => setF({ ...f, category: c.id })}>{c.label}</Chip>)}</div>
      </Field>
      <Field label="모임 이름"><input className="field" maxLength={20} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예) 웰시코기 사랑방, 마포구 산책러" /></Field>
      <Field label="소개"><textarea className="field min-h-[72px]" maxLength={200} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} /></Field>
      <button disabled={busy} className="btn btn-peach w-full min-h-[48px]" onClick={async () => {
        setBusy(true);
        const r = await call<{ club: ClubView }>('/api/clubs', f);
        setBusy(false);
        if (r) { toast('모임을 만들었어요!'); nav({ compose: false, clubId: r.club.id }); }
      }}>{busy ? '만드는 중…' : '모임 만들기'}</button>
    </div>
  );
}

function ClubDetailView({ id }: { id: number }) {
  const { data: c, setData, error, loading, reload } = useLoad(() => api<{ club: ClubDetail }>(`/api/clubs/${id}`).then((r) => r.club), [id]);
  const [tab, setTab] = useState<'board' | 'members'>('board');
  if (!c) return <><Back onClick={() => nav({ clubId: undefined })} /><Loading error={error} loading={loading} reload={reload} /></>;
  const act = async (path: 'join' | 'leave') => {
    if (path === 'leave' && !confirm(`'${c.name}'에서 탈퇴할까요?`)) return;
    const r = await call<{ club: ClubView }>(`/api/clubs/${c.id}/${path}`, {});
    if (r) { const d = await api<{ club: ClubDetail }>(`/api/clubs/${c.id}`); setData(d.club); }
  };
  return (
    <div>
      <Back onClick={() => nav({ clubId: undefined })} />
      <div className="panel !rounded-2xl p-4">
        <div className="text-xs mb-1"><span className="rounded-full px-2 py-0.5 bg-sage-soft text-sage-deep font-display">{CLUB_CATEGORIES.find((x) => x.id === c.category)?.label}</span></div>
        <h3 className="font-display text-2xl">{c.name}</h3>
        {c.intro && <p className="text-sm mt-1">{c.intro}</p>}
        <div className="text-xs text-cocoa-soft mt-1">👥 멤버 {c.memberCount}명 · 📝 글 {c.postCount}</div>
        <div className="mt-3">
          {!c.isMember ? <button className="btn btn-peach px-5 min-h-[46px]" onClick={() => act('join')}>가입하기</button>
            : !c.isOwner && <button className="btn btn-ghost px-5 min-h-[46px]" onClick={() => act('leave')}>탈퇴하기</button>}
          {c.isOwner && <span className="text-sm text-cocoa-soft">👑 내가 만든 모임이에요</span>}
        </div>
      </div>
      <div className="flex gap-1.5 my-3">
        <Chip on={tab === 'board'} onClick={() => setTab('board')}>📝 모임 게시판</Chip>
        <Chip on={tab === 'members'} onClick={() => setTab('members')}>👥 멤버 {c.memberCount}</Chip>
      </div>
      {tab === 'members' ? (
        <div className="grid gap-1.5">
          {c.members.map((m) => <div key={m.user.id} className="panel !rounded-2xl px-3 py-2"><Author a={m.user} sub={m.role === 'owner' ? '👑 모임장' : undefined} /></div>)}
        </div>
      ) : <PostFeed key={c.id} clubId={c.id} canWrite={c.isMember} />}
    </div>
  );
}

// ---------------------------------------------------------------- 강아지 자랑
function PostsTab() {
  const [scope, setScope] = useState<'all' | 'saved' | 'mine'>('all');
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 scroll-soft">
        <Chip on={scope === 'all'} onClick={() => setScope('all')}>전체 자랑</Chip>
        <Chip on={scope === 'saved'} onClick={() => setScope('saved')}>🔖 저장한 글</Chip>
        <Chip on={scope === 'mine'} onClick={() => setScope('mine')}>✍️ 내 글</Chip>
      </div>
      <PostFeed key={scope} scope={scope} canWrite={scope !== 'saved'} />
    </div>
  );
}

function PostFeed({ scope = 'all', clubId, canWrite }: { scope?: string; clubId?: number; canWrite: boolean }) {
  const [composing, setComposing] = useState(false);
  const { data, setData, error, loading, reload } = useLoad(
    () => api<{ posts: PostView[] }>(clubId ? `/api/posts?club=${clubId}` : `/api/posts?scope=${scope}`).then((r) => r.posts), [scope, clubId]);
  const [more, setMore] = useState(true);
  async function loadMore() {
    if (!data?.length) return;
    const before = data[data.length - 1].id;
    const r = await call<{ posts: PostView[] }>(clubId ? `/api/posts?club=${clubId}&before=${before}` : `/api/posts?scope=${scope}&before=${before}`);
    if (r) { setData([...data, ...r.posts]); if (r.posts.length < 30) setMore(false); }
  }
  const update = (p: PostView | null, id: number) => setData((d) => (d ? (p ? d.map((x) => (x.id === id ? p : x)) : d.filter((x) => x.id !== id)) : d));
  return (
    <div>
      {canWrite && (composing
        ? <PostComposer clubId={clubId} onDone={(p) => { setComposing(false); if (p) setData((d) => [p, ...(d ?? [])]); }} />
        : <button className="w-full panel !rounded-2xl p-3 mb-2 flex items-center gap-2 text-left text-cocoa-soft hover:bg-white" onClick={() => setComposing(true)}>
            <span className="text-2xl">📸</span><span className="flex-1">{clubId ? '모임 게시판에 글 쓰기' : '우리 강아지 사진을 자랑해 보세요!'}</span><span className="btn btn-peach px-4 min-h-[40px] text-sm">글쓰기</span>
          </button>)}
      <Loading error={error} loading={loading && !data} reload={reload} />
      {data && !data.length && <Empty icon={clubId ? '📝' : '📸'}>{scope === 'saved' ? '저장한 글이 없어요.' : '아직 글이 없어요. 첫 글을 올려 보세요!'}</Empty>}
      <div className="grid gap-3">
        {data?.map((p) => <PostCard key={p.id} p={p} onChange={(np) => update(np, p.id)} />)}
      </div>
      {data && data.length >= 30 && more && <button className="btn btn-ghost w-full min-h-[44px] mt-3" onClick={loadMore}>더 보기</button>}
    </div>
  );
}

function PostComposer({ clubId, onDone }: { clubId?: number; onDone: (p: PostView | null) => void }) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  async function pick(f: File | undefined) {
    if (!f) return;
    try { setPhoto(await resizeImage(f, 1024)); } catch (e) { toast((e as Error).message || '사진을 읽지 못했어요.', 'error'); }
  }
  async function submit() {
    if (!clubId && !photo) return toast('강아지 사진을 골라 주세요.', 'error');
    if (!text.trim()) return toast('내용을 입력해 주세요.', 'error');
    setBusy(true);
    const r = await call<{ post: PostView }>('/api/posts', { text, photo, clubId, screenConsent: consent });
    setBusy(false);
    if (r) { toast(consent ? '글을 올렸어요! 운영자 승인 후 광장 스크린에도 나와요 📺' : '글을 올렸어요! 🐾'); onDone(r.post); }
  }
  return (
    <div className="panel !rounded-2xl p-3 mb-3">
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {photo
        ? <div className="relative mb-2"><img src={photo} alt="올릴 사진" className="w-full max-h-72 object-cover rounded-2xl" /><button className="absolute top-2 right-2 btn btn-ghost w-9 h-9" onClick={() => setPhoto(null)} aria-label="사진 빼기">✕</button></div>
        : <button className="w-full h-32 rounded-2xl border-2 border-dashed border-[#f1c9b6] bg-white grid place-items-center text-cocoa-soft mb-2" onClick={() => file.current?.click()}>
            <span><span className="text-3xl block text-center">📷</span>{clubId ? '사진 추가 (선택)' : '강아지 사진 고르기'}</span>
          </button>}
      <textarea className="field min-h-[80px]" maxLength={POST_MAX_LEN} value={text} onChange={(e) => setText(e.target.value)} placeholder={clubId ? '모임 멤버들에게 하고 싶은 이야기' : '우리 강아지 이야기를 들려주세요'} />
      <div className="text-right text-[11px] text-cocoa-soft">{text.length}/{POST_MAX_LEN}</div>
      {!clubId && photo && (
        <label className="flex items-start gap-2 text-sm mt-1 bg-cream-2 rounded-xl px-3 py-2">
          <input type="checkbox" className="mt-1 accent-[#f39a7b]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>📺 이 사진과 글을 <b>광장 대형 스크린</b>에 공개하는 데 동의해요. <span className="text-cocoa-soft text-xs">(운영자 승인 후 노출, 글을 지우면 함께 내려가요)</span></span>
        </label>
      )}
      <div className="flex gap-2 mt-2">
        <button className="btn btn-ghost px-4 min-h-[44px]" onClick={() => onDone(null)}>취소</button>
        <button disabled={busy} className="btn btn-peach flex-1 min-h-[44px]" onClick={submit}>{busy ? '올리는 중…' : '올리기'}</button>
      </div>
    </div>
  );
}

const SCREEN_BADGE: Record<string, string> = { pending: '📺 스크린 승인 대기', approved: '📺 광장 스크린 노출 중', rejected: '📺 스크린 반려', hidden: '📺 스크린 숨김' };

function PostCard({ p, onChange }: { p: PostView; onChange: (p: PostView | null) => void }) {
  const me = useStore((s) => s.me)!;
  const [showComments, setShowComments] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const toggle = async (k: 'like' | 'save') => { const r = await call<{ post: PostView }>(`/api/posts/${p.id}/${k}`, {}); if (r) onChange(r.post); };
  return (
    <article className="panel !rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 p-3 pb-2">
        <div className="flex-1 min-w-0"><Author a={p.author} sub={ago(p.ts)} /></div>
        <div className="relative">
          <button className="btn btn-ghost w-10 h-10 !shadow-none" onClick={() => setMenu(!menu)} aria-label="더 보기">⋯</button>
          {menu && (
            <div className="absolute right-0 mt-1 panel p-1.5 w-40 z-10 pop" onClick={() => setMenu(false)}>
              {p.author.id !== me.id && <button className="w-full text-left rounded-xl px-3 py-2 text-sm hover:bg-cream-2" onClick={() => void openProfile(p.author.id)}>👤 프로필·친구 신청</button>}
              {p.author.id !== me.id && p.author.residence && <button className="w-full text-left rounded-xl px-3 py-2 text-sm hover:bg-cream-2" onClick={async () => { if (await joinPark(`home-${p.author.id}`)) set({ community: null }); }}>🏠 집 놀러가기</button>}
              {p.author.id !== me.id && <button className="w-full text-left rounded-xl px-3 py-2 text-sm hover:bg-cream-2 text-[#c4553a]" onClick={() => setReporting(true)}>🚨 신고하기</button>}
              {p.canDelete && <button className="w-full text-left rounded-xl px-3 py-2 text-sm hover:bg-cream-2 text-[#c4553a]" onClick={async () => {
                if (!confirm('이 글을 지울까요? 광장 스크린에서도 함께 내려가요.')) return;
                if (await call(`/api/posts/${p.id}`, undefined, 'DELETE')) { onChange(null); toast('글을 지웠어요'); }
              }}>🗑️ 삭제</button>}
            </div>
          )}
        </div>
      </div>
      {p.image && <img src={p.image} alt={`${p.author.dogName} 사진`} className="w-full max-h-[420px] object-cover bg-cream-2" loading="lazy" onDoubleClick={() => !p.likedByMe && toggle('like')} />}
      <div className="px-3 pt-2 pb-3">
        <div className="flex items-center gap-1">
          <button className={`btn !shadow-none px-3 min-h-[40px] ${p.likedByMe ? 'bg-peach-soft' : 'bg-transparent'}`} onClick={() => toggle('like')} aria-pressed={p.likedByMe}>{p.likedByMe ? '❤️' : '🤍'} {p.likes}</button>
          <button className="btn !shadow-none bg-transparent px-3 min-h-[40px]" onClick={() => setShowComments(!showComments)}>💬 {p.comments}</button>
          <span className="flex-1" />
          <button className={`btn !shadow-none px-3 min-h-[40px] ${p.savedByMe ? 'bg-sage-soft' : 'bg-transparent'}`} onClick={() => toggle('save')} aria-pressed={p.savedByMe}>{p.savedByMe ? '🔖 저장됨' : '🔖 저장'}</button>
        </div>
        <p className="text-[15px] whitespace-pre-wrap break-words mt-1">{p.text}</p>
        {p.author.id === me.id && p.screen !== 'none' && <p className="text-[11px] text-cocoa-soft mt-1">{SCREEN_BADGE[p.screen]}</p>}
        {showComments && <Comments post={p} onCount={(n) => onChange({ ...p, comments: n })} />}
      </div>
      {reporting && <ReportPost post={p} onClose={() => setReporting(false)} />}
    </article>
  );
}

function Comments({ post, onCount }: { post: PostView; onCount: (n: number) => void }) {
  const [list, setList] = useState<CommentView[] | null>(null);
  const [text, setText] = useState('');
  useEffect(() => { api<{ comments: CommentView[] }>(`/api/posts/${post.id}/comments`).then((r) => setList(r.comments)).catch((e) => toast((e as Error).message, 'error')); }, [post.id]);
  return (
    <div className="mt-2 border-t-2 border-cream-2 pt-2">
      {list === null ? <p className="text-xs text-cocoa-soft">불러오는 중…</p> : !list.length && <p className="text-xs text-cocoa-soft">첫 댓글을 남겨 보세요</p>}
      {list?.map((c) => (
        <div key={c.id} className="flex items-start gap-2 py-1 text-sm">
          <button className="font-display shrink-0" onClick={() => void openProfile(c.author.id)}>{c.author.nickname}</button>
          <span className="flex-1 break-words">{c.text}</span>
          {c.canDelete && <button className="text-xs text-cocoa-soft shrink-0" onClick={async () => {
            if (await call(`/api/comments/${c.id}`, undefined, 'DELETE')) { const n = list.filter((x) => x.id !== c.id); setList(n); onCount(n.length); }
          }} aria-label="댓글 삭제">삭제</button>}
        </div>
      ))}
      <form className="flex gap-2 mt-1.5" onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        const r = await call<{ comments: CommentView[] }>(`/api/posts/${post.id}/comments`, { text });
        if (r) { setList(r.comments); setText(''); onCount(r.comments.length); }
      }}>
        <input className="field !py-2 flex-1" maxLength={COMMENT_MAX_LEN} value={text} onChange={(e) => setText(e.target.value)} placeholder="따뜻한 댓글을 남겨 주세요" enterKeyHint="send" />
        <button className="btn btn-peach px-4 min-h-[42px] text-sm">등록</button>
      </form>
    </div>
  );
}

const POST_REPORT_REASONS = ['부적절한 사진', '욕설/비하', '스팸·광고', '개인정보 노출', '동물 학대 의심', '기타'];
function ReportPost({ post, onClose }: { post: PostView; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#5a403333] p-4" {...backdropClose(onClose)}>
      <div className="panel pop w-full max-w-[360px] p-4">
        <h3 className="font-display text-xl mb-2">🚨 게시글 신고</h3>
        <p className="text-xs text-cocoa-soft mb-2">운영자가 확인 후 글을 숨기거나 이용을 제한해요. 작성자는 누가 신고했는지 알 수 없어요.</p>
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {POST_REPORT_REASONS.map((r) => <Chip key={r} on={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}
        </div>
        <textarea className="field min-h-[60px]" maxLength={300} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="자세한 내용 (선택)" />
        <div className="flex gap-2 mt-3">
          <button className="btn btn-ghost px-4 min-h-[44px]" onClick={onClose}>취소</button>
          <button disabled={!reason} className="btn btn-coral flex-1 min-h-[44px]" onClick={async () => {
            if (await call(`/api/posts/${post.id}/report`, { reason, detail })) { toast('신고가 접수되었어요. 확인 후 조치할게요.'); onClose(); }
          }}>신고하기</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 모임 시작 안내 (광장에서 만나요)
export function MeetupAlert() {
  const a = useStore((s) => s.meetupAlert);
  if (!a) return null;
  const parkName = PARKS.find((p) => p.id === a.park)?.name;
  return (
    <div className="absolute z-30 left-1/2 -translate-x-1/2 top-[64px] md:top-[78px] w-[min(94vw,380px)] panel p-3 pop" role="alert">
      <div className="font-display">⏰ '{a.title}' 모임이 곧 시작해요!</div>
      <div className="text-sm text-cocoa-soft mt-0.5">{a.kind === 'online' ? `${parkName} 분수대 앞에서 만나요.` : `📍 ${a.place} — 안전하게 다녀오세요!`}</div>
      <div className="flex gap-2 mt-2">
        {a.kind === 'online' && a.park && <button className="btn btn-peach px-4 min-h-[42px] text-sm" onClick={async () => { if (await joinPark(a.park!)) set({ meetupAlert: null }); }}>🌳 {parkName}으로 가기</button>}
        <button className="btn btn-ghost px-4 min-h-[42px] text-sm" onClick={() => { openCommunity('meetups', { meetupId: a.meetupId }); set({ meetupAlert: null }); }}>모임 보기</button>
        <button className="btn btn-ghost px-3 min-h-[42px] text-sm ml-auto" onClick={() => set({ meetupAlert: null })} aria-label="닫기">✕</button>
      </div>
    </div>
  );
}
