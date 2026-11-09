// 사진 촬영 모드(포토존·벤치) · 광장 스크린 상세 보기 · 광장 스크린에 올리기 신청
import { useEffect, useRef, useState } from 'react';
import { PHOTO_ZONE } from '@shared/world';
import type { ScreenSlide } from '@shared/screen';
import { api } from '../lib/api';
import { get, set, toast, useStore } from '../store';
import { local } from '../game/local';
import { cam } from '../game/CameraRig';
import { isTouchDevice, setMoveLocked } from '../game/input';
import { openProfile } from '../net/socket';
import { resizeImage } from '../lib/image';
import { openCommunity } from './Community';
import { Modal, timeLabel } from './common';
import { DEMO } from '../demo';

/** 사람과 강아지가 함께 보이도록 정면 구도로 카메라를 옮기고 UI를 숨긴다 */
export function startPhotoMode() {
  cam.yaw = local.rot + 0.35;
  cam.pitch = 0.2;
  cam.dist = 3.9;
  cam.lastUserInput = performance.now() + 1e9; // 촬영 중에는 자동 정렬 끔
  setMoveLocked(true);
  set({ photoMode: true, benchMenu: null, panel: 'none' });
}
function endPhotoMode() {
  cam.lastUserInput = performance.now();
  setMoveLocked(false);
  set({ photoMode: false });
}

/** 촬영 모드 하단 바: 셔터 · 나가기, 찍은 사진 미리보기(저장·스크린에 올리기) */
export function PhotoModeBar() {
  const [shot, setShot] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  function capture() {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    try {
      const url = (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.92);
      setFlash(true); setTimeout(() => setFlash(false), 180);
      setShot(url);
    } catch { toast('사진을 찍지 못했어요.', 'error'); }
  }
  function save() {
    if (!shot) return;
    const a = document.createElement('a');
    a.href = shot; a.download = `mungle-${new Date().toISOString().slice(0, 10)}.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('사진을 저장했어요 📸');
  }
  async function share() {
    if (!shot) return;
    const small = await fetch(shot).then((r) => r.blob()).then((b) => resizeImage(new File([b], 'shot.jpg', { type: 'image/jpeg' }), 1024));
    endPhotoMode();
    set({ screenSubmit: { photo: small } });
  }

  return (
    <>
      {flash && <div className="absolute inset-0 z-40 bg-white/80 pointer-events-none" />}
      <div className="absolute z-30 inset-x-0 flex items-center justify-center gap-4" style={{ bottom: 'calc(var(--safe-b) + 24px)' }}>
        <button className="btn btn-ghost px-5 min-h-[48px]" onClick={endPhotoMode}>✕ 나가기</button>
        <button className="w-[76px] h-[76px] rounded-full bg-white border-[6px] border-[#f4776a] shadow-xl active:scale-95" onClick={capture} aria-label="사진 찍기" />
        <span className="name-tag !text-xs">화면을 끌어 구도 조절</span>
      </div>
      {shot && (
        <Modal onClose={() => setShot(null)} className="max-w-[440px] p-4">
          <img src={shot} alt="찍은 사진" className="w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button className="btn btn-peach py-3" onClick={save}>💾 저장하기</button>
            <button className="btn btn-coral py-3" disabled={DEMO} onClick={share}>📺 광장 스크린에 올리기</button>
          </div>
          <button className="w-full text-sm text-cocoa-soft underline mt-2" onClick={() => setShot(null)}>다시 찍기</button>
        </Modal>
      )}
    </>
  );
}

/** 포토존에 서면 '사진 찍기' 버튼 */
export function PhotoZonePrompt() {
  const [near, setNear] = useState(false);
  const mobileChat = useStore((s) => s.chatOpen) && isTouchDevice();
  useEffect(() => {
    const id = window.setInterval(() => {
      setNear(get().park?.kind === 'park' && Math.hypot(local.x - PHOTO_ZONE.standX, local.z - PHOTO_ZONE.standZ) < PHOTO_ZONE.r);
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  if (!near || mobileChat) return null;
  return (
    <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-24 pop" style={{ bottom: isTouchDevice() ? 'calc(var(--safe-b) + 176px)' : undefined }}>
      <button className="btn btn-coral px-6 py-3 text-lg shadow-lg" onClick={() => {
        // 배경판을 등지고 광장 쪽을 보게 선다
        local.rot = PHOTO_ZONE.rot;
        startPhotoMode();
      }}>📸 포토존에서 사진 찍기</button>
    </div>
  );
}

/** 광장 스크린 상세 */
export function ScreenDetail() {
  const d = useStore((s) => s.screenDetail);
  const me = useStore((s) => s.me);
  if (!d) return null;
  const close = () => set({ screenDetail: null });
  if (d === 'empty') {
    return (
      <Modal onClose={close} className="max-w-[380px] p-5 text-center">
        <div className="text-4xl">📺</div>
        <h2 className="font-display text-xl mt-1">멍글마을 광장 스크린</h2>
        <p className="text-sm text-cocoa-soft mt-1">아직 소개된 강아지가 없어요. 우리 강아지 사진을 올리면 운영자가 확인한 뒤 이 스크린에 소개돼요.</p>
        <button className="btn btn-coral w-full py-3 mt-4" disabled={DEMO} onClick={() => set({ screenDetail: null, screenSubmit: {} })}>🐶 우리 강아지 올리기</button>
        {DEMO && <p className="text-xs text-cocoa-soft mt-2">미리보기에서는 신청할 수 없어요. (게임 서버에서 동작)</p>}
      </Modal>
    );
  }
  const s = d as ScreenSlide;
  return (
    <Modal onClose={close} className="max-w-[440px] p-0 overflow-hidden">
      {s.image ? <img src={s.image} alt="" className="w-full max-h-[50vh] object-cover" /> : <div className="h-32 grid place-items-center text-5xl bg-sage-soft">{s.kind === 'meetup' ? '🗓️' : '📢'}</div>}
      <div className="p-5">
        <span className={`text-xs rounded-full px-2.5 py-1 text-white ${s.kind === 'notice' ? 'bg-[#97c08d]' : s.kind === 'meetup' ? 'bg-[#6fb3d2]' : 'bg-[#f39a7b]'}`}>{s.label}</span>
        <h2 className="font-display text-2xl mt-2">{s.title}</h2>
        {s.text && <p className="mt-1">{s.text}</p>}
        <p className="text-xs text-cocoa-soft mt-2">{s.kind === 'notice' ? '멍글마을 운영팀' : s.kind === 'meetup' ? `모임장 ${s.author}` : `${s.author}${s.dogName ? ` · 🐶 ${s.dogName}` : ''}`} · {timeLabel(s.ts)}</p>
        <div className="grid gap-2 mt-4">
          {s.kind === 'meetup' && <button className="btn btn-peach py-2.5" onClick={() => { close(); openCommunity('meetups', { meetupId: s.id }); }}>🐾 모임 보기·참가 신청</button>}
          {s.kind === 'dog' && s.authorId !== me?.id && <button className="btn btn-ghost py-2.5 border border-[#f1e2d2]" onClick={() => { close(); void openProfile(s.authorId); }}>👤 작성자 프로필 보기</button>}
          {s.kind !== 'meetup' && <button className="btn btn-coral py-2.5" onClick={() => { close(); openCommunity('posts'); }}>📸 강아지 자랑하고 스크린에 올리기</button>}
        </div>
      </div>
    </Modal>
  );
}

interface MyItem { id: number; title: string; image: string | null; status: string; ts: number }
const STATUS: Record<string, string> = { pending: '운영자 확인 중', approved: '스크린에 소개 중', rejected: '반려됨', hidden: '내려감' };

/** 광장 스크린에 올리기 신청 (공개 동의 필수 → 운영자 승인 후 노출) */
export function ScreenSubmit() {
  const req = useStore((s) => s.screenSubmit);
  const me = useStore((s) => s.me);
  const [photo, setPhoto] = useState<string | null>(null);
  const [useProfile, setUseProfile] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<MyItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!req) return;
    setPhoto(req.photo ?? null); setUseProfile(!req.photo && !!me?.dogPhoto); setTitle(me ? `${me.dogName} 자랑해요` : ''); setText(''); setConsent(false);
    api<{ items: MyItem[] }>('/api/screen/mine').then((r) => setMine(r.items)).catch(() => {});
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!req || !me) return null;
  const close = () => set({ screenSubmit: null });
  const preview = useProfile ? me.dogPhoto : photo;

  async function submit() {
    setBusy(true);
    try {
      await api('/api/screen', { body: { title, text, consent, ...(useProfile ? { useProfilePhoto: true } : { photo }) } });
      toast('신청했어요! 운영자가 확인하면 광장 스크린에 소개돼요 📺');
      close();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function withdraw(id: number) {
    if (!confirm('스크린 공개를 철회할까요? 신청이 삭제돼요.')) return;
    await api(`/api/screen/${id}`, { method: 'DELETE' }).catch((e) => toast((e as Error).message, 'error'));
    setMine((m) => m.filter((x) => x.id !== id));
  }

  return (
    <Modal onClose={close} className="max-w-[440px] p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-xl flex-1">📺 광장 스크린에 우리 강아지 올리기</h2>
        <button className="btn btn-ghost w-11 h-11" onClick={close} aria-label="닫기">✕</button>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setPhoto(await resizeImage(f, 1024)); setUseProfile(false); } }} />
      <button type="button" onClick={() => fileRef.current?.click()} className="mt-3 w-full h-44 rounded-2xl overflow-hidden bg-white border-2 border-dashed border-[#e9d8c6] grid place-items-center">
        {preview ? <img src={preview} alt="" className="w-full h-full object-cover" /> : <span className="text-cocoa-soft">📷 사진 고르기</span>}
      </button>
      {me.dogPhoto && (
        <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={useProfile} onChange={(e) => setUseProfile(e.target.checked)} /> 프로필에 등록한 강아지 사진 쓰기</label>
      )}
      <input className="field mt-3" maxLength={30} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 (예: 사슴이의 첫 산책)" />
      <textarea className="field mt-2 text-sm" rows={2} maxLength={80} value={text} onChange={(e) => setText(e.target.value)} placeholder="한 줄 소개 (선택)" />
      <label className="flex items-start gap-2 text-sm mt-3 bg-cream-2 rounded-2xl px-3 py-2.5">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>이 사진과 글이 멍글마을 광장 스크린에 <b>모든 이용자에게 공개</b>되는 것에 동의해요. 운영자 확인 후 소개되며, 언제든 철회할 수 있어요.</span>
      </label>
      <button className="btn btn-coral w-full py-3 mt-3" disabled={busy || !consent || !title.trim() || !preview} onClick={submit}>{busy ? '보내는 중…' : '신청하기'}</button>
      {mine.length > 0 && (
        <div className="mt-4">
          <div className="font-display text-sm mb-1">내 신청</div>
          {mine.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-1 text-sm">
              {m.image && <img src={m.image} alt="" className="w-8 h-8 rounded-lg object-cover" />}
              <span className="flex-1 truncate">{m.title}</span>
              <span className="text-xs text-cocoa-soft">{STATUS[m.status] ?? m.status}</span>
              <button className="text-xs underline text-cocoa-soft" onClick={() => withdraw(m.id)}>철회</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
