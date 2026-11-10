// 멍글런너 — 로비(곡 선택) · 플레이 · 결과 · 랭킹 · 게임 방법 · 설정
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { DogAnim } from '@shared/protocol';
import { GUEST_DOG, type DogAvatar } from '@shared/avatar';
import {
  COURSES, JUDGE, RUNNER_GAME_VERSION, buildChart, buildSong, judgeRun, type CourseInfo, type Grade, type RunResult,
} from '@shared/runner';
import { Dog, newDogDriver } from '../game/models/Dog';
import { Lighting } from '../game/Lighting';
import { setMoveLocked } from '../game/input';
import { api, ApiError } from '../lib/api';
import { DEMO } from '../demo';
import { set, toast, useStore } from '../store';
import { DogBadge, Modal } from '../ui/common';
import { MusicPlayer, renderSong } from './music';
import { GRADE_COLOR, GRADE_LABEL, RunnerPlay, type PlayGame } from './RunnerPlay';

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

/** 로비·결과 화면의 강아지 미리보기 (천천히 회전 / 완주 후 기뻐하기) */
function DogStage({ avatar, happy }: { avatar: DogAvatar; happy?: boolean }) {
  const g = useRef<THREE.Group>(null!);
  const d = useRef(newDogDriver());
  useFrame((_, dt) => {
    g.current.rotation.y += dt * (happy ? 1.6 : 0.5);
    d.current.anim = happy ? DogAnim.Greet : DogAnim.Stand;
    if (happy) d.current.happyUntil = performance.now() + 500;
  });
  return <group ref={g} position={[0, -0.32, 0]}><Dog avatar={avatar} driver={d} /></group>;
}
function DogPreview({ avatar, happy, className }: { avatar: DogAvatar; happy?: boolean; className: string }) {
  return (
    <div className={className}>
      <Canvas camera={{ position: [0, 0.32, 2.0], fov: 32 }} dpr={[1, 2]} onCreated={({ camera }) => camera.lookAt(0, -0.06, 0)}>
        <Lighting indoor={false} shadows={false} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.33, 0]}><circleGeometry args={[0.5, 40]} /><meshLambertMaterial color="#f7c9b4" /></mesh>
        <DogStage avatar={avatar} happy={happy} />
      </Canvas>
    </div>
  );
}

export default function RunnerApp() {
  const me = useStore((s) => s.me)!;
  const guest = me.role === 'guest';
  const practiceOnly = guest || DEMO;
  const avatar: DogAvatar = guest ? GUEST_DOG : me.dog;
  const [screen, setScreen] = useState<'lobby' | 'play' | 'result'>('lobby');
  const [courseId, setCourseId] = useState('elise');
  const [modal, setModal] = useState<'rank' | 'how' | 'settings' | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [bests, setBests] = useState<Bests[]>([]);
  const [audio, setAudio] = useState<AudioBuffer | null>(null);
  const [audioErr, setAudioErr] = useState('');
  const [starting, setStarting] = useState(false);
  const [game, setGame] = useState<PlayGame | null>(null);
  const [result, setResult] = useState<{ r: RunResult; inputs: PlayGame['inputs']; runId: string | null; course: CourseInfo } | null>(null);
  const course = COURSES.find((c) => c.id === courseId)!;
  const song = useMemo(() => buildSong(courseId), [courseId]);
  const chart = useMemo(() => buildChart(courseId), [courseId]);
  const myBest = bests.find((b) => b.course === courseId) ?? null;

  useEffect(() => { setMoveLocked(true, 'runner'); return () => setMoveLocked(false, 'runner'); }, []);
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
    // 버튼을 누른 순간 오디오를 켬 (모바일 자동 재생 제한)
    const player = new MusicPlayer(settings.volume);
    const g: PlayGame = { chart, song, course, player, inputs: [], calib: settings.calib, sfx: settings.sfx, paused: false, ended: false, live: null, lastEvent: null, stumbleAt: -1e9 };
    (g as PlayGame & { runId: string | null }).runId = runId;
    await player.play(audio);
    game?.player.close();
    setGame(g); setScreen('play'); setStarting(false);
  }
  function finish() {
    if (!game) return;
    const r = judgeRun(game.chart, game.inputs);
    setResult({ r, inputs: [...game.inputs], runId: (game as PlayGame & { runId: string | null }).runId, course: game.course });
    window.setTimeout(() => { game.player.stop(); }, 1200);
    setScreen('result');
  }

  return (
    <div className="absolute inset-0 z-40 bg-cream overflow-hidden" data-testid="runner">
      {screen === 'play' && game && (
        <RunnerPlay game={game} avatar={avatar} best={myBest?.score ?? null} onEnd={finish}
          onQuit={() => { game.player.close(); setGame(null); setScreen('lobby'); }}
          onRetry={() => { game.player.close(); setGame(null); void start(); }} />
      )}
      {screen === 'lobby' && (
        <div className="h-full flex flex-col pt-[calc(10px+var(--safe-t,0px))] pb-[calc(10px+var(--safe-b))] bg-[radial-gradient(circle_at_20%_10%,#fde3d6,transparent_50%),radial-gradient(circle_at_85%_90%,#e3efdc,transparent_45%)]">
          {/* 상단: 로고 · 내 강아지 · 내 최고 기록 · 광장으로 */}
          <div className="px-3 flex items-center gap-2">
            <div className="panel !rounded-full px-4 py-2 font-display text-lg md:text-xl whitespace-nowrap">🏃 멍글런너</div>
            <div className="panel !rounded-full pl-1.5 pr-3 py-1 flex items-center gap-2 min-w-0">
              {guest ? <span className="text-2xl">🐶</span> : <DogBadge profile={me} size={32} />}
              <div className="min-w-0 leading-tight">
                <div className="font-display text-sm truncate">{guest ? '방문자 강아지' : me.dogName}</div>
                <div className="text-[11px] text-cocoa-soft truncate">최고 {myBest ? myBest.score.toLocaleString() : '—'}{myBest ? ` · ${myBest.rank}위` : ''}</div>
              </div>
            </div>
            <div className="flex-1" />
            <button className="btn btn-ghost px-3 min-h-[40px] text-sm whitespace-nowrap" onClick={exit}>🌳 광장으로</button>
          </div>
          {practiceOnly && <div className="mx-3 mt-2 text-center text-xs rounded-full bg-[#eef5fb] text-[#4b6a86] py-1.5">{DEMO ? '미리보기 · 연습 모드 (랭킹은 게임 서버에서 기록돼요)' : '👀 둘러보기 중 · 연습 모드 (랭킹에 기록하려면 회원가입)'}</div>}
          {/* 가운데: 3D 강아지 + 곡 카드 */}
          <div className="flex-1 min-h-0 flex flex-col md:flex-row items-center justify-center gap-2 md:gap-8 px-3">
            <DogPreview avatar={avatar} className="w-[min(60vw,240px)] h-[min(32vh,240px)] md:w-[300px] md:h-[300px] shrink-0" />
            <div className="w-full md:w-[440px]">
              <div className="flex gap-2 overflow-x-auto scroll-soft pb-2 snap-x" role="listbox" aria-label="코스 선택">
                {COURSES.map((c) => (
                  <button key={c.id} role="option" aria-selected={c.id === courseId} disabled={!c.available}
                    className={`snap-start shrink-0 w-[124px] rounded-2xl p-2.5 text-left border-2 ${c.id === courseId ? 'border-[#f4776a] bg-white' : 'border-[#f1e2d2] bg-white/80'} ${c.available ? '' : 'opacity-60'}`}
                    onClick={() => c.available && setCourseId(c.id)}>
                    <div className="text-[11px] text-cocoa-soft">{c.order}단계 · {c.course}</div>
                    <div className="font-display text-sm leading-tight mt-0.5">{c.title}</div>
                    <div className="text-[11px] text-[#f2836b] mt-1">{stars(c.difficulty)}</div>
                    {!c.available && <div className="text-[10px] mt-1 rounded-full bg-cream-2 text-center py-0.5">🎵 음원 준비 중</div>}
                  </button>
                ))}
              </div>
              <div className="panel p-4 mt-1">
                <div className="text-xs text-cocoa-soft">{course.order}단계 코스 · {course.course}</div>
                <div className="font-display text-2xl leading-tight">{course.title}</div>
                <div className="text-sm text-cocoa-soft">{course.composer} · 난이도 <span className="text-[#f2836b]">{stars(course.difficulty)}</span>{chart ? ` · 장애물 ${chart.obstacles.length}개 · 약 ${Math.round(chart.duration / 1000)}초` : ''}</div>
                <button className="btn btn-coral w-full py-3.5 text-lg mt-3" data-testid="runner-start" disabled={!audio || starting || !course.available} onClick={() => void start()}>
                  {!course.available ? '🎵 음원 준비 중' : audioErr || (!audio ? '🎹 연주 준비 중…' : starting ? '시작하는 중…' : '▶ 게임 시작')}
                </button>
              </div>
            </div>
          </div>
          {/* 하단: 랭킹 · 게임 방법 · 설정 */}
          <div className="px-3 grid grid-cols-3 gap-2 max-w-[520px] w-full mx-auto">
            <button className="btn btn-ghost min-h-[44px] text-sm" onClick={() => setModal('rank')}>🏆 랭킹</button>
            <button className="btn btn-ghost min-h-[44px] text-sm" onClick={() => setModal('how')}>❓ 게임 방법</button>
            <button className="btn btn-ghost min-h-[44px] text-sm" onClick={() => setModal('settings')}>⚙️ 설정</button>
          </div>
        </div>
      )}
      {screen === 'result' && result && (
        <ResultScreen res={result} avatar={avatar} practiceOnly={practiceOnly} onSaved={loadSummary}
          onRetry={() => { setResult(null); void start(); }} onCourses={() => { setResult(null); setGame(null); setScreen('lobby'); }} onExit={exit}
          onRanking={() => setModal('rank')} />
      )}
      {modal === 'rank' && <RankingModal courseId={courseId} onClose={() => setModal(null)} />}
      {modal === 'how' && <HowModal onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal s={settings} onChange={setSettings} onClose={() => setModal(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- 결과
interface Saved { newBest: boolean; best: { score: number }; rank: number; total: number }
function ResultScreen({ res, avatar, practiceOnly, onSaved, onRetry, onCourses, onExit, onRanking }: {
  res: { r: RunResult; inputs: PlayGame['inputs']; runId: string | null; course: CourseInfo }; avatar: DogAvatar; practiceOnly: boolean;
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
    if (DEMO || state === 'saving') return;
    api<{ entries: RankEntry[] }>(`/api/runner/ranking?scope=course&course=${course.id}&limit=5`).then((x) => setTop(x.entries)).catch(() => {});
  }, [state, course.id]);
  const cnt = (g: Grade) => r.counts[g];
  return (
    <div className="h-full overflow-y-auto scroll-soft pt-[calc(14px+var(--safe-t,0px))] pb-[calc(14px+var(--safe-b))] px-3 bg-[radial-gradient(circle_at_50%_0%,#fde3d6,transparent_60%)]" data-testid="runner-result">
      <div className="max-w-[460px] mx-auto">
        <div className="text-center">
          <div className="font-display text-2xl">🏁 완주! · {course.course}</div>
          <div className="text-sm text-cocoa-soft">{course.title} · {course.composer}</div>
        </div>
        <DogPreview avatar={avatar} happy className="w-[200px] h-[170px] mx-auto" />
        <div className="panel p-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs text-cocoa-soft">최종 점수</div>
              <div className="font-display text-4xl tabular-nums" data-testid="runner-final">{r.score.toLocaleString()}</div>
            </div>
            {saved?.newBest && <span className="rounded-full bg-[#f39a7b] text-white px-3 py-1 font-display text-sm pop">🎉 개인 최고 기록!</span>}
          </div>
          <div className="grid grid-cols-4 gap-1.5 mt-3 text-center">
            {(['perfect', 'great', 'good', 'miss'] as Grade[]).map((g) => (
              <div key={g} className="rounded-xl bg-cream-2 py-1.5"><div className="text-[11px] font-display" style={{ color: GRADE_COLOR[g] }}>{GRADE_LABEL[g]}</div><div className="font-display text-lg">{cnt(g)}</div></div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-1.5 text-center text-sm">
            <div className="rounded-xl bg-cream-2 py-1.5">최고 콤보 <b>{r.maxCombo}</b></div>
            <div className="rounded-xl bg-cream-2 py-1.5">정확도 <b>{pct(r.accuracy)}</b></div>
          </div>
          <div className="mt-3 text-sm">
            {state === 'practice' && <p className="rounded-xl bg-[#eef5fb] text-[#4b6a86] px-3 py-2">연습 기록이라 랭킹에는 올라가지 않아요.</p>}
            {state === 'saving' && <p className="text-cocoa-soft">기록을 저장하는 중…</p>}
            {state === 'error' && (
              <div className="rounded-xl bg-[#fff0ec] text-[#c4553a] px-3 py-2">
                기록을 저장하지 못했어요. {err}
                <button className="btn btn-coral w-full py-2 mt-2" onClick={() => void save()}>🔄 다시 저장하기</button>
              </div>
            )}
            {saved && <p>🏆 곡별 랭킹 <b>{saved.rank}위</b> / {saved.total}명 · 내 최고 {saved.best.score.toLocaleString()}</p>}
          </div>
          {top.length > 0 && (
            <div className="mt-3">
              <div className="font-display text-sm mb-1">{course.course} TOP 5</div>
              {top.map((e) => <RankRow key={e.userId} e={e} compact />)}
              <button className="text-xs underline text-cocoa-soft mt-1" onClick={onRanking}>전체 순위 보기</button>
            </div>
          )}
        </div>
        <div className="grid gap-2 mt-3">
          <button className="btn btn-coral py-3" onClick={onRetry}>🔁 다시 도전하기</button>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-ghost py-3" onClick={onCourses}>🎵 다른 곡 선택</button>
            <button className="btn btn-ghost py-3" onClick={onExit}>🌳 광장으로 돌아가기</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RankRow({ e, me, compact }: { e: RankEntry; me?: boolean; compact?: boolean }) {
  const medal = ['🥇', '🥈', '🥉'][e.rank - 1];
  return (
    <div className={`flex items-center gap-2 rounded-xl px-2 ${compact ? 'py-1' : 'py-1.5'} ${me ? 'bg-[#fde3d6]' : ''}`}>
      <span className="w-8 text-center font-display">{medal ?? e.rank}</span>
      {e.dogPhoto ? <img src={e.dogPhoto} alt="" className="w-8 h-8 rounded-full object-cover border border-white" /> : <span className="w-8 h-8 rounded-full grid place-items-center text-sm" style={{ background: e.coat }}>🐶</span>}
      <div className="flex-1 min-w-0 leading-tight">
        <div className="font-display text-sm truncate">{e.nickname} <span className="text-cocoa-soft font-body text-xs">· 🐶 {e.dogName}</span></div>
        {!compact && <div className="text-[11px] text-cocoa-soft">{e.course ? COURSES.find((c) => c.id === e.course)?.course : '전체'} · 콤보 {e.maxCombo}{e.accuracy ? ` · 정확도 ${pct(e.accuracy)}` : ''} · {dateLabel(e.achievedAt)}</div>}
      </div>
      <span className="font-display tabular-nums text-[#f2836b]">{(e.course ? e.score : e.points).toLocaleString()}{e.course ? '' : 'P'}</span>
    </div>
  );
}

function RankingModal({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const [scope, setScope] = useState<'course' | 'weekly' | 'friends' | 'overall'>('course');
  const [data, setData] = useState<{ entries: RankEntry[]; me: RankEntry | null; total: number; weekStart: number | null } | null>(null);
  const [err, setErr] = useState('');
  const meId = useStore((s) => s.me?.id);
  useEffect(() => {
    setData(null); setErr('');
    if (DEMO) { setErr('미리보기에서는 랭킹을 볼 수 없어요. (게임 서버에서 동작)'); return; }
    api<typeof data>(`/api/runner/ranking?scope=${scope}&course=${courseId}&limit=50`).then(setData).catch((e) => setErr((e as Error).message));
  }, [scope, courseId]);
  const tabs: [typeof scope, string][] = [['course', '곡별'], ['weekly', '주간'], ['friends', '친구'], ['overall', '전체']];
  return (
    <Modal onClose={onClose} className="max-w-[440px] p-4">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-display text-xl flex-1">🏆 멍글런너 랭킹</h2>
        <button className="btn btn-ghost w-10 h-10" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="grid grid-cols-4 gap-1 bg-cream-2 rounded-full p-1 text-sm" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={scope === k} className={`btn py-1.5 ${scope === k ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => setScope(k)}>{l}</button>)}
      </div>
      <p className="text-[11px] text-cocoa-soft mt-2">
        {scope === 'overall' ? '코스마다 점수 체계가 달라, 코스별 최고 기록을 0~1000점으로 환산한 포인트의 합으로 순위를 매겨요.'
          : scope === 'weekly' ? `이번 주 기록 (매주 월요일 00:00 한국 시간에 새로 시작${data?.weekStart ? ` · ${dateLabel(data.weekStart)}~` : ''})`
            : '같은 코스 최고 기록 1개만 반영 · 같은 점수면 정확도 → 최고 콤보 → 먼저 기록한 순'}
      </p>
      <div className="mt-2 max-h-[52vh] overflow-y-auto scroll-soft" data-testid="runner-ranking">
        {err && <p className="text-sm text-cocoa-soft text-center py-6">{err}</p>}
        {!data && !err && <p className="text-sm text-cocoa-soft text-center py-6">불러오는 중…</p>}
        {data && data.entries.length === 0 && <p className="text-sm text-cocoa-soft text-center py-6">아직 기록이 없어요. 첫 기록에 도전해 보세요!</p>}
        {data?.entries.map((e) => <RankRow key={`${e.userId}`} e={e} me={e.userId === meId} />)}
      </div>
      {data?.me && (
        <div className="mt-2 border-t border-[#f1e2d2] pt-2">
          <div className="text-xs text-cocoa-soft mb-1">내 순위 ({data.total}명 중)</div>
          <RankRow e={data.me} me />
        </div>
      )}
    </Modal>
  );
}

function HowModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="max-w-[420px] p-5 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-display text-xl flex-1">❓ 게임 방법</h2>
        <button className="btn btn-ghost w-10 h-10" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <p>강아지는 음악에 맞춰 자동으로 달려요. 장애물 밑의 <b>빛나는 띠가 강아지에게 닿는 순간이 박자</b>예요. 그 박자에 맞춰 조작하면 높은 판정을 받아요.</p>
      <ul className="mt-2 space-y-1">
        <li>🪵 통나무 → <b>점프</b> (↑ · Space · ⤴️)</li>
        <li>🎀 낮은 리본 → <b>몸 낮추기</b> (↓ · ⤵️)</li>
        <li>🪴 화분 → <b>좌우 피하기</b> (← → · ◀ ▶)</li>
        <li>🚧 울타리 → 화살표가 있는 <b>빈 레인으로 이동</b></li>
      </ul>
      <div className="mt-3 rounded-xl bg-cream-2 px-3 py-2">
        판정: PERFECT ±{JUDGE.perfect}ms (100점) · GREAT ±{JUDGE.great}ms (70점) · GOOD ±{JUDGE.good}ms (40점) · MISS 0점<br />
        콤보 10마다 점수 +10% (최대 +100%). 부딪히면 강아지가 비틀거리고 콤보가 초기화되지만 계속 달려요.
      </div>
      <p className="mt-2 text-xs text-cocoa-soft">소리가 늦게 들리는 기기(블루투스 이어폰 등)는 설정의 ‘판정 보정’을 조절해 주세요.</p>
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
