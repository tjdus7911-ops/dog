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
    <Modal onClose={() => set({ panel: 'none' })} className="max-w-3xl p-5">
      <PanelHeader icon="🛡️" title="신고 관리" onClose={() => set({ panel: 'none' })} />
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
    </Modal>
  );
}
