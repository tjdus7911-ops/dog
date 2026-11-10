// 모바일 가상 조이스틱 & 동작 버튼
import { useRef, useState } from 'react';
import { input, isTouchDevice, JOY_RUN } from '../game/input';
import { local } from '../game/local';
import { DEMO } from '../demo';
import { useStore } from '../store';
import { standUp } from '../game/Players';
import { startPhotoMode } from './Photo';
import { stopDogTask, stopFurniture } from '../game/furniture';
import { ACTION_GAP, ACTION_SIZE, CTRL_BOTTOM, JOY_KNOB, JOY_TOUCH, JOY_VISUAL } from './layout';

export function Joystick() {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const area = useRef<HTMLDivElement>(null);
  const pid = useRef<number | null>(null);
  const chatOpen = useStore((s) => s.chatOpen);
  const moreOpen = useStore((s) => s.moreOpen);
  // 채팅·더보기가 열리면 조이스틱을 숨긴다 (이동 입력도 함께 잠김)
  if (!isTouchDevice() || chatOpen || moreOpen) return null;
  // 보이는 원은 작게(110px), 손가락 인식 영역은 그보다 넓게(150px)
  const R = (JOY_VISUAL - JOY_KNOB) / 2 + 6;
  const pad = (JOY_TOUCH - JOY_VISUAL) / 2;

  const update = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y);
    if (d > R) { x = (x / d) * R; y = (y / d) * R; }
    setKnob({ x, y });
    input.joy.x = x / R; input.joy.y = -y / R; input.joy.active = true;
  };
  const end = () => { pid.current = null; setKnob({ x: 0, y: 0 }); input.joy.x = 0; input.joy.y = 0; input.joy.active = false; };

  return (
    <div ref={area} aria-label="이동 조이스틱"
      style={{ bottom: `calc(${CTRL_BOTTOM} - ${pad}px)`, left: 20 - pad, width: JOY_TOUCH, height: JOY_TOUCH }}
      className="absolute z-10 grid place-items-center touch-none select-none"
      onPointerDown={(e) => {
        // 조이스틱은 처음 누른 손가락 하나만 추적 (다른 손가락은 점프 등 다른 버튼에 사용)
        if (pid.current !== null) return;
        e.preventDefault();
        pid.current = e.pointerId; area.current!.setPointerCapture(e.pointerId); update(e);
      }}
      onPointerMove={(e) => { if (pid.current === e.pointerId) update(e); }}
      onPointerUp={(e) => { if (pid.current === e.pointerId) end(); }}
      onPointerCancel={(e) => { if (pid.current === e.pointerId) end(); }}
      onLostPointerCapture={(e) => { if (pid.current === e.pointerId) end(); }}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="relative rounded-full bg-[#fff8ef]/55 border-[3px] border-white/90 shadow-[0_4px_14px_rgba(90,64,51,.18)] pointer-events-none"
        style={{ width: JOY_VISUAL, height: JOY_VISUAL }}>
        {/* 끝까지 밀면(달리기) 손잡이가 코랄색으로 */}
        <div className={`absolute rounded-full shadow-md left-1/2 top-1/2 border ${Math.hypot(knob.x, knob.y) / R > JOY_RUN ? 'bg-[#f39a7b] border-[#f7c9b4]' : 'bg-white border-[#f1e2d2]'}`}
          style={{ width: JOY_KNOB, height: JOY_KNOB, transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
      </div>
    </div>
  );
}

export function ActionBar() {
  const touch = isTouchDevice();
  const benchSeated = useStore((s) => s.seated);
  // 벤치 또는 집 가구(소파·침대)를 쓰는 중이면 '일어나기'
  const furnUse = useStore((s) => s.furnUse);
  const dogTask = useStore((s) => s.dogTaskKey);
  const seated = !!benchSeated || !!furnUse;
  const getUp = () => (benchSeated ? standUp() : stopFurniture());
  const chatOpen = useStore((s) => s.chatOpen);
  const moreOpen = useStore((s) => s.moreOpen);
  if (touch) {
    // 모바일: 하단 내비게이션 위 오른쪽 2×2 버튼 묶음, 채팅·더보기가 열리면 숨김
    if (chatOpen || moreOpen) return null;
    return (
      <div className="absolute z-10 right-4 flex flex-col items-end gap-2.5 touch-none select-none" style={{ bottom: CTRL_BOTTOM }}>
        {seated && <div className="flex gap-2"><button className="btn btn-ghost px-4 min-h-[44px] text-sm shadow-lg pop" onClick={startPhotoMode}>📸 사진</button><button className="btn btn-coral px-4 min-h-[44px] text-sm shadow-lg pop" onClick={getUp}>🧍 일어나기</button></div>}
        {dogTask && <button className="btn btn-ghost px-4 min-h-[40px] text-sm shadow-lg pop" onClick={stopDogTask}>🐾 강아지 부르기</button>}
        {/* 모바일: 달리기 버튼 없음 — 조이스틱을 끝까지 밀면 달리기 (달리면서 점프 가능) */}
        <div className="grid grid-cols-2" style={{ gap: ACTION_GAP }}>
          <Action small icon="👋" label="인사하기" onClick={() => { local.waveUntil = performance.now() + 1800; }} />
          <Action small icon="🐕" label="앉아!" onClick={() => { local.sitUntil = performance.now() + 6000; }} />
          <div />
          <Action small icon="⬆️" label="점프" onClick={() => { input.jump = true; }} />
        </div>
      </div>
    );
  }
  return (
    <div className="absolute z-10 right-2 md:right-3 bottom-3 flex flex-col items-end gap-2">
      {!touch && (
        <div className="name-tag !text-[11px] !px-3 !py-1.5 opacity-90 hidden md:block">
          WASD·바닥 클릭 이동 · Shift+이동 달리기 · Space 점프 · 벤치·가구 클릭 · 드래그 카메라 회전 · 휠 확대/축소{DEMO ? '' : ' · Enter 채팅'}
        </div>
      )}
      {seated && (
        <div className="flex gap-2">
          <button className="btn btn-ghost px-5 py-3 text-base shadow-lg pop" onClick={startPhotoMode}>📸 사진 찍기</button>
          <button className="btn btn-coral px-5 py-3 text-base shadow-lg pop" onClick={getUp}>🧍 일어나기</button>
        </div>
      )}
      {dogTask && <button className="btn btn-ghost px-4 py-2 text-sm shadow-lg pop" onClick={stopDogTask}>🐾 강아지 부르기</button>}
      <div className="flex gap-2">
        <Action icon="👋" label="인사하기" onClick={() => { local.waveUntil = performance.now() + 1800; }} />
        <Action icon="🐕" label="앉아!" onClick={() => { local.sitUntil = performance.now() + 6000; }} />
        <Action icon="⤴️" label="점프" onClick={() => { input.jump = true; }} />
      </div>
    </div>
  );
}

function Action({ icon, label, onClick, active, small }: { icon: string; label: string; onClick: () => void; active?: boolean; small?: boolean }) {
  const [pressed, setPressed] = useState(false);
  const flash = () => { setPressed(true); window.setTimeout(() => setPressed(false), 180); };
  // 모바일 멀티터치: 조이스틱을 누른 채 다른 손가락으로 눌러도 바로 동작하도록 pointerdown에서 처리
  // (휴대폰 브라우저는 두 번째 손가락 터치에 click 이벤트를 만들지 않는 경우가 있음)
  return (
    <button
      onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); flash(); onClick(); }}
      onClick={(e) => { if (e.detail === 0) onClick(); /* 키보드(Enter/Space)로 누른 경우만 */ }}
      onContextMenu={(e) => e.preventDefault()}
      style={small ? { width: ACTION_SIZE, height: ACTION_SIZE } : undefined}
      className={`${small ? '' : 'w-[68px] h-[68px]'} rounded-full touch-none select-none flex flex-col items-center justify-center shadow-[0_4px_12px_rgba(90,64,51,.18)] border-2 transition active:scale-95 ${active || pressed ? 'bg-peach text-white border-peach-soft' : small ? 'bg-[#fff8ef]/95 border-white' : 'bg-white/95 border-white'}`}>
      <span className={`${small ? 'text-[19px]' : 'text-2xl'} leading-none`}>{icon}</span>
      <span className={`${small ? 'text-[10px]' : 'text-[11px]'} font-display mt-0.5 leading-none`}>{label}</span>
    </button>
  );
}
