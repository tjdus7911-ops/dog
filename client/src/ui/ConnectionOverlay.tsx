import { useStore } from '../store';
import { connect, joinOrWait } from '../net/socket';
import { logout } from './App';

export function ConnectionOverlay() {
  const conn = useStore((s) => s.connection);
  const reason = useStore((s) => s.kickReason);
  const wait = useStore((s) => s.parkWait);
  const cap = useStore((s) => s.parks.find((p) => p.kind === 'park')?.capacity ?? 30);
  if (conn === 'online' && wait) {
    // 모든 광장 만원: 자리가 나면 자동으로 들어감 (8초마다 다시 시도)
    return (
      <div className="absolute inset-0 z-50 grid place-items-center bg-[#51473F33] p-4" data-testid="park-wait">
        <div className="panel p-6 max-w-sm text-center pop">
          <p className="font-display text-xl">모든 광장이 가득 찼어요</p>
          <p className="text-sm text-cocoa-soft mt-2 leading-relaxed">광장마다 {cap}명까지 함께할 수 있어요.<br />자리가 나면 바로 들어갈게요. 잠시만 기다려 주세요.</p>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-cocoa-soft"><span className="w-2 h-2 rounded-full bg-[#E58D76] animate-pulse" />대기 중</div>
          <button className="btn btn-ghost w-full py-2.5 mt-4 border border-[#EAE3DC]" onClick={() => void joinOrWait()}>지금 다시 시도</button>
        </div>
      </div>
    );
  }
  if (conn === 'online') return null;
  if (conn === 'kicked') {
    return (
      <div className="absolute inset-0 z-50 grid place-items-center bg-[#5a403355] p-4">
        <div className="panel p-6 max-w-sm text-center pop">
          <div className="text-4xl">🐾</div>
          <p className="font-display text-xl mt-2">연결이 종료되었어요</p>
          <p className="text-sm text-cocoa-soft mt-1 whitespace-pre-line">{reason}</p>
          <div className="flex gap-2 mt-4">
            <button className="btn btn-ghost flex-1 py-2.5" onClick={logout}>로그아웃</button>
            <button className="btn btn-peach flex-1 py-2.5" onClick={connect}>다시 접속</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 panel !rounded-full px-4 py-2 text-sm font-display">
      🔌 서버에 연결하는 중…
    </div>
  );
}
