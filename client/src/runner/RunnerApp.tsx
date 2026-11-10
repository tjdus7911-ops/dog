// 멍글런너 — 로비(곡·코스 선택) · 플레이 · 결과 · 랭킹 · 보상 · 게임 방법 · 설정
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { DogAnim, HumanAnim } from '@shared/protocol';
import { GUEST_DOG, GUEST_HUMAN, type DogAvatar, type HumanAvatar } from '@shared/avatar';
import {
  COURSES, JUDGE, RUNNER_GAME_VERSION, buildChart, buildSong, judgeRun, type CourseInfo, type Grade, type RunResult,
} from '@shared/runner';
import { Dog, newDogDriver } from '../game/models/Dog';
import { Human, newHumanDriver } from '../game/models/Human';
import { Lighting } from '../game/Lighting';
import { setMoveLocked } from '../game/input';
import { api, ApiError } from '../lib/api';
import { DEMO } from '../demo';
import { get, set, toast, useStore } from '../store';
import { Modal } from '../ui/common';
import { MusicPlayer, renderSong } from './music';
import { COUNTDOWN_S, GRADE_COLOR, GRADE_LABEL, RunnerPlay, type PlayGame } from './RunnerPlay';
import { MultiResultScreen, MultiScreen } from './MultiLobby';
import { clearResults, joinRoom, leaveRoom, serverNow, useMulti, type StartSignal } from './multi';

interface Bests { course: string; score: number; accuracy: number; maxCombo: number; rank: number; achievedAt: number }
interface RankEntry { rank: number; userId: number; nickname: string; dogName: string; dogPhoto: string | null; coat: string; score: number; accuracy: number; maxCombo: number; points: number; course: string | null; achievedAt: number }
interface Settings { calib: number; sfx: boolean; volume: number }
const SETTINGS_KEY = 'mungle.runner.settings';
function loadSettings(): Settings {
  try { return { calib: 0, sfx: true, volume: 0.9, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return { calib: 0, sfx: true, volume: 0.9 }; }
}
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const dateLabel = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mmss = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** 코스 썸네일 (코스 분위기 색 + 상징) */
const THUMB: Record<string, { bg: string; icon: string }> = {
  cherry: { bg: 'linear-gradient(160deg,#fde4ea 0%,#f7b8c8 55%,#f6cfd6 100%)', icon: '🌸' },
  cloud: { bg: 'linear-gradient(160deg,#e6f3fb 0%,#bfe0f3 60%,#fff 100%)', icon: '☁️' },
  toy: { bg: 'linear-gradient(160deg,#fff4cf 0%,#f9d98a 60%,#fde3d6 100%)', icon: '🧸' },
  star: { bg: 'linear-gradient(160deg,#4b4f8a 0%,#7c78c4 60%,#c9b3ec 100%)', icon: '🌙' },
  storm: { bg: 'linear-gradient(160deg,#9fb2c8 0%,#6d84a3 60%,#c7d3e2 100%)', icon: '⚡' },
};

// ---------------------------------------------------------------- 3D 미리보기 (로비: 강아지 / 결과: 보호자와 함께 기뻐하기)
function StageDog({ avatar, happy, x = 0, spin }: { avatar: DogAvatar; happy?: boolean; x?: number; spin?: boolean }) {
  const g = useRef<THREE.Group>(null!);
  const d = useRef(newDogDriver());
  useFrame(({ clock }) => {
    // 카메라 쪽을 보며 좌우로 천천히 고개를 돌림 (등을 보이지 않게)
    if (spin) g.current.rotation.y = Math.sin(clock.elapsedTime * 0.5) * 0.6;
    d.current.anim = happy ? DogAnim.Greet : DogAnim.Stand;
    if (happy) d.current.happyUntil = performance.now() + 500;
  });
  return <group ref={g} position={[x, -0.32, 0]} rotation={[0, spin ? 0 : -0.35, 0]}><Dog avatar={avatar} driver={d} /></group>;
}
function StageHuman({ avatar, x }: { avatar: HumanAvatar; x: number }) {
  const d = useRef(newHumanDriver());
  d.current.leash = false;
  useFrame(() => { d.current.anim = HumanAnim.Wave; d.current.wave = 1; });
  return <group position={[x, -0.32, -0.15]} rotation={[0, 0.35, 0]} scale={0.62}><Human avatar={avatar} driver={d} /></group>;
}
function Stage({ avatar, human, happy, className }: { avatar: DogAvatar; human?: HumanAvatar | null; happy?: boolean; className: string }) {
  const withHuman = !!human;
  return (
    <div className={className}>
      <Canvas camera={{ position: [0, withHuman ? 0.45 : 0.32, withHuman ? 2.6 : 2.0], fov: 32 }} dpr={[1, 2]} onCreated={({ camera }) => camera.lookAt(0, withHuman ? 0.05 : -0.06, 0)}>
        <Lighting indoor={false} shadows={false} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.33, 0]}><circleGeometry args={[withHuman ? 0.9 : 0.5, 40]} /><meshLambertMaterial color="#f7c9b4" /></mesh>
        {human && <StageHuman avatar={human} x={-0.42} />}
        <StageDog avatar={avatar} happy={happy} x={withHuman ? 0.3 : 0} spin={!withHuman} />
      </Canvas>
    </div>
  );
}

export default function RunnerApp() {
  const me = useStore((s) => s.me)!;
  const guest = me.role === 'guest';
  const practiceOnly = guest || DEMO;
  const avatar: DogAvatar = guest ? GUEST_DOG : me.dog;
  const human: HumanAvatar = guest ? GUEST_HUMAN : me.human;
  const [screen, setScreen] = useState<'lobby' | 'play' | 'result' | 'multi' | 'mwait' | 'mresult'>(() => (get().runnerJoin || useMulti.getState().room ? 'multi' : 'lobby'));
  const runnerJoin = useStore((s) => s.runnerJoin);
  const prepared = useRef<MusicPlayer | null>(null);
  const mStart = useMulti((s) => s.start);
  const mResults = useMulti((s) => s.results);
  const [courseId, setCourseId] = useState('elise');
  const [modal, setModal] = useState<'rank' | 'how' | 'settings' | 'reward' | null>(() => (get().runnerRank ? 'rank' : null));
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [bests, setBests] = useState<Bests[]>([]);
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [audioErr, setAudioErr] = useState('');
  const [starting, setStarting] = useState(false);
  const [game, setGame] = useState<PlayGame | null>(null);
  const [result, setResult] = useState<{ r: RunResult; inputs: PlayGame['inputs']; runId: string | null; course: CourseInfo; prevBest: number | null } | null>(null);
  const course = COURSES.find((c) => c.id === courseId)!;
  const song = useMemo(() => buildSong(courseId), [courseId]);
  const chart = useMemo(() => buildChart(courseId), [courseId]);
  const myBest = bests.find((b) => b.course === courseId) ?? null;

  useEffect(() => { setMoveLocked(true, 'runner'); set({ runnerRank: false }); return () => setMoveLocked(false, 'runner'); }, []);
  // 친구 초대 카드에서 '참가' → 그 방으로
  useEffect(() => {
    if (!runnerJoin) return;
    set({ runnerJoin: null });
    setScreen('multi');
    void joinRoom(runnerJoin).catch((e) => toast((e as Error).message, 'error'));
  }, [runnerJoin]);
  // ---------------- 함께 달리기: 서버가 정한 시작 시각에 맞춰 출발 / 결과 받기
  useEffect(() => { if (mStart && (!game?.multi || game.multi.round !== mStart.round)) void startMulti(mStart); }, [mStart]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mResults || !game?.multi || mResults.round !== game.multi.round) return;
    game.ended = true;
    window.setTimeout(() => game.player.stop(), 600);
    setScreen('mresult');
  }, [mResults]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadSummary = () => { if (!practiceOnly) api<{ bests: Bests[] }>('/api/runner/summary').then((r) => setBests(r.bests)).catch(() => {}); };
  useEffect(loadSummary, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 곡을 고르면 연주를 미리 만들어 둠
  useEffect(() => {
    setAudio(null); setAudioErr('');
    if (!song) return;
    renderSong(song).then(setAudio).catch(() => setAudioErr('이 기기에서 음악을 만들지 못했어요.'));
  }, [song]);
  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 저장 불가 */ } }, [settings]);
  useEffect(() => () => game?.player.close(), [game]);

  const exit = () => { game?.player.close(); set({ runner: false }); };

  async function start() {
    if (!audio || !song || !chart) return;
    setStarting(true);
    let runId: string | null = null;
    if (!practiceOnly) {
      try { runId = (await api<{ runId: string }>('/api/runner/start', { body: { courseId } })).runId; }
      catch (e) { toast(`${(e as Error).message} 이번 판은 연습으로 진행해요.`, 'error'); }
    }
    // 버튼을 누른 순간 오디오를 켬 (모바일 자동 재생 제한). 출발 카운트다운 뒤에 음악 시작
    const player = new MusicPlayer(settings.volume);
    const g: PlayGame = { chart, song, course, player, inputs: [], calib: settings.calib, sfx: settings.sfx, paused: false, ended: false, live: null, lastEvent: null, stumbleAt: -1e9 };
    (g as PlayGame & { runId: string | null }).runId = runId;
    await player.play(audio, 0, COUNTDOWN_S);
    game?.player.close();
    setGame(g); setScreen('play'); setStarting(false);
  }
  /** 준비 완료를 누를 때 오디오를 미리 켜 둠 (모바일은 사용자 터치가 있어야 소리가 남) */
  function prepareAudio() {
    if (!prepared.current) prepared.current = new MusicPlayer(settings.volume);
    void prepared.current.ctx.resume().catch(() => {});
  }
  async function startMulti(sig: StartSignal) {
    const c = COURSES.find((x) => x.id === sig.courseId);
    const sg = buildSong(sig.courseId), ch = buildChart(sig.courseId, sig.difficulty);
    const room = useMulti.getState().room;
    if (!c || !sg || !ch || !room) return;
    let buf: AudioBuffer;
    try { buf = await renderSong(sg); } catch { toast('이 기기에서 음악을 만들지 못했어요.', 'error'); return; }
    const player = prepared.current ?? new MusicPlayer(settings.volume);
    prepared.current = null;
    const g: PlayGame = {
      chart: ch, song: sg, course: c, player, inputs: [...(sig.myInputs ?? [])], calib: settings.calib, sfx: settings.sfx, paused: false, ended: false, live: null, lastEvent: null, stumbleAt: -1e9,
      multi: { round: sig.round, myId: me.id, players: room.players },
    };
    // 서버 시작 시각까지 남은 시간만큼 기다렸다가 재생 (늦게 들어왔으면 그만큼 건너뛰고 재생)
    const delay = (sig.startAt - serverNow()) / 1000;
    if (delay >= 0) await player.play(buf, 0, delay);
    else await player.play(buf, Math.min(-delay, buf.duration - 0.5), 0);
    game?.player.close();
    setResult(null);
    setGame(g); setScreen('play');
  }

  function finish() {
    if (!game) return;
    // 함께 달리기: 서버 최종 판정을 기다림
    if (game.multi) { setScreen(useMulti.getState().results?.round === game.multi.round ? 'mresult' : 'mwait'); return; }
    const r = judgeRun(game.chart, game.inputs);
    setResult({ r, inputs: [...game.inputs], runId: (game as PlayGame & { runId: string | null }).runId, course: game.course, prevBest: myBest?.score ?? null });
    window.setTimeout(() => { game.player.stop(); }, 1200);
    setScreen('result');
  }

  const sel = COURSES.indexOf(course);
  return (
    <div className="absolute inset-0 z-40 bg-cream overflow-hidden" data-testid="runner">
      {screen === 'play' && game && (
        <RunnerPlay game={game} avatar={avatar} human={human} best={myBest?.score ?? null} onEnd={finish}
          onQuit={() => { game.player.close(); setGame(null); if (game.multi) { void leaveRoom(); } setScreen('lobby'); }}
          onRetry={() => { game.player.close(); setGame(null); void start(); }} />
      )}
      {screen === 'lobby' && (
        <div className="h-full flex flex-col pt-[calc(8px+var(--safe-t,0px))] pb-[calc(8px+var(--safe-b))] bg-[radial-gradient(circle_at_15%_0%,#fde4ea,transparent_55%),radial-gradient(circle_at_90%_95%,#e3efdc,transparent_45%)]" data-testid="runner-lobby">
          {/* 헤더: 홈(광장으로) · 제목 · 게임 방법 · 설정 */}
          <div className="px-3 flex items-center gap-2 shrink-0">
            <button className="w-10 h-10 rounded-full bg-white shadow grid place-items-center text-lg shrink-0" onClick={exit} aria-label="광장으로">🏠</button>
            <div className="flex-1 text-center font-display text-xl md:text-2xl text-cocoa whitespace-nowrap">
              🐾 멍글런너 <span className="align-middle text-[11px] rounded-full bg-[#b9a6e6] text-white px-2 py-0.5">Beta</span>
            </div>
            <button className="w-10 h-10 rounded-full bg-white shadow grid place-items-center text-lg shrink-0" onClick={() => setModal('how')} aria-label="게임 방법">?</button>
            <button className="w-10 h-10 rounded-full bg-white shadow grid place-items-center text-lg shrink-0" onClick={() => setModal('settings')} aria-label="설정">⚙️</button>
          </div>
          {practiceOnly && <div className="mx-3 mt-1.5 text-center text-xs rounded-full bg-[#eef5fb] text-[#4b6a86] py-1.5 shrink-0">{DEMO ? '미리보기 · 연습 모드 (랭킹은 게임 서버에서 기록돼요)' : '👀 둘러보기 중 · 연습 모드 (랭킹에 기록하려면 회원가입)'}</div>}
          <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 md:gap-6 px-3 mt-2 md:items-stretch md:justify-center">
            {/* 히어로: 내 강아지 + 선택한 코스 */}
            <div className="shrink-0 md:w-[360px] md:max-h-[520px] md:self-center md:h-full rounded-3xl overflow-hidden relative" style={{ background: THUMB[course.theme].bg }}>
              <Stage avatar={avatar} className="w-full h-[min(26vh,190px)] md:h-full" />
              <div className="absolute left-3 top-2 leading-tight">
                <div className="font-display text-base text-cocoa drop-shadow-[0_1px_0_#fff]">{guest ? '방문자 강아지' : me.dogName}</div>
                <div className="text-[11px] text-cocoa-soft">최고 {myBest ? myBest.score.toLocaleString() : '—'}{myBest ? ` · ${myBest.rank}위` : ''}</div>
              </div>
              <div className="absolute right-2 top-2 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-display">{sel + 1}코스 · {course.course}</div>
            </div>
            {/* 코스 목록 (세로) + 게임 시작 */}
            <div className="flex-1 min-h-0 flex flex-col md:max-w-[420px]">
              <div className="flex-1 min-h-0 overflow-y-auto scroll-soft space-y-1.5 pr-0.5" role="listbox" aria-label="코스 선택">
                {COURSES.map((c, i) => {
                  const on = c.id === courseId;
                  const b = bests.find((x) => x.course === c.id);
                  return (
                    <button key={c.id} role="option" aria-selected={on} aria-disabled={!c.available} data-testid={`course-${c.id}`}
                      className={`w-full flex items-center gap-2.5 rounded-2xl p-1.5 pr-3 text-left border-2 ${on ? 'border-[#f39a7b] bg-white shadow-sm' : 'border-transparent bg-white/70'} ${c.available ? '' : 'text-cocoa-soft'}`}
                      onClick={() => (c.available ? setCourseId(c.id) : toast('이 곡은 저작권 문제가 없는 연주를 준비하고 있어요. 조금만 기다려 주세요!'))}>
                      <span className="relative w-14 h-14 rounded-xl grid place-items-center text-2xl shrink-0" style={{ background: THUMB[c.theme].bg }}>
                        {THUMB[c.theme].icon}
                        {!c.available && <span className="absolute inset-0 rounded-xl bg-[#5a403355] grid place-items-center text-lg">🔒</span>}
                      </span>
                      <span className="flex-1 min-w-0 leading-tight">
                        <span className="block text-[11px] text-cocoa-soft">{i + 1}. {c.course}</span>
                        <span className="block font-display text-[15px] truncate">{c.composer} — {c.title}</span>
                        <span className="block text-[11px] text-[#f2836b]">{stars(c.difficulty)}{!c.available ? <span className="text-cocoa-soft"> · 🎵 음원 준비 중</span> : b ? <span className="text-cocoa-soft"> · 최고 {b.score.toLocaleString()}</span> : null}</span>
                      </span>
                      {on && c.available && <span className="w-8 h-8 rounded-full bg-[#f39a7b] text-white grid place-items-center text-sm shrink-0">▶</span>}
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-cocoa-soft text-center mt-1.5 shrink-0">{chart ? `${course.composer} · ${chart.bpm} BPM · 장애물 ${chart.obstacles.length}개 · ${mmss(chart.duration)}` : ''}</div>
              <div className="grid grid-cols-2 gap-2 mt-1 shrink-0">
                <button className="btn btn-coral py-3.5 text-lg shadow-[0_4px_0_#d9705f] leading-tight" data-testid="runner-start" disabled={!audio || starting || !course.available} onClick={() => void start()}>
                  {!course.available ? '🎵 음원 준비 중' : audioErr || (!audio ? '🎹 준비 중…' : starting ? '출발 준비 중…' : <>🐶 혼자 달리기</>)}
                </button>
                <button className="btn py-3.5 text-lg text-white bg-[#b9a6e6] shadow-[0_4px_0_#9b86cf] leading-tight disabled:opacity-60" data-testid="runner-multi" disabled={practiceOnly}
                  onClick={() => setScreen('multi')} title={practiceOnly ? '함께 달리기는 게임 서버에서 회원만 이용할 수 있어요' : '친구와 최대 4명 대결'}>
                  🐾 함께 달리기
                </button>
              </div>
              {practiceOnly && <p className="text-[11px] text-cocoa-soft text-center mt-1">함께 달리기는 {DEMO ? '게임 서버에서' : '회원가입 후'} 친구와 최대 4명이 대결할 수 있어요.</p>}
            </div>
          </div>
          {/* 하단: 랭킹 · 보상 · 게임 방법 */}
          <div className="px-3 mt-2 grid grid-cols-3 gap-2 max-w-[520px] w-full mx-auto shrink-0">
            <button className="btn btn-ghost bg-white/80 min-h-[46px] text-sm" onClick={() => setModal('rank')}>🏆 랭킹</button>
            <button className="btn btn-ghost bg-white/80 min-h-[46px] text-sm" onClick={() => setModal('reward')}>🎁 보상</button>
            <button className="btn btn-ghost bg-white/80 min-h-[46px] text-sm" onClick={() => setModal('how')}>📖 게임 방법</button>
          </div>
        </div>
      )}
      {screen === 'result' && result && (
        <ResultScreen res={result} avatar={avatar} human={human} practiceOnly={practiceOnly} onSaved={loadSummary}
          onRetry={() => { setResult(null); void start(); }} onCourses={() => { setResult(null); setGame(null); setScreen('lobby'); }} onExit={exit}
          onRanking={() => setModal('rank')} />
      )}
      {screen === 'multi' && <MultiScreen joinCode={null} onBack={() => setScreen('lobby')} onPrepare={prepareAudio} />}
      {screen === 'mwait' && (
        <div className="h-full grid place-items-center bg-[radial-gradient(circle_at_50%_0%,#fde4ea,transparent_60%)]" data-testid="mr-wait">
          <div className="text-center"><div className="text-5xl pop">🏁</div><div className="font-display text-xl mt-2">완주! 다른 친구들을 기다리는 중…</div><p className="text-sm text-cocoa-soft">서버가 모두의 기록을 확인하고 있어요.</p></div>
        </div>
      )}
      {screen === 'mresult' && mResults && (
        <MultiResultScreen results={mResults.results}
          onAgain={() => { clearResults(); game?.player.close(); setGame(null); setScreen('multi'); }}
          onLeave={() => { clearResults(); game?.player.close(); setGame(null); void leaveRoom(); setScreen('lobby'); }} />
      )}
      {modal === 'rank' && <RankingModal courseId={courseId} onClose={() => setModal(null)} />}
      {modal === 'how' && <HowModal onClose={() => setModal(null)} />}
      {modal === 'reward' && <RewardModal bests={bests} practiceOnly={practiceOnly} onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal s={settings} onChange={setSettings} onClose={() => setModal(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- 결과
interface Saved { newBest: boolean; best: { score: number }; rank: number; prevRank: number | null; total: number; coin?: { amount: number } | null }
function ResultScreen({ res, avatar, human, practiceOnly, onSaved, onRetry, onCourses, onExit, onRanking }: {
  res: { r: RunResult; inputs: PlayGame['inputs']; runId: string | null; course: CourseInfo; prevBest: number | null }; avatar: DogAvatar; human: HumanAvatar; practiceOnly: boolean;
  onSaved: () => void; onRetry: () => void; onCourses: () => void; onExit: () => void; onRanking: () => void;
}) {
  const { r, course } = res;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'error' | 'practice'>(res.runId ? 'idle' : 'practice');
  const [err, setErr] = useState('');
  const [top, setTop] = useState<RankEntry[]>([]);
  const chart = useMemo(() => buildChart(course.id)!, [course.id]);
  async function save() {
    if (!res.runId) return;
    setState('saving'); setErr('');
    try {
      const s = await api<Saved & { result: { score: number } }>('/api/runner/finish', {
        body: { runId: res.runId, courseId: course.id, gameVersion: RUNNER_GAME_VERSION, patternVersion: chart.patternVersion, inputs: res.inputs },
      });
      setSaved(s); setState('idle'); onSaved();
    } catch (e) {
      // 이미 저장된 기록(재시도 중 중복)은 성공으로 처리
      if (e instanceof ApiError && e.status === 409 && /이미/.test(e.message)) { setState('idle'); onSaved(); return; }
      setErr((e as Error).message); setState('error');
    }
  }
  useEffect(() => { void save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (DEMO || state === 'saving' || practiceOnly) return;
    api<{ entries: RankEntry[] }>(`/api/runner/ranking?scope=course&course=${course.id}&limit=3`).then((x) => setTop(x.entries)).catch(() => {});
  }, [state, course.id, practiceOnly]);
  const up = saved && saved.prevRank !== null ? saved.prevRank - saved.rank : null;
  const best = saved ? saved.best.score : Math.max(r.score, res.prevBest ?? 0);
  return (
    <div className="h-full overflow-y-auto scroll-soft pt-[calc(12px+var(--safe-t,0px))] pb-[calc(12px+var(--safe-b))] px-3 bg-[radial-gradient(circle_at_50%_0%,#fde4ea,transparent_60%)]" data-testid="runner-result">
      <div className="max-w-[440px] mx-auto">
        <div className="text-center">
          <div className="inline-block font-display text-2xl text-white bg-[#f39a7b] rounded-full px-6 py-1 shadow-[0_3px_0_#d9705f]">🏁 완주!</div>
          <div className="text-sm text-cocoa-soft mt-1">{course.course} · {course.composer} — {course.title}</div>
        </div>
        <div className="relative">
          <Stage avatar={avatar} human={human} happy className="w-full h-[170px]" />
          {saved?.newBest && <span className="absolute right-2 top-2 rounded-full bg-[#f6c453] text-white px-3 py-1 font-display text-sm pop shadow">NEW RECORD!</span>}
        </div>
        <div className="panel p-4">
          <div className="text-center">
            <div className="text-xs text-cocoa-soft">최종 점수</div>
            <div className="font-display text-5xl tabular-nums text-[#e2604f]" data-testid="runner-final">{r.score.toLocaleString()}</div>
          </div>
          <div className="grid grid-cols-4 gap-1.5 mt-3 text-center">
            {(['perfect', 'great', 'good', 'miss'] as Grade[]).map((g) => (
              <div key={g} className="rounded-xl bg-cream-2 py-1.5"><div className="text-[11px] font-display" style={{ color: GRADE_COLOR[g] }}>{GRADE_LABEL[g]}</div><div className="font-display text-lg">{r.counts[g]}</div></div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5 mt-1.5 text-center text-sm">
            <div className="rounded-xl bg-cream-2 py-1.5"><div className="text-[11px] text-cocoa-soft">최고 콤보</div><b>{r.maxCombo}</b></div>
            <div className="rounded-xl bg-cream-2 py-1.5"><div className="text-[11px] text-cocoa-soft">정확도</div><b>{pct(r.accuracy)}</b></div>
            <div className="rounded-xl bg-cream-2 py-1.5"><div className="text-[11px] text-cocoa-soft">개인 최고</div><b>{best.toLocaleString()}</b></div>
          </div>
          <div className="mt-3 text-sm">
            {state === 'practice' && <p className="rounded-xl bg-[#eef5fb] text-[#4b6a86] px-3 py-2">연습 기록이라 랭킹에는 올라가지 않아요.</p>}
            {state === 'saving' && <p className="text-cocoa-soft text-center">기록을 저장하는 중…</p>}
            {state === 'error' && (
              <div className="rounded-xl bg-[#fff0ec] text-[#c4553a] px-3 py-2">
                기록을 저장하지 못했어요. {err}
                <button className="btn btn-coral w-full py-2 mt-2" onClick={() => void save()}>🔄 다시 저장하기</button>
              </div>
            )}
            {saved && (
              <p className="text-center text-[13px] mb-1.5" data-testid="runner-coin">{saved.coin ? <>🪙 완주 보상 <b className="text-[#e2a21c]">+{saved.coin.amount}코인</b></> : <span className="text-cocoa-soft">오늘 받을 수 있는 완주 코인(하루 3번)을 모두 받았어요</span>}</p>
            )}
            {saved && (
              <button className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#fde3d6] py-2" onClick={onRanking} data-testid="runner-rank">
                🏆 코스 랭킹 <b className="font-display text-lg">{saved.rank}위</b>
                {up !== null && up > 0 && <span className="text-[#e2604f] font-display">▲{up}</span>}
                {up !== null && up < 0 && <span className="text-[#6d84a3] font-display">▼{-up}</span>}
                {saved.prevRank === null && <span className="text-[11px] rounded-full bg-white px-2">첫 기록</span>}
                <span className="text-cocoa-soft text-xs">/ {saved.total}명</span>
              </button>
            )}
          </div>
          {top.length > 0 && (
            <div className="mt-2">
              {top.map((e) => <RankRow key={e.userId} e={e} compact />)}
            </div>
          )}
        </div>
        <div className="grid gap-2 mt-3">
          <button className="btn btn-coral py-3.5 text-lg shadow-[0_4px_0_#d9705f]" onClick={onRetry}>🔁 다시 도전</button>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-ghost bg-white py-3" onClick={onCourses}>🎵 다른 곡 선택</button>
            <button className="btn btn-ghost bg-white py-3" onClick={onExit}>🌳 광장으로</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Avatar({ e, size = 32 }: { e: RankEntry; size?: number }) {
  return e.dogPhoto
    ? <img src={e.dogPhoto} alt="" className="rounded-full object-cover border-2 border-white shrink-0" style={{ width: size, height: size }} />
    : <span className="rounded-full grid place-items-center border-2 border-white shrink-0" style={{ background: e.coat, width: size, height: size, fontSize: size * 0.45 }}>🐶</span>;
}
function RankRow({ e, me, compact }: { e: RankEntry; me?: boolean; compact?: boolean }) {
  const medal = ['🥇', '🥈', '🥉'][e.rank - 1];
  return (
    <div className={`flex items-center gap-2 rounded-xl px-2 ${compact ? 'py-1' : 'py-1.5'} ${me ? 'bg-[#fde3d6]' : ''}`}>
      <span className="w-8 text-center font-display">{medal ?? e.rank}</span>
      <Avatar e={e} />
      <div className="flex-1 min-w-0 leading-tight">
        <div className="font-display text-sm truncate">🐶 {e.dogName} <span className="text-cocoa-soft font-body text-xs">· {e.nickname}</span></div>
        {!compact && <div className="text-[11px] text-cocoa-soft">{e.course ? `콤보 ${e.maxCombo} · 정확도 ${pct(e.accuracy)}` : '코스별 최고 기록 포인트 합'} · {dateLabel(e.achievedAt)}</div>}
      </div>
      <span className="font-display tabular-nums text-[#f2836b]">{(e.course ? e.score : e.points).toLocaleString()}{e.course ? '' : 'P'}</span>
    </div>
  );
}

function Podium({ list }: { list: RankEntry[] }) {
  const order = [1, 0, 2];
  const h = [64, 86, 50];
  const color = ['#cfd8e6', '#f6c453', '#e8b48a'];
  return (
    <div className="grid grid-cols-3 gap-2 items-end mt-3" data-testid="runner-podium">
      {order.map((i, k) => {
        const e = list[i];
        return (
          <div key={i} className="flex flex-col items-center min-w-0">
            {e ? <><Avatar e={e} size={k === 1 ? 48 : 40} /><div className="font-display text-xs truncate max-w-full mt-0.5">{e.dogName}</div><div className="text-[10px] text-cocoa-soft truncate max-w-full">{e.nickname}</div><div className="font-display text-xs text-[#f2836b] tabular-nums">{(e.course ? e.score : e.points).toLocaleString()}</div></>
              : <div className="text-[11px] text-cocoa-soft pb-1">비어 있어요</div>}
            <div className="w-full rounded-t-xl grid place-items-start justify-center pt-1 font-display text-white text-xl mt-1" style={{ height: h[k], background: color[k] }}>{i + 1}</div>
          </div>
        );
      })}
    </div>
  );
}

function RankingModal({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  type Tab = 'all' | 'weekly' | 'friends' | 'mine';
  const [tab, setTab] = useState<Tab>('all');
  const [cid, setCid] = useState(courseId);
  const [data, setData] = useState<{ entries: RankEntry[]; me: RankEntry | null; total: number; weekStart: number | null } | null>(null);
  const [err, setErr] = useState('');
  const meId = useStore((s) => s.me?.id);
  const overall = cid === 'overall';
  useEffect(() => {
    setData(null); setErr('');
    if (DEMO) { setErr('미리보기에서는 랭킹을 볼 수 없어요. (게임 서버에서 동작)'); return; }
    if (overall && tab === 'weekly') { setErr('주간 랭킹은 코스를 골라서 볼 수 있어요.'); return; }
    const scope = overall ? 'overall' : tab === 'weekly' ? 'weekly' : 'course';
    const q = `scope=${scope}&course=${overall ? 'elise' : cid}&limit=50${tab === 'friends' ? '&friends=1' : ''}${tab === 'mine' ? '&around=1' : ''}`;
    api<typeof data>(`/api/runner/ranking?${q}`).then(setData).catch((e) => setErr((e as Error).message));
  }, [tab, cid, overall]);
  const tabs: [Tab, string][] = [['all', '전체'], ['weekly', '주간'], ['friends', '친구'], ['mine', '내 순위']];
  const list = data?.entries ?? [];
  const podium = tab !== 'mine' && list.length > 0;
  return (
    <Modal onClose={onClose} className="max-w-[440px] p-4">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-display text-xl flex-1">🏆 멍글런너 랭킹</h2>
        <button className="btn btn-ghost w-10 h-10" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="grid grid-cols-4 gap-1 bg-cream-2 rounded-full p-1 text-sm" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`btn py-1.5 ${tab === k ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <select className="w-full mt-2 rounded-xl border border-[#f1e2d2] bg-white px-3 py-2 text-sm" value={cid} onChange={(e) => setCid(e.target.value)} aria-label="코스 선택" data-testid="rank-course">
        {COURSES.filter((c) => c.available).map((c) => <option key={c.id} value={c.id}>{c.order}. {c.course} · {c.title}</option>)}
        <option value="overall">모든 코스 합산 (포인트)</option>
      </select>
      <p className="text-[11px] text-cocoa-soft mt-1.5">
        {overall ? '코스마다 점수 체계가 달라, 코스별 최고 기록을 0~1000점으로 환산한 포인트의 합으로 순위를 매겨요.'
          : tab === 'weekly' ? `이번 주 기록 (매주 월요일 00:00 한국 시간에 새로 시작${data?.weekStart ? ` · ${dateLabel(data.weekStart)}~` : ''})`
            : tab === 'mine' ? '내 순위 위아래 5명씩 보여 줘요.'
              : '서버가 입력 기록으로 다시 판정한 최고 기록 1개만 반영 · 같은 점수면 정확도 → 최고 콤보 → 먼저 기록한 순'}
      </p>
      <div data-testid="runner-ranking">
        {podium && <Podium list={list} />}
        <div className="mt-2 max-h-[40vh] overflow-y-auto scroll-soft">
          {err && <p className="text-sm text-cocoa-soft text-center py-6">{err}</p>}
          {!data && !err && <p className="text-sm text-cocoa-soft text-center py-6">불러오는 중…</p>}
          {data && list.length === 0 && <p className="text-sm text-cocoa-soft text-center py-6">{tab === 'mine' ? '아직 내 기록이 없어요. 한 판 달려 볼까요?' : tab === 'friends' ? '아직 친구 기록이 없어요.' : '아직 기록이 없어요. 첫 기록에 도전해 보세요!'}</p>}
          {(podium ? list.slice(3) : list).map((e) => <RankRow key={`${e.userId}`} e={e} me={e.userId === meId} />)}
        </div>
      </div>
      {data?.me && tab !== 'mine' && (
        <div className="mt-2 border-t border-[#f1e2d2] pt-2">
          <div className="text-xs text-cocoa-soft mb-1">내 순위 ({data.total}명 중)</div>
          <RankRow e={data.me} me />
        </div>
      )}
    </Modal>
  );
}

/** 보상: 내 최고 기록으로 계산한 배지 (서버에 저장된 기록 기준) */
function RewardModal({ bests, practiceOnly, onClose }: { bests: Bests[]; practiceOnly: boolean; onClose: () => void }) {
  const chart = useMemo(() => buildChart('elise')!, []);
  const b = bests.find((x) => x.course === 'elise');
  const items: [string, string, boolean][] = [
    ['🌸', '벚꽃 산책길 첫 완주', !!b],
    ['⭐', `점수 ${Math.round(chart.maxScore * 0.5).toLocaleString()}점 넘기기`, !!b && b.score >= chart.maxScore * 0.5],
    ['🌟', `점수 ${Math.round(chart.maxScore * 0.8).toLocaleString()}점 넘기기`, !!b && b.score >= chart.maxScore * 0.8],
    ['🎯', '정확도 90% 이상', !!b && b.accuracy >= 0.9],
    ['🔥', `${chart.obstacles.length}콤보 (올 콤보)`, !!b && b.maxCombo >= chart.obstacles.length],
    ['🏆', '코스 랭킹 10위 안', !!b && b.rank <= 10],
  ];
  return (
    <Modal onClose={onClose} className="max-w-[400px] p-5 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-display text-xl flex-1">🎁 보상 배지</h2>
        <button className="btn btn-ghost w-10 h-10" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      {practiceOnly && <p className="rounded-xl bg-[#eef5fb] text-[#4b6a86] px-3 py-2 mb-2 text-xs">로그인한 회원의 공식 기록으로 배지를 받아요.</p>}
      <div className="grid grid-cols-2 gap-2" data-testid="runner-rewards">
        {items.map(([icon, label, ok]) => (
          <div key={label} className={`rounded-2xl p-3 text-center ${ok ? 'bg-[#fde3d6]' : 'bg-cream-2 opacity-60'}`}>
            <div className={`text-3xl ${ok ? '' : 'grayscale'}`}>{icon}</div>
            <div className="text-xs mt-1">{label}</div>
            <div className="text-[11px] font-display mt-0.5" style={{ color: ok ? '#e2604f' : '#a3857a' }}>{ok ? '획득!' : '도전 중'}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-cocoa-soft mt-2">다른 코스는 음원이 준비되면 배지가 추가돼요.</p>
    </Modal>
  );
}

function HowModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="max-w-[420px] p-5 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-display text-xl flex-1">📖 게임 방법</h2>
        <button className="btn btn-ghost w-10 h-10" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <p>강아지는 음악에 맞춰 3개의 레인을 자동으로 달려요. 장애물 밑의 <b>빛나는 띠가 강아지에게 닿는 순간이 박자</b>예요. 그 박자에 맞춰 조작하면 높은 판정을 받아요.</p>
      <ul className="mt-2 space-y-1">
        <li>🪵 낮은 통나무 (노란 띠) → <b>뛰기</b></li>
        <li>🐾 높은 발바닥 막대 (하늘색 띠) → <b>숙이기</b></li>
        <li>🌷 꽃 화단 상자 (주황 띠) → <b>좌우로 피하기</b></li>
        <li>🚧 흰 울타리 → 화살표가 있는 <b>빈 레인으로 이동</b></li>
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-cream-2 px-3 py-2"><b>📱 모바일</b><br />아래 버튼 4개<br />← 왼쪽 · → 오른쪽 · ↑ 뛰기 · ↓ 숙이기</div>
        <div className="rounded-xl bg-cream-2 px-3 py-2"><b>💻 PC</b><br />← / A · → / D 레인 이동<br />↑ / Space 뛰기 · ↓ / Ctrl 숙이기</div>
      </div>
      <div className="mt-2 rounded-xl bg-cream-2 px-3 py-2">
        판정: PERFECT ±{JUDGE.perfect}ms (100점) · GREAT ±{JUDGE.great}ms (70점) · GOOD ±{JUDGE.good}ms (40점) · MISS 0점<br />
        콤보 10마다 점수 +10% (최대 +100%). 부딪히면 강아지가 비틀거리고 콤보가 초기화되지만 계속 달려요.
      </div>
      <p className="mt-2 rounded-xl bg-[#f1ecfa] px-3 py-2">🐾 <b>함께 달리기</b>: 최대 4명이 각자 자기 트랙(3레인)에서 같은 음악·같은 장애물로 달려요. 다른 트랙으로는 넘어갈 수 없고, 점수·콤보·순위가 실시간으로 보여요.</p>
      <p className="mt-2 text-xs text-cocoa-soft">소리가 늦게 들리는 기기(블루투스 이어폰 등)는 설정의 ‘판정 보정’을 조절해 주세요. 일시정지했다가 이어 해도 음악과 장애물은 그대로 맞아요.</p>
    </Modal>
  );
}

function SettingsModal({ s, onChange, onClose }: { s: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="max-w-[400px] p-5 text-sm">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-display text-xl flex-1">⚙️ 설정</h2>
        <button className="btn btn-ghost w-10 h-10" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <label className="block">🎯 판정 보정: <b>{s.calib > 0 ? '+' : ''}{s.calib}ms</b>
        <input type="range" className="w-full accent-[#f4776a]" min={-200} max={200} step={5} value={s.calib} onChange={(e) => onChange({ ...s, calib: Number(e.target.value) })} />
        <span className="text-xs text-cocoa-soft">계속 늦게 눌린다고 나오면 + 쪽으로, 빠르다고 나오면 − 쪽으로 옮겨 주세요.</span>
      </label>
      <label className="block mt-3">🔊 음악 크기
        <input type="range" className="w-full accent-[#f4776a]" min={0.1} max={1} step={0.05} value={s.volume} onChange={(e) => onChange({ ...s, volume: Number(e.target.value) })} />
      </label>
      <label className="flex items-center gap-2 mt-3"><input type="checkbox" checked={s.sfx} onChange={(e) => onChange({ ...s, sfx: e.target.checked })} /> 판정 효과음</label>
    </Modal>
  );
}
