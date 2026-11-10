// 공원 공개 채팅 — 서버를 통해 같은 공원 사용자에게 전달, 가까운 사용자에겐 말풍선으로도 표시
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { CHAT_MAX_LEN } from '@shared/protocol';
import { sendChat, openProfile } from '../net/socket';
import { set, useStore } from '../store';
import { isTouchDevice, setMoveLocked } from '../game/input';
import { useVisualViewport } from './useViewport';
import { timeLabel } from './common';
import { DEMO } from '../demo';

export function ChatPanel() {
  if (DEMO) return <DemoNotice />;
  return <LiveChatPanel />;
}

import { MOBILE_TOP_ROWS } from './layout';

function DemoNotice() {
  const touch = isTouchDevice();
  const [open, setOpen] = useState(false);
  if (touch) {
    return (
      <button onClick={() => setOpen(!open)} style={{ top: `calc(var(--safe-t) + ${MOBILE_TOP_ROWS}px)` }}
        className="absolute z-10 left-3 panel !rounded-2xl px-3 py-1.5 text-left text-[12px] leading-relaxed max-w-[calc(100vw-96px)] min-h-[36px]">
        <span className="font-display text-[13px]">👀 미리보기 · 혼자 산책</span>{open ? <span className="block mt-1">서버 없이 아바타와 산책만 체험하는 화면이에요. 공원 채팅·친구·1:1 대화는 게임 서버에서 동작해요.</span> : <span className="text-cocoa-soft"> · 자세히</span>}
      </button>
    );
  }
  return (
    <div className={`absolute z-10 left-2 md:left-3 ${touch ? 'bottom-[172px] w-[min(86vw,320px)]' : 'bottom-3 w-[320px]'} panel p-3 text-[13px] leading-relaxed`}>
      <div className="font-display text-[15px] mb-1">👀 미리보기 · 혼자 산책 모드</div>
      서버 없이 아바타와 산책만 체험하는 화면이에요. 실시간 멀티플레이·공원 채팅·친구·1:1 대화·AI 사진 분석은 게임 서버를 실행하면 동작해요.
    </div>
  );
}

function LiveChatPanel() {
  return isTouchDevice() ? <MobileChat /> : <DesktopChat />;
}

/** 채팅 메시지 목록 (PC·모바일 공용) */
function ChatList({ listRef, className }: { listRef: RefObject<HTMLDivElement>; className: string }) {
  const chat = useStore((s) => s.chat);
  const meId = useStore((s) => s.me?.id);
  return (
    <div ref={listRef} className={`overflow-y-auto scroll-soft space-y-1 px-1 text-[13px] ${className}`}>
      {chat.length === 0 && <p className="text-cocoa-soft text-xs py-6 text-center">아직 대화가 없어요. 먼저 인사해 보세요! 👋</p>}
      {chat.map((m) => (
        <div key={m.id} className="leading-snug">
          <button className={`font-display ${m.from === meId ? 'text-peach-deep' : 'text-cocoa hover:underline'}`} onClick={() => m.from !== meId && openProfile(m.from)}>{m.nickname}</button>
          <span className="text-[10px] text-cocoa-soft ml-1">{timeLabel(m.ts)}</span>
          <div className="break-words">{m.text}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * 모바일 채팅: 닫혀 있으면 조이스틱 위의 작은 '공원 채팅' 버튼, 열리면 하단 바텀시트.
 * 채팅 열림(chatOpen) 하나의 상태로 시트 표시 · 조이스틱/액션 버튼 숨김 · 이동 입력 잠금을 함께 제어한다.
 * 키보드가 올라오면 Visual Viewport 기준으로 시트를 키보드 위로 올리고, 메시지 목록만 줄인다.
 */
function MobileChat() {
  const chat = useStore((s) => s.chat);
  const open = useStore((s) => s.chatOpen);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const vp = useVisualViewport();

  // 처음 들어오면 닫힌 상태로 시작
  useEffect(() => { set({ chatOpen: false }); }, []);
  // 채팅이 열려 있는 동안 이동 입력 잠금
  useEffect(() => { setMoveLocked(open); if (open) set({ chatUnread: 0 }); return () => setMoveLocked(false); }, [open]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [chat.length, open, vp.visibleHeight]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (await sendChat(t)) setText('');
    inputRef.current?.focus(); // 전송 후에도 키보드 유지
  }
  function close() {
    inputRef.current?.blur();
    set({ chatOpen: false });
  }

  // 닫혀 있을 때는 하단 내비게이션의 '채팅' 버튼으로 연다 (새 메시지 수 표시)
  if (!open) return null;

  // 기본: 화면의 약 38%. 키보드가 열리면 보이는 영역 안에서 시트 높이를 줄이고(목록만 축소) 키보드 바로 위에 붙인다.
  const base = Math.round(vp.fullHeight * 0.38);
  const height = vp.keyboardOpen ? Math.max(170, Math.min(base, Math.round(vp.visibleHeight * 0.55))) : base;
  return (
    <section aria-label="공원 채팅" className="mobile-sheet absolute z-30 inset-x-0 flex flex-col bg-[#fffaf4] rounded-t-[24px] shadow-[0_-8px_30px_rgba(90,64,51,.18)] border-t-2 border-white"
      style={{ bottom: vp.bottomInset, height, paddingBottom: vp.keyboardOpen ? 8 : 'calc(var(--safe-b) + 8px)' }}>
      <div className="mx-auto mt-1.5 w-10 h-1.5 rounded-full bg-[#e9d8c6]" />
      <header className="flex items-center gap-2 px-4 pt-1">
        <span className="font-display text-lg">💬 공원 채팅</span>
        <span className="text-[11px] text-cocoa-soft flex-1 truncate">같은 공원 사용자에게 전달돼요</span>
        <button className="w-11 h-11 -mr-2 grid place-items-center rounded-full text-cocoa-soft text-lg active:bg-cream-2" onClick={close} aria-label="채팅 닫기">✕</button>
      </header>
      <ChatList listRef={listRef} className="flex-1 min-h-0 px-4" />
      <form onSubmit={submit} className="flex gap-2 px-3 pt-2">
        <input ref={inputRef} className="field !py-2.5 !rounded-full text-[16px] min-h-[44px]" value={text} maxLength={CHAT_MAX_LEN} placeholder="메시지 입력"
          enterKeyHint="send" onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-peach px-5 text-sm shrink-0 min-h-[44px]">전송</button>
      </form>
    </section>
  );
}

function DesktopChat() {
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
