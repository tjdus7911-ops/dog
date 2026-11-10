import { useEffect, useState } from 'react';
import type { MyProfile, PrivacySettings } from '@shared/protocol';
import { api } from '../lib/api';
import { get, set, toast, useStore } from '../store';
import { disconnect, friendAction, refreshBlocked } from '../net/socket';
import { DEMO } from '../demo';
import { logout } from './App';
import { LegalModal, type LegalDoc } from './Legal';
import { DogBadge, PanelHeader } from './common';

const ITEMS: { key: keyof PrivacySettings; title: string; desc: string }[] = [
  { key: 'showOnline', title: '친구에게 접속 상태 공개', desc: '끄면 친구 목록에서 온라인/오프라인이 보이지 않아요.' },
  { key: 'showLocation', title: '친구에게 내가 있는 공원 공개', desc: '켜면 친구가 내 공원으로 찾아와 함께 산책할 수 있어요.' },
  { key: 'allowFriendRequests', title: '친구 신청 받기', desc: '끄면 새로운 친구 신청을 받지 않아요.' },
];

export function SettingsPanel() {
  const me = useStore((s) => s.me)!;
  const blocked = useStore((s) => s.blocked);
  const [privacy, setPrivacy] = useState(me.privacy);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { refreshBlocked(); }, []);

  async function withdraw() {
    if (!confirm('정말 탈퇴할까요? 아바타, 강아지 사진, 친구, 1:1 대화가 모두 삭제되고 되돌릴 수 없어요.')) return;
    setBusy(true);
    try {
      disconnect(); // 서버가 연결을 끊기 전에 먼저 정리 (재연결 시도 방지)
      await api('/api/me', { method: 'DELETE', body: { password: pw } });
      await logout();
      toast('탈퇴가 완료되었어요. 그동안 함께 산책해 주셔서 고마워요 🐾');
    } catch (e) {
      toast((e as Error).message, 'error');
      location.reload(); // 연결 복구
    } finally { setBusy(false); }
  }

  async function toggle(k: keyof PrivacySettings) {
    const next = { ...privacy, [k]: !privacy[k] };
    setPrivacy(next);
    try {
      const r = await api<{ profile: MyProfile }>('/api/me/privacy', { method: 'PUT', body: next });
      set({ me: { ...get().me!, privacy: r.profile.privacy } });
    } catch (e) { setPrivacy(privacy); toast((e as Error).message, 'error'); }
  }

  return (
    <aside className="above-nav-panel absolute z-30 right-2 md:right-3 top-[64px] md:top-[74px] bottom-3 w-[min(94vw,360px)] panel p-4 flex flex-col pop">
      <PanelHeader icon="🔒" title="개인정보·차단 설정" onClose={() => set({ panel: 'none' })} />
      <div className="overflow-y-auto scroll-soft space-y-2">
        {ITEMS.map((it) => (
          <button key={it.key} onClick={() => toggle(it.key)} className="w-full flex items-center gap-3 bg-white rounded-2xl p-3 text-left">
            <div className="flex-1"><div className="font-display">{it.title}</div><div className="text-xs text-cocoa-soft mt-0.5">{it.desc}</div></div>
            <span className={`w-12 h-7 rounded-full relative transition ${privacy[it.key] ? 'bg-sage' : 'bg-[#e4d8cc]'}`}>
              <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all ${privacy[it.key] ? 'left-6' : 'left-1'}`} />
            </span>
          </button>
        ))}
        <p className="text-xs text-cocoa-soft px-1 leading-relaxed">
          다른 사용자에게는 닉네임, 아바타, 강아지 이름·소개·사진만 보여요. 로그인 아이디는 공개되지 않아요.
          같은 공원 안에서는 모든 사용자가 아바타 위치를 볼 수 있어요.
        </p>
        <h3 className="font-display text-lg pt-3">🚫 차단한 사용자 {blocked.length}명</h3>
        {blocked.length === 0 && <p className="text-sm text-cocoa-soft">차단한 사용자가 없어요.</p>}
        {blocked.map((p) => (
          <div key={p.id} className="flex items-center gap-3 bg-white rounded-2xl p-2.5">
            <DogBadge profile={p} size={36} />
            <div className="flex-1 font-display">{p.nickname}</div>
            <button className="btn btn-ghost px-3 py-1.5 text-sm border border-[#f1e2d2] !shadow-none" onClick={() => friendAction('unblock', p.id)}>차단 해제</button>
          </div>
        ))}

        <div className="pt-4 mt-2 border-t border-[#f1e2d2] text-sm text-cocoa-soft flex flex-wrap gap-x-3 gap-y-1">
          <button className="underline" onClick={() => setLegal('terms')}>이용약관</button>
          <button className="underline" onClick={() => setLegal('privacy')}>개인정보 처리방침</button>
          {!DEMO && <button className="underline ml-auto" onClick={() => setLeaving((v) => !v)}>회원 탈퇴</button>}
        </div>
        {leaving && !DEMO && (
          <div className="bg-white rounded-2xl p-3 space-y-2">
            <p className="text-xs text-cocoa-soft">탈퇴하면 계정과 아바타, 강아지 사진, 친구·차단 목록, 1:1 대화가 바로 삭제돼요. 확인을 위해 비밀번호를 입력해 주세요.</p>
            <input className="field text-sm" type="password" autoComplete="current-password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button className="btn w-full py-2 text-sm bg-[#c4553a] text-white" disabled={!pw || busy} onClick={withdraw}>{busy ? '처리 중…' : '탈퇴하기'}</button>
          </div>
        )}
      </div>
      {legal && <LegalModal doc={legal} onClose={() => setLegal(null)} />}
    </aside>
  );
}
