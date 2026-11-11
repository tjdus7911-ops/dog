import { useEffect, useRef, useState } from 'react';
import { set, useStore } from '../store';
import { friendAction, goToFriend, joinPark, openDm, openProfile, refreshFriends } from '../net/socket';
import { get, toast } from '../store';
import { residenceLabel } from '@shared/apartment';
import type { PublicProfile } from '@shared/protocol';
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
    <aside className="above-nav-panel absolute z-30 right-2 md:right-3 top-[64px] md:top-[74px] bottom-3 w-[min(94vw,360px)] panel p-4 flex flex-col pop">
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
  // 친구가 있는 광장의 현재 인원 (서버 집계) — 가득 찼으면 따라가기 대신 '만원'
  const fp = useStore((s) => (f.parkId ? s.parks.find((x) => x.id === f.parkId) : undefined));
  const full = !!fp && fp.kind === 'park' && fp.count >= fp.capacity;
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
          <div className="text-xs text-cocoa-soft truncate">{here ? '🌸 같은 곳에 있어요' : status}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 mt-2">
        <button className="btn btn-ghost py-2 text-sm relative border border-[#f1e2d2] !shadow-none" onClick={() => openDm(p)}>
          💬 채팅하기{f.unread > 0 && <span className="ml-1 bg-[#ef6b5b] text-white rounded-full px-1.5 text-[11px]">{f.unread}</span>}
        </button>
        <button className="btn btn-ghost py-2 text-sm border border-[#f1e2d2] !shadow-none" onClick={() => visitFriendHome(p)}>🏠 집 놀러 가기</button>
        <button className="btn btn-ghost py-2 text-sm border border-[#f1e2d2] !shadow-none" onClick={() => set({ dogSheet: p.id, panel: 'none' })}>🐶 강아지 보기</button>
        <button className={`btn py-2 text-sm !shadow-none border border-[#f1e2d2] ${menu ? 'btn-peach' : 'btn-ghost'}`} onClick={() => setMenu(!menu)}>🤝 친구 관계 관리</button>
        {f.parkId && !here && (full
          ? <button className="btn btn-ghost col-span-2 py-2 text-sm !shadow-none border border-[#f1e2d2] opacity-60" disabled>📍 {f.parkName}은(는) 지금 만원이에요 ({fp!.count}/{fp!.capacity}명)</button>
          : <button className="btn btn-sage col-span-2 py-2 text-sm !shadow-none" onClick={() => goToFriend(p.id)} data-testid={`follow-${p.id}`}>📍 {f.parkName}(으)로 따라가기</button>)}
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

/** 친구 집 놀러 가기: 동·호실 확인 → 아파트 로비(복도)로 이동 → 그 집 문 앞 안내에서 방문하기 */
async function visitFriendHome(p: PublicProfile) {
  if (!p.residence) { toast(`${p.nickname}님은 아직 아파트에 입주하지 않았어요.`); return; }
  set({ panel: 'none' });
  if (get().park?.kind !== 'lobby' && !(await joinPark('lobby-1'))) return;
  toast(`🏢 ${residenceLabel(p.residence)} ${p.nickname}님 집으로 가요`);
  set({ lobbyFocus: p.id });
}
