import { useEffect, useRef, useState } from 'react';
import { set, useStore } from '../store';
import { friendAction, goToFriend, openDm, openProfile, refreshFriends } from '../net/socket';
import { DogBadge, PanelHeader } from './common';
import type { FriendEntry } from '@shared/protocol';

export function FriendsPanel() {
  const friends = useStore((s) => s.friends);
  const incoming = useStore((s) => s.incoming);
  const outgoing = useStore((s) => s.outgoing);
  const [tab, setTab] = useState<'list' | 'incoming' | 'outgoing'>(incoming.length ? 'incoming' : 'list');
  useEffect(() => { refreshFriends(); }, []);
  // 받은 신청을 모두 처리하면 친구 목록으로 돌아감
  const prevIncoming = useRef(incoming.length);
  useEffect(() => {
    if (prevIncoming.current > 0 && incoming.length === 0 && tab === 'incoming') setTab('list');
    prevIncoming.current = incoming.length;
  }, [incoming.length, tab]);

  const sorted = [...friends].sort((a, b) => Number(!!b.online) - Number(!!a.online) || b.unread - a.unread);

  return (
    <aside className="absolute z-30 right-2 md:right-3 top-[64px] md:top-[74px] bottom-3 w-[min(94vw,360px)] panel p-4 flex flex-col pop">
      <PanelHeader icon="👥" title="친구" onClose={() => set({ panel: 'none' })} />
      <div className="grid grid-cols-3 gap-1 bg-cream-2 rounded-full p-1 mb-3 text-sm">
        {([['list', `친구 ${friends.length}`], ['incoming', `받은 신청 ${incoming.length}`], ['outgoing', `보낸 신청 ${outgoing.length}`]] as const).map(([k, l]) => (
          <button key={k} className={`btn py-1.5 ${tab === k ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto scroll-soft space-y-2 -mx-1 px-1">
        {tab === 'list' && (sorted.length === 0
          ? <Empty text="아직 친구가 없어요. 공원에서 다른 보호자를 눌러 친구 신청을 해 보세요!" />
          : sorted.map((f) => <FriendRow key={f.profile.id} f={f} />))}
        {tab === 'incoming' && (incoming.length === 0 ? <Empty text="받은 친구 신청이 없어요." /> : incoming.map(({ profile }) => (
          <div key={profile.id} className="flex items-center gap-3 bg-white rounded-2xl p-2.5">
            <button onClick={() => openProfile(profile.id)}><DogBadge profile={profile} size={44} /></button>
            <div className="flex-1 min-w-0"><div className="font-display truncate">{profile.nickname}</div><div className="text-xs text-cocoa-soft">🐶 {profile.dogName}</div></div>
            <button className="btn btn-peach px-3 py-1.5 text-sm" onClick={() => friendAction('friend:accept', profile.id)}>수락</button>
            <button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={() => friendAction('friend:decline', profile.id)}>거절</button>
          </div>
        )))}
        {tab === 'outgoing' && (outgoing.length === 0 ? <Empty text="보낸 친구 신청이 없어요." /> : outgoing.map((p) => (
          <div key={p.id} className="flex items-center gap-3 bg-white rounded-2xl p-2.5">
            <DogBadge profile={p} size={44} />
            <div className="flex-1 min-w-0"><div className="font-display truncate">{p.nickname}</div><div className="text-xs text-cocoa-soft">신청 중 · 🐶 {p.dogName}</div></div>
            <button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={() => friendAction('friend:cancel', p.id)}>신청 취소</button>
          </div>
        )))}
      </div>
    </aside>
  );
}

function FriendRow({ f }: { f: FriendEntry }) {
  const [menu, setMenu] = useState(false);
  const here = useStore((s) => s.park?.id === f.parkId && !!f.parkId);
  const p = f.profile;
  const status = f.online === null ? '접속 상태 비공개' : f.online ? (f.parkName ? `${f.parkName}에서 산책 중` : '온라인') : '오프라인';
  return (
    <div className="bg-white rounded-2xl p-2.5">
      <div className="flex items-center gap-3">
        <button className="relative" onClick={() => openProfile(p.id)}>
          <DogBadge profile={p} size={44} />
          <span className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${f.online ? 'bg-[#6fbf63]' : 'bg-[#cfc4ba]'}`} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-display truncate">{p.nickname} <span className="text-xs text-cocoa-soft font-body">· 🐶 {p.dogName}</span></div>
          <div className="text-xs text-cocoa-soft truncate">{here ? '🌸 같은 공원에 있어요' : status}</div>
        </div>
        <button className="text-cocoa-soft w-8 h-8 rounded-full hover:bg-cream-2" onClick={() => setMenu(!menu)} aria-label="더보기">⋯</button>
      </div>
      <div className="flex gap-1.5 mt-2">
        <button className="btn btn-ghost flex-1 py-1.5 text-sm relative border border-[#f1e2d2] !shadow-none" onClick={() => openDm(p)}>
          💬 메시지{f.unread > 0 && <span className="ml-1 bg-[#ef6b5b] text-white rounded-full px-1.5 text-[11px]">{f.unread}</span>}
        </button>
        {f.parkId && !here && <button className="btn btn-sage flex-1 py-1.5 text-sm !shadow-none" onClick={() => goToFriend(p.id)}>📍 함께 산책하기</button>}
      </div>
      {menu && (
        <div className="flex gap-1.5 mt-2">
          <button className="btn btn-ghost flex-1 py-1.5 text-xs !shadow-none border border-[#f1e2d2]" onClick={() => { if (confirm(`${p.nickname}님을 친구에서 삭제할까요?`)) friendAction('friend:remove', p.id); }}>친구 삭제</button>
          <button className="btn btn-ghost flex-1 py-1.5 text-xs !shadow-none border border-[#f1e2d2] text-[#c4553a]" onClick={() => { if (confirm(`${p.nickname}님을 차단할까요? 친구 관계가 끊기고 서로의 채팅이 보이지 않아요.`)) friendAction('block', p.id); }}>차단</button>
        </div>
      )}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-sm text-cocoa-soft text-center py-10 px-4 leading-relaxed">{text}</p>;
