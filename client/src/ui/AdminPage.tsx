// 관리자 페이지 (/admin) — 운영자만 사용
//  · 화면은 누구나 주소로 열 수 있지만, 내용은 전부 서버가 매 요청마다 운영자 권한을 확인한 뒤에만 내려줌
//    (운영자가 아니면 '접근 권한이 없어요'만 보이고, 어떤 운영 데이터도 받지 못함)
//  · 메뉴: 대시보드 · 회원 관리 · 게시글 관리 · 신고 관리 · 스크린 승인 · 작업 기록
//  · 모든 처리(정지·숨김·삭제·승인 등)는 확인 창 + 사유 입력 후 실행, 서버가 작업자·대상·시각·사유를 기록
//  · PC: 왼쪽 메뉴 + 표 / 모바일: 위쪽 메뉴 + 목록, 상세는 전체 화면
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { toast, useStore } from '../store';
import { LogoMark } from './Logo';

// ---------------------------------------------------------------- 공용
type Section = 'dashboard' | 'users' | 'content' | 'reports' | 'screen' | 'log';
const SECTIONS: { key: Section; icon: string; label: string }[] = [
  { key: 'dashboard', icon: '🏡', label: '대시보드' },
  { key: 'users', icon: '👥', label: '회원 관리' },
  { key: 'content', icon: '📝', label: '게시글 관리' },
  { key: 'reports', icon: '🚨', label: '신고 관리' },
  { key: 'screen', icon: '📺', label: '스크린 승인' },
  { key: 'log', icon: '🗂️', label: '작업 기록' },
];
const PERMANENT = 32503680000000;
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (ts?: number | null) => {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const untilLabel = (until?: number | null) => !until ? '-' : until >= PERMANENT ? '영구' : `${fmt(until)}까지`;
const REPORT_REASONS = ['욕설 및 괴롭힘', '광고 및 도배', '부적절한 이미지', '개인정보 노출', '기타'];

const USER_STATUS: Record<string, [string, string]> = {
  active: ['정상', 'bg-[#E3F1DE] text-[#4D7A45]'],
  banned: ['정지 중', 'bg-[#FBE8E1] text-[#B5523C]'],
  permanent: ['영구 정지', 'bg-[#F6D9D2] text-[#9A3F2C]'],
  admin: ['운영자', 'bg-[#E4E6FA] text-[#4B4F96]'],
  guest: ['둘러보기', 'bg-[#EFEAE5] text-[#756B63]'],
};
const CONTENT_STATE: Record<string, [string, string]> = {
  visible: ['보임', 'bg-[#E3F1DE] text-[#4D7A45]'],
  hidden: ['숨김', 'bg-[#FFF4D6] text-[#8A6414]'],
  deleted: ['삭제됨', 'bg-[#FBE8E1] text-[#B5523C]'],
  pending: ['승인 대기', 'bg-[#FFF4D6] text-[#8A6414]'],
  approved: ['노출 중', 'bg-[#E3F1DE] text-[#4D7A45]'],
  rejected: ['반려', 'bg-[#FBE8E1] text-[#B5523C]'],
};
const REPORT_STATUS: Record<string, [string, string]> = {
  open: ['처리 대기', 'bg-[#FFF4D6] text-[#8A6414]'],
  resolved: ['처리 완료', 'bg-[#E3F1DE] text-[#4D7A45]'],
  dismissed: ['기각', 'bg-[#EFEAE5] text-[#756B63]'],
};
const ACTION_LABEL: Record<string, string> = {
  ban: '이용 정지', ban_permanent: '영구 정지', unban: '정지 해제',
  hide: '숨김', unhide: '숨김 해제', delete: '삭제(복구 가능)', restore: '복구', purge: '영구 삭제',
  report_resolved: '신고 처리 완료', report_dismissed: '신고 기각', report_open: '신고 다시 열기',
  screen_approve: '스크린 승인', screen_reject: '스크린 반려', screen_hide: '스크린 노출 중단',
  grant_admin: '운영자 지정', revoke_admin: '운영자 권한 회수',
};
const TARGET_LABEL: Record<string, string> = { user: '회원', post: '자랑 글', comment: '댓글', meetup: '산책 모임', guestbook: '방명록', screen: '스크린', report: '신고' };
type CType = 'post' | 'comment' | 'meetup' | 'guestbook' | 'screen';
const CTYPES: { key: CType; label: string }[] = [
  { key: 'post', label: '강아지 자랑' }, { key: 'comment', label: '댓글' }, { key: 'meetup', label: '산책 모임' },
  { key: 'guestbook', label: '방명록' }, { key: 'screen', label: '스크린 신청' },
];

function Badge({ map, k }: { map: Record<string, [string, string]>; k: string }) {
  const [label, tone] = map[k] ?? [k, 'bg-[#EFEAE5] text-[#756B63]'];
  return <span className={`inline-block shrink-0 text-[11px] leading-none rounded-full px-2 py-1 font-display ${tone}`}>{label}</span>;
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-cocoa-soft py-10 text-center">{children}</p>;
}
function Tabs<T extends string>({ items, value, onChange, testid }: { items: { key: T; label: string }[]; value: T; onChange: (v: T) => void; testid?: string }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto scroll-soft pb-1" data-testid={testid}>
      {items.map((t) => (
        <button key={t.key} type="button" onClick={() => onChange(t.key)}
          className={`shrink-0 btn px-3.5 py-1.5 text-sm border-2 !shadow-none ${value === t.key ? 'border-[#f4776a] bg-[#fff1ec] text-[#e2604f]' : 'border-[#f3e7da] bg-white'}`}>{t.label}</button>
      ))}
    </div>
  );
}
function SearchBox({ value, onSubmit, placeholder }: { value: string; onSubmit: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState(value);
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSubmit(v.trim()); }}>
      <input className="field !py-2 text-sm flex-1 min-w-0" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} enterKeyHint="search" />
      <button className="btn btn-peach px-4 text-sm">검색</button>
    </form>
  );
}
function Info({ label, children }: { label: string; children: ReactNode }) {
  return <><dt className="text-cocoa-soft">{label}</dt><dd className="min-w-0 break-all">{children}</dd></>;
}

// ---------------------------------------------------------------- 확인 창 (사유 입력 포함)
interface Ask {
  title: string; desc?: ReactNode; confirmLabel: string; danger?: boolean;
  /** 사유 입력 (기본: 필수) */ reason?: { label?: string; required?: boolean; presets?: string[]; hint?: string } | false;
  /** 이 문구를 그대로 입력해야 실행 (영구 삭제 등) */ typeWord?: string;
  onConfirm: (reason: string) => Promise<boolean>;
}
function AskDialog({ a, onClose }: { a: Ask; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const needReason = a.reason !== false && (a.reason?.required ?? true);
  const ok = (!needReason || reason.trim().length > 0) && (!a.typeWord || word.trim() === a.typeWord);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[#5a403344] p-4" role="dialog" aria-modal="true" data-testid="admin-ask">
      <div className="panel pop w-full max-w-[420px] p-5 !bg-[#fffaf4]">
        <h3 className="font-display text-xl">{a.title}</h3>
        {a.desc && <div className="text-sm text-cocoa-soft mt-1.5 leading-relaxed">{a.desc}</div>}
        {a.reason !== false && (
          <div className="mt-3">
            <label className="text-sm font-display">{a.reason?.label ?? '처리 사유'}{needReason ? '' : ' (선택)'}</label>
            {a.reason?.presets && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {a.reason.presets.map((p) => (
                  <button key={p} type="button" onClick={() => setReason(p)}
                    className={`btn px-2.5 py-1 text-xs border !shadow-none ${reason === p ? 'border-[#f4776a] bg-[#fff1ec] text-[#e2604f]' : 'border-[#f3e7da] bg-white'}`}>{p}</button>
                ))}
              </div>
            )}
            <textarea className="field mt-1.5 text-sm min-h-[64px]" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={a.reason?.hint ?? '운영 기록에만 남아요'} data-testid="admin-ask-reason" />
          </div>
        )}
        {a.typeWord && (
          <div className="mt-3">
            <label className="text-sm">확인을 위해 <b className="text-[#c4553a]">{a.typeWord}</b>를 입력해 주세요</label>
            <input className="field mt-1.5 text-sm" value={word} onChange={(e) => setWord(e.target.value)} placeholder={a.typeWord} data-testid="admin-ask-word" />
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button className="btn btn-ghost flex-1 py-2.5" disabled={busy} onClick={onClose}>취소</button>
          <button className={`btn flex-1 py-2.5 ${a.danger ? 'btn-coral' : 'btn-peach'}`} disabled={!ok || busy} data-testid="admin-ask-ok"
            onClick={async () => { setBusy(true); const done = await a.onConfirm(reason.trim()); setBusy(false); if (done) onClose(); }}>
            {busy ? '처리 중…' : a.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 운영 API 호출 (실패하면 안내 후 false) */
async function call(path: string, body?: unknown): Promise<any | null> {
  try { return await api(path, body ? { body } : {}); } catch (e) { toast((e as Error).message, 'error'); return null; }
}

// ---------------------------------------------------------------- 페이지 사이 이동 (상세 창 열기 등)
interface Nav {
  go: (s: Section) => void;
  openUser: (id: number) => void;
  openContent: (type: CType, id: number) => void;
  ask: (a: Ask) => void;
  view: (src: string) => void;
  /** 처리 후 목록·대시보드 숫자 새로고침 */
  bump: () => void;
  ver: number;
  myId: number;
}
const NavCtx = createContext<Nav>(null as unknown as Nav);
const useNav = () => useContext(NavCtx);

const sectionFromPath = (): Section => {
  const s = location.pathname.replace(/\/+$/, '').split('/')[2] as Section | undefined;
  return s && SECTIONS.some((x) => x.key === s) ? s : 'dashboard';
};

export default function AdminPage() {
  const me = useStore((s) => s.me);
  const [auth, setAuth] = useState<'checking' | 'ok' | 'denied'>('checking');
  const [isSuper, setSuper] = useState(false);
  const [section, setSection] = useState<Section>(sectionFromPath);
  const [userId, setUserId] = useState<number | null>(null);
  const [content, setContent] = useState<{ type: CType; id: number } | null>(null);
  const [asking, setAsking] = useState<Ask | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [ver, setVer] = useState(0);

  useEffect(() => {
    document.title = '멍글마을 관리자';
    // 화면 표시용 확인 — 실제 권한은 모든 운영 API에서 서버가 다시 확인
    api<{ ok: boolean; super: boolean }>('/api/admin/me').then((r) => { setSuper(!!r.super); setAuth('ok'); }).catch(() => setAuth('denied'));
    const onPop = () => setSection(sectionFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((s: Section) => {
    setSection(s); setUserId(null); setContent(null);
    const path = s === 'dashboard' ? '/admin' : `/admin/${s}`;
    if (location.pathname !== path) history.pushState(null, '', path);
  }, []);
  const nav: Nav = {
    go, openUser: (id) => { setContent(null); setUserId(id); }, openContent: (type, id) => { setUserId(null); setContent({ type, id }); },
    ask: setAsking, view: setViewing, bump: () => setVer((v) => v + 1), ver, myId: me?.id ?? 0,
  };

  if (auth !== 'ok') {
    return (
      <div className="h-full grid place-items-center bg-cream p-4" data-testid="admin-denied">
        <div className="panel p-6 max-w-sm text-center">
          <LogoMark size={56} />
          {auth === 'checking' ? <p className="mt-3 text-cocoa-soft">확인하는 중…</p> : <>
            <p className="font-display text-xl mt-3">접근 권한이 없어요</p>
            <p className="text-sm text-cocoa-soft mt-1">운영자만 볼 수 있는 페이지예요.</p>
            <a href="/" className="btn btn-peach inline-block px-5 py-2.5 mt-4">멍글마을로 돌아가기</a>
          </>}
        </div>
      </div>
    );
  }

  const cur = SECTIONS.find((s) => s.key === section)!;
  return (
    <NavCtx.Provider value={nav}>
      <div className="h-full flex flex-col md:flex-row bg-[#fff6ec]" data-testid="admin-page">
        {/* PC: 왼쪽 메뉴 */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col gap-1 p-4 bg-[#fdeedd] border-r-2 border-white">
          <div className="flex items-center gap-2 px-2 pb-3">
            <LogoMark size={34} />
            <div><div className="font-display text-lg leading-tight">멍글마을</div><div className="text-xs text-cocoa-soft">관리자 페이지</div></div>
          </div>
          {SECTIONS.map((s) => (
            <button key={s.key} onClick={() => go(s.key)} data-testid={`admin-nav-${s.key}`}
              className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left font-display transition ${section === s.key ? 'bg-white shadow-sm text-[#e2604f]' : 'hover:bg-[#fff6ec]'}`}>
              <span className="text-lg">{s.icon}</span>{s.label}
            </button>
          ))}
          <div className="mt-auto rounded-2xl bg-white/70 p-3 text-xs text-cocoa-soft">
            <div className="font-display text-sm text-cocoa">{me?.nickname}</div>
            {isSuper ? '최고 관리자' : '운영자'}
            <a href="/" className="block mt-2 underline">멍글마을로 돌아가기</a>
          </div>
        </aside>
        {/* 모바일: 위쪽 머리 + 메뉴 */}
        <header className="md:hidden shrink-0 bg-[#fdeedd] px-4 pt-[calc(var(--safe-t)+10px)] pb-2">
          <div className="flex items-center gap-2">
            <LogoMark size={28} />
            <div className="font-display text-lg flex-1">관리자 페이지</div>
            <span className="text-[11px] text-cocoa-soft">{isSuper ? '최고 관리자' : '운영자'}</span>
            <a href="/" className="btn btn-ghost px-3 py-1.5 text-xs !shadow-none">마을로</a>
          </div>
          <nav className="flex gap-1.5 overflow-x-auto mt-2 -mx-1 px-1 pb-1" aria-label="관리 메뉴">
            {SECTIONS.map((s) => (
              <button key={s.key} onClick={() => go(s.key)} data-testid={`admin-mnav-${s.key}`}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-display ${section === s.key ? 'bg-white text-[#e2604f] shadow-sm' : 'text-cocoa-soft'}`}>{s.icon} {s.label}</button>
            ))}
          </nav>
        </header>
        <main className="flex-1 min-w-0 overflow-y-auto scroll-soft">
          <div className="max-w-[1100px] mx-auto p-4 md:p-7 pb-[calc(var(--safe-b)+24px)]">
            <h1 className="font-display text-2xl mb-4 hidden md:block">{cur.icon} {cur.label}</h1>
            {section === 'dashboard' && <Dashboard />}
            {section === 'users' && <Users />}
            {section === 'content' && <Contents />}
            {section === 'reports' && <Reports />}
            {section === 'screen' && <ScreenApproval />}
            {section === 'log' && <ActionLog />}
          </div>
        </main>
      </div>
      {userId !== null && <UserDetail id={userId} onClose={() => setUserId(null)} />}
      {content && <ContentDetail type={content.type} id={content.id} onClose={() => setContent(null)} />}
      {asking && <AskDialog a={asking} onClose={() => setAsking(null)} />}
      {viewing && (
        <div className="fixed inset-0 z-[80] bg-[#2b201acc] grid place-items-center p-4" onClick={() => setViewing(null)} data-testid="admin-image-view">
          <img src={viewing} alt="" className="max-w-full max-h-[85vh] object-contain rounded-2xl" />
          <button className="absolute top-[calc(var(--safe-t)+12px)] right-3 btn btn-ghost w-11 h-11 text-lg" aria-label="닫기">✕</button>
        </div>
      )}
    </NavCtx.Provider>
  );
}

/** 상세 보기 (PC: 오른쪽 창, 모바일: 전체 화면) */
function Drawer({ title, onClose, children, testid }: { title: string; onClose: () => void; children: ReactNode; testid?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[data-testid="admin-ask"]')) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex bg-[#5a403333]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="ml-auto h-full w-full md:max-w-[560px] bg-[#fffaf4] shadow-2xl flex flex-col mobile-sheet" data-testid={testid}>
        <div className="flex items-center gap-2 px-4 md:px-5 pt-[calc(var(--safe-t)+12px)] pb-3 border-b border-[#f3e7da]">
          <h2 className="font-display text-xl flex-1 min-w-0 truncate">{title}</h2>
          <button className="btn btn-ghost w-10 h-10 !shadow-none text-lg" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-soft p-4 md:p-5 pb-[calc(var(--safe-b)+24px)] space-y-4">{children}</div>
      </section>
    </div>
  );
}
function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded-3xl bg-white p-4 shadow-[0_3px_0_#f1e2d2]">
      {title && <div className="flex items-center mb-2"><h3 className="font-display text-base flex-1">{title}</h3>{right}</div>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- 대시보드
interface Stats { members: number; todayJoined: number; online: number; openReports: number; pendingScreen: number; banned: number }
function Dashboard() {
  const nav = useNav();
  const [s, setS] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<ReportRow[]>([]);
  useEffect(() => {
    void call('/api/admin/stats').then((r) => r && setS(r));
    void call('/api/admin/report-list?status=open').then((r) => r && setRecent(r.reports.slice(0, 5)));
  }, [nav.ver]);
  const tiles: { label: string; value?: number; icon: string; tone: string; to?: Section }[] = [
    { label: '전체 회원', value: s?.members, icon: '👥', tone: 'bg-[#FDE3D6]', to: 'users' },
    { label: '오늘 가입', value: s?.todayJoined, icon: '🌱', tone: 'bg-[#E3EFDC]', to: 'users' },
    { label: '지금 접속', value: s?.online, icon: '🟢', tone: 'bg-[#E4F0F6]' },
    { label: '처리 대기 신고', value: s?.openReports, icon: '🚨', tone: 'bg-[#FBE8E1]', to: 'reports' },
    { label: '스크린 승인 대기', value: s?.pendingScreen, icon: '📺', tone: 'bg-[#FFF4D6]', to: 'screen' },
    { label: '정지된 회원', value: s?.banned, icon: '⛔', tone: 'bg-[#EFEAE5]', to: 'users' },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="admin-stats">
        {tiles.map((t) => (
          <button key={t.label} disabled={!t.to} onClick={() => t.to && nav.go(t.to)}
            className={`text-left rounded-3xl p-4 ${t.tone} border-2 border-white shadow-[0_3px_0_#f1e2d2] disabled:cursor-default disabled:opacity-100`}>
            <div className="text-sm text-cocoa-soft flex items-center gap-1.5"><span>{t.icon}</span>{t.label}</div>
            <div className="font-display text-3xl mt-1">{t.value ?? '…'}<span className="text-base ml-0.5">{t.label.includes('회원') || t.label.includes('가입') || t.label.includes('접속') ? '명' : '건'}</span></div>
          </button>
        ))}
      </div>
      <Card title="처리를 기다리는 신고" right={<button className="text-sm underline text-cocoa-soft" onClick={() => nav.go('reports')}>모두 보기</button>}>
        {recent.length === 0 ? <Empty>처리를 기다리는 신고가 없어요.</Empty> : (
          <ul className="divide-y divide-[#f6ece2]">
            {recent.map((r) => (
              <li key={r.id} className="py-2.5 flex items-center gap-2 text-sm">
                <span className="font-display shrink-0">#{r.id}</span>
                <span className="shrink-0">{r.reason}</span>
                <span className="text-cocoa-soft truncate flex-1 min-w-0">{r.reporter ?? '-'} → <b className="text-cocoa">{r.target.nickname ?? '-'}</b></span>
                <span className="text-xs text-cocoa-soft shrink-0">{fmt(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- 회원 관리
interface UserRow {
  id: number; username: string; nickname: string; dogName: string; createdAt: number; lastSeenAt: number | null;
  status: string; bannedUntil: number | null; banReason: string; reportsReceived: number; super?: boolean;
}
function Users() {
  const nav = useNav();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'members' | 'banned' | 'admin' | 'guest'>('members');
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const load = (offset = 0) => call(`/api/admin/users?q=${encodeURIComponent(q)}&status=${status}&offset=${offset}`).then((r) => {
    if (!r) return;
    setTotal(r.total);
    setRows((prev) => offset ? [...(prev ?? []), ...r.users] : r.users);
  });
  useEffect(() => { setRows(null); void load(); }, [q, status, nav.ver]);
  return (
    <div className="space-y-3">
      <SearchBox value={q} onSubmit={setQ} placeholder="아이디 · 닉네임 · 고유 번호(#12)로 검색" />
      <Tabs value={status} onChange={setStatus} items={[{ key: 'members', label: '전체 회원' }, { key: 'banned', label: '정지된 회원' }, { key: 'admin', label: '운영자' }, { key: 'guest', label: '둘러보기' }]} />
      <p className="text-xs text-cocoa-soft">{rows ? `${total}명` : '불러오는 중…'}</p>
      {rows && rows.length === 0 ? <Empty>찾는 회원이 없어요.</Empty> : (
        <div className="rounded-3xl bg-white overflow-hidden shadow-[0_3px_0_#f1e2d2]" data-testid="admin-users">
          <div className="hidden md:grid grid-cols-[70px_1.2fr_1.2fr_110px_130px_130px_70px] gap-3 px-4 py-2.5 text-xs text-cocoa-soft bg-[#fdf3e8]">
            <span>번호</span><span>아이디</span><span>닉네임 · 강아지</span><span>상태</span><span>가입일</span><span>최근 접속</span><span>받은 신고</span>
          </div>
          {rows?.map((u) => (
            <button key={u.id} onClick={() => nav.openUser(u.id)} data-testid={`admin-user-${u.id}`}
              className="w-full text-left grid grid-cols-[1fr_auto] md:grid-cols-[70px_1.2fr_1.2fr_110px_130px_130px_70px] gap-x-3 gap-y-0.5 px-4 py-3 border-t border-[#f6ece2] hover:bg-[#fffaf4] text-sm items-center">
              <span className="hidden md:block text-cocoa-soft">#{u.id}</span>
              <span className="font-display truncate">{u.username}<span className="md:hidden text-cocoa-soft font-body text-xs"> · #{u.id}</span></span>
              <span className="md:hidden justify-self-end"><Badge map={USER_STATUS} k={u.status} /></span>
              <span className="truncate text-cocoa-soft md:text-cocoa col-span-2 md:col-span-1">{u.nickname || '-'}{u.dogName ? ` · 🐶 ${u.dogName}` : ''}</span>
              <span className="hidden md:block"><Badge map={USER_STATUS} k={u.status} /></span>
              <span className="text-xs text-cocoa-soft md:text-sm md:text-cocoa"><span className="md:hidden">가입 </span>{fmt(u.createdAt).slice(0, 10)}</span>
              <span className="text-xs text-cocoa-soft md:text-sm justify-self-end md:justify-self-auto"><span className="md:hidden">접속 </span>{fmt(u.lastSeenAt)}</span>
              <span className="hidden md:block">{u.reportsReceived}</span>
            </button>
          ))}
        </div>
      )}
      {rows && rows.length < total && <button className="btn btn-ghost w-full py-2.5" onClick={() => void load(rows.length)}>더 보기</button>}
    </div>
  );
}

function UserDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const nav = useNav();
  const [d, setD] = useState<{ user: UserRow; reports: any[]; sanctions: any[]; counts: Record<string, number> } | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const load = () => call(`/api/admin/users/${id}`).then((r) => r && setD(r));
  useEffect(() => { void load(); }, [id, nav.ver]);
  const u = d?.user;
  const isAdmin = u?.status === 'admin';
  const banned = u && (u.status === 'banned' || u.status === 'permanent');
  const periodLabel = (n: number) => n === 0 ? '영구 정지' : `${n}일 정지`;
  const ban = () => u && days !== null && nav.ask({
    title: `${u.nickname || u.username}님을 ${periodLabel(days)}할까요?`,
    desc: <>지금 접속 중이면 바로 연결이 끊기고, 로그인·게임·채팅을 쓸 수 없어요. 회원에게 기간과 사유, 문의처가 안내돼요.{banned ? ' (이미 정지 중이면 새 기간으로 바뀌어요)' : ''}</>,
    confirmLabel: periodLabel(days), danger: true, reason: { label: '정지 사유', presets: REPORT_REASONS, hint: '운영 기록에 남고, 정지된 회원에게 기간과 함께 안내돼요' },
    onConfirm: async (reason) => {
      const r = await call(`/api/admin/users/${u.id}/ban`, { days, reason });
      if (r) { toast(`${periodLabel(days)} 처리했어요`); setDays(null); nav.bump(); }
      return !!r;
    },
  });
  const unban = () => u && nav.ask({
    title: `${u.nickname || u.username}님의 정지를 해제할까요?`, desc: '해제하면 바로 다시 로그인할 수 있어요.', confirmLabel: '정지 해제', reason: { label: '해제 사유' },
    onConfirm: async (reason) => { const r = await call(`/api/admin/users/${u.id}/unban`, { reason }); if (r) { toast('정지를 해제했어요'); nav.bump(); } return !!r; },
  });
  return (
    <Drawer title={u ? `${u.nickname || u.username}` : '회원 정보'} onClose={onClose} testid="admin-user-detail">
      {!d || !u ? <p className="text-sm text-cocoa-soft">불러오는 중…</p> : <>
        <Card>
          <div className="flex items-center gap-2 mb-3"><Badge map={USER_STATUS} k={u.status} />{u.super && <span className="text-xs font-display text-[#4B4F96]">최고 관리자</span>}</div>
          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
            <Info label="고유 번호">#{u.id}</Info>
            <Info label="아이디">{u.username}</Info>
            <Info label="닉네임">{u.nickname || '-'}</Info>
            <Info label="강아지">{u.dogName || '-'}</Info>
            <Info label="가입일">{fmt(u.createdAt)}</Info>
            <Info label="최근 접속">{fmt(u.lastSeenAt)}</Info>
            {banned && <Info label="정지 기간"><span className="text-[#B5523C]">{untilLabel(u.bannedUntil)}</span></Info>}
            {banned && <Info label="정지 사유">{u.banReason || '-'}</Info>}
            <Info label="활동">자랑 글 {d.counts.posts} · 댓글 {d.counts.comments} · 모임 {d.counts.meetups} · 보낸 신고 {d.counts.reportsMade}</Info>
          </dl>
        </Card>
        <Card title="이용 제재">
          {isAdmin ? (
            <p className="text-sm text-cocoa-soft">운영자 계정은 이 화면에서 정지하거나 삭제할 수 없어요. 운영자 권한 변경은 deploy/admins.txt 확인 절차로만 할 수 있어요.</p>
          ) : u.id === nav.myId ? <p className="text-sm text-cocoa-soft">내 계정은 정지할 수 없어요.</p> : <>
            <div className="flex flex-wrap gap-1.5" data-testid="admin-ban-days">
              {[1, 3, 7, 30, 0].map((n) => (
                <button key={n} onClick={() => setDays(n)}
                  className={`btn px-3 py-1.5 text-sm border-2 !shadow-none ${days === n ? 'border-[#f4776a] bg-[#fff1ec] text-[#e2604f]' : 'border-[#f3e7da] bg-white'}`}>{n === 0 ? '영구' : `${n}일`}</button>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <button className="btn btn-coral flex-1 py-2.5 text-sm" disabled={days === null} onClick={ban} data-testid="admin-ban">{days === null ? '정지 기간을 골라 주세요' : `${periodLabel(days)}…`}</button>
              {banned && <button className="btn btn-ghost flex-1 py-2.5 text-sm border border-[#f1e2d2]" onClick={unban} data-testid="admin-unban">정지 해제…</button>}
            </div>
          </>}
        </Card>
        <Card title={`받은 신고 ${d.reports.length}건`}>
          {d.reports.length === 0 ? <p className="text-sm text-cocoa-soft">받은 신고가 없어요.</p> : (
            <ul className="space-y-2">
              {d.reports.map((r) => (
                <li key={r.id} className="rounded-2xl bg-[#fffaf4] p-2.5 text-sm">
                  <div className="flex items-center gap-2 flex-wrap"><Badge map={REPORT_STATUS} k={r.status} /><b>{r.reason}</b><span className="text-xs text-cocoa-soft ml-auto">{fmt(r.created_at)}</span></div>
                  {r.detail && <p className="mt-1">{r.detail}</p>}
                  <p className="text-xs text-cocoa-soft mt-1">신고자 {r.reporter ?? '-'}{r.resolution ? ` · 처리: ${r.resolution}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="제재·처리 이력">
          {d.sanctions.length === 0 ? <p className="text-sm text-cocoa-soft">기록이 없어요.</p> : (
            <ul className="space-y-1.5 text-sm" data-testid="admin-sanctions">
              {d.sanctions.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-x-2">
                  <b>{ACTION_LABEL[a.action] ?? a.action}</b>
                  {a.until && a.action.startsWith('ban') && <span className="text-cocoa-soft">{untilLabel(a.until)}</span>}
                  <span className="text-cocoa-soft">· {a.reason || '-'}</span>
                  <span className="text-xs text-cocoa-soft ml-auto">{a.admin ?? '자동'} · {fmt(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>}
    </Drawer>
  );
}

// ---------------------------------------------------------------- 게시글 관리
interface ContentRow {
  type: CType; typeLabel: string; id: number; text: string; image: string | null; createdAt: number;
  author: { id: number; nickname: string; username: string }; state: string; extra: Record<string, any>; reports: number;
}
function Contents() {
  const nav = useNav();
  const [type, setType] = useState<CType>('post');
  const [state, setState] = useState<'all' | 'visible' | 'hidden' | 'deleted'>('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [more, setMore] = useState(false);
  const load = (offset = 0) => call(`/api/admin/content?type=${type}&state=${state}&q=${encodeURIComponent(q)}&offset=${offset}`).then((r) => {
    if (!r) return;
    setMore(r.items.length === 50);
    setRows((prev) => offset ? [...(prev ?? []), ...r.items] : r.items);
  });
  useEffect(() => { setRows(null); void load(); }, [type, state, q, nav.ver]);
  const stateTabs = type === 'screen'
    ? [{ key: 'all' as const, label: '전체' }, { key: 'visible' as const, label: '노출 중' }, { key: 'hidden' as const, label: '대기·반려·내림' }, { key: 'deleted' as const, label: '삭제됨' }]
    : [{ key: 'all' as const, label: '전체' }, { key: 'visible' as const, label: '보임' }, { key: 'hidden' as const, label: '숨김' }, { key: 'deleted' as const, label: '삭제됨' }];
  return (
    <div className="space-y-3">
      <Tabs value={type} onChange={setType} items={CTYPES} testid="admin-content-types" />
      <SearchBox value={q} onSubmit={setQ} placeholder="내용 · 작성자 닉네임 · 아이디로 검색" />
      <Tabs value={state} onChange={setState} items={stateTabs} />
      {!rows ? <p className="text-sm text-cocoa-soft">불러오는 중…</p> : rows.length === 0 ? <Empty>해당하는 글이 없어요.</Empty> : (
        <div className="rounded-3xl bg-white overflow-hidden shadow-[0_3px_0_#f1e2d2]" data-testid="admin-contents">
          <div className="hidden md:grid grid-cols-[60px_56px_1fr_150px_90px_120px_60px] gap-3 px-4 py-2.5 text-xs text-cocoa-soft bg-[#fdf3e8]">
            <span>번호</span><span>사진</span><span>내용</span><span>작성자</span><span>상태</span><span>작성일</span><span>신고</span>
          </div>
          {rows.map((c) => (
            <button key={`${c.type}-${c.id}`} onClick={() => nav.openContent(c.type, c.id)} data-testid={`admin-content-${c.type}-${c.id}`}
              className="w-full text-left grid grid-cols-[56px_1fr] md:grid-cols-[60px_56px_1fr_150px_90px_120px_60px] gap-x-3 px-4 py-3 border-t border-[#f6ece2] hover:bg-[#fffaf4] text-sm items-center">
              <span className="hidden md:block text-cocoa-soft">#{c.id}</span>
              {c.image ? <img src={c.image} alt="" className="w-14 h-14 rounded-xl object-cover row-span-2 md:row-span-1" /> : <span className="w-14 h-14 rounded-xl bg-[#fdf3e8] grid place-items-center text-xl row-span-2 md:row-span-1">{c.type === 'meetup' ? '🦮' : c.type === 'comment' ? '💬' : c.type === 'guestbook' ? '📮' : '📝'}</span>}
              <span className="min-w-0"><span className="line-clamp-2">{c.text || '(내용 없음)'}</span></span>
              <span className="min-w-0 flex items-center gap-1.5 flex-wrap text-xs md:text-sm text-cocoa-soft md:text-cocoa">
                <span className="truncate">{c.author.nickname}</span>
                <span className="md:hidden"><Badge map={CONTENT_STATE} k={c.state} /></span>
                <span className="md:hidden">· {fmt(c.createdAt).slice(5)}</span>
                {c.reports > 0 && <span className="md:hidden text-[#B5523C]">· 신고 {c.reports}</span>}
              </span>
              <span className="hidden md:block"><Badge map={CONTENT_STATE} k={c.state} /></span>
              <span className="hidden md:block text-cocoa-soft">{fmt(c.createdAt).slice(2)}</span>
              <span className={`hidden md:block ${c.reports ? 'text-[#B5523C] font-display' : 'text-cocoa-soft'}`}>{c.reports}</span>
            </button>
          ))}
        </div>
      )}
      {rows && more && <button className="btn btn-ghost w-full py-2.5" onClick={() => void load(rows.length)}>더 보기</button>}
      <p className="text-xs text-cocoa-soft leading-relaxed px-1">
        숨김: 회원에게 보이지 않지만 그대로 보관 · 삭제: 목록에서 사라지지만 언제든 복구 가능 · 영구 삭제: 삭제된 글만 가능하며, 글과 함께 댓글·좋아요·저장·연결된 스크린 항목·사진 파일이 지워져 되돌릴 수 없어요. 신고 기록은 처리 내역으로 남아요.
      </p>
    </div>
  );
}

function ContentDetail({ type, id, onClose }: { type: CType; id: number; onClose: () => void }) {
  const nav = useNav();
  const [d, setD] = useState<{ item: ContentRow; history: any[]; reports: any[]; comments?: number } | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => { void call(`/api/admin/content/${type}/${id}`).then((r) => r ? setD(r) : setGone(true)); }, [type, id, nav.ver]);
  const c = d?.item;
  const act = (action: 'hide' | 'unhide' | 'delete' | 'restore' | 'purge') => {
    if (!c) return;
    const name = `${c.typeLabel} #${c.id}`;
    const conf: Record<typeof action, Omit<Ask, 'onConfirm'>> = {
      hide: { title: `${name}을(를) 숨길까요?`, desc: type === 'screen' ? "광장 스크린에서 바로 내려가요. 다시 올리려면 '승인 대기로 되돌리기' 후 스크린 승인에서 승인해 주세요." : '회원에게 보이지 않게 돼요. 내용은 그대로 보관되고 언제든 다시 보이게 할 수 있어요.' + (type === 'post' ? ' 이 글과 연결된 스크린 노출도 멈춰요.' : ''), confirmLabel: '숨기기', reason: { presets: REPORT_REASONS } },
      unhide: { title: type === 'screen' ? `${name}을(를) 승인 대기로 되돌릴까요?` : `${name}을(를) 다시 보이게 할까요?`, desc: type === 'screen' ? "바로 노출되지 않고 '승인 대기'로 돌아가요. 스크린 승인에서 다시 승인하면 나와요." : '회원에게 다시 보여요.', confirmLabel: type === 'screen' ? '승인 대기로' : '숨김 해제' },
      delete: { title: `${name}을(를) 삭제할까요?`, desc: '회원에게서 사라지지만 운영자는 복구할 수 있어요. (사진·댓글·신고 기록은 그대로 보관)', confirmLabel: '삭제', danger: true, reason: { presets: REPORT_REASONS } },
      restore: { title: `${name}을(를) 복구할까요?`, desc: type === 'screen' ? "'승인 대기'로 돌아가요. 스크린 승인에서 다시 승인하면 나와요." : '삭제 전처럼 회원에게 다시 보여요.', confirmLabel: '복구' },
      purge: { title: `${name}을(를) 영구 삭제할까요?`, desc: <>되돌릴 수 없어요. {type === 'post' ? `이 글의 댓글${d?.comments ? ` ${d.comments}개` : ''}·좋아요·저장·연결된 스크린 항목과 사진 파일이 함께 지워져요.` : type === 'meetup' ? '참가자·채팅·후기가 함께 지워져요.' : type === 'screen' ? '스크린 항목과 신청 사진 파일이 지워져요.' : '내용이 완전히 지워져요.'} 신고 기록은 처리 내역으로 남아요.</>, confirmLabel: '영구 삭제', danger: true, typeWord: '영구 삭제' },
    };
    const NOTE = { required: false, hint: '운영 기록에만 남아요. 작성자에게는 알리지 않아요.' };
    nav.ask({
      ...conf[action],
      reason: { ...NOTE, ...(conf[action].reason || {}), required: false },
      onConfirm: async (reason) => {
        const r = await call(`/api/admin/content/${type}/${id}`, { action, reason, ...(action === 'purge' ? { confirm: '영구 삭제' } : {}) });
        if (!r) return false;
        toast(action === 'purge' ? '영구 삭제했어요' : '처리했어요');
        if (action === 'purge') onClose();
        nav.bump();
        return true;
      },
    });
  };
  const s = c?.state;
  const deleted = s === 'deleted';
  return (
    <Drawer title={c ? `${c.typeLabel} #${c.id}` : '글 정보'} onClose={onClose} testid="admin-content-detail">
      {gone ? <p className="text-sm text-cocoa-soft">이미 영구 삭제되었거나 찾을 수 없어요.</p> : !c ? <p className="text-sm text-cocoa-soft">불러오는 중…</p> : <>
        <Card>
          <div className="flex items-center gap-2 mb-2"><Badge map={CONTENT_STATE} k={c.state} /><span className="text-xs text-cocoa-soft">{fmt(c.createdAt)}</span></div>
          {c.image && <button onClick={() => nav.view(c.image!)} className="block"><img src={c.image} alt="" className="max-h-64 rounded-2xl object-contain bg-[#fdf3e8]" /></button>}
          <p className="text-sm whitespace-pre-wrap mt-2">{c.text || '(내용 없음)'}</p>
          <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-sm mt-3">
            <Info label="작성자"><button className="underline" onClick={() => nav.openUser(c.author.id)}>{c.author.nickname}</button> <span className="text-cocoa-soft">@{c.author.username} · #{c.author.id}</span></Info>
            {type === 'comment' && c.extra.postId && <Info label="원글"><button className="underline" onClick={() => nav.openContent('post', Number(c.extra.postId))}>자랑 글 #{c.extra.postId}</button></Info>}
            {type === 'post' && d!.comments !== undefined && <Info label="댓글">{d!.comments}개</Info>}
            {type === 'meetup' && <Info label="모임">{fmt(c.extra.startsAt)} · {c.extra.status}</Info>}
          </dl>
        </Card>
        <Card title="처리">
          <div className="flex flex-wrap gap-2" data-testid="admin-content-actions">
            {type !== 'screen' && s === 'visible' && <button className="btn btn-ghost px-4 py-2 text-sm border border-[#f1e2d2]" onClick={() => act('hide')}>숨기기</button>}
            {type === 'screen' && s === 'approved' && <button className="btn btn-ghost px-4 py-2 text-sm border border-[#f1e2d2]" onClick={() => act('hide')}>스크린에서 내리기</button>}
            {type !== 'screen' && s === 'hidden' && <button className="btn btn-sage px-4 py-2 text-sm" onClick={() => act('unhide')}>숨김 해제</button>}
            {type === 'screen' && s === 'hidden' && <button className="btn btn-sage px-4 py-2 text-sm" onClick={() => act('unhide')}>승인 대기로 되돌리기</button>}
            {!deleted && <button className="btn btn-coral px-4 py-2 text-sm" onClick={() => act('delete')} data-testid="admin-content-delete">삭제 (복구 가능)</button>}
            {deleted && <button className="btn btn-sage px-4 py-2 text-sm" onClick={() => act('restore')}>복구</button>}
            {deleted && <button className="btn px-4 py-2 text-sm bg-[#c4553a] text-white" onClick={() => act('purge')} data-testid="admin-content-purge">영구 삭제…</button>}
          </div>
          {type === 'screen' && s === 'pending' && <p className="text-xs text-cocoa-soft mt-2">승인·반려는 '스크린 승인' 메뉴에서 할 수 있어요.</p>}
          {!deleted && <p className="text-xs text-cocoa-soft mt-2">영구 삭제는 먼저 '삭제'한 뒤에 할 수 있어요.</p>}
        </Card>
        <Card title={`이 글에 들어온 신고 ${d!.reports.length}건`}>
          {d!.reports.length === 0 ? <p className="text-sm text-cocoa-soft">신고가 없어요.</p> : (
            <ul className="space-y-1.5 text-sm">{d!.reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1"><Badge map={REPORT_STATUS} k={r.status} /><b>{r.reason}</b><span className="text-cocoa-soft">{r.detail}</span><span className="text-xs text-cocoa-soft ml-auto">{r.reporter ?? '-'} · {fmt(r.created_at)}</span></li>
            ))}</ul>
          )}
        </Card>
        <Card title="처리 이력">
          {d!.history.length === 0 ? <p className="text-sm text-cocoa-soft">기록이 없어요.</p> : (
            <ul className="space-y-1.5 text-sm">{d!.history.map((h, i) => (
              <li key={i} className="flex flex-wrap gap-x-2"><b>{ACTION_LABEL[h.action] ?? h.action}</b><span className="text-cocoa-soft">· {h.reason || '-'}</span><span className="text-xs text-cocoa-soft ml-auto">{h.admin ?? '-'} · {fmt(h.created_at)}</span></li>
            ))}</ul>
          )}
        </Card>
      </>}
    </Drawer>
  );
}

// ---------------------------------------------------------------- 신고 관리
interface ReportRow {
  id: number; reason: string; detail: string; context: string; status: string; createdAt: number; reporter: string | null;
  target: { id: number; nickname: string | null; username: string | null; banned: boolean; admin: boolean };
  targetType: string | null; targetRef: number | null; resolution: string; handler: string | null; handledAt: number | null;
}
function Reports() {
  const nav = useNav();
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed' | 'all'>('open');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  useEffect(() => { setRows(null); void call(`/api/admin/report-list?status=${status}`).then((r) => r && setRows(r.reports)); }, [status, nav.ver]);
  const handle = (r: ReportRow, next: 'resolved' | 'dismissed' | 'open') => nav.ask({
    title: next === 'resolved' ? `신고 #${r.id}를 처리 완료로 바꿀까요?` : next === 'dismissed' ? `신고 #${r.id}를 기각할까요?` : `신고 #${r.id}를 다시 열까요?`,
    desc: next === 'resolved' ? '글 숨김·회원 정지 같은 조치는 각 버튼으로 따로 해 주세요. 여기서는 신고 상태와 처리 사유만 기록해요.' : next === 'dismissed' ? '문제가 없다고 판단한 경우예요. 신고 기록은 그대로 남아요.' : '처리 대기 상태로 돌아가요.',
    confirmLabel: next === 'resolved' ? '처리 완료' : next === 'dismissed' ? '기각' : '다시 열기',
    reason: next === 'open' ? { required: false } : { label: '처리 사유', presets: next === 'resolved' ? ['글 숨김 처리', '회원 이용 정지', '경고 안내'] : ['규정 위반 아님', '중복 신고', '확인 불가'] },
    onConfirm: async (resolution) => { const x = await call(`/api/admin/reports/${r.id}/handle`, { status: next, resolution }); if (x) { toast('신고 상태를 바꿨어요'); nav.bump(); } return !!x; },
  });
  const KIND = new Set(['post', 'comment', 'meetup', 'guestbook', 'screen']);
  return (
    <div className="space-y-3">
      <Tabs value={status} onChange={setStatus} items={[{ key: 'open', label: '처리 대기' }, { key: 'resolved', label: '처리 완료' }, { key: 'dismissed', label: '기각' }, { key: 'all', label: '전체' }]} />
      {!rows ? <p className="text-sm text-cocoa-soft">불러오는 중…</p> : rows.length === 0 ? <Empty>해당하는 신고가 없어요.</Empty> : (
        <div className="space-y-2.5" data-testid="admin-reports">
          {rows.map((r) => (
            <div key={r.id} className="rounded-3xl bg-white p-4 shadow-[0_3px_0_#f1e2d2]" data-testid={`admin-report-${r.id}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge map={REPORT_STATUS} k={r.status} />
                <span className="font-display">#{r.id} {r.reason}</span>
                <span className="text-xs text-cocoa-soft ml-auto">{fmt(r.createdAt)}</span>
              </div>
              <p className="text-sm mt-1.5">
                <span className="text-cocoa-soft">{r.reporter ?? '-'} →</span>{' '}
                <button className="underline font-display" onClick={() => nav.openUser(r.target.id)}>{r.target.nickname ?? '(탈퇴)'}</button>
                {r.target.banned && <span className="text-xs text-[#B5523C]"> · 정지 중</span>}
                {r.target.admin && <span className="text-xs text-[#4B4F96]"> · 운영자</span>}
                {r.targetType && KIND.has(r.targetType) && r.targetRef ? <> · <button className="underline" onClick={() => nav.openContent(r.targetType as CType, r.targetRef!)}>{TARGET_LABEL[r.targetType]} #{r.targetRef}</button></> : null}
              </p>
              {r.detail && <p className="text-sm mt-1">{r.detail}</p>}
              {r.context && <pre className="text-xs bg-[#fdf3e8] rounded-2xl p-2.5 mt-2 whitespace-pre-wrap break-all font-body max-h-40 overflow-y-auto">{r.context}</pre>}
              {r.status !== 'open' && <p className="text-xs text-cocoa-soft mt-2">처리: {r.resolution || '-'} · {r.handler ?? '-'} · {fmt(r.handledAt)}</p>}
              <div className="flex flex-wrap gap-1.5 mt-3 text-sm">
                {r.targetType && KIND.has(r.targetType) && r.targetRef && <button className="btn btn-ghost px-3 py-1.5 border border-[#f1e2d2] !shadow-none" onClick={() => nav.openContent(r.targetType as CType, r.targetRef!)}>글 숨김·삭제</button>}
                {!r.target.admin && <button className="btn btn-ghost px-3 py-1.5 border border-[#f1e2d2] !shadow-none" onClick={() => nav.openUser(r.target.id)}>회원 정지</button>}
                {r.status === 'open' ? <>
                  <button className="btn btn-sage px-3 py-1.5 !shadow-none" onClick={() => handle(r, 'resolved')} data-testid="admin-report-resolve">처리 완료</button>
                  <button className="btn btn-ghost px-3 py-1.5 border border-[#f1e2d2] !shadow-none" onClick={() => handle(r, 'dismissed')}>기각</button>
                </> : <button className="btn btn-ghost px-3 py-1.5 border border-[#f1e2d2] !shadow-none" onClick={() => handle(r, 'open')}>다시 열기</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 스크린 승인
interface ScreenItem {
  id: number; kind: string; title: string; text: string; image: string | null; author: string; authorId: number; dogName: string | null;
  status: string; ts: number; username?: string; decidedAt?: number | null; decidedBy?: string | null;
}
function ScreenApproval() {
  const nav = useNav();
  const [tab, setTab] = useState<'pending' | 'history' | 'notices'>('pending');
  const [data, setData] = useState<{ pending: ScreenItem[]; history: ScreenItem[]; notices: ScreenItem[] } | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  useEffect(() => { void call('/api/admin/screen').then((r) => r && setData(r)); }, [nav.ver]);
  const act = (i: ScreenItem, action: 'approve' | 'reject' | 'hide') => {
    const name = i.kind === 'notice' ? `공지 '${i.title}'` : `${i.author}님의 '${i.title}'`;
    nav.ask({
      title: action === 'approve' ? `${name}을(를) 승인할까요?` : action === 'reject' ? `${name} 신청을 반려할까요?` : `${name}을(를) 스크린에서 내릴까요?`,
      desc: action === 'approve' ? '승인하면 광장 스크린에 바로 나오고, 누구나 크게 볼 수 있어요.' : action === 'reject' ? '스크린에 올라가지 않고, 신청한 회원에게 결과가 안내돼요. 사진은 신청한 회원과 운영자만 볼 수 있어요.' : "스크린에서 바로 내려가요. 다시 올리려면 게시글 관리 › 스크린 신청에서 '승인 대기로 되돌리기' 후 승인해 주세요.",
      confirmLabel: action === 'approve' ? '승인 (스크린 노출)' : action === 'reject' ? '반려' : '내리기',
      danger: action !== 'approve',
      reason: action === 'approve' ? { required: false, label: '메모' } : { presets: action === 'reject' ? ['강아지 사진이 아니에요', '사진이 흐려요', '개인정보가 보여요', '부적절한 이미지'] : REPORT_REASONS },
      onConfirm: async (reason) => {
        const r = await call(`/api/admin/screen/${i.id}`, { action, reason });
        if (r) { toast(action === 'approve' ? '승인했어요. 광장 스크린에 바로 나와요' : action === 'reject' ? '반려했어요' : '스크린에서 내렸어요'); nav.bump(); }
        return !!r;
      },
    });
  };
  async function notice() {
    const r = await call('/api/admin/notices', { title, text });
    if (r) { setTitle(''); setText(''); toast('공지를 스크린에 올렸어요'); nav.bump(); }
  }
  const card = (i: ScreenItem) => (
    <div key={i.id} className="rounded-3xl bg-white p-3 flex gap-3 shadow-[0_3px_0_#f1e2d2]" data-testid={`admin-screen-${i.id}`}>
      {i.image ? <button type="button" className="shrink-0" onClick={() => nav.view(i.image!)} aria-label="사진 크게 보기">
        <img src={i.image} alt="" className="w-24 h-24 md:w-28 md:h-28 rounded-2xl object-cover bg-[#fdf3e8]" />
      </button> : <div className="w-24 h-24 rounded-2xl bg-sage-soft grid place-items-center text-3xl shrink-0">📢</div>}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap"><Badge map={{ ...CONTENT_STATE, hidden: ['내림', 'bg-[#EFEAE5] text-[#756B63]'] }} k={i.status} /><span className="font-display">{i.title}</span></div>
        {i.text && <p className="text-sm mt-0.5">{i.text}</p>}
        <p className="text-xs text-cocoa-soft mt-1">
          {i.kind === 'notice' ? '운영 공지' : <>신청: <button className="underline text-cocoa" onClick={() => nav.openUser(i.authorId)}>{i.author}</button>{i.username ? ` (@${i.username})` : ''}{i.dogName ? ` · 🐶 ${i.dogName}` : ''}</>} · {fmt(i.ts)}
        </p>
        {i.decidedAt && <p className="text-xs text-cocoa-soft">처리: {fmt(i.decidedAt)}{i.decidedBy ? ` · ${i.decidedBy}` : ''}</p>}
        <div className="flex flex-wrap gap-1.5 mt-2 text-sm">
          {i.status === 'pending' && <>
            <button className="btn btn-sage px-3 py-1.5 !shadow-none" onClick={() => act(i, 'approve')} data-testid="admin-screen-approve">승인</button>
            <button className="btn btn-ghost px-3 py-1.5 border border-[#f1e2d2] !shadow-none" onClick={() => act(i, 'reject')} data-testid="admin-screen-reject">반려</button>
          </>}
          {i.status === 'approved' && <button className="btn btn-ghost px-3 py-1.5 border border-[#f1e2d2] !shadow-none" onClick={() => act(i, 'hide')} data-testid="admin-screen-hide">노출 중단</button>}
        </div>
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <Tabs value={tab} onChange={setTab} items={[{ key: 'pending', label: `승인 대기${data ? ` ${data.pending.length}` : ''}` }, { key: 'history', label: '처리 이력' }, { key: 'notices', label: '운영 공지' }]} testid="admin-screen-tabs" />
      {!data ? <p className="text-sm text-cocoa-soft">불러오는 중…</p> : tab === 'pending' ? (
        data.pending.length === 0 ? <Empty>승인을 기다리는 사진 신청이 없어요.</Empty> : <div className="grid md:grid-cols-2 gap-2.5">{data.pending.map(card)}</div>
      ) : tab === 'history' ? (
        data.history.length === 0 ? <Empty>아직 처리한 신청이 없어요.</Empty> : <div className="grid md:grid-cols-2 gap-2.5">{data.history.map(card)}</div>
      ) : (
        <>
          <Card title="📢 운영 공지 올리기">
            <input className="field text-sm" maxLength={30} placeholder="공지 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="field text-sm mt-2" maxLength={80} placeholder="내용 (선택)" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn btn-coral px-4 py-2 mt-2 text-sm" disabled={!title.trim()} onClick={notice}>스크린에 올리기</button>
          </Card>
          {data.notices.length === 0 ? <Empty>올린 공지가 없어요.</Empty> : <div className="grid md:grid-cols-2 gap-2.5">{data.notices.map(card)}</div>}
        </>
      )}
      <p className="text-xs text-cocoa-soft px-1">승인 전(대기·반려·내림) 사진은 신청한 회원과 운영자만 볼 수 있어요. 일반 회원에게는 어떤 경로로도 보이지 않아요.</p>
    </div>
  );
}

// ---------------------------------------------------------------- 작업 기록
function ActionLog() {
  const nav = useNav();
  const [type, setType] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { setRows(null); void call(`/api/admin/actions${type ? `?type=${type}` : ''}`).then((r) => r && setRows(r.actions)); }, [type, nav.ver]);
  const open = (a: any) => {
    if (a.targetType === 'user') nav.openUser(a.targetId);
    else if (['post', 'comment', 'meetup', 'guestbook', 'screen'].includes(a.targetType) && a.action !== 'purge') nav.openContent(a.targetType, a.targetId);
  };
  return (
    <div className="space-y-3">
      <Tabs value={type} onChange={setType} items={[{ key: '', label: '전체' }, ...Object.entries(TARGET_LABEL).map(([key, label]) => ({ key, label }))]} />
      {!rows ? <p className="text-sm text-cocoa-soft">불러오는 중…</p> : rows.length === 0 ? <Empty>기록이 없어요.</Empty> : (
        <div className="rounded-3xl bg-white overflow-hidden shadow-[0_3px_0_#f1e2d2]" data-testid="admin-log">
          <div className="hidden md:grid grid-cols-[130px_120px_130px_1fr_110px] gap-3 px-4 py-2.5 text-xs text-cocoa-soft bg-[#fdf3e8]">
            <span>시각</span><span>작업자</span><span>작업</span><span>대상 · 사유</span><span>기간</span>
          </div>
          {rows.map((a) => (
            <button key={a.id} onClick={() => open(a)} className="w-full text-left grid grid-cols-[1fr_auto] md:grid-cols-[130px_120px_130px_1fr_110px] gap-x-3 gap-y-0.5 px-4 py-2.5 border-t border-[#f6ece2] hover:bg-[#fffaf4] text-sm items-center">
              <span className="text-xs md:text-sm text-cocoa-soft order-2 md:order-none justify-self-end md:justify-self-auto">{fmt(a.at).slice(2)}</span>
              <span className="hidden md:block truncate">{a.admin ?? '자동(저장소 목록)'}</span>
              <span className="font-display order-1 md:order-none">{ACTION_LABEL[a.action] ?? a.action}</span>
              <span className="min-w-0 col-span-2 md:col-span-1 order-3 md:order-none text-cocoa-soft md:text-cocoa truncate">{TARGET_LABEL[a.targetType] ?? a.targetType} #{a.targetId} · {a.reason || '-'}<span className="md:hidden"> · {a.admin ?? '자동'}</span></span>
              <span className="hidden md:block text-cocoa-soft">{a.action.startsWith('ban') ? untilLabel(a.until) : a.detail?.slice(0, 12) || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
