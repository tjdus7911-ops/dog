// 아바타 만들기 / 수정 — 왼쪽: 3D 미리보기 + 아바타 예시 / 오른쪽: 항목별 실제 3D 썸네일 커스터마이징
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LogoMark } from './Logo';
import {
  ACCESSORIES, BREED_PRESETS, CLOTH_COLORS, COAT_COLORS, DOG_BUILDS, DOG_EAR_SIZES, DOG_LENGTHS, DOG_MARKINGS, DOG_EARS, DOG_FUR, DOG_PATTERNS, DOG_SIZES, DOG_SNOUTS,
  DOG_TAILS, HAIR_COLORS, HAIR_STYLES, HARNESS_COLORS, HAT_STYLES, SKIN_TONES,
  type Accessory, type DogAvatar, type HatStyle, type HumanAvatar,
} from '@shared/avatar';
import type { MyProfile } from '@shared/protocol';
import { api } from '../lib/api';
import { resizeImage } from '../lib/image';
import { get, set, toast } from '../store';
import { useDogThumb, useHumanThumb, type DogView, type HumanView } from '../game/thumbs';
import { AvatarStage, type StageFocus } from './AvatarStage';
import { DogAiPanel } from './DogAiPanel';
import { BOTTOM_PRESETS, EXAMPLES, FUR_LABEL, LABEL, SHOE_PRESETS, SNOUT_LABEL, TAIL_LABEL, THUMB_BASE, TOP_PRESETS, MARKING_LABEL, EAR_SIZE_LABEL, BUILD_LABEL, BODY_LEN_LABEL, LEG_LEN_LABEL } from './avatarOptions';

// ---------- 공통 조각 ----------
function OptionRow({ icon, label, children, extra }: { icon: string; label: string; children: ReactNode; extra?: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    check();
    el.addEventListener('scroll', check);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', check); ro.disconnect(); };
  }, []);
  return (
    <div className="py-3 border-b border-[#f4e6d7] last:border-0">
      <div className="flex items-center gap-2 md:gap-3">
        <div className="w-[88px] md:w-[124px] shrink-0 flex items-center gap-2">
          <span className="w-7 h-7 grid place-items-center text-lg opacity-80">{icon}</span>
          <span className="font-display text-[15px] md:text-base">{label}</span>
        </div>
        <div ref={scroller} className="flex-1 min-w-0 flex gap-2 overflow-x-auto scroll-soft no-scrollbar py-1 px-0.5">{children}</div>
        <button type="button" aria-label="더 보기" onClick={() => scroller.current?.scrollBy({ left: 220, behavior: 'smooth' })}
          className={`w-7 h-7 shrink-0 rounded-full text-cocoa-soft hover:bg-cream-2 transition ${more ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>›</button>
      </div>
      {extra && <div className="mt-2 md:ml-[136px] ml-[96px]">{extra}</div>}
    </div>
  );
}

function Thumb({ src, selected, onClick, label, size = 64 }: { src: string | null; selected: boolean; onClick: () => void; label: string; size?: number }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={selected}
      className={`shrink-0 rounded-2xl bg-white grid place-items-center transition border-2 ${selected ? 'border-[#f4776a] bg-[#fff1ec] shadow-[0_3px_10px_rgba(244,119,106,.25)]' : 'border-[#f3e7da] hover:border-[#f6b6a9]'}`}
      style={{ width: size + 8, height: size + 8 }}>
      {src ? <img src={src} alt="" draggable={false} style={{ width: size, height: size }} className="object-contain" />
        : <span className="rounded-xl bg-cream-2 animate-pulse" style={{ width: size * 0.7, height: size * 0.7 }} />}
    </button>
  );
}

const HumanThumb = (p: { a: HumanAvatar; view: HumanView; selected: boolean; onClick: () => void; label: string }) =>
  <Thumb src={useHumanThumb(p.a, p.view)} selected={p.selected} onClick={p.onClick} label={p.label} />;
const DogThumb = (p: { d: DogAvatar; view: DogView; selected: boolean; onClick: () => void; label: string }) =>
  <Thumb src={useDogThumb(p.d, p.view)} selected={p.selected} onClick={p.onClick} label={p.label} />;

/** 사진 분석으로 정해진 털색이 기본 팔레트에 없으면 맨 앞에 함께 보여 준다 */
const withPhotoColor = (c: string): readonly string[] => ((COAT_COLORS as readonly string[]).includes(c) ? COAT_COLORS : [c, ...COAT_COLORS]);

function Swatches({ list, value, onChange, square }: { list: readonly string[]; value: string; onChange: (v: string) => void; square?: boolean }) {
  return (
    <>
      {list.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={`색상 ${c}`} aria-pressed={value === c}
          className={`shrink-0 transition border-2 ${square ? 'w-12 h-12 rounded-2xl' : 'w-10 h-10 rounded-full'} ${value === c ? 'border-[#f4776a] scale-105 shadow-[0_3px_10px_rgba(244,119,106,.3)]' : 'border-white shadow-sm'}`}
          style={{ background: c, outline: value === c ? '3px solid #fff' : undefined, outlineOffset: -5 }} />
      ))}
    </>
  );
}

const SmallSwatches = ({ list, value, onChange }: { list: readonly string[]; value: string; onChange: (v: string) => void }) => (
  <div className="flex flex-wrap gap-1.5 items-center">
    <span className="text-xs text-cocoa-soft mr-1">색상</span>
    {list.map((c) => (
      <button key={c} type="button" onClick={() => onChange(c)} aria-label={`색상 ${c}`}
        className={`w-6 h-6 rounded-full border-2 ${value === c ? 'border-[#f4776a] scale-110' : 'border-white shadow-sm'}`} style={{ background: c }} />
    ))}
  </div>
);

function Chips<T extends string>({ list, value, onChange, labels = LABEL }: { list: readonly T[]; value: T; onChange: (v: T) => void; labels?: Record<string, string> }) {
  return (
    <>
      {list.map((v) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`shrink-0 btn px-3.5 py-2 text-sm border-2 !shadow-none ${value === v ? 'border-[#f4776a] bg-[#fff1ec] text-[#e2604f]' : 'border-[#f3e7da] bg-white'}`}>
          {labels[v] ?? v}
        </button>
      ))}
    </>
  );
}


// ---------- 화면 ----------
export default function AvatarEditor({ mode }: { mode: 'onboarding' | 'edit' }) {
  const me = get().me!;
  const [tab, setTab] = useState<'human' | 'dog'>('human');
  const [human, setHuman] = useState<HumanAvatar>(me.human);
  const [dog, setDog] = useState<DogAvatar>(me.dog);
  const [nickname, setNickname] = useState(me.nickname);
  const [dogName, setDogName] = useState(me.dogName);
  const [dogIntro, setDogIntro] = useState(me.dogIntro);
  const [photo, setPhoto] = useState(me.dogPhoto);
  const [walking, setWalking] = useState(false);
  const [focus, setFocus] = useState<StageFocus>('both');
  const [expanded, setExpanded] = useState(false);
  // 모바일(768px 미만) 여부 — 아바타 예시를 미리보기 바로 아래 가로 카드로 보여 줌
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const mobilePresets = isMobile && tab === 'human' && !expanded;
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const h = (patch: Partial<HumanAvatar>) => setHuman((p) => ({ ...p, ...patch }));
  const d = (patch: Partial<DogAvatar>) => setDog((p) => ({ ...p, ...patch }));

  useEffect(() => { document.body.style.cursor = ''; }, []);
  useEffect(() => { setFocus(tab === 'dog' ? 'dog' : 'both'); }, [tab]);

  async function uploadPhoto(dataUrl: string) {
    try {
      const r = await api<{ profile: MyProfile }>('/api/me/dog-photo', { body: { dataUrl } });
      setPhoto(r.profile.dogPhoto);
      set({ me: { ...get().me!, dogPhoto: r.profile.dogPhoto } });
      toast('강아지 사진을 등록했어요 📸');
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function removePhoto() {
    try {
      await api('/api/me/dog-photo', { method: 'DELETE' });
      setPhoto(null);
      set({ me: { ...get().me!, dogPhoto: null } });
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ profile: MyProfile }>('/api/me/profile', { method: 'PUT', body: { nickname, dogName, dogIntro, human, dog } });
      set({ me: r.profile, onboarding: false, panel: 'none' });
      toast(mode === 'onboarding' ? '멍글마을에 오신 걸 환영해요! 🐾' : '아바타를 저장했어요');
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  // 썸네일 기준 아바타 (관련 항목만 반영)
  const base: HumanAvatar = { ...THUMB_BASE, skin: human.skin };
  const hairBase: HumanAvatar = { ...base, hairStyle: human.hairStyle, hairColor: human.hairColor };

  const humanRows = (
    <>
      <div className="flex items-center gap-3 py-3 border-b border-[#f4e6d7]">
        <span className="w-[88px] md:w-[124px] shrink-0 font-display pl-9">닉네임</span>
        <div className="flex-1 relative">
          <input className="field !rounded-2xl pr-20" value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-cocoa-soft">{Array.from(nickname).length}/12자</span>
        </div>
      </div>
      <OptionRow icon="🙂" label="피부색"><Swatches list={SKIN_TONES} value={human.skin} onChange={(skin) => h({ skin })} square /></OptionRow>
      <OptionRow icon="✂️" label="헤어스타일">
        {HAIR_STYLES.map((s) => (
          <HumanThumb key={s} a={{ ...base, hairColor: human.hairColor, hairStyle: s }} view="hair" label={LABEL[s]} selected={human.hairStyle === s} onClick={() => h({ hairStyle: s })} />
        ))}
      </OptionRow>
      <OptionRow icon="🎨" label="머리색"><Swatches list={HAIR_COLORS} value={human.hairColor} onChange={(hairColor) => h({ hairColor })} /></OptionRow>
      <OptionRow icon="👕" label="상의" extra={<SmallSwatches list={CLOTH_COLORS} value={human.topColor} onChange={(topColor) => h({ topColor })} />}>
        {TOP_PRESETS.map((p, i) => (
          <HumanThumb key={i} a={{ ...base, ...p }} view="top" label={LABEL[p.top]} selected={human.top === p.top && human.topColor === p.topColor} onClick={() => h(p)} />
        ))}
      </OptionRow>
      <OptionRow icon="👖" label="하의" extra={<SmallSwatches list={CLOTH_COLORS} value={human.bottomColor} onChange={(bottomColor) => h({ bottomColor })} />}>
        {BOTTOM_PRESETS.map((p, i) => (
          <HumanThumb key={i} a={{ ...base, ...p }} view="bottom" label={LABEL[p.bottom]} selected={human.bottom === p.bottom && human.bottomColor === p.bottomColor} onClick={() => h(p)} />
        ))}
      </OptionRow>
      <OptionRow icon="👟" label="신발">
        {SHOE_PRESETS.map((p, i) => (
          <HumanThumb key={i} a={{ ...base, ...p }} view="shoes" label={LABEL[p.shoes]} selected={human.shoes === p.shoes && human.shoeColor === p.shoeColor} onClick={() => h(p)} />
        ))}
      </OptionRow>
      <OptionRow icon="🧢" label="모자" extra={human.hat !== 'none' && <SmallSwatches list={CLOTH_COLORS} value={human.hatColor} onChange={(hatColor) => h({ hatColor })} />}>
        {HAT_STYLES.map((s: HatStyle) => s === 'none'
          ? <NoneBtn key={s} selected={human.hat === 'none'} onClick={() => h({ hat: 'none' })} />
          : <HumanThumb key={s} a={{ ...hairBase, hat: s, hatColor: human.hatColor }} view="head" label={LABEL[s]} selected={human.hat === s} onClick={() => h({ hat: s })} />)}
      </OptionRow>
      <OptionRow icon="👓" label="액세서리">
        {ACCESSORIES.map((s: Accessory) => s === 'none'
          ? <NoneBtn key={s} selected={human.accessory === 'none'} onClick={() => h({ accessory: 'none' })} />
          : <HumanThumb key={s} a={{ ...hairBase, accessory: s }} view={s === 'backpack' || s === 'crossbag' ? 'back' : 'head'} label={LABEL[s]} selected={human.accessory === s} onClick={() => h({ accessory: s })} />)}
      </OptionRow>
    </>
  );

  const dogRows = (
    <>
      {/* 강아지 AI 사진 분석(사진 업로드): 모바일 화면에서는 숨김 (PC에서만) */}
      {!isMobile && <DogAiPanel current={dog} onApply={(next) => setDog({ ...next, harness: dog.harness })} onUseAsProfile={uploadPhoto} />}
      <div className="grid md:grid-cols-2 gap-3 py-3 border-b border-[#f4e6d7]">
        <label className="text-sm font-display">강아지 이름
          <input className="field !rounded-2xl mt-1 font-body" value={dogName} maxLength={12} onChange={(e) => setDogName(e.target.value)} />
        </label>
        <label className="text-sm font-display">한 줄 소개
          <input className="field !rounded-2xl mt-1 font-body" value={dogIntro} maxLength={80} placeholder="산책과 간식을 좋아해요!" onChange={(e) => setDogIntro(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-3 py-3 border-b border-[#f4e6d7]">
        <span className="w-[88px] md:w-[124px] shrink-0 font-display flex items-center gap-2"><span className="w-7 text-lg text-center">📷</span>프로필 사진</span>
        {photo ? <img src={photo} alt="강아지 사진" className="w-14 h-14 rounded-2xl object-cover border-2 border-white shadow" />
          : <div className="w-14 h-14 rounded-2xl bg-cream-2 grid place-items-center text-xl">🐶</div>}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadPhoto(await resizeImage(f, 640)); }} />
        <button type="button" className="btn btn-ghost px-4 py-2 text-sm border-2 border-[#f3e7da] !shadow-none" onClick={() => fileRef.current?.click()}>{photo ? '바꾸기' : '사진 올리기'}</button>
        {photo && <button type="button" className="text-sm text-cocoa-soft underline" onClick={removePhoto}>삭제</button>}
      </div>
      <OptionRow icon="🐕" label="견종 유형">
        {Object.entries(BREED_PRESETS).map(([k, p]) => (
          <DogThumb key={k} d={{ ...p.dog, harness: dog.harness }} view="full" label={p.label} selected={dog.breed === k} onClick={() => setDog({ ...p.dog, harness: dog.harness })} />
        ))}
      </OptionRow>
      <OptionRow icon="📏" label="체형"><Chips list={DOG_SIZES} value={dog.size} onChange={(size) => d({ size })} /></OptionRow>
      <OptionRow icon="〰️" label="털 길이"><Chips list={DOG_FUR} value={dog.fur} onChange={(fur) => d({ fur })} labels={FUR_LABEL} /></OptionRow>
      <OptionRow icon="🎨" label="털색"><Swatches list={withPhotoColor(dog.coat)} value={dog.coat} onChange={(coat) => d({ coat })} /></OptionRow>
      <OptionRow icon="🐾" label="주요 무늬" extra={dog.pattern !== 'none' && <SmallSwatches list={withPhotoColor(dog.secondary)} value={dog.secondary} onChange={(secondary) => d({ secondary })} />}>
        {DOG_PATTERNS.map((s) => <DogThumb key={s} d={{ ...dog, pattern: s }} view="full" label={LABEL[s]} selected={dog.pattern === s} onClick={() => d({ pattern: s })} />)}
      </OptionRow>
      <OptionRow icon="😺" label="얼굴 무늬">
        {DOG_MARKINGS.map((s) => <DogThumb key={s} d={{ ...dog, marking: s }} view="head" label={MARKING_LABEL[s]} selected={dog.marking === s} onClick={() => d({ marking: s })} />)}
      </OptionRow>
      <OptionRow icon="👂" label="귀 모양">
        {DOG_EARS.map((s) => <DogThumb key={s} d={{ ...dog, ear: s }} view="head" label={LABEL[s]} selected={dog.ear === s} onClick={() => d({ ear: s })} />)}
      </OptionRow>
      <OptionRow icon="🔍" label="귀 크기"><Chips list={DOG_EAR_SIZES} value={dog.earSize} onChange={(earSize) => d({ earSize })} labels={EAR_SIZE_LABEL} /></OptionRow>
      <OptionRow icon="🍙" label="몸매"><Chips list={DOG_BUILDS} value={dog.build} onChange={(build) => d({ build })} labels={BUILD_LABEL} /></OptionRow>
      <OptionRow icon="↔️" label="몸 길이"><Chips list={DOG_LENGTHS} value={dog.bodyLen} onChange={(bodyLen) => d({ bodyLen })} labels={BODY_LEN_LABEL} /></OptionRow>
      <OptionRow icon="🦵" label="다리 길이"><Chips list={DOG_LENGTHS} value={dog.legLen} onChange={(legLen) => d({ legLen })} labels={LEG_LEN_LABEL} /></OptionRow>
      <OptionRow icon="👃" label="주둥이">
        {DOG_SNOUTS.map((s) => <DogThumb key={s} d={{ ...dog, snout: s }} view="side" label={SNOUT_LABEL[s]} selected={dog.snout === s} onClick={() => d({ snout: s })} />)}
      </OptionRow>
      <OptionRow icon="🌀" label="꼬리">
        {DOG_TAILS.map((s) => <DogThumb key={s} d={{ ...dog, tail: s }} view="tail" label={TAIL_LABEL[s]} selected={dog.tail === s} onClick={() => d({ tail: s })} />)}
      </OptionRow>
      <OptionRow icon="🎀" label="목줄·하네스"><Swatches list={HARNESS_COLORS} value={dog.harness} onChange={(harness) => d({ harness })} /></OptionRow>
    </>
  );

  const cta = mode === 'onboarding' && tab === 'human'
    ? <button className="btn btn-coral w-full py-3.5 text-lg" onClick={() => setTab('dog')}>다음: 강아지 아바타 만들기 →</button>
    : (
      <div className="flex gap-2">
        {mode === 'edit' && <button className="btn btn-ghost px-6 py-3.5" onClick={() => set({ panel: 'none' })}>취소</button>}
        {mode === 'onboarding' && <button className="btn btn-ghost px-6 py-3.5" onClick={() => setTab('human')}>← 사람 아바타</button>}
        <button className="btn btn-coral flex-1 py-3.5 text-lg" disabled={busy} onClick={save}>{busy ? '저장 중…' : mode === 'onboarding' ? '완성! 산책 나가기 🐾' : '저장하기'}</button>
      </div>
    );

  const stageButtons: [string, string, () => void, boolean][] = [
    ['⛶', expanded ? '작게 보기' : '크게 보기', () => setExpanded(!expanded), expanded],
    ['👕', '사람 보기', () => setFocus(focus === 'human' ? 'both' : 'human'), focus === 'human'],
    ['🐾', '강아지 보기', () => setFocus(focus === 'dog' ? 'both' : 'dog'), focus === 'dog'],
    ['🚶', walking ? '걷기 멈추기' : '걷는 모습 보기', () => setWalking(!walking), walking],
  ];

  return (
    <div className={`${mode === 'edit' ? 'fixed inset-0 z-40' : 'h-full'} bg-[#fff8f0] flex flex-col overflow-hidden`}>
      {/* 헤더 */}
      <header className="flex items-center gap-3 md:gap-5 px-4 md:px-7 pt-3 md:pt-5 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <LogoMark size={40} className="md:w-12 md:h-auto" />
          <div className="leading-none"><div className="font-display text-xl md:text-[28px]">멍글마을</div><div className="text-[11px] font-display text-cocoa-soft hidden md:block mt-0.5">Mungle Village</div></div>
        </div>
        <span className="w-px h-7 bg-[#e9d8c6]" />
        <h1 className="font-display text-xl md:text-[28px]">아바타 {mode === 'edit' ? '꾸미기' : '만들기'}</h1>
        <p className="hidden lg:block text-sm text-cocoa-soft border-b-2 border-[#f3e3d2] pb-0.5">나와 우리 강아지를 닮은 말랑한 3D 아바타를 꾸며 주세요 ♡</p>
        {mode === 'edit' && <button className="ml-auto btn btn-ghost w-10 h-10" onClick={() => set({ panel: 'none' })} aria-label="닫기">✕</button>}
      </header>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3 md:gap-5 px-3 md:px-7 pb-3 md:pb-6">
        {/* 왼쪽: 미리보기 + 예시 */}
        <div className="md:w-[41%] shrink-0 flex flex-col gap-3 md:gap-4 min-h-0">
          <div data-testid="avatar-preview" className={`${expanded ? 'fixed inset-0 z-50 rounded-none' : `relative rounded-[24px] md:rounded-[28px] ${mobilePresets ? 'h-[clamp(168px,26vh,240px)]' : 'h-[34vh] min-h-[220px]'} md:h-auto md:flex-1 md:min-h-[220px]`} overflow-hidden shadow-[0_6px_24px_rgba(122,82,56,.14)] bg-[#bfe3f7]`}>
            <AvatarStage human={human} dog={dog} walking={walking} focus={focus} compact={isMobile && !expanded} />
            <div className="absolute right-2.5 top-2.5 md:right-3 md:top-3 flex flex-col gap-1.5 [@media(max-height:700px)]:gap-1 md:gap-2.5">
              {stageButtons.map(([icon, label, onClick, active]) => (
                <button key={label} onClick={onClick} title={label} aria-label={label}
                  className={`w-9 h-9 text-base md:w-12 md:h-12 md:text-lg rounded-full grid place-items-center shadow-md transition ${active ? 'bg-[#f4776a] text-white' : 'bg-white/95 hover:bg-white'}`}>{icon}</button>
              ))}
            </div>
            <div className="absolute bottom-2 md:bottom-3 inset-x-0 flex justify-center pointer-events-none">
              <span className="font-display text-white text-base md:text-xl drop-shadow-[0_1px_3px_rgba(0,0,0,.35)]">⟲ 360° ⟳</span>
            </div>
          </div>
          {/* 모바일: 아바타 예시 (PC와 같은 EXAMPLES · 같은 적용 방식) — 가로로 넘겨 보는 카드 */}
          {mobilePresets && (
            <div className="md:hidden -mx-3 shrink-0" data-testid="avatar-presets-mobile">
              <div className="px-4 font-display text-sm mb-1.5 flex items-center gap-1.5 [@media(max-height:700px)]:text-[13px] [@media(max-height:700px)]:mb-1"><span className="text-[#f4776a]">●</span> 아바타 예시 <span className="text-xs text-cocoa-soft font-body">· 누르면 바로 적용돼요</span></div>
              <div className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory scroll-px-4 px-4 pb-1 no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
                {EXAMPLES.map((ex, i) => (
                  <ExampleCard key={i} a={ex} bg={EXAMPLE_BG[i % EXAMPLE_BG.length]} onClick={() => setHuman({ ...ex })}
                    selected={sameHuman(human, ex)} className="snap-start shrink-0 w-[30%] max-w-[112px] [@media(max-height:700px)]:max-w-[84px]" testId={`avatar-preset-${i}`} />
                ))}
              </div>
            </div>
          )}
          {tab === 'human' && !expanded && (
            <div className="hidden md:block panel !rounded-[24px] p-3.5 shrink-0">
              <div className="font-display text-sm mb-2 flex items-center gap-1.5"><span className="text-[#f4776a]">●</span> 아바타 예시 <span className="text-xs text-cocoa-soft font-body">· 누르면 바로 적용돼요</span></div>
              <div className="grid grid-cols-4 gap-2.5">
                {EXAMPLES.map((ex, i) => <ExampleCard key={i} a={ex} bg={EXAMPLE_BG[i % EXAMPLE_BG.length]} onClick={() => setHuman({ ...ex })} />)}
              </div>
            </div>
          )}
        </div>

        {/* 오른쪽: 커스터마이징 */}
        <div className="flex-1 min-w-0 min-h-0 panel !rounded-[28px] p-3 md:p-5 flex flex-col">
          <div className="grid grid-cols-2 gap-1 bg-[#fdeee3] rounded-full p-1 shrink-0">
            {(['human', 'dog'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`btn py-2.5 md:py-3 text-base md:text-lg ${tab === t ? 'bg-[#f4776a] text-white shadow-[0_3px_0_#e2604f]' : 'text-cocoa'}`}>
                {t === 'human' ? '🧑 사람 아바타' : '🐾 강아지 아바타'}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-soft px-1 md:px-2 mt-1">{tab === 'human' ? humanRows : dogRows}</div>
          <div className="pt-3 shrink-0">{cta}</div>
        </div>
      </div>
    </div>
  );
}

function NoneBtn({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="없음" title="없음" aria-pressed={selected}
      className={`shrink-0 w-[72px] h-[72px] rounded-2xl bg-white grid place-items-center text-2xl text-[#c9b8a8] border-2 ${selected ? 'border-[#f4776a] bg-[#fff1ec]' : 'border-[#f3e7da]'}`}>⊘</button>
  );
}

const EXAMPLE_BG = ['#e6ecf7', '#fde3e6', '#ece7f4', '#f1e6f7'];
/** 지금 아바타가 예시와 같은지 (예시에 있는 항목만 비교) */
function sameHuman(cur: HumanAvatar, ex: HumanAvatar) {
  return (Object.keys(ex) as (keyof HumanAvatar)[]).every((k) => JSON.stringify(cur[k]) === JSON.stringify(ex[k]));
}

function ExampleCard({ a, bg, onClick, selected, className = '', testId }: { a: HumanAvatar; bg: string; onClick: () => void; selected?: boolean; className?: string; testId?: string }) {
  const src = useHumanThumb(a, 'bust');
  // selected 를 넘기는 곳(모바일)에서만 선택 테두리 — PC 카드 모양은 그대로
  const ring = selected === undefined ? '' : selected ? 'border-[3px] border-[#f4776a]' : 'border-[3px] border-transparent';
  return (
    <button onClick={onClick} data-testid={testId} aria-pressed={selected} className={`rounded-2xl aspect-square grid place-items-center overflow-hidden hover:scale-[1.03] transition ${ring} ${className}`} style={{ background: bg }} aria-label="예시 아바타 적용">
      {src ? <img src={src} alt="" className="w-full h-full object-contain" /> : <span className="w-1/2 h-1/2 rounded-xl bg-white/60 animate-pulse" />}
    </button>
  );
}
