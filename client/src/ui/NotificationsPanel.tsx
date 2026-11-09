import { useEffect } from 'react';
import { get, set, useStore } from '../store';
import { openDm, openProfile } from '../net/socket';
import { PanelHeader, timeLabel } from './common';

export function NotificationsPanel() {
  const items = useStore((s) => s.notifications);
  useEffect(() => () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })), []);

  return (
    <aside className="absolute z-30 right-2 md:right-3 top-[64px] md:top-[74px] w-[min(94vw,340px)] max-h-[70vh] panel p-4 flex flex-col pop">
      <PanelHeader icon="🔔" title="알림" onClose={() => set({ panel: 'none' })} />
      <div className="overflow-y-auto scroll-soft space-y-1.5">
        {items.length === 0 && <p className="text-sm text-cocoa-soft text-center py-8">새 알림이 없어요.<br /><span className="text-xs">친구 신청·수락, 1:1 메시지가 오면 여기에 표시돼요.</span></p>}
        {items.map((n) => (
          <button key={n.id} className={`w-full text-left rounded-2xl px-3 py-2.5 ${n.read ? 'bg-white' : 'bg-peach-soft'}`}
            onClick={() => {
              if (n.kind === 'friend_request') set({ panel: 'friends' });
              else if (n.kind === 'dm') {
                const f = get().friends.find((x) => x.profile.id === n.fromId);
                if (f) openDm(f.profile);
                set({ panel: 'none' });
              } else { openProfile(n.fromId); set({ panel: 'none' }); }
            }}>
            <div className="text-sm">{n.kind === 'friend_request' ? '💌' : n.kind === 'dm' ? '💬' : '🐾'} {n.kind === 'dm' ? <><b>{n.fromNickname}</b>: {n.text}</> : n.text}</div>
            <div className="text-[11px] text-cocoa-soft mt-0.5">{timeLabel(n.ts)}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}
