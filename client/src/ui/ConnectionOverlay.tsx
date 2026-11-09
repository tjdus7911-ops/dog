import { useStore } from '../store';
import { connect } from '../net/socket';
import { logout } from './App';

export function ConnectionOverlay() {
  const conn = useStore((s) => s.connection);
  const reason = useStore((s) => s.kickReason);
  if (conn === 'online') return null;
  if (conn === 'kicked') {
    return (
      <div className="absolute inset-0 z-50 grid place-items-center bg-[#5a403355] p-4">
        <div className="panel p-6 max-w-sm text-center pop">
          <div className="text-4xl">🐾</div>
          <p className="font-display text-xl mt-2">연결이 종료되었어요</p>
          <p className="text-sm text-cocoa-soft mt-1">{reason}</p>
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
