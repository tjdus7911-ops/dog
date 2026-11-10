// 멍글런너 '함께 달리기' 화면 — 방 만들기/참가 · 대기실(참가자·준비·곡/난이도·친구 초대) · 결과(1~4위)
import { useEffect, useState } from 'react';
import { COURSES, DIFFICULTY_LABEL, type RunnerDifficulty } from '@shared/runner';
import { MR_MAX, MR_REWARD, type MRPlayer, type MRResult } from '@shared/runnerMulti';
import { toast, useStore } from '../store';
import { clearResults, createRoom, invite, joinRoom, leaveRoom, setReady, setSettings, useMulti } from './multi';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const AVAILABLE = COURSES.filter((c) => c.available);

function DogFace({ p, size = 48 }: { p: Pick<MRPlayer, 'dogPhoto' | 'dog'>; size?: number }) {
  return p.dogPhoto
    ? <img src={p.dogPhoto} alt="" className="rounded-full object-cover border-2 border-white shadow shrink-0" style={{ width: size, height: size }} />
    : <span className="rounded-full grid place-items-center border-2 border-white shadow shrink-0" style={{ width: size, height: size, background: p.dog.coat, fontSize: size * 0.45 }}>🐶</span>;
}

/** 방 만들기 / 방 코드로 참가 */
function Entry({ onBack, initialCode }: { onBack: () => void; initialCode: string | null }) {
  const [courseId, setCourseId] = useState(AVAILABLE[0]?.id ?? 'elise');
  const [difficulty, setDifficulty] = useState<RunnerDifficulty>('normal');
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } };
  useEffect(() => { if (initialCode) void run(() => joinRoom(initialCode)); }, [initialCode]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="max-w-[860px] mx-auto">
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <section className="panel p-4" data-testid="mr-create">
          <h3 className="font-display text-lg">🏠 방 만들기</h3>
          <p className="text-xs text-cocoa-soft">내가 방장이 되어 곡과 난이도를 고르고, 친구를 초대해요. (최대 {MR_MAX}명)</p>
          <label className="block text-sm mt-3">🎵 곡 · 코스
            <select className="w-full mt-1 rounded-xl border border-[#f1e2d2] bg-white px-3 py-2.5" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {COURSES.map((c) => <option key={c.id} value={c.id} disabled={!c.available}>{c.order}. {c.course} · {c.composer} — {c.title}{c.available ? '' : ' (음원 준비 중)'}</option>)}
            </select>
          </label>
          <div className="text-sm mt-3">⭐ 난이도</div>
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            {(['easy', 'normal'] as RunnerDifficulty[]).map((d) => (
              <button key={d} className={`btn py-2.5 border-2 ${difficulty === d ? 'border-[#f39a7b] bg-[#fff3ee]' : 'border-transparent bg-cream-2'}`} onClick={() => setDifficulty(d)}>
                {DIFFICULTY_LABEL[d]}<span className="block text-[10px] text-cocoa-soft">{d === 'easy' ? '박 사이 장애물 없음' : '혼자 달리기와 같은 패턴'}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-coral w-full py-3 mt-3 text-lg" disabled={busy} data-testid="mr-create-btn" onClick={() => void run(() => createRoom(courseId, difficulty))}>방 만들기</button>
        </section>
        <section className="panel p-4" data-testid="mr-join">
          <h3 className="font-display text-lg">🔑 방 코드로 참가</h3>
          <p className="text-xs text-cocoa-soft">친구에게 받은 6자리 코드를 입력해요.</p>
          <input className="field mt-3 text-center font-display text-2xl tracking-[0.35em] uppercase !py-3" maxLength={6} value={code} placeholder="ABC234" inputMode="text" autoCapitalize="characters"
            data-testid="mr-code-input" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          <button className="btn btn-coral w-full py-3 mt-3 text-lg" disabled={busy || code.length !== 6} data-testid="mr-join-btn" onClick={() => void run(() => joinRoom(code))}>참가하기</button>
          <div className="mt-4 rounded-2xl bg-cream-2 px-3 py-2 text-[12px] text-cocoa-soft">
            🌐 공개방 · ⚡ 빠른 매칭은 준비 중이에요. 지금은 코드나 친구 초대로 함께 달려요.
          </div>
        </section>
      </div>
      <button className="btn btn-ghost mx-auto block mt-3 px-5 py-2.5" onClick={onBack}>← 멍글런너 처음으로</button>
    </div>
  );
}

/** 대기실 */
function Room({ onPrepare }: { onPrepare: () => void }) {
  const room = useMulti((s) => s.room)!;
  const me = useStore((s) => s.me)!;
  const friends = useStore((s) => s.friends);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [sent, setSent] = useState<Record<number, true>>({});
  const mine = room.players.find((p) => p.id === me.id);
  const host = room.hostId === me.id;
  const course = COURSES.find((c) => c.id === room.courseId)!;
  const allReady = room.players.length >= 2 && room.players.every((p) => p.ready && p.connected);
  const err = (e: unknown) => toast((e as Error).message, 'error');
  async function copy() {
    try { await navigator.clipboard.writeText(room.code); toast('방 코드를 복사했어요'); } catch { toast(`방 코드: ${room.code}`); }
  }
  const slots = Array.from({ length: MR_MAX }, (_, i) => room.players[i] ?? null);
  const inRoom = new Set(room.players.map((p) => p.id));
  return (
    <div className="max-w-[860px] mx-auto" data-testid="mr-room">
      <div className="panel p-3 md:p-4 mt-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[180px]">
          <div className="text-xs text-cocoa-soft">방 코드</div>
          <button className="font-display text-3xl tracking-[0.25em] text-[#e2604f]" onClick={() => void copy()} data-testid="mr-code" aria-label="방 코드 복사">{room.code}</button>
        </div>
        <div className="min-w-[200px] flex-1">
          <div className="text-xs text-cocoa-soft">곡 · 난이도 {host ? '(방장이 정해요)' : `(방장: ${room.players.find((p) => p.host)?.nickname ?? ''})`}</div>
          {host ? (
            <div className="flex gap-1.5 mt-1">
              <select className="flex-1 min-w-0 rounded-xl border border-[#f1e2d2] bg-white px-2 py-2 text-sm" value={room.courseId} data-testid="mr-course"
                onChange={(e) => void setSettings({ courseId: e.target.value }).catch(err)}>
                {COURSES.map((c) => <option key={c.id} value={c.id} disabled={!c.available}>{c.course} · {c.title}{c.available ? '' : ' (준비 중)'}</option>)}
              </select>
              {(['easy', 'normal'] as RunnerDifficulty[]).map((d) => (
                <button key={d} className={`btn px-3 text-sm ${room.difficulty === d ? 'btn-peach' : 'btn-ghost'}`} data-testid={`mr-diff-${d}`} onClick={() => void setSettings({ difficulty: d }).catch(err)}>{DIFFICULTY_LABEL[d]}</button>
              ))}
            </div>
          ) : <div className="font-display mt-1">🎵 {course.course} · {course.title} · ⭐ {DIFFICULTY_LABEL[room.difficulty]}</div>}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2" data-testid="mr-players">
        {slots.map((p, i) => p ? (
          <div key={p.id} className={`panel p-3 text-center relative ${p.id === me.id ? 'ring-2 ring-[#f39a7b]' : ''}`}>
            {p.host && <span className="absolute left-2 top-2 text-lg" title="방장">👑</span>}
            <div className="mx-auto w-fit"><DogFace p={p} size={56} /></div>
            <div className="font-display mt-1 truncate">🐶 {p.dogName}</div>
            <div className="text-xs text-cocoa-soft truncate">{p.nickname}{p.id === me.id ? ' (나)' : ''}</div>
            <div className={`mt-1.5 rounded-full text-xs py-1 font-display ${!p.connected ? 'bg-cream-2 text-cocoa-soft' : p.ready ? 'bg-sage-soft text-sage-deep' : 'bg-[#fff4cf] text-[#b9851a]'}`} data-testid={`mr-state-${p.id}`}>
              {!p.connected ? '📡 연결 대기' : p.ready ? '✅ 준비 완료' : '⏳ 준비 중'}
            </div>
          </div>
        ) : (
          <button key={`e${i}`} className="rounded-[22px] border-2 border-dashed border-[#e9d8c6] bg-white/50 p-3 text-center text-cocoa-soft min-h-[150px]" onClick={() => setInviteOpen(true)}>
            <div className="text-3xl">＋</div><div className="text-sm mt-1">친구 초대</div>
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-cocoa-soft mt-2">{room.players.length < 2 ? '2명 이상 모이면 시작할 수 있어요. 방 코드를 알려 주거나 친구를 초대하세요.' : allReady ? '모두 준비 완료! 곧 출발해요' : '모두 준비 완료를 누르면 3초 카운트다운 뒤 함께 출발해요.'}</p>
      <div className="grid grid-cols-3 gap-2 mt-2 max-w-[560px] mx-auto">
        <button className="btn btn-ghost py-3" onClick={() => void leaveRoom()}>🚪 나가기</button>
        <button className="btn btn-ghost py-3" onClick={() => setInviteOpen(!inviteOpen)} data-testid="mr-invite-open">💌 친구 초대</button>
        <button className={`btn py-3 text-lg ${mine?.ready ? 'btn-ghost border-2 border-[#a9cfa0]' : 'btn-coral'}`} data-testid="mr-ready"
          onClick={() => { onPrepare(); void setReady(!mine?.ready).catch(err); }}>
          {mine?.ready ? '준비 취소' : '준비 완료'}
        </button>
      </div>
      {inviteOpen && (
        <div className="panel p-3 mt-2 max-w-[560px] mx-auto" data-testid="mr-invite-list">
          <div className="font-display text-sm mb-1">💌 멍글마을 친구 초대</div>
          {friends.length === 0 && <p className="text-xs text-cocoa-soft py-2">아직 친구가 없어요. 방 코드 <b>{room.code}</b>를 알려 주세요.</p>}
          {[...friends].sort((a, b) => Number(!!b.online) - Number(!!a.online)).map((f) => (
            <div key={f.profile.id} className="flex items-center gap-2 py-1">
              <DogFace p={{ dogPhoto: f.profile.dogPhoto, dog: f.profile.dog }} size={32} />
              <span className="flex-1 text-sm truncate">{f.profile.nickname} · 🐶 {f.profile.dogName} {f.online ? <span className="text-[11px] text-sage-deep">● 접속 중</span> : null}</span>
              <button className="btn btn-peach px-3 min-h-[38px] text-xs" disabled={inRoom.has(f.profile.id) || !!sent[f.profile.id]}
                onClick={() => void invite(f.profile.id).then(() => { setSent((s) => ({ ...s, [f.profile.id]: true })); toast(`${f.profile.nickname}님께 초대를 보냈어요`); }).catch(err)}>
                {inRoom.has(f.profile.id) ? '참가 중' : sent[f.profile.id] ? '보냄' : '초대'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 결과: 1~4위 · 점수 · 정확도 · 최대 콤보 · 코인 */
export function MultiResultScreen({ results, onAgain, onLeave }: { results: MRResult[]; onAgain: () => void; onLeave: () => void }) {
  const me = useStore((s) => s.me)!;
  const room = useMulti((s) => s.room);
  const mine = results.find((r) => r.id === me.id);
  const face = (id: number) => room?.players.find((p) => p.id === id);
  return (
    <div className="h-full overflow-y-auto scroll-soft pt-[calc(12px+var(--safe-t,0px))] pb-[calc(12px+var(--safe-b))] px-3 bg-[radial-gradient(circle_at_50%_0%,#fde4ea,transparent_60%)]" data-testid="mr-result">
      <div className="max-w-[520px] mx-auto">
        <div className="text-center">
          <div className="inline-block font-display text-2xl text-white bg-[#f39a7b] rounded-full px-6 py-1 shadow-[0_3px_0_#d9705f]">🏁 함께 달리기 결과</div>
          {mine && <div className="font-display text-xl mt-2" data-testid="mr-my-rank">{mine.rank ? `🐶 ${mine.dogName} · ${mine.rank}위!` : `${mine.reason ?? '완주하지 못했어요'}`}</div>}
        </div>
        <div className="mt-3 space-y-2">
          {results.map((r) => {
            const p = face(r.id);
            const medal = r.rank ? ['🥇', '🥈', '🥉', '🏅'][r.rank - 1] : '—';
            return (
              <div key={r.id} className={`panel p-3 flex items-center gap-3 ${r.id === me.id ? 'ring-2 ring-[#f39a7b]' : ''} ${r.completed ? '' : 'opacity-70'}`}>
                <span className="w-9 text-center font-display text-2xl">{medal}</span>
                {p ? <DogFace p={p} size={44} /> : <span className="w-11 h-11 rounded-full bg-cream-2 grid place-items-center">🐶</span>}
                <div className="flex-1 min-w-0 leading-tight">
                  <div className="font-display truncate">🐶 {r.dogName} <span className="text-xs text-cocoa-soft font-body">· {r.nickname}</span></div>
                  <div className="text-[12px] text-cocoa-soft">{r.completed ? `정확도 ${pct(r.accuracy)} · 최대 콤보 ${r.maxCombo}` : r.reason}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg tabular-nums text-[#e2604f]">{r.score.toLocaleString()}</div>
                  <div className="text-[11px] text-[#b9851a]">{r.completed ? (r.coin ? `🪙 +${r.coin}` : '오늘 보상 횟수 끝') : ''}</div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-cocoa-soft text-center mt-2">순위 보상 {MR_REWARD.map((c, i) => `${i + 1}위 ${c}`).join(' · ')}코인 · 정상 완주자만 · 혼자 달리기와 합쳐 하루 3번</p>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button className="btn btn-ghost bg-white py-3" onClick={onLeave}>🚪 방 나가기</button>
          <button className="btn btn-coral py-3" onClick={onAgain} data-testid="mr-again">🔁 같은 방에서 한 번 더</button>
        </div>
      </div>
    </div>
  );
}

/** 함께 달리기 화면 (방이 없으면 만들기/참가, 있으면 대기실) */
export function MultiScreen({ onBack, onPrepare, joinCode }: { onBack: () => void; onPrepare: () => void; joinCode: string | null }) {
  const room = useMulti((s) => s.room);
  return (
    <div className="h-full overflow-y-auto scroll-soft pt-[calc(8px+var(--safe-t,0px))] pb-[calc(12px+var(--safe-b))] px-3 bg-[radial-gradient(circle_at_15%_0%,#fde4ea,transparent_55%),radial-gradient(circle_at_90%_95%,#e3efdc,transparent_45%)]" data-testid="mr-screen">
      <div className="flex items-center gap-2 max-w-[860px] mx-auto">
        <button className="w-10 h-10 rounded-full bg-white shadow grid place-items-center shrink-0" onClick={() => (room ? void leaveRoom() : onBack())} aria-label="뒤로">←</button>
        <div className="flex-1 text-center font-display text-xl">🐾 함께 달리기</div>
        <span className="w-10" />
      </div>
      {room ? <Room onPrepare={onPrepare} /> : <Entry onBack={onBack} initialCode={joinCode} />}
    </div>
  );
}
export { clearResults };
