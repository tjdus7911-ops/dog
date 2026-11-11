// 모바일 가상 조이스틱 & 동작 버튼
import { useRef, useState } from 'react';
import { input, isTouchDevice, JOY_RUN } from '../game/input';
import { local } from '../game/local';
import { DEMO } from '../demo';
import { useStore } from '../store';
import { standUp } from '../game/Players';
import { startPhotoMode } from './Photo';
import { stopDogTask, stopFurniture } from '../game/furniture';
import { ACTION_SIZE, ACTION_SMALL, CTRL_BOTTOM, JOY_KNOB, JOY_TOUCH, JOY_VISUAL } from './layout';
import { Icon, type IconName } from './icons';

export function Joystick() {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const area = useRef<HTMLDivElement>(null);
  const pid = useRef<number | null>(null);
  const chatOpen = useStore((s) => s.chatOpen);
  const moreOpen = useStore((s) => s.activeMenu === 'more' || s.activeMenu === 'home');
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
      <div className="relative rounded-full bg-[#FFFCF8]/45 border-2 border-white/90 shadow-[0_2px_10px_rgba(81,71,63,.12)] pointer-events-none"
        style={{ width: JOY_VISUAL, height: JOY_VISUAL }}>
        {/* 끝까지 밀면(달리기) 손잡이가 코랄색으로 */}
        <div className={`absolute rounded-full shadow-md left-1/2 top-1/2 border ${Math.hypot(knob.x, knob.y) / R > JOY_RUN ? 'bg-[#E58D76] border-[#F2C3B3]' : 'bg-white border-[#EAE3DC]'}`}
          style={{ width: JOY_KNOB, height: JOY_KNOB, transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
      </div>
    </div>
  );
}

const loadFolded = () => { try { return localStorage.getItem('mungle.actions') === 'closed'; } catch { return false; } };

export function ActionBar() {
  const touch = isTouchDevice();
  const benchSeated = useStore((s) => s.seated);
  // 벤치 또는 집 가구(소파·침대)를 쓰는 중이면 '일어나기'
  const furnUse = useStore((s) => s.furnUse);
  const dogTask = useStore((s) => s.dogTaskKey);
  const seated = !!benchSeated || !!furnUse;
  const getUp = () => (benchSeated ? standUp() : stopFurniture());
  const chatOpen = useStore((s) => s.chatOpen);
  const moreOpen = useStore((s) => s.activeMenu === 'more' || s.activeMenu === 'home');
  const [folded, setFolded] = useState(loadFolded);
  const fold = () => { setFolded(!folded); try { localStorage.setItem('mungle.actions', folded ? 'open' : 'closed'); } catch { /* 무시 */ } };
  const wave = () => { local.waveUntil = performance.now() + 1800; };
  const sit = () => { local.sitUntil = performance.now() + 6000; };
  const jump = () => { input.jump = true; };
  if (touch) {
    // 모바일(승인 시안): 작은 원형 버튼 — 인사·앉아 46px, 점프 52px. 위 화살표로 인사·앉아를 접을 수 있음.
    // 채팅·더보기가 열리면 숨김. 달리기는 조이스틱을 끝까지 밀면 됨 (달리면서 점프 가능)
    if (chatOpen || moreOpen) return null;
    return (
      <div className="absolute z-10 right-3 touch-none select-none" style={{ bottom: CTRL_BOTTOM, width: 144, height: 106 }} data-testid="action-bar">
        <div className="absolute right-0 bottom-full mb-2 flex flex-col items-end gap-2">
          {seated && <div className="flex gap-2"><button className="btn btn-ghost px-4 min-h-[44px] text-sm shadow-lg pop" onClick={startPhotoMode}>📸 사진</button><button className="btn btn-coral px-4 min-h-[44px] text-sm shadow-lg pop" onClick={getUp}>🧍 일어나기</button></div>}
          {dogTask && <button className="btn btn-ghost px-4 min-h-[40px] text-sm shadow-lg pop" onClick={stopDogTask}>🐾 강아지 부르기</button>}
        </div>
        <button onClick={fold} aria-label={folded ? '동작 버튼 펼치기' : '동작 버튼 접기'} aria-expanded={!folded} data-testid="action-fold"
          className="hud absolute right-0 top-0 w-[30px] h-[30px] rounded-full grid place-items-center">
          <Icon name={folded ? 'chevronUp' : 'chevronDown'} size={15} className="hud-icon" />
        </button>
        {!folded && <Action size={ACTION_SMALL} icon="dog" label="앉아" onClick={sit} style={{ left: 49, top: 17 }} />}
        {!folded && <Action size={ACTION_SMALL} icon="wave" label="인사" onClick={wave} style={{ left: 0, bottom: 3 }} />}
        <Action size={ACTION_SIZE} icon="up" label="점프" onClick={jump} style={{ right: 0, bottom: 0 }} />
      </div>
    );
  }
  return (
    <div className="absolute z-10 right-3 bottom-3 flex flex-col items-end gap-2">
      <div className="name-tag !text-[11px] !px-3 !py-1.5 opacity-90 hidden md:block">
        WASD·바닥 클릭 이동 · Shift+이동 달리기 · Space 점프 · 벤치·가구 클릭 · 드래그 카메라 회전 · 휠 확대/축소{DEMO ? '' : ' · Enter 채팅'}
      </div>
      {seated && (
        <div className="flex gap-2">
          <button className="btn btn-ghost px-5 py-3 text-base shadow-lg pop" onClick={startPhotoMode}>📸 사진 찍기</button>
          <button className="btn btn-coral px-5 py-3 text-base shadow-lg pop" onClick={getUp}>🧍 일어나기</button>
        </div>
      )}
      {dogTask && <button className="btn btn-ghost px-4 py-2 text-sm shadow-lg pop" onClick={stopDogTask}>🐾 강아지 부르기</button>}
      <div className="flex gap-2">
        <Action inline size={56} icon="wave" label="인사하기" onClick={wave} />
        <Action inline size={56} icon="dog" label="앉아!" onClick={sit} />
        <Action inline size={56} icon="up" label="점프" onClick={jump} />
      </div>
    </div>
  );
}

function Action({ icon, label, onClick, size, style, inline }: { icon: IconName; label: string; onClick: () => void; size: number; style?: React.CSSProperties; inline?: boolean }) {
  const [pressed, setPressed] = useState(false);
  const flash = () => { setPressed(true); window.setTimeout(() => setPressed(false), 180); };
  // 모바일 멀티터치: 조이스틱을 누른 채 다른 손가락으로 눌러도 바로 동작하도록 pointerdown에서 처리
  // (휴대폰 브라우저는 두 번째 손가락 터치에 click 이벤트를 만들지 않는 경우가 있음)
  return (
    <button
      aria-label={label}
      onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); flash(); onClick(); }}
      onClick={(e) => { if (e.detail === 0) onClick(); /* 키보드(Enter/Space)로 누른 경우만 */ }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ width: size, height: size, ...style }}
      className={`${inline ? '' : 'absolute'} hud rounded-full touch-none select-none flex flex-col items-center justify-center gap-0.5 transition ${pressed ? 'hud-on' : ''}`}>
      <Icon name={icon} size={size >= 52 ? 20 : 18} className={pressed ? '' : 'hud-icon'} />
      <span className="text-[10px] leading-none">{label}</span>
    </button>
  );
}
