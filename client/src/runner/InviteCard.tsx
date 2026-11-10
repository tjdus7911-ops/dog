// 친구가 보낸 '함께 달리기' 초대 카드 (광장·멍글런너 어디서나 작게 표시)
import { set, useStore } from '../store';
import { useMulti } from './multi';

export function RunnerInviteCard() {
  const inv = useStore((s) => s.runnerInvite);
  const inRoom = useMulti((s) => s.room?.code);
  if (!inv || inRoom === inv.code) return null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 top-[calc(64px+var(--safe-t,0px))] z-[56] panel !rounded-2xl px-3 py-2.5 flex items-center gap-2 w-[min(94vw,420px)] pop" role="alert" data-testid="runner-invite">
      <span className="text-2xl">🏃</span>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="font-display text-sm truncate">{inv.nickname}님이 함께 달리기에 초대했어요</div>
        <div className="text-[11px] text-cocoa-soft">방 코드 {inv.code} · 🐶 {inv.dogName}와 대결!</div>
      </div>
      <button className="btn btn-ghost px-2.5 min-h-[40px] text-xs" onClick={() => set({ runnerInvite: null })}>닫기</button>
      <button className="btn btn-coral px-3 min-h-[40px] text-sm" data-testid="runner-invite-join" onClick={() => set({ runnerInvite: null, runnerJoin: inv.code, runner: true })}>참가</button>
    </div>
  );
}
