// 광장 벤치 — 벤치를 누르면 빈 자리를 골라 앉을 수 있다. (좌석 점유는 서버가 관리)
import { SEATS } from '@shared/world';
import { set, useStore } from '../store';
import { local } from '../game/local';

export function BenchMenu() {
  const bench = useStore((s) => s.benchMenu);
  const seats = useStore((s) => s.seats);
  const players = useStore((s) => s.players);
  const me = useStore((s) => s.me)!;
  const seated = useStore((s) => s.seated);
  if (bench === null) return null;
  const list = SEATS.filter((s) => s.bench === bench);
  const close = () => set({ benchMenu: null });

  function choose(id: string) {
    const seat = list.find((s) => s.id === id)!;
    local.seatGoal = id;
    local.moveTarget = { x: seat.frontX, z: seat.frontZ };
    close();
  }

  return (
    <div className="absolute z-30 left-1/2 -translate-x-1/2 bottom-28 md:bottom-24 panel p-4 w-[min(92vw,340px)] pop">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🪑</span>
        <div className="flex-1">
          <div className="font-display text-lg leading-none">광장 벤치</div>
          <div className="text-xs text-cocoa-soft mt-1">강아지와 함께 앉아서 쉬어 가요. 앉은 채로 채팅할 수 있어요.</div>
        </div>
        <button className="btn btn-ghost w-9 h-9" onClick={close} aria-label="닫기">✕</button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {list.map((s, i) => {
          const who = seats[s.id];
          const mine = who === me.id || seated === s.id;
          const taken = who !== undefined && !mine;
          const name = taken ? players[who]?.nickname ?? '다른 산책러' : '';
          return (
            <button key={s.id} disabled={taken || mine} onClick={() => choose(s.id)}
              className={`rounded-2xl py-3 px-2 border-2 text-center ${mine ? 'border-[#a9cfa0] bg-sage-soft' : taken ? 'border-transparent bg-cream-2 opacity-70' : 'border-dashed border-[#e9d8c6] bg-white hover:border-[#f4776a]'}`}>
              <div className="font-display">{i === 0 ? '왼쪽 자리' : '오른쪽 자리'}</div>
              <div className="text-[11px] text-cocoa-soft mt-0.5">{mine ? '앉아 있는 자리' : taken ? `${name}님이 앉아 있어요` : '앉기 ▸'}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
