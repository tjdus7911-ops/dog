// 모바일 가상 조이스틱 & 동작 버튼
import { useRef, useState } from 'react';
import { input, isTouchDevice } from '../game/input';
import { local } from '../game/local';
import { DEMO } from '../demo';

export function Joystick() {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const base = useRef<HTMLDivElement>(null);
  const pid = useRef<number | null>(null);
  if (!isTouchDevice()) return null;
  const R = 52;

  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y);
    if (d > R) { x = (x / d) * R; y = (y / d) * R; }
    setKnob({ x, y });
    input.joy.x = x / R; input.joy.y = -y / R; input.joy.active = true;
  };
  const end = () => { pid.current = null; setKnob({ x: 0, y: 0 }); input.joy.x = 0; input.joy.y = 0; input.joy.active = false; };

  return (
    <div ref={base}
      className="absolute z-10 left-5 bottom-6 w-[136px] h-[136px] rounded-full bg-white/45 border-4 border-white/80 shadow-lg touch-none select-none"
      onPointerDown={(e) => { pid.current = e.pointerId; (e.target as HTMLElement).setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => { if (pid.current === e.pointerId) update(e); }}
      onPointerUp={end} onPointerCancel={end}>
      <div className="absolute w-14 h-14 rounded-full bg-white shadow-md left-1/2 top-1/2 pointer-events-none"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
    </div>
  );
}

export function ActionBar() {
  const touch = isTouchDevice();
  const [run, setRun] = useState(false);
  return (
    <div className="absolute z-10 right-2 md:right-3 bottom-3 flex flex-col items-end gap-2">
      {!touch && (
        <div className="name-tag !text-[11px] !px-3 !py-1.5 opacity-90 hidden md:block">
          WASD 이동 · Shift 달리기 · 드래그 카메라 회전 · 휠 확대/축소{DEMO ? '' : ' · Enter 채팅'}
        </div>
      )}
      <div className="flex gap-2">
        <Action icon="👋" label="인사하기" onClick={() => { local.waveUntil = performance.now() + 1800; }} />
        <Action icon="🐕" label="앉아!" onClick={() => { local.sitUntil = performance.now() + 6000; }} />
        {touch && <Action icon="🏃" label={run ? '달리는 중' : '달리기'} active={run} onClick={() => { input.runToggle = !run; setRun(!run); }} />}
      </div>
    </div>
  );
}

function Action({ icon, label, onClick, active }: { icon: string; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-[68px] h-[68px] rounded-full flex flex-col items-center justify-center shadow-lg border-2 border-white transition active:scale-95 ${active ? 'bg-peach text-white' : 'bg-white/95'}`}>
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-[11px] font-display mt-0.5">{label}</span>
    </button>
  );
}
