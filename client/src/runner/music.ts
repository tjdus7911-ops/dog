// 멍글런너 음악 — 악보 데이터(shared/runner)로 피아노 소리를 직접 합성한다 (외부 녹음 음원을 쓰지 않음).
// 같은 악보에서 장애물 박자를 만들기 때문에 음악과 판정 타임라인이 항상 정확히 일치한다.
import type { Song } from '@shared/runner';

const cache = new Map<string, Promise<AudioBuffer>>();
const SR = 44100;

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** 부드러운 피아노 느낌의 음색 (배음 감쇠) */
function pianoWave(ctx: BaseAudioContext) {
  const h = [0, 1, 0.42, 0.2, 0.11, 0.05, 0.03, 0.015];
  const real = new Float32Array(h.length), imag = new Float32Array(h);
  return ctx.createPeriodicWave(real, imag);
}

/** 짧은 잔향 (노이즈가 줄어드는 임펄스) */
function reverbImpulse(ctx: BaseAudioContext, sec = 1.6) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, 3) * 0.6;
  }
  return buf;
}

/** 곡 전체를 오디오 버퍼로 미리 만들어 둔다 (한 번 만들면 재사용) */
export function renderSong(song: Song): Promise<AudioBuffer> {
  let p = cache.get(song.courseId);
  if (!p) {
    p = (async () => {
      const ctx = new OfflineAudioContext(2, Math.ceil((song.duration + 2) * SR), SR);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3;
      const master = ctx.createGain(); master.gain.value = 0.9;
      const wet = ctx.createGain(); wet.gain.value = 0.22;
      const verb = ctx.createConvolver(); verb.buffer = reverbImpulse(ctx, 1.1);
      const bus = ctx.createGain();
      bus.connect(master); bus.connect(verb); verb.connect(wet); wet.connect(master);
      master.connect(comp); comp.connect(ctx.destination);
      const wave = pianoWave(ctx);
      // 높은 음은 배음을 줄여 부드럽게 (음마다 필터를 두지 않아 모바일에서도 빨리 만들어짐)
      const soft = ctx.createPeriodicWave(new Float32Array(5), new Float32Array([0, 1, 0.25, 0.08, 0.03]));
      for (const n of song.notes) {
        const f = freq(n.midi);
        const t0 = n.t;
        // 낮은 음일수록 길게 울림
        const tau = Math.max(0.28, Math.min(1.5, 0.95 * Math.pow(440 / f, 0.45)));
        const end = t0 + Math.max(n.dur * 1.6, 0.35) + tau * 1.2;
        const o = ctx.createOscillator(); o.setPeriodicWave(n.midi >= 74 ? soft : wave); o.frequency.value = f;
        const g = ctx.createGain();
        const peak = 0.16 * n.vel * (n.hand ? 0.85 : 1);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.005);
        g.gain.setTargetAtTime(peak * 0.35, t0 + 0.005, tau * 0.35);
        g.gain.setTargetAtTime(0, t0 + Math.max(n.dur * 1.3, 0.2), tau * 0.45);
        o.connect(g); g.connect(bus);
        o.start(t0); o.stop(end);
        // 2절 멜로디: 한 옥타브 위 오르골 소리를 살짝 겹쳐 밝게
        if (n.part === 1 && n.hand === 0) {
          const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = f * 2;
          const bg = ctx.createGain();
          bg.gain.setValueAtTime(0, t0); bg.gain.linearRampToValueAtTime(0.045 * n.vel, t0 + 0.004); bg.gain.setTargetAtTime(0, t0 + 0.01, 0.18);
          b.connect(bg); bg.connect(bus); b.start(t0); b.stop(t0 + 1.2);
        }
      }
      return ctx.startRendering();
    })();
    cache.set(song.courseId, p);
    p.catch(() => cache.delete(song.courseId));
  }
  return p;
}

/**
 * 재생기: '지금 귀에 들리는 음악 시각'을 계산한다.
 * getOutputTimestamp(실제 출력 시각)를 우선 쓰고, 없으면 outputLatency로 보정 — 모바일 오디오 지연 보정.
 */
export class MusicPlayer {
  ctx: AudioContext;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  private startAt = 0;
  private frozen: number | null = null;
  constructor(volume = 0.9) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(this.ctx.destination);
  }
  /** delaySec: 출발 카운트다운 동안 기다렸다가 재생 (그동안 now()는 음수) */
  async play(buf: AudioBuffer, fromSec = 0, delaySec = 0) {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.src?.stop(); this.src?.disconnect();
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.connect(this.gain);
    const when = this.ctx.currentTime + 0.1 + delaySec;
    s.start(when, fromSec);
    this.src = s;
    this.startAt = when - fromSec;
    this.frozen = null;
  }
  /** 실제로 들리고 있는 음악 위치 (ms) */
  now(): number {
    if (this.frozen !== null) return this.frozen;
    const c = this.ctx as AudioContext & { getOutputTimestamp?: () => AudioTimestamp };
    let t = this.ctx.currentTime - ((this.ctx as unknown as { outputLatency?: number }).outputLatency || this.ctx.baseLatency || 0);
    const ts = c.getOutputTimestamp?.();
    if (ts && ts.contextTime && ts.performanceTime) t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return (t - this.startAt) * 1000;
  }
  async pause() { this.frozen = this.now(); await this.ctx.suspend(); }
  async resume() { await this.ctx.resume(); this.frozen = null; }
  stop() { try { this.src?.stop(); } catch { /* 이미 멈춤 */ } this.src = null; }
  /** 판정 효과음 */
  blip(kind: 'perfect' | 'great' | 'good' | 'miss') {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = kind === 'miss' ? 'triangle' : 'sine';
    o.frequency.value = kind === 'perfect' ? 1568 : kind === 'great' ? 1319 : kind === 'good' ? 1047 : 160;
    g.gain.setValueAtTime(kind === 'miss' ? 0.12 : 0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'miss' ? 0.18 : 0.12));
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.2);
  }
  close() { this.stop(); if (this.ctx.state !== 'closed') void this.ctx.close().catch(() => {}); }
}
