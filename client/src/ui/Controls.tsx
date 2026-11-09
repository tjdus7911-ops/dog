// 모바일 가상 조이스틱 & 동작 버튼
import { useRef, useState } from 'react';
import { input, isTouchDevice } from '../game/input';
import { local } from '../game/local';
import { DEMO } from '../demo';
import { useStore } from '../store';
import { standUp } from '../game/Players';
import { startPhotoMode } from './Photo';
import { MOBILE_JOY_BOTTOM, MOBILE_JOY_SIZE } from './ChatPanel';

export function Joystick() {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const base = useRef<HTMLDivElement>(null);
  const pid = useRef<number | null>(null);
  const chatOpen = useStore((s) => s.chatOpen);
  // 채팅이 열리면 조이스틱을 숨긴다 (이동 입력도 함께 잠김)
  if (!isTouchDevice() || chatOpen) return null;
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
      style={{ bottom: `calc(var(--safe-b) + ${MOBILE_JOY_BOTTOM}px)`, width: MOBILE_JOY_SIZE, height: MOBILE_JOY_SIZE }}
      className="absolute z-10 left-4 rounded-full bg-white/45 border-4 border-white/80 shadow-lg touch-none select-none"
      onPointerDown={(e) => {
        // 조이스틱은 처음 누른 손가락 하나만 추적 (다른 손가락은 점프 등 다른 버튼에 사용)
        if (pid.current !== null) return;
        e.preventDefault();
        pid.current = e.pointerId; base.current!.setPointerCapture(e.pointerId); update(e);
      }}
      onPointerMove={(e) => { if (pid.current === e.pointerId) update(e); }}
      onPointerUp={(e) => { if (pid.current === e.pointerId) end(); }}
      onPointerCancel={(e) => { if (pid.current === e.pointerId) end(); }}
      onLostPointerCapture={(e) => { if (pid.current === e.pointerId) end(); }}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="absolute w-14 h-14 rounded-full bg-white shadow-md left-1/2 top-1/2 pointer-events-none"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
    </div>
  );
}

export function ActionBar() {
  const touch = isTouchDevice();
  const [run, setRun] = useState(false);
  const seated = useStore((s) => s.seated);
  const chatOpen = useStore((s) => s.chatOpen);
  if (touch) {
    // 모바일: 2×2 버튼 묶음 (조이스틱과 겹치지 않는 폭), 채팅이 열리면 숨김
    if (chatOpen) return null;
    return (
      <div className="absolute z-10 right-3 flex flex-col items-end gap-2 touch-none select-none" style={{ bottom: `calc(var(--safe-b) + ${MOBILE_JOY_BOTTOM}px)` }}>
        {seated && <div className="flex gap-2"><button className="btn btn-ghost px-4 min-h-[44px] text-sm shadow-lg pop" onClick={startPhotoMode}>📸 사진</button><button className="btn btn-coral px-4 min-h-[44px] text-sm shadow-lg pop" onClick={standUp}>🧍 일어나기</button></div>}
        <div className="grid grid-cols-2 gap-2">
          <Action small icon="👋" label="인사하기" onClick={() => { local.waveUntil = performance.now() + 1800; }} />
          <Action small icon="🐕" label="앉아!" onClick={() => { local.sitUntil = performance.now() + 6000; }} />
          <Action small icon="⤴️" label="점프" onClick={() => { input.jump = true; }} />
          <Action small icon="🏃" label={run ? '달리는 중' : '달리기'} active={run} onClick={() => { input.runToggle = !run; setRun(!run); }} />
        </div>
      </div>
    );
  }
  return (
    <div className="absolute z-10 right-2 md:right-3 bottom-3 flex flex-col items-end gap-2">
      {!touch && (
        <div className="name-tag !text-[11px] !px-3 !py-1.5 opacity-90 hidden md:block">
          WASD·바닥 클릭 이동 · 벤치 클릭 앉기 · Space 점프 · Shift 달리기 · 드래그 카메라 회전 · 휠 확대/축소{DEMO ? '' : ' · Enter 채팅'}
        </div>
      )}
      {seated && (
        <div className="flex gap-2">
          <button className="btn btn-ghost px-5 py-3 text-base shadow-lg pop" onClick={startPhotoMode}>📸 사진 찍기</button>
          <button className="btn btn-coral px-5 py-3 text-base shadow-lg pop" onClick={standUp}>🧍 일어나기</button>
        </div>
      )}
      <div className="flex gap-2">
        <Action icon="👋" label="인사하기" onClick={() => { local.waveUntil = performance.now() + 1800; }} />
        <Action icon="🐕" label="앉아!" onClick={() => { local.sitUntil = performance.now() + 6000; }} />
        <Action icon="⤴️" label="점프" onClick={() => { input.jump = true; }} />
        {touch && <Action icon="🏃" label={run ? '달리는 중' : '달리기'} active={run} onClick={() => { input.runToggle = !run; setRun(!run); }} />}
      </div>
    </div>
  );
}

function Action({ icon, label, onClick, active, small }: { icon: string; label: string; onClick: () => void; active?: boolean; small?: boolean }) {
  // 모바일 멀티터치: 조이스틱을 누른 채 다른 손가락으로 눌러도 바로 동작하도록 pointerdown에서 처리
  // (휴대폰 브라우저는 두 번째 손가락 터치에 click 이벤트를 만들지 않는 경우가 있음)
  return (
    <button
      onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); onClick(); }}
      onClick={(e) => { if (e.detail === 0) onClick(); /* 키보드(Enter/Space)로 누른 경우만 */ }}
      onContextMenu={(e) => e.preventDefault()}
      className={`${small ? 'w-[62px] h-[62px]' : 'w-[68px] h-[68px]'} rounded-full touch-none select-none flex flex-col items-center justify-center shadow-lg border-2 border-white transition active:scale-95 ${active ? 'bg-peach text-white' : 'bg-white/95'}`}>
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-[11px] font-display mt-0.5">{label}</span>
    </button>
  );
}
