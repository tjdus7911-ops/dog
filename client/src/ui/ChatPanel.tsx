// 공원 공개 채팅 — 서버를 통해 같은 공원 사용자에게 전달, 가까운 사용자에겐 말풍선으로도 표시
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LEN } from '@shared/protocol';
import { sendChat, openProfile } from '../net/socket';
import { set, useStore } from '../store';
import { isTouchDevice } from '../game/input';
import { timeLabel } from './common';

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const meId = useStore((s) => s.me?.id);
  const open = useStore((s) => s.chatOpen);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const touch = isTouchDevice();

  useEffect(() => { if (touch) set({ chatOpen: false }); }, [touch]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [chat.length, open]);
  useEffect(() => {
    // Enter: 채팅 입력으로 이동 / Esc: 게임으로 돌아가기
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (inputRef.current) inputRef.current.focus();
        else { set({ chatOpen: true }); setTimeout(() => inputRef.current?.focus(), 0); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) { inputRef.current?.blur(); return; }
    if (await sendChat(t)) setText('');
  }

  const last = chat[chat.length - 1];

  if (!open) {
    return (
      <button onClick={() => set({ chatOpen: true })}
        className={`absolute z-10 left-2 md:left-3 ${touch ? 'bottom-[172px]' : 'bottom-3'} panel !rounded-full px-4 py-2 text-sm max-w-[70vw] truncate text-left`}>
        💬 {last ? <><b className="font-display">{last.nickname}</b> {last.text}</> : '공원 채팅 열기'}
      </button>
    );
  }

  return (
    <div className={`absolute z-10 left-2 md:left-3 ${touch ? 'bottom-[172px] w-[min(86vw,340px)]' : 'bottom-3 w-[340px]'} panel p-2.5 flex flex-col`}>
      <div className="flex items-center gap-2 px-1 pb-1.5">
        <span className="font-display">💬 공원 채팅</span>
        <span className="text-[11px] text-cocoa-soft flex-1">같은 공원 사용자에게 전달돼요</span>
        <button className="text-cocoa-soft px-1" onClick={() => set({ chatOpen: false })} aria-label="채팅 접기">▾</button>
      </div>
      <div ref={listRef} className={`${touch ? 'h-28' : 'h-44'} overflow-y-auto scroll-soft space-y-1 px-1 text-[13px]`}>
        {chat.length === 0 && <p className="text-cocoa-soft text-xs py-6 text-center">아직 대화가 없어요. 먼저 인사해 보세요! 👋</p>}
        {chat.map((m) => (
          <div key={m.id} className="leading-snug">
            <button className={`font-display ${m.from === meId ? 'text-peach-deep' : 'text-cocoa hover:underline'}`} onClick={() => m.from !== meId && openProfile(m.from)}>{m.nickname}</button>
            <span className="text-[10px] text-cocoa-soft ml-1">{timeLabel(m.ts)}</span>
            <div className="break-words">{m.text}</div>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-1.5 mt-2">
        <input ref={inputRef} className="field !py-2 !rounded-full text-sm" value={text} maxLength={CHAT_MAX_LEN} placeholder={touch ? '메시지 입력' : 'Enter로 채팅 · Esc로 닫기'}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
        <button className="btn btn-peach px-4 text-sm shrink-0">전송</button>
      </form>
    </div>
  );
}
