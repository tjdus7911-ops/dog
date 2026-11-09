// 운영자 전용 신고 관리 (서버에서 운영자 권한을 다시 검증)
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { set, toast } from '../store';
import { Modal, PanelHeader, timeLabel } from './common';

interface Report {
  id: number; reporter_nickname: string; target_nickname: string; target_id: number; target_banned_until: number;
  reason: string; detail: string; context: string; status: string; created_at: number;
}

export default function AdminPanel() {
  const [tab, setTab] = useState<'reports' | 'screen'>('reports');
  return (
    <Modal onClose={() => set({ panel: 'none' })} className="max-w-3xl p-5">
      <PanelHeader icon="🛡️" title="운영 관리" onClose={() => set({ panel: 'none' })} />
      <div className="grid grid-cols-2 gap-1 bg-cream-2 rounded-full p-1 mb-3">
        {(['reports', 'screen'] as const).map((t) => (
          <button key={t} className={`btn py-2 text-sm ${tab === t ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setTab(t)}>{t === 'reports' ? '🚨 신고 관리' : '📺 광장 스크린'}</button>
        ))}
      </div>
      {tab === 'reports' ? <Reports /> : <ScreenAdmin />}
    </Modal>
  );
}

interface ScreenItem { id: number; kind: string; title: string; text: string; image: string | null; author: string; dogName: string | null; status: string; ts: number }

/** 광장 스크린: 공개 동의된 신청 승인·반려, 운영 공지 작성 */
function ScreenAdmin() {
  const [items, setItems] = useState<ScreenItem[] | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const load = () => api<{ items: ScreenItem[] }>('/api/admin/screen').then((r) => setItems(r.items)).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);
  async function act(id: number, action: string) {
    await api(`/api/admin/screen/${id}`, { body: { action } }).catch((e) => toast(e.message, 'error'));
    load();
  }
  async function notice() {
    await api('/api/admin/notices', { body: { title, text } }).then(() => { setTitle(''); setText(''); toast('공지를 스크린에 올렸어요'); }).catch((e) => toast(e.message, 'error'));
    load();
  }
  return (
    <div>
      <div className="rounded-2xl bg-white p-3">
        <div className="font-display mb-2">📢 운영 공지 올리기</div>
        <input className="field text-sm" maxLength={30} placeholder="공지 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="field text-sm mt-2" maxLength={80} placeholder="내용 (선택)" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-coral px-4 py-2 mt-2 text-sm" disabled={!title.trim()} onClick={notice}>스크린에 올리기</button>
      </div>
      {!items ? <p className="text-sm text-cocoa-soft mt-3">불러오는 중…</p> : items.length === 0 ? <p className="text-sm text-cocoa-soft py-6 text-center">신청이 없어요.</p> : (
        <div className="space-y-2 mt-3">
          {items.map((i) => (
            <div key={i.id} className={`rounded-2xl p-3 flex gap-3 ${i.status === 'pending' ? 'bg-white' : 'bg-cream-2'}`}>
              {i.image ? <img src={i.image} alt="" className="w-20 h-20 rounded-xl object-cover shrink-0" /> : <div className="w-20 h-20 rounded-xl bg-sage-soft grid place-items-center text-2xl shrink-0">📢</div>}
              <div className="flex-1 min-w-0">
                <div className="font-display">{i.title} <span className="text-xs text-cocoa-soft">· {i.kind === 'notice' ? '공지' : `${i.author} / 🐶 ${i.dogName}`} · {timeLabel(i.ts)}</span></div>
                {i.text && <p className="text-sm">{i.text}</p>}
                <div className="flex flex-wrap gap-1.5 mt-2 text-xs items-center">
                  <span className="text-cocoa-soft mr-1">{i.status === 'pending' ? '승인 대기' : i.status === 'approved' ? '노출 중' : i.status}</span>
                  {i.status === 'pending' && <>
                    <button className="btn btn-sage px-3 py-1 !shadow-none" onClick={() => act(i.id, 'approve')}>승인 (스크린 노출)</button>
                    <button className="btn btn-ghost px-3 py-1" onClick={() => act(i.id, 'reject')}>반려</button>
                  </>}
                  {i.status === 'approved' && <button className="btn btn-ghost px-3 py-1" onClick={() => act(i.id, 'hide')}>내리기</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
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
