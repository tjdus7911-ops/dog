// 광장 벤치 — 벤치를 누르면 빈 자리를 골라 앉을 수 있다. (좌석 점유는 서버가 관리)
import { ABOVE_CTRL } from './layout';
import { BENCHES, PAVILION, SEATS } from '@shared/world';
import { set, useStore } from '../store';
import { local } from '../game/local';
import { isTouchDevice } from '../game/input';

export function BenchMenu() {
  const bench = useStore((s) => s.benchMenu);
  const seats = useStore((s) => s.seats);
  const players = useStore((s) => s.players);
  const me = useStore((s) => s.me)!;
  const seated = useStore((s) => s.seated);
  const mobileChat = useStore((s) => s.chatOpen) && isTouchDevice();
  if (bench === null || mobileChat) return null;
  const list = SEATS.filter((s) => s.bench === bench);
  const pavilion = BENCHES[bench]?.kind === 'pavilion';
  const seatLabel = (i: number) => (list.length > 3 ? `${i + 1}번` : list.length === 3 ? ['왼쪽 자리', '가운데 자리', '오른쪽 자리'][i] : i === 0 ? '왼쪽 자리' : '오른쪽 자리');
  const close = () => set({ benchMenu: null });

  function choose(id: string) {
    const seat = list.find((s) => s.id === id)!;
    local.seatGoal = id;
    // 팔각정 밖에서 고르면 난간에 막히지 않게 출입구 → 가운데를 거쳐 자리 앞으로
    if (pavilion && Math.hypot(local.x - PAVILION.x, local.z - PAVILION.z) > PAVILION.r - 0.6) {
      const ex = Math.sin(PAVILION.rot), ez = Math.cos(PAVILION.rot);
      local.moveTarget = { x: PAVILION.x + ex * (PAVILION.r + 1.2), z: PAVILION.z + ez * (PAVILION.r + 1.2) };
      local.moveVia = [{ x: PAVILION.x + ex * 0.6, z: PAVILION.z + ez * 0.6 }, { x: seat.frontX, z: seat.frontZ }];
    } else {
      local.moveVia = [];
      local.moveTarget = { x: seat.frontX, z: seat.frontZ };
    }
    close();
  }

  return (
    <div style={{ bottom: isTouchDevice() ? ABOVE_CTRL : undefined }} className="absolute z-30 left-1/2 -translate-x-1/2 bottom-24 panel p-4 w-[min(92vw,340px)] pop">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{pavilion ? '🪵' : '🪑'}</span>
        <div className="flex-1">
          <div className="font-display text-lg leading-none">{pavilion ? '멍글 팔각정' : '광장 벤치'}</div>
          <div className="text-xs text-cocoa-soft mt-1">{pavilion ? '다 같이 둘러앉아 쉬어 가요. 앉은 채로 채팅할 수 있어요.' : '강아지와 함께 앉아서 쉬어 가요. 앉은 채로 채팅할 수 있어요.'}</div>
        </div>
        <button className="btn btn-ghost w-9 h-9" onClick={close} aria-label="닫기">✕</button>
      </div>
      <div className={`grid ${list.length > 3 ? 'grid-cols-5 gap-1.5' : list.length === 3 ? 'grid-cols-3 gap-2' : 'grid-cols-2 gap-2'} mt-3`}>
        {list.map((s, i) => {
          const who = seats[s.id];
          const mine = who === me.id || seated === s.id;
          const taken = who !== undefined && !mine;
          const name = taken ? players[who]?.nickname ?? '다른 산책러' : '';
          return (
            <button key={s.id} disabled={taken || mine} onClick={() => choose(s.id)}
              className={`rounded-2xl py-3 ${list.length > 3 ? 'px-0.5 min-w-0' : 'px-2'} border-2 text-center ${mine ? 'border-[#a9cfa0] bg-sage-soft' : taken ? 'border-transparent bg-cream-2 opacity-70' : 'border-dashed border-[#e9d8c6] bg-white hover:border-[#f4776a]'}`}>
              <div className="font-display">{seatLabel(i)}</div>
              <div className="text-[11px] text-cocoa-soft mt-0.5">{list.length > 3 ? (mine ? '내 자리' : taken ? name : '앉기 ▸') : mine ? '앉아 있는 자리' : taken ? `${name}님이 앉아 있어요` : '앉기 ▸'}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
