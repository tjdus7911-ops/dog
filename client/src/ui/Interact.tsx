// 산책 상호작용 UI
// - InteractBar: 지금 할 수 있는 일만 버튼으로 (여러 개면 작은 액션 메뉴 하나로 통합)
// - DogMenu: 다른 강아지(또는 내 강아지)를 눌렀을 때 메뉴
// - DogProfileSheet: 강아지 프로필 (모바일 하단 시트 / PC 오른쪽 패널) · DogProfileEditor
// - PhotoViewer: 사진 크게 보기 (광장 스크린·액자·강아지 사진첩 공통)
// - JoinPrompt: 둘러보기 방문자가 주민 전용 기능을 눌렀을 때 가입 안내
import { useEffect, useRef, useState } from 'react';
import { BIG_SCREEN, BINS, PHOTO_ZONE } from '@shared/world';
import { BIN_REACH, DOG_PHOTO_MAX, DOG_TRAITS, PET_REACH, POOP_REACH, type DogProfileSettings, type DogProfileView } from '@shared/protocol';
import type { ScreenSlide } from '@shared/screen';
import { get, set, toast, useStore } from '../store';
import { local } from '../game/local';
import { isTouchDevice, setMoveLocked } from '../game/input';
import { screenNow } from '../game/fx';
import { rendered } from '../net/remote';
import { disposeBag, dogPos, friendAction, joinPark, openDm, openProfile, petDog, pickupPoop } from '../net/socket';
import { api } from '../lib/api';
import { resizeImage } from '../lib/image';
import { DEMO } from '../demo';
import { ABOVE_CTRL } from './layout';
import { DOORS } from './Places';
import { startPhotoMode } from './Photo';
import { openCommunity } from './Community';
import { Modal } from './common';
import { logout } from './App';

interface Act { key: string; icon: string; label: string; run: () => void }

/** 모달·프로필이 열려 있는지 (열려 있으면 이동 UI를 숨긴다) */
export function useOverlayOpen() {
  return useStore((s) => !!(s.viewer || s.dogMenu !== null || s.dogEdit || s.joinPrompt || (s.dogSheet !== null && isTouchDevice())));
}
const isGuest = () => get().me?.role === 'guest';

// ---------- 쓰다듬으러 다가가기 ----------
let approach: { targetId: number; t0: number } | null = null;
/** 강아지 앞까지 걸어간 뒤 쓰다듬기 (가까우면 바로) */
export function approachAndPet(targetId: number) {
  if (isGuest()) { set({ joinPrompt: true }); return; }
  const p = dogPos(targetId);
  if (!p) { toast('강아지가 보이지 않아요.', 'error'); return; }
  if (Math.hypot(p.x - local.x, p.z - local.z) < PET_REACH - 0.5) { void petDog(targetId); return; }
  approach = { targetId, t0: performance.now() };
  stepApproach();
}
function stepApproach() {
  if (!approach) return;
  const p = dogPos(approach.targetId);
  const dt = performance.now() - approach.t0;
  if (!p || dt > 12000) { approach = null; local.moveTarget = null; return; }
  const d = Math.hypot(p.x - local.x, p.z - local.z);
  if (d < PET_REACH - 0.5) {
    const id = approach.targetId;
    approach = null; local.moveTarget = null;
    void petDog(id);
    return;
  }
  // 직접 움직이거나 막혀서 멈췄으면 취소
  if (dt > 400 && !local.moveTarget) { approach = null; toast('강아지에게 다가가지 못했어요. 조금 더 가까이 가 주세요.'); return; }
  // 강아지와 나 사이, 강아지에게서 0.9m 떨어진 곳으로 이동
  const k = 0.9 / Math.max(d, 0.01);
  local.moveTarget = { x: p.x + (local.x - p.x) * k, z: p.z + (local.z - p.z) * k };
}

// ---------- 지금 할 수 있는 일 ----------
function nearActions(): Act[] {
  const st = get();
  const acts: Act[] = [];
  const kind = st.park?.kind;
  if (!st.me || !kind || st.seated || local.action) return acts;
  const near = (x: number, z: number, r: number) => Math.hypot(local.x - x, local.z - z) < r;
  if (kind === 'park') {
    // 내 강아지 배변 (가장 가까운 것)
    const mine = Object.values(st.poops).filter((p) => p.ownerId === st.me!.id && near(p.x, p.z, POOP_REACH - 0.2));
    if (mine.length) acts.push({ key: 'poop', icon: '💩', label: '똥 줍기', run: () => void pickupPoop(mine[0].id) });
    if (local.bag) {
      const bin = BINS.find((b) => near(b.x, b.z, BIN_REACH - 0.2));
      if (bin) acts.push({ key: 'bin', icon: '🗑️', label: '봉투 버리기', run: () => void disposeBag(bin.id) });
    }
    const door = DOORS.find((x) => near(x.e.x, x.e.z, x.e.r));
    if (door) acts.push({ key: door.id, icon: door.label.split(' ')[0], label: door.label.split(' ').slice(1).join(' '), run: () => (door.id === 'board' ? openCommunity('meetups') : void joinPark(door.id)) });
    if (near(PHOTO_ZONE.standX, PHOTO_ZONE.standZ, PHOTO_ZONE.r)) acts.push({ key: 'photo', icon: '📸', label: '포토존에서 사진 찍기', run: () => { local.rot = PHOTO_ZONE.rot; startPhotoMode(); } });
    // 광장 스크린 앞 (스크린 정면 쪽)
    if (Math.abs(local.x - BIG_SCREEN.x) < BIG_SCREEN.postX + 1.6 && local.z > BIG_SCREEN.z && local.z < BIG_SCREEN.z + 6.5) {
      acts.push({ key: 'screen', icon: '📺', label: '자세히 보기', run: () => openScreenSlide(screenNow.get()) });
    }
  }
  // 다른 강아지가 바로 옆에 있으면 쓰다듬기
  let best: { id: number; d: number } | null = null;
  rendered.forEach((r, id) => {
    const d = Math.hypot(r.dx - local.x, r.dz - local.z);
    if (d < 1.6 && (!best || d < best.d) && st.players[id]) best = { id, d };
  });
  const other = best as { id: number; d: number } | null;
  if (other) {
    const name = st.players[other.id]?.dogName ?? '강아지';
    acts.push({ key: `pet-${other.id}`, icon: '❤️', label: `${name} 쓰다듬기`, run: () => approachAndPet(other.id) });
  }
  // 멈춰 서 있고 내 강아지가 곁에 있으면 내 강아지 쓰다듬기
  const idle = local.humanAnim === 0 && local.jumpY === 0;
  if (idle && !isGuest() && Math.hypot(local.dogX - local.x, local.dogZ - local.z) < 1.5) {
    acts.push({ key: 'pet-me', icon: '❤️', label: '쓰다듬기', run: () => void petDog(st.me!.id) });
  }
  return acts;
}

export function InteractBar() {
  const [acts, setActs] = useState<Act[]>([]);
  const [open, setOpen] = useState(false);
  const touch = isTouchDevice();
  useEffect(() => {
    const id = window.setInterval(() => {
      stepApproach();
      const next = nearActions();
      setActs((cur) => (cur.map((a) => a.key).join() === next.map((a) => a.key).join() ? cur : next));
    }, 200);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => { if (acts.length < 2) setOpen(false); }, [acts.length]);
  if (!acts.length) return null;
  const pos = { bottom: touch ? ABOVE_CTRL : undefined };
  const btn = (a: Act, extra = '') => (
    <button key={a.key} className={`btn btn-coral shadow-lg whitespace-nowrap min-h-[48px] ${extra}`} onClick={() => { setOpen(false); a.run(); }}>
      <span className="mr-1">{a.icon}</span>{a.label}
    </button>
  );
  if (acts.length === 1) {
    return <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-24 pop" style={pos} data-testid="interact">{btn(acts[0], 'px-6 py-3 text-lg')}</div>;
  }
  // 여러 개: 대표 동작 + 나머지를 펼치는 작은 메뉴
  return (
    <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-24 flex flex-col items-center gap-2" style={pos} data-testid="interact">
      {open && (
        <div className="panel p-2 grid gap-1.5 pop w-[min(80vw,260px)]">
          {acts.slice(1).map((a) => (
            <button key={a.key} className="btn btn-ghost min-h-[46px] px-4 justify-start text-left border border-[#f1e2d2]" onClick={() => { setOpen(false); a.run(); }}>
              <span className="mr-1.5">{a.icon}</span>{a.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 pop">
        {btn(acts[0], 'px-5 py-3 text-base')}
        <button className={`btn min-h-[48px] min-w-[48px] px-3 shadow-lg ${open ? 'btn-peach' : 'btn-ghost bg-white'}`} onClick={() => setOpen(!open)} aria-label="다른 동작 보기" aria-expanded={open}>
          {open ? '✕' : `⋯ ${acts.length - 1}`}
        </button>
      </div>
    </div>
  );
}

// ---------- 강아지 메뉴 ----------
export function DogMenu() {
  const id = useStore((s) => s.dogMenu);
  const me = useStore((s) => s.me);
  const p = useStore((s) => (id !== null ? s.players[id] : undefined));
  const friends = useStore((s) => s.friends.some((f) => f.profile.id === id));
  const outgoing = useStore((s) => s.outgoing.some((o) => o.id === id));
  if (id === null || !me) return null;
  const isMe = id === me.id;
  const dogName = isMe ? me.dogName : p?.dogName ?? '강아지';
  const close = () => set({ dogMenu: null });
  const item = (icon: string, label: string, run: () => void, testid?: string) => (
    <button className="btn btn-ghost min-h-[50px] px-4 justify-start text-left border border-[#f1e2d2] text-base" data-testid={testid} onClick={() => { close(); run(); }}>
      <span className="mr-2 text-lg">{icon}</span>{label}
    </button>
  );
  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-[#5a403322]" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel pop w-full md:w-[320px] p-4 rounded-b-none md:rounded-b-[22px] pb-[calc(16px+var(--safe-b))] md:pb-4" role="dialog" aria-label={`${dogName} 메뉴`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">🐶</span>
          <div className="flex-1">
            <div className="font-display text-xl leading-none">{dogName}</div>
            {!isMe && p && <div className="text-xs text-cocoa-soft mt-1">보호자 {p.nickname}{p.guest ? ' · 둘러보기 방문자' : ''}</div>}
          </div>
          <button className="btn btn-ghost w-10 h-10" onClick={close} aria-label="닫기">✕</button>
        </div>
        <div className="grid gap-2">
          {item('🐾', '강아지 정보', () => set({ dogSheet: id }), 'dog-info')}
          {item('❤️', '쓰다듬기', () => (isMe ? void petDog(id) : approachAndPet(id)), 'dog-pet')}
          {!isMe && item('👤', '보호자 프로필', () => void openProfile(id))}
          {!isMe && !p?.guest && (friends
            ? item('💬', '채팅하기', () => p && void openDm(p))
            : outgoing ? <div className="text-sm text-cocoa-soft text-center py-2">🤝 친구 신청을 보냈어요</div>
              : item('🤝', '친구 신청', () => (isGuest() ? set({ joinPrompt: true }) : void friendAction('friend:request', id))))}
          {isMe && item('✏️', '우리 강아지 프로필 꾸미기', () => (isGuest() ? set({ joinPrompt: true }) : set({ dogEdit: true })))}
        </div>
      </div>
    </div>
  );
}

// ---------- 강아지 프로필 ----------
const AGE = (a: number | null) => (a === null ? null : a === 0 ? '1살 미만' : `${a}살`);
const GENDER = { male: '남아 ♂', female: '여아 ♀' } as const;

function demoDogView(id: number): DogProfileView | null {
  const me = get().me;
  if (!me || id !== me.id) return null;
  return { ownerId: me.id, ownerNickname: me.nickname, name: me.dogName, breed: '우리 강아지', photos: me.dogPhoto ? [me.dogPhoto] : [], coat: me.dog.coat, intro: me.dogIntro ?? '', age: null, gender: null, traits: [], limited: false, canPet: true, friendStatus: 'none', isMe: true, guest: false };
}

/** 사진이 없을 때 기본 강아지 그림 */
function DefaultDog({ coat, className = '' }: { coat: string; className?: string }) {
  return (
    <div className={`grid place-items-center ${className}`} style={{ background: `radial-gradient(circle at 50% 40%, ${coat}, ${coat}cc 60%, #f6e7d6)` }}>
      <svg viewBox="0 0 100 100" className="w-1/2 h-1/2 drop-shadow" aria-label="기본 강아지 이미지">
        <ellipse cx="22" cy="42" rx="14" ry="22" fill="#8b6a55" transform="rotate(-18 22 42)" />
        <ellipse cx="78" cy="42" rx="14" ry="22" fill="#8b6a55" transform="rotate(18 78 42)" />
        <circle cx="50" cy="52" r="32" fill="#fff8ef" />
        <circle cx="38" cy="48" r="4.5" fill="#4a3426" /><circle cx="62" cy="48" r="4.5" fill="#4a3426" />
        <ellipse cx="50" cy="62" rx="7" ry="5" fill="#4a3426" />
        <path d="M44 70 Q50 75 56 70" stroke="#4a3426" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function Slider({ photos, coat, onOpen }: { photos: string[]; coat: string; onOpen: (i: number) => void }) {
  const [i, setI] = useState(0);
  const sx = useRef<number | null>(null);
  useEffect(() => setI(0), [photos.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!photos.length) return <DefaultDog coat={coat} className="w-full h-full" />;
  const go = (d: number) => setI((v) => (v + d + photos.length) % photos.length);
  return (
    <div className="relative w-full h-full bg-[#2b211b] select-none"
      onPointerDown={(e) => { sx.current = e.clientX; }}
      onPointerUp={(e) => { if (sx.current !== null && Math.abs(e.clientX - sx.current) > 40) go(e.clientX < sx.current ? 1 : -1); sx.current = null; }}>
      <img src={photos[i]} alt={`강아지 사진 ${i + 1}`} className="w-full h-full object-contain cursor-zoom-in" draggable={false} onClick={() => onOpen(i)} />
      {photos.length > 1 && (
        <>
          <button className="absolute left-2 top-1/2 -translate-y-1/2 btn btn-ghost w-10 h-10 bg-white/85" onClick={() => go(-1)} aria-label="이전 사진">‹</button>
          <button className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost w-10 h-10 bg-white/85" onClick={() => go(1)} aria-label="다음 사진">›</button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {photos.map((_, k) => <span key={k} className={`w-2 h-2 rounded-full ${k === i ? 'bg-white' : 'bg-white/45'}`} />)}
          </div>
        </>
      )}
    </div>
  );
}

export function DogProfileSheet() {
  const id = useStore((s) => s.dogSheet);
  const editVersion = useStore((s) => s.dogEdit);
  const [dog, setDog] = useState<DogProfileView | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (id === null) return;
    setDog(null); setErr('');
    if (DEMO) { const v = demoDogView(id); if (v) setDog(v); else setErr('미리보기에서는 다른 강아지 프로필을 볼 수 없어요.'); return; }
    api<{ dog: DogProfileView }>(`/api/dogs/${id}`).then((r) => setDog(r.dog)).catch((e) => setErr((e as Error).message));
  }, [id, editVersion]);
  if (id === null) return null;
  const close = () => set({ dogSheet: null });
  const touch = isTouchDevice();
  const view = (i: number) => dog && set({ viewer: { photos: dog.photos, index: i, title: dog.name, caption: dog.intro || undefined } });
  const status = dog?.friendStatus;
  const guestViewer = get().me?.role === 'guest';
  return (
    <div className={touch ? 'fixed inset-0 z-40 flex items-end bg-[#5a403333]' : 'fixed z-40 right-3 top-16 bottom-3 w-[370px]'}
      onPointerDown={(e) => touch && e.target === e.currentTarget && close()}>
      <div className={`panel pop flex flex-col overflow-hidden ${touch ? 'w-full max-h-[86vh] rounded-b-none' : 'h-full'}`} role="dialog" aria-label="강아지 프로필" data-testid="dog-sheet">
        {touch && <div className="mx-auto mt-2 w-10 h-1.5 rounded-full bg-[#e9d8c6]" />}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <span className="text-xl">🐾</span>
          <h2 className="font-display text-xl flex-1">강아지 프로필</h2>
          <button className="btn btn-ghost w-10 h-10" onClick={close} aria-label="프로필 닫기">✕</button>
        </div>
        <div className="overflow-y-auto scroll-soft pb-[calc(16px+var(--safe-b))]">
          {!dog ? (
            <div className="p-8 text-center text-cocoa-soft">{err || '불러오는 중…'}</div>
          ) : (
            <>
              <div className="h-60 md:h-64"><Slider photos={dog.photos} coat={dog.coat} onOpen={view} /></div>
              <div className="px-4 pt-3">
                <div className="flex items-end gap-2">
                  <div className="font-display text-2xl leading-none">{dog.name}</div>
                  <div className="text-cocoa-soft text-sm">{dog.breed}</div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 text-sm">
                  {AGE(dog.age) && <span className="rounded-full bg-cream-2 px-2.5 py-1">🎂 {AGE(dog.age)}</span>}
                  {dog.gender && <span className="rounded-full bg-cream-2 px-2.5 py-1">{GENDER[dog.gender]}</span>}
                  {dog.traits.map((t) => <span key={t} className="rounded-full bg-[#fde3d6] px-2.5 py-1">{t}</span>)}
                </div>
                {dog.intro && <p className="mt-3 bg-cream-2 rounded-2xl px-3 py-2">{dog.intro}</p>}
                <div className="mt-3 text-sm text-cocoa-soft">👤 보호자 <b className="text-cocoa">{dog.ownerNickname}</b>{dog.guest ? ' · 둘러보기 방문자' : ''}</div>
                {dog.limited && <p className="mt-2 text-xs text-cocoa-soft bg-[#f3f7ef] rounded-xl px-3 py-2">🔒 보호자가 일부 정보를 {dog.isMe ? '' : '친구에게만 '}공개했어요. 공개된 정보만 보여요.</p>}
                {dog.photos.length > 1 && (
                  <div className="mt-3">
                    <div className="font-display text-sm mb-1.5">📷 사진첩</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {dog.photos.map((u, i) => (
                        <button key={u + i} className="aspect-square rounded-xl overflow-hidden bg-cream-2" onClick={() => view(i)} aria-label={`사진 ${i + 1} 크게 보기`}>
                          <img src={u} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid gap-2 mt-4">
                  {dog.isMe ? (
                    <button className="btn btn-coral py-3" onClick={() => (guestViewer ? set({ joinPrompt: true }) : set({ dogEdit: true }))}>✏️ 프로필·사진첩 꾸미기</button>
                  ) : (
                    <>
                      <button className="btn btn-ghost py-2.5 border border-[#f1e2d2]" onClick={() => { close(); void openProfile(dog.ownerId); }}>👤 보호자 프로필</button>
                      {!dog.guest && (
                        <div className="grid grid-cols-2 gap-2">
                          {status === 'friends' ? <button className="btn btn-ghost py-2.5 border border-[#f1e2d2] text-sm" disabled>🤝 친구예요</button>
                            : status === 'outgoing' ? <button className="btn btn-ghost py-2.5 border border-[#f1e2d2] text-sm" disabled>⏳ 신청 보냄</button>
                              : <button className="btn btn-peach py-2.5 text-sm" onClick={async () => {
                                if (guestViewer) return set({ joinPrompt: true });
                                const st = await friendAction(status === 'incoming' ? 'friend:accept' : 'friend:request', dog.ownerId);
                                if (st) setDog({ ...dog, friendStatus: st });
                              }}>🤝 {status === 'incoming' ? '친구 수락' : '친구 신청'}</button>}
                          <button className="btn btn-coral py-2.5 text-sm" onClick={() => {
                            if (guestViewer) return set({ joinPrompt: true });
                            const p = get().players[dog.ownerId] ?? get().friends.find((f) => f.profile.id === dog.ownerId)?.profile;
                            if (status !== 'friends' || !p) { toast('친구가 되면 보호자와 1:1 채팅을 할 수 있어요. 먼저 친구 신청을 보내 보세요!'); return; }
                            close(); void openDm(p);
                          }}>💬 채팅 요청</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- 내 강아지 프로필 편집 ----------
export function DogProfileEditor() {
  const open = useStore((s) => s.dogEdit);
  const me = useStore((s) => s.me);
  const [s, setS] = useState<DogProfileSettings | null>(null);
  const [intro, setIntro] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setS(null);
    if (DEMO) { setS({ age: null, gender: null, traits: [], photos: [], visibility: 'all', allowPetting: 'all' }); return; }
    api<{ settings: DogProfileSettings; intro: string }>('/api/me/dog-profile').then((r) => { setS(r.settings); setIntro(r.intro); }).catch((e) => toast((e as Error).message, 'error'));
  }, [open]);
  if (!open || !me) return null;
  const close = () => set({ dogEdit: false });
  const up = (p: Partial<DogProfileSettings>) => s && setS({ ...s, ...p });
  async function save() {
    if (!s) return;
    if (DEMO) { toast('미리보기에서는 저장되지 않아요. (게임 서버에서 동작)'); return; }
    setBusy(true);
    try {
      await api('/api/me/dog-profile', { method: 'PUT', body: { ...s, intro } });
      toast('🐶 강아지 프로필을 저장했어요');
      close();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function addPhoto(f: File) {
    if (DEMO) { toast('미리보기에서는 사진을 올릴 수 없어요.'); return; }
    setBusy(true);
    try {
      const r = await api<{ settings: DogProfileSettings }>('/api/me/dog-photos', { body: { dataUrl: await resizeImage(f, 1280) } });
      setS((cur) => cur && { ...cur, photos: r.settings.photos });
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function removePhoto(url: string) {
    if (!confirm('이 사진을 사진첩에서 지울까요?')) return;
    try {
      const r = await api<{ settings: DogProfileSettings }>('/api/me/dog-photos', { method: 'DELETE', body: { url } });
      setS((cur) => cur && { ...cur, photos: r.settings.photos });
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  const seg = <T extends string>(val: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="grid gap-1 bg-cream-2 rounded-2xl p-1" style={{ gridTemplateColumns: `repeat(${opts.length}, 1fr)` }}>
      {opts.map(([v, l]) => <button key={v} type="button" className={`btn py-2 text-sm ${val === v ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`} onClick={() => on(v)}>{l}</button>)}
    </div>
  );
  return (
    <Modal onClose={close} className="max-w-[440px] p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-display text-xl flex-1">✏️ {me.dogName} 프로필 꾸미기</h2>
        <button className="btn btn-ghost w-10 h-10" onClick={close} aria-label="닫기">✕</button>
      </div>
      {!s ? <p className="text-cocoa-soft">불러오는 중…</p> : (
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-display mb-1">📷 사진첩 ({s.photos.length}/{DOG_PHOTO_MAX})</div>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPhoto(f); }} />
            <div className="grid grid-cols-4 gap-1.5">
              {s.photos.map((u) => (
                <div key={u} className="relative aspect-square rounded-xl overflow-hidden bg-cream-2">
                  <img src={u} alt="" className="w-full h-full object-cover" />
                  <button className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-white/90 text-xs" onClick={() => removePhoto(u)} aria-label="사진 지우기">✕</button>
                </div>
              ))}
              {s.photos.length < DOG_PHOTO_MAX && <button className="aspect-square rounded-xl border-2 border-dashed border-[#e9d8c6] text-cocoa-soft" disabled={busy} onClick={() => file.current?.click()}>＋<br />사진</button>}
            </div>
            <p className="text-xs text-cocoa-soft mt-1">대표 사진은 아바타 편집에서 바꿀 수 있어요. JPG·PNG·WebP</p>
          </div>
          <label className="block">나이
            <select className="field mt-1" value={s.age ?? ''} onChange={(e) => up({ age: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">선택 안 함</option>
              <option value="0">1살 미만</option>
              {Array.from({ length: 25 }, (_, i) => i + 1).map((a) => <option key={a} value={a}>{a}살</option>)}
            </select>
          </label>
          <div><div className="mb-1">성별 (선택)</div>{seg((s.gender ?? 'none') as 'male' | 'female' | 'none', [['none', '선택 안 함'], ['male', '남아'], ['female', '여아']], (v) => up({ gender: v === 'none' ? null : v }))}</div>
          <div>
            <div className="mb-1">성격·특징 (최대 4개)</div>
            <div className="flex flex-wrap gap-1.5">
              {DOG_TRAITS.map((t) => {
                const on = s.traits.includes(t);
                return <button key={t} type="button" className={`rounded-full px-3 py-1.5 border ${on ? 'bg-[#fde3d6] border-[#f39a7b]' : 'bg-white border-[#f1e2d2]'}`}
                  onClick={() => up({ traits: on ? s.traits.filter((x) => x !== t) : s.traits.length >= 4 ? s.traits : [...s.traits, t] })}>{t}</button>;
              })}
            </div>
          </div>
          <label className="block">한 줄 소개
            <input className="field mt-1" maxLength={80} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="예: 공만 보면 신나는 산책왕이에요" />
          </label>
          <div><div className="mb-1">🔒 프로필 공개 (나이·성별·성격·소개·사진첩)</div>{seg(s.visibility, [['all', '전체'], ['friends', '친구만'], ['private', '나만']], (v) => up({ visibility: v }))}
            <p className="text-xs text-cocoa-soft mt-1">이름·견종·대표 사진은 항상 보여요.</p></div>
          <div><div className="mb-1">❤️ 다른 사람의 쓰다듬기</div>{seg(s.allowPetting, [['all', '누구나'], ['friends', '친구만'], ['none', '허용 안 함']], (v) => up({ allowPetting: v }))}</div>
          <button className="btn btn-coral w-full py-3" disabled={busy} onClick={save}>{busy ? '저장 중…' : '저장하기'}</button>
        </div>
      )}
    </Modal>
  );
}

// ---------- 사진 크게 보기 ----------
export function PhotoViewer() {
  const v = useStore((s) => s.viewer);
  const [i, setI] = useState(0);
  const sx = useRef<number | null>(null);
  // 뒤로가기로 닫기: 열 때 기록을 하나 쌓고, 뒤로가기(popstate)가 오면 닫음
  useEffect(() => {
    if (!v) return;
    setI(v.index);
    setMoveLocked(true, 'viewer');
    history.pushState({ mungleViewer: true }, '');
    const onPop = () => set({ viewer: null });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeViewer();
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, v.photos.length - 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); setMoveLocked(false, 'viewer'); };
  }, [v]);
  if (!v) return null;
  const n = v.photos.length;
  const go = (d: number) => setI((x) => Math.max(0, Math.min(n - 1, x + d)));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e1712e6] md:bg-[#2b211bcc] md:p-8" data-testid="photo-viewer"
      onPointerDown={(e) => e.target === e.currentTarget && closeViewer()} role="dialog" aria-label="사진 크게 보기">
      <div className="relative w-full h-full md:h-auto md:max-w-[880px] md:rounded-[22px] md:overflow-hidden md:bg-[#2b211b] flex flex-col">
        <div className="flex items-center gap-2 px-3 pt-[calc(10px+var(--safe-t,0px))] pb-2 text-white">
          <div className="flex-1 min-w-0">
            {v.title && <div className="font-display text-lg truncate">{v.title}</div>}
            {n > 1 && <div className="text-xs opacity-75">{i + 1} / {n}</div>}
          </div>
          <button className="w-11 h-11 rounded-full bg-white/15 text-xl" onClick={closeViewer} aria-label="닫기">✕</button>
        </div>
        <div className="relative flex-1 md:flex-none md:h-[68vh] min-h-0 select-none touch-pan-y"
          onPointerDown={(e) => { sx.current = e.clientX; }}
          onPointerUp={(e) => { if (sx.current !== null && Math.abs(e.clientX - sx.current) > 40) go(e.clientX < sx.current ? 1 : -1); sx.current = null; }}>
          {/* 비율 유지 · 잘리지 않게 (object-contain) */}
          <img src={v.photos[i]} alt={v.title ? `${v.title} 사진 ${i + 1}` : `사진 ${i + 1}`} className="absolute inset-0 w-full h-full object-contain" draggable={false} />
          {n > 1 && i > 0 && <button className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/80 text-2xl" onClick={() => go(-1)} aria-label="이전 사진">‹</button>}
          {n > 1 && i < n - 1 && <button className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/80 text-2xl" onClick={() => go(1)} aria-label="다음 사진">›</button>}
        </div>
        {(v.caption || v.dogOwnerId !== undefined) && (
          <div className="px-4 pt-3 pb-[calc(14px+var(--safe-b))] md:pb-4 text-white">
            {v.caption && <p className="text-sm opacity-90">{v.caption}</p>}
            {v.dogOwnerId !== undefined && (
              <button className="btn btn-coral w-full md:w-auto md:px-6 py-3 mt-2" onClick={() => { const id = v.dogOwnerId!; closeViewer(); set({ dogSheet: id }); }}>🐶 강아지 프로필 보기</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
export function closeViewer() {
  if (!get().viewer) return;
  set({ viewer: null });
  if (history.state?.mungleViewer) history.back();
}

/** 광장 스크린 슬라이드 열기: 사진이 있으면 크게 보기(누른 순간의 슬라이드 고정), 없으면 상세 */
export function openScreenSlide(s: ScreenSlide | 'empty') {
  if (s === 'empty' || !s.image) { set({ screenDetail: s }); return; }
  const slide = s;
  set({
    viewer: {
      photos: [slide.image!], index: 0,
      title: slide.kind === 'dog' && slide.dogName ? `🐶 ${slide.dogName}` : slide.title,
      caption: [slide.kind === 'dog' ? slide.title : '', slide.text].filter(Boolean).join(' · ') || undefined,
      dogOwnerId: slide.kind === 'dog' ? slide.authorId : undefined,
    },
  });
  // 강아지 사진첩이 공개돼 있으면 슬라이드에 이어 붙임 (누른 사진이 첫 장)
  if (slide.kind === 'dog' && !DEMO) {
    api<{ dog: DogProfileView }>(`/api/dogs/${slide.authorId}`).then((r) => {
      const cur = get().viewer;
      if (!cur || cur.photos[0] !== slide.image) return;
      const more = r.dog.photos.filter((u) => u !== slide.image);
      if (more.length) set({ viewer: { ...cur, photos: [slide.image!, ...more], caption: cur.caption ?? (r.dog.intro || undefined) } });
    }).catch(() => {});
  }
}

// ---------- 둘러보기 방문자 가입 안내 ----------
export function JoinPrompt() {
  const open = useStore((s) => s.joinPrompt);
  if (!open) return null;
  const close = () => set({ joinPrompt: false });
  return (
    <Modal onClose={close} className="max-w-[380px] p-6 text-center">
      <div className="text-5xl">🐶</div>
      <p className="font-display text-lg mt-2 leading-snug" data-testid="join-prompt">이 기능은 멍글마을 주민만 이용할 수 있어요!<br />회원가입하고 우리 강아지와 함께 시작해 보세요.</p>
      <div className="grid gap-2 mt-5">
        <button className="btn btn-coral py-3" onClick={() => { close(); void goSignup(); }}>회원가입하기</button>
        <button className="btn btn-ghost py-3 border border-[#f1e2d2]" onClick={close}>계속 둘러보기</button>
      </div>
    </Modal>
  );
}
/** 둘러보기를 마치고 가입 화면으로 (가입 후 아바타 → 강아지 → 입주 순서) */
export async function goSignup() {
  try { sessionStorage.setItem('mungle.authMode', 'signup'); } catch { /* 저장 불가 */ }
  await logout();
}

/** 화면에 늘 붙어 있는 상호작용 레이어 */
export function InteractionOverlays() {
  return (
    <>
      <DogMenu />
      <DogProfileSheet />
      <DogProfileEditor />
      <PhotoViewer />
      <JoinPrompt />
    </>
  );
}

