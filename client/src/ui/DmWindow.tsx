// 친구 간 1:1 채팅 (서버 DB 저장 · 실시간 전달)
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DirectMessage, PublicProfile } from '@shared/protocol';
import { set, useStore } from '../store';
import { sendDm } from '../net/socket';
import { DogBadge, timeLabel } from './common';

const EMPTY: DirectMessage[] = [];

export function DmWindow({ profile }: { profile: PublicProfile }) {
  // zustand v5: 셀렉터가 매번 새 배열을 반환하면 무한 렌더가 발생하므로 상수 사용
  const msgs = useStore((s) => s.dms[profile.id] ?? EMPTY);
  const meId = useStore((s) => s.me!.id);
  const friend = useStore((s) => s.friends.find((f) => f.profile.id === profile.id));
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [msgs.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() && (await sendDm(profile.id, text.trim()))) setText('');
  }
  const status = !friend ? '친구가 아니에요' : friend.online === null ? '접속 상태 비공개' : friend.online ? '온라인' : '오프라인 · 메시지는 저장돼요';

  return (
    <div className="absolute z-30 right-2 md:right-[372px] bottom-[96px] md:bottom-3 w-[min(94vw,340px)] h-[min(60vh,440px)] panel p-3 flex flex-col pop">
      <div className="flex items-center gap-2 pb-2 border-b border-[#f6e9db]">
        <DogBadge profile={profile} size={36} />
        <div className="flex-1 min-w-0">
          <div className="font-display truncate">{profile.nickname}</div>
          <div className="text-[11px] text-cocoa-soft">{status}</div>
        </div>
        <button className="btn btn-ghost w-8 h-8 !shadow-none" onClick={() => set({ dmWith: null })} aria-label="닫기">✕</button>
      </div>
      <div ref={list} className="flex-1 overflow-y-auto scroll-soft py-2 space-y-1.5">
        {msgs.length === 0 && <p className="text-xs text-cocoa-soft text-center py-8">{profile.nickname}님에게 첫 메시지를 보내 보세요 🐾</p>}
        {msgs.map((m) => {
          const mine = m.from === meId;
          return (
            <div key={m.id} className={`flex items-end gap-1 ${mine ? 'justify-end' : ''}`}>
              {mine && <span className="text-[10px] text-cocoa-soft">{timeLabel(m.ts)}</span>}
              <div className={`max-w-[75%] px-3 py-1.5 rounded-2xl text-sm break-words ${mine ? 'bg-peach text-white rounded-br-md' : 'bg-white rounded-bl-md'}`}>{m.text}</div>
              {!mine && <span className="text-[10px] text-cocoa-soft">{timeLabel(m.ts)}</span>}
            </div>
          );
        })}
      </div>
      <form onSubmit={submit} className="flex gap-1.5 pt-2">
        <input className="field !py-2 !rounded-full text-sm" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder="메시지 입력" />
        <button className="btn btn-peach px-4 text-sm shrink-0">전송</button>
      </form>
    </div>
  );
}
