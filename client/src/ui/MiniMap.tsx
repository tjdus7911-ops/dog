// 실시간 미니맵 — 내 위치(주황), 친구(초록), 다른 사용자(흰색)
import { useEffect, useRef } from 'react';
import { BINS, BUILDINGS, PAVILION, RADIAL_END, RUNNER_ARENA, FOUNTAIN_RADIUS, PATH_WIDTH, PLAZA_RADIUS, RADIAL_ANGLES, RING_RADIUS, TREES, WORLD_RADIUS } from '@shared/world';
import { local } from '../game/local';
import { rendered } from '../net/remote';
import { get, useStore } from '../store';

const SIZE = 132;

export function MiniMap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const park = useStore((s) => s.park);
  const count = useStore((s) => s.park?.count ?? 0);

  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = SIZE * dpr; c.height = SIZE * dpr;
    const g = c.getContext('2d')!;
    const k = (SIZE / 2 - 4) / (WORLD_RADIUS + 1);
    const P = (x: number, z: number): [number, number] => [SIZE / 2 + x * k, SIZE / 2 + z * k];
    const draw = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, SIZE, SIZE);
      g.fillStyle = '#b6db9c'; g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#f3e6cf'; g.lineWidth = PATH_WIDTH * k; g.lineCap = 'round';
      g.beginPath(); g.arc(SIZE / 2, SIZE / 2, RING_RADIUS * k, 0, Math.PI * 2); g.stroke();
      for (const a of RADIAL_ANGLES) { g.beginPath(); g.moveTo(...P(0, 0)); g.lineTo(...P(Math.sin(a) * RADIAL_END, Math.cos(a) * RADIAL_END)); g.stroke(); }
      g.fillStyle = '#f3e6cf'; g.beginPath(); g.arc(SIZE / 2, SIZE / 2, PLAZA_RADIUS * k, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9ad6e8'; g.beginPath(); g.arc(SIZE / 2, SIZE / 2, FOUNTAIN_RADIUS * k, 0, Math.PI * 2); g.fill();
      for (const t of TREES) { g.fillStyle = t.kind === 'cherry' ? '#f4b6c6' : '#86b874'; g.beginPath(); g.arc(...P(t.x, t.z), 1.6, 0, Math.PI * 2); g.fill(); }
      for (const b of BUILDINGS) { g.fillStyle = b.roof; const [x, y] = P(b.x - b.w / 2, b.z - b.d / 2); g.fillRect(x, y, b.w * k, b.d * k); }
      drawBinsAndPoops(g, P, 2.6);
      const friendIds = new Set(get().friends.map((f) => f.profile.id));
      rendered.forEach((r, id) => {
        const [x, y] = P(r.x, r.z);
        g.fillStyle = friendIds.has(id) ? '#5fa35a' : '#ffffff';
        g.strokeStyle = '#5a4033'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); g.stroke();
      });
      // 나
      const [mx, my] = P(local.x, local.z);
      g.save(); g.translate(mx, my); g.rotate(-local.rot + Math.PI);
      g.fillStyle = '#ef7a55'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -6); g.lineTo(4.5, 4.5); g.lineTo(0, 2.5); g.lineTo(-4.5, 4.5); g.closePath(); g.fill(); g.stroke();
      g.restore();
    };
    draw();
    const id = setInterval(draw, 160);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="absolute top-[108px] md:top-[78px] left-2 md:left-3 z-10 flex items-start gap-2 pointer-events-none">
      <canvas ref={ref} style={{ width: SIZE, height: SIZE }} className="rounded-full border-4 border-white shadow-lg hidden sm:block" />
      {/* 작은 화면: 한 줄로 간결하게 */}
      <span className="name-tag !text-xs !px-2.5 !py-1 sm:hidden">📍 {park ? park.name : '입장 중'} · 🐾 {count}명</span>
      <div className="hidden sm:flex flex-col gap-1.5">
        <span className="name-tag !text-sm !px-3 !py-1">📍 {park?.name ?? '입장 중'}</span>
        <span className="name-tag !text-sm !px-3 !py-1">🐾 산책 중 {count}명</span>
      </div>
    </div>
  );
}

/** 배변봉투 휴지통(초록 네모) · 치워야 할 내 강아지 배변(갈색 점) */
export function drawBinsAndPoops(g: CanvasRenderingContext2D, P: (x: number, z: number) => [number, number], r: number) {
  // 팔각정 (나무색 팔각형)
  { const [x, y] = P(PAVILION.x, PAVILION.z); const k = Math.max(3, P(PAVILION.x + PAVILION.r, 0)[0] - P(PAVILION.x, 0)[0]);
    g.fillStyle = '#d9b48a'; g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = PAVILION.rot + Math.PI / 8 + (i * Math.PI) / 4; const px = x + Math.sin(a) * k, py = y + Math.cos(a) * k; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
    g.closePath(); g.fill(); g.stroke(); }
  // 멍글런너 경기장 (코랄 원)
  { const [x, y] = P(RUNNER_ARENA.x, RUNNER_ARENA.z); const k = (P(RUNNER_ARENA.x + 4.4, 0)[0] - P(RUNNER_ARENA.x, 0)[0]);
    g.fillStyle = '#f7b8a4'; g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, Math.max(3, k), 0, Math.PI * 2); g.fill(); g.stroke(); }
  for (const b of BINS) {
    const [x, y] = P(b.x, b.z);
    g.fillStyle = '#5f9a5a'; g.strokeStyle = '#fff'; g.lineWidth = 1;
    g.fillRect(x - r, y - r, r * 2, r * 2); g.strokeRect(x - r, y - r, r * 2, r * 2);
    g.fillStyle = '#f6c453'; g.fillRect(x - r, y - r - 1, r * 2, 1.6);
  }
  const me = get().me?.id;
  for (const p of Object.values(get().poops)) {
    if (p.ownerId !== me) continue;
    const [x, y] = P(p.x, p.z);
    g.fillStyle = '#8b5a3a'; g.strokeStyle = '#fff'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(x, y, r * 1.1, 0, Math.PI * 2); g.fill(); g.stroke();
  }
}
