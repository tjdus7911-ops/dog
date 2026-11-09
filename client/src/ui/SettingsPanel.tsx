import { useEffect, useState } from 'react';
import type { MyProfile, PrivacySettings } from '@shared/protocol';
import { api } from '../lib/api';
import { get, set, toast, useStore } from '../store';
import { friendAction, refreshBlocked } from '../net/socket';
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
  useEffect(() => { refreshBlocked(); }, []);

  async function toggle(k: keyof PrivacySettings) {
    const next = { ...privacy, [k]: !privacy[k] };
    setPrivacy(next);
    try {
      const r = await api<{ profile: MyProfile }>('/api/me/privacy', { method: 'PUT', body: next });
      set({ me: { ...get().me!, privacy: r.profile.privacy } });
    } catch (e) { setPrivacy(privacy); toast((e as Error).message, 'error'); }
  }

  return (
    <aside className="absolute z-30 right-2 md:right-3 top-[64px] md:top-[74px] bottom-3 w-[min(94vw,360px)] panel p-4 flex flex-col pop">
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
      </div>
    </aside>
  );
}
