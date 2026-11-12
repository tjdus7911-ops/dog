// 운영자 전용 신고 관리 (서버에서 운영자 권한을 다시 검증)
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { set, toast } from '../store';
import { openProfile } from '../net/socket';
import { Modal, PanelHeader, timeLabel } from './common';
import { goToPage } from './menus';

interface Report {
  id: number; reporter_nickname: string; target_nickname: string; target_id: number; target_banned_until: number;
  reason: string; detail: string; context: string; status: string; created_at: number; target_type?: string; target_ref?: number | null;
}

export default function AdminPanel() {
  const [tab, setTab] = useState<'reports' | 'screen'>('reports');
  return (
    <Modal onClose={() => set({ panel: 'none' })} className="max-w-3xl p-5">
      <PanelHeader icon="🛡️" title="운영 관리" onClose={() => set({ panel: 'none' })}>
        <button className="btn btn-ghost px-3 py-1.5 text-sm !shadow-none border border-[#f1e2d2]" onClick={() => goToPage('/admin')} data-testid="open-admin-page">관리자 페이지 ›</button>
      </PanelHeader>
      <div className="grid grid-cols-2 gap-1 bg-cream-2 rounded-full p-1 mb-3">
        {(['reports', 'screen'] as const).map((t) => (
          <button key={t} className={`btn py-2 text-sm ${tab === t ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setTab(t)}>{t === 'reports' ? '🚨 신고 관리' : '📺 광장 스크린'}</button>
        ))}
      </div>
      {tab === 'reports' ? <Reports /> : <ScreenAdmin />}
    </Modal>
  );
}

interface ScreenItem {
  id: number; kind: string; title: string; text: string; image: string | null; author: string; authorId: number; dogName: string | null; status: string; ts: number;
  username?: string; decidedAt?: number | null; decidedBy?: string | null;
}
const STATUS_LABEL: Record<string, string> = { pending: '승인 대기', approved: '노출 중', rejected: '반려', hidden: '내림' };
const STATUS_TONE: Record<string, string> = { pending: 'bg-[#FFF4D6] text-[#8A6414]', approved: 'bg-[#E3F1DE] text-[#4D7A45]', rejected: 'bg-[#FBE8E1] text-[#B5523C]', hidden: 'bg-[#EFEAE5] text-[#756B63]' };

/** 광장 스크린: 강아지 사진 신청 승인·반려(대기 목록 + 처리 이력), 운영 공지 작성·내리기 */
function ScreenAdmin() {
  const [data, setData] = useState<{ pending: ScreenItem[]; history: ScreenItem[]; notices: ScreenItem[] } | null>(null);
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [busy, setBusy] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const load = () => api<{ pending: ScreenItem[]; history: ScreenItem[]; notices: ScreenItem[] }>('/api/admin/screen').then(setData).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);
  async function act(i: ScreenItem, action: 'approve' | 'reject' | 'hide') {
    const name = i.kind === 'notice' ? `공지 '${i.title}'` : `${i.author}님의 '${i.title}'`;
    if (action !== 'approve' && !confirm(action === 'reject' ? `${name} 신청을 반려할까요? (스크린에 올라가지 않아요)` : `${name}을(를) 스크린에서 내릴까요?`)) return;
    setBusy(i.id);
    await api(`/api/admin/screen/${i.id}`, { body: { action } })
      .then(() => toast(action === 'approve' ? '승인했어요. 광장 스크린에 바로 나와요' : action === 'reject' ? '반려했어요' : '스크린에서 내렸어요'))
      .catch((e) => toast(e.message, 'error'));
    setBusy(null);
    load();
  }
  async function notice() {
    await api('/api/admin/notices', { body: { title, text } }).then(() => { setTitle(''); setText(''); toast('공지를 스크린에 올렸어요'); }).catch((e) => toast(e.message, 'error'));
    load();
  }
  const card = (i: ScreenItem) => (
    <div key={i.id} className={`rounded-2xl p-3 flex gap-3 ${i.status === 'pending' ? 'bg-white' : 'bg-cream-2'}`} data-testid={`screen-req-${i.id}`}>
      {i.image ? <button type="button" className="shrink-0" onClick={() => set({ viewer: { photos: [i.image!], index: 0, title: i.title, caption: `${i.author} · 🐶 ${i.dogName ?? ''}` } })} aria-label="사진 크게 보기">
        <img src={i.image} alt="" className="w-20 h-20 rounded-xl object-cover" />
      </button> : <div className="w-20 h-20 rounded-xl bg-sage-soft grid place-items-center text-2xl shrink-0">📢</div>}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[11px] rounded-full px-2 py-0.5 ${STATUS_TONE[i.status] ?? ''}`}>{STATUS_LABEL[i.status] ?? i.status}</span>
          <span className="font-display">{i.title}</span>
        </div>
        {i.text && <p className="text-sm mt-0.5">{i.text}</p>}
        <p className="text-xs text-cocoa-soft mt-1">
          {i.kind === 'notice' ? '운영 공지' : <>신청: <b className="text-cocoa">{i.author}</b>{i.username ? ` (@${i.username})` : ''} · 🐶 {i.dogName}</>} · {timeLabel(i.ts)}
        </p>
        {i.decidedAt && <p className="text-xs text-cocoa-soft">처리: {STATUS_LABEL[i.status] ?? i.status} · {timeLabel(i.decidedAt)}{i.decidedBy ? ` · ${i.decidedBy}` : ''}</p>}
        <div className="flex flex-wrap gap-1.5 mt-2 text-xs items-center">
          {i.kind !== 'notice' && <button className="btn btn-ghost px-3 py-1" onClick={() => { set({ panel: 'none' }); void openProfile(i.authorId); }}>신청자 프로필</button>}
          {i.status === 'pending' && <>
            <button className="btn btn-sage px-3 py-1 !shadow-none" disabled={busy === i.id} onClick={() => act(i, 'approve')} data-testid="screen-approve">승인 (스크린 노출)</button>
            <button className="btn btn-ghost px-3 py-1" disabled={busy === i.id} onClick={() => act(i, 'reject')} data-testid="screen-reject">반려</button>
          </>}
          {i.status === 'approved' && <button className="btn btn-ghost px-3 py-1" disabled={busy === i.id} onClick={() => act(i, 'hide')}>스크린에서 내리기</button>}
        </div>
      </div>
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-2 gap-1 bg-cream-2 rounded-full p-1 mb-3">
        <button className={`btn py-2 text-sm ${view === 'pending' ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setView('pending')} data-testid="screen-tab-pending">승인 대기{data ? ` ${data.pending.length}` : ''}</button>
        <button className={`btn py-2 text-sm ${view === 'history' ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setView('history')} data-testid="screen-tab-history">처리 이력 · 공지</button>
      </div>
      {!data ? <p className="text-sm text-cocoa-soft">불러오는 중…</p> : view === 'pending' ? (
        data.pending.length === 0 ? <p className="text-sm text-cocoa-soft py-6 text-center">승인을 기다리는 사진 신청이 없어요.</p>
          : <div className="space-y-2">{data.pending.map(card)}</div>
      ) : (
        <>
          <div className="rounded-2xl bg-white p-3">
            <div className="font-display mb-2">📢 운영 공지 올리기</div>
            <input className="field text-sm" maxLength={30} placeholder="공지 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="field text-sm mt-2" maxLength={80} placeholder="내용 (선택)" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn btn-coral px-4 py-2 mt-2 text-sm" disabled={!title.trim()} onClick={notice}>스크린에 올리기</button>
          </div>
          {data.notices.length > 0 && <div className="space-y-2 mt-3">{data.notices.map(card)}</div>}
          <h3 className="font-display text-sm text-cocoa-soft mt-4 mb-2">사진 신청 처리 이력 (최근 100건)</h3>
          {data.history.length === 0 ? <p className="text-sm text-cocoa-soft py-4 text-center">아직 처리한 신청이 없어요.</p> : <div className="space-y-2">{data.history.map(card)}</div>}
        </>
      )}
    </div>
  );
}

function Reports() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const load = () => api<{ reports: Report[] }>('/api/admin/reports').then((r) => setReports(r.reports)).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  async function status(id: number, s: string) {
    await api(`/api/admin/reports/${id}/status`, { body: { status: s } }).catch((e) => toast(e.message, 'error'));
    load();
  }
  async function ban(userId: number, hours: number, name: string) {
    if (!confirm(hours ? `${name}님을 ${hours}시간 이용 정지할까요?` : `${name}님의 정지를 해제할까요?`)) return;
    await api('/api/admin/ban', { body: { userId, hours } }).then(() => toast('처리했어요')).catch((e) => toast(e.message, 'error'));
    load();
  }

  return (
    <>
      {!reports ? <p className="text-sm text-cocoa-soft">불러오는 중…</p> : reports.length === 0 ? <p className="text-sm text-cocoa-soft py-6 text-center">접수된 신고가 없어요.</p> : (
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r.id} className={`rounded-2xl p-3 ${r.status === 'open' ? 'bg-white' : 'bg-cream-2 opacity-75'}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-display">#{r.id} {r.reason}</span>
                <span className="text-cocoa-soft">{r.reporter_nickname} → <b className="text-cocoa">{r.target_nickname}</b></span>
                <span className="text-xs text-cocoa-soft ml-auto">{timeLabel(r.created_at)} · {r.status === 'open' ? '대기' : r.status === 'resolved' ? '처리됨' : '기각'}</span>
              </div>
              {r.detail && <p className="text-sm mt-1">{r.detail}</p>}
              {r.context && <pre className="text-xs bg-cream-2 rounded-xl p-2 mt-2 whitespace-pre-wrap font-body">{r.context}</pre>}
              <div className="flex flex-wrap gap-1.5 mt-2 text-xs">
                {r.target_type === 'post' && r.target_ref && <button className="btn btn-ghost px-3 py-1" onClick={() => {
                  if (!confirm('이 자랑 글을 숨길까요? (광장 스크린에서도 내려가요)')) return;
                  void api(`/api/admin/posts/${r.target_ref}/hide`, { body: {} }).then(() => toast('글을 숨겼어요')).catch((e) => toast(e.message, 'error'));
                }}>📝 글 숨기기</button>}
                <button className="btn btn-ghost px-3 py-1" onClick={() => ban(r.target_id, 24, r.target_nickname)}>24시간 정지</button>
                <button className="btn btn-ghost px-3 py-1" onClick={() => ban(r.target_id, 24 * 7, r.target_nickname)}>7일 정지</button>
                {r.target_banned_until > Date.now() && <button className="btn btn-ghost px-3 py-1" onClick={() => ban(r.target_id, 0, r.target_nickname)}>정지 해제</button>}
                {r.status === 'open' && <>
                  <button className="btn btn-sage px-3 py-1 !shadow-none" onClick={() => status(r.id, 'resolved')}>처리 완료</button>
                  <button className="btn btn-ghost px-3 py-1" onClick={() => status(r.id, 'dismissed')}>기각</button>
                </>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
