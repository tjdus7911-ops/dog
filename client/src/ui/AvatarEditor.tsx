// 아바타 만들기 / 수정 — 사람 아바타 & 강아지 아바타(파츠 조합) + 360도 미리보기
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  ACCESSORIES, BOTTOM_STYLES, BREED_PRESETS, CLOTH_COLORS, COAT_COLORS, DOG_EARS, DOG_FUR, DOG_PATTERNS, DOG_SIZES,
  DOG_SNOUTS, DOG_TAILS, HAIR_COLORS, HAIR_STYLES, HARNESS_COLORS, HAT_STYLES, SHOE_COLORS, SKIN_TONES, TOP_STYLES,
  type DogAvatar, type HumanAvatar,
} from '@shared/avatar';
import { DogAnim, HumanAnim, type MyProfile } from '@shared/protocol';
import { Human, newHumanDriver } from '../game/models/Human';
import { Dog, newDogDriver } from '../game/models/Dog';
import { api } from '../lib/api';
import { get, set, toast } from '../store';
import { geo, mat } from '../game/lowpoly';

const L: Record<string, string> = {
  short: '숏컷', bob: '단발', long: '긴머리', bun: '똥머리', spiky: '삐죽',
  hoodie: '후드티', tee: '티셔츠', jacket: '재킷', shorts: '반바지', pants: '긴바지', skirt: '치마',
  none: '없음', cap: '캡모자', beanie: '비니', backpack: '가방', glasses: '안경',
  small: '소형', medium: '중형', large: '대형', patch: '얼룩', saddle: '등 무늬', mask: '얼굴·가슴', socks: '흰 양말',
  floppy: '접힌 귀', pointy: '선 귀', fold: '반쯤 접힌 귀', curl: '말린 꼬리', straight: '곧은 꼬리', fluffy: '풍성한 꼬리',
  medium_snout: '보통',
};
const snoutLabel = { short: '짧은 코', medium: '보통 코', long: '긴 코' };
const furLabel = { short: '단모', long: '장모' };
const shortTail = { short: '짧은 꼬리' };

function Preview({ human, dog, walking }: { human: HumanAvatar; dog: DogAvatar; walking: boolean }) {
  const hd = useRef(newHumanDriver());
  const dd = useRef(newDogDriver());
  useFrame((state, dt) => {
    hd.current.anim = walking ? HumanAnim.Walk : HumanAnim.Idle;
    hd.current.phase += walking ? dt * 7 : 0;
    dd.current.anim = walking ? DogAnim.Walk : DogAnim.Stand;
    dd.current.phase += walking ? dt * 11 : 0;
    dd.current.look = walking ? 0 : Math.sin(state.clock.elapsedTime * 0.8) * 0.5;
  });
  return (
    <group position={[0, -0.75, 0]}>
      <mesh geometry={geo.cyl(1.25, 1.35, 0.18, 12)} material={mat('#fdeedd')} position={[0, -0.09, 0]} />
      <mesh geometry={geo.cyl(1.32, 1.32, 0.02, 12)} material={mat('#a9d38f')} position={[0, 0.005, 0]} />
      <group position={[-0.35, 0, 0]}><Human avatar={human} driver={hd} /></group>
      <group position={[0.5, 0, 0.25]} rotation={[0, -0.5, 0]}><Dog avatar={dog} driver={dd} /></group>
    </group>
  );
}

function Swatches({ list, value, onChange }: { list: readonly string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={c}
          className={`w-8 h-8 rounded-full border-2 transition ${value === c ? 'border-peach scale-110 shadow-md' : 'border-white shadow-sm'}`} style={{ background: c }} />
      ))}
    </div>
  );
}

function Chips<T extends string>({ list, value, onChange, labels }: { list: readonly T[]; value: T; onChange: (v: T) => void; labels?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((v) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`btn px-3 py-1.5 text-sm ${value === v ? 'btn-peach !shadow-none' : 'btn-ghost !shadow-none border border-[#f1e2d2]'}`}>
          {(labels ?? L)[v] ?? L[v] ?? v}
        </button>
      ))}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="py-2.5 border-b border-[#f6e9db] last:border-0">
    <div className="text-sm text-cocoa-soft mb-1.5">{label}</div>
    {children}
  </div>
);

async function resizeImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const max = 640;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

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
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const h = <K extends keyof HumanAvatar>(k: K) => (v: HumanAvatar[K]) => setHuman({ ...human, [k]: v });
  const d = <K extends keyof DogAvatar>(k: K) => (v: DogAvatar[K]) => setDog({ ...dog, [k]: v });

  useEffect(() => { document.body.style.cursor = ''; }, []);

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
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

  const body = (
    <div className="flex flex-col md:flex-row gap-4 h-full min-h-0">
      {/* 360도 미리보기 */}
      <div className="md:w-[44%] shrink-0 flex flex-col">
        <div className="relative rounded-3xl bg-gradient-to-b from-[#fff8ef] to-[#fdeedd] h-[34vh] md:h-full min-h-[240px] overflow-hidden">
          <Canvas camera={{ position: [0, 0.6, 3.4], fov: 38 }} dpr={[1, 2]}>
            <hemisphereLight args={['#fff7ea', '#e8d6b8', 1.5]} />
            <directionalLight position={[3, 5, 4]} intensity={1.4} />
            <Preview human={human} dog={dog} walking={walking} />
            <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={1.6} minPolarAngle={0.9} maxPolarAngle={1.75} target={new THREE.Vector3(0, -0.05, 0)} />
          </Canvas>
          <div className="absolute bottom-3 inset-x-0 flex justify-center gap-2">
            <span className="name-tag">↔ 드래그해서 360도 돌려 보기</span>
            <button className="btn btn-ghost text-xs px-3 py-1" onClick={() => setWalking(!walking)}>{walking ? '⏸ 멈추기' : '🚶 걷기 보기'}</button>
          </div>
        </div>
      </div>

      {/* 설정 */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="grid grid-cols-2 gap-1 bg-cream-2 rounded-full p-1 mb-2 shrink-0">
          <button className={`btn py-2 ${tab === 'human' ? 'btn-peach !shadow-none' : 'text-cocoa-soft'}`} onClick={() => setTab('human')}>🧑 사람 아바타</button>
          <button className={`btn py-2 ${tab === 'dog' ? 'btn-peach !shadow-none' : 'text-cocoa-soft'}`} onClick={() => setTab('dog')}>🐶 강아지 아바타</button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-soft pr-1">
          {tab === 'human' ? (
            <>
              <Row label="닉네임"><input className="field" value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} /></Row>
              <Row label="피부색"><Swatches list={SKIN_TONES} value={human.skin} onChange={h('skin')} /></Row>
              <Row label="헤어스타일"><Chips list={HAIR_STYLES} value={human.hairStyle} onChange={h('hairStyle')} /></Row>
              <Row label="머리색"><Swatches list={HAIR_COLORS} value={human.hairColor} onChange={h('hairColor')} /></Row>
              <Row label="상의"><Chips list={TOP_STYLES} value={human.top} onChange={h('top')} /><div className="mt-2"><Swatches list={CLOTH_COLORS} value={human.topColor} onChange={h('topColor')} /></div></Row>
              <Row label="하의"><Chips list={BOTTOM_STYLES} value={human.bottom} onChange={h('bottom')} /><div className="mt-2"><Swatches list={CLOTH_COLORS} value={human.bottomColor} onChange={h('bottomColor')} /></div></Row>
              <Row label="신발"><Swatches list={SHOE_COLORS} value={human.shoeColor} onChange={h('shoeColor')} /></Row>
              <Row label="모자"><Chips list={HAT_STYLES} value={human.hat} onChange={h('hat')} />{human.hat !== 'none' && <div className="mt-2"><Swatches list={CLOTH_COLORS} value={human.hatColor} onChange={h('hatColor')} /></div>}</Row>
              <Row label="액세서리"><Chips list={ACCESSORIES} value={human.accessory} onChange={h('accessory')} /></Row>
            </>
          ) : (
            <>
              <div className="rounded-2xl bg-sage-soft text-[13px] px-3 py-2.5 my-2 leading-relaxed">
                🤖 <b>AI 사진 분석은 아직 연결되지 않았어요.</b> 지금은 아래에서 견종 유형을 고르고 털색·귀·꼬리를 직접 맞춰 주세요.
                AI가 연결되면 사진을 분석해 같은 항목을 자동으로 채워 드리고, 결과는 여기서 다시 수정할 수 있어요.
              </div>
              <Row label="강아지 이름"><input className="field" value={dogName} maxLength={12} onChange={(e) => setDogName(e.target.value)} /></Row>
              <Row label="한 줄 소개">
                <input className="field" value={dogIntro} maxLength={80} placeholder="예: 산책과 간식을 좋아하는 호기심 많은 아이예요!" onChange={(e) => setDogIntro(e.target.value)} />
              </Row>
              <Row label="실제 강아지 사진 (프로필에 표시)">
                <div className="flex items-center gap-3">
                  {photo ? <img src={photo} alt="강아지 사진" className="w-16 h-16 rounded-2xl object-cover border-2 border-white shadow" />
                    : <div className="w-16 h-16 rounded-2xl bg-cream-2 grid place-items-center text-2xl">📷</div>}
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                  <button type="button" className="btn btn-ghost px-4 py-2 text-sm" onClick={() => fileRef.current?.click()}>{photo ? '사진 바꾸기' : '사진 올리기'}</button>
                  {photo && <button type="button" className="text-sm text-cocoa-soft underline" onClick={removePhoto}>삭제</button>}
                </div>
              </Row>
              <Row label="견종 유형 (선택하면 기본 파츠가 맞춰져요)">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(BREED_PRESETS).map(([k, p]) => (
                    <button key={k} type="button" onClick={() => setDog({ ...p.dog, harness: dog.harness })}
                      className={`btn px-3 py-1.5 text-sm ${dog.breed === k ? 'btn-peach !shadow-none' : 'btn-ghost !shadow-none border border-[#f1e2d2]'}`}>{p.label}</button>
                  ))}
                </div>
              </Row>
              <Row label="체형"><Chips list={DOG_SIZES} value={dog.size} onChange={d('size')} /></Row>
              <Row label="털 길이"><Chips list={DOG_FUR} value={dog.fur} onChange={d('fur')} labels={furLabel} /></Row>
              <Row label="털색 (기본)"><Swatches list={COAT_COLORS} value={dog.coat} onChange={d('coat')} /></Row>
              <Row label="주요 무늬"><Chips list={DOG_PATTERNS} value={dog.pattern} onChange={d('pattern')} />
                {dog.pattern !== 'none' && <div className="mt-2"><div className="text-xs text-cocoa-soft mb-1">무늬 색</div><Swatches list={COAT_COLORS} value={dog.secondary} onChange={d('secondary')} /></div>}
              </Row>
              <Row label="귀 모양"><Chips list={DOG_EARS} value={dog.ear} onChange={d('ear')} /></Row>
              <Row label="꼬리 모양"><Chips list={DOG_TAILS} value={dog.tail} onChange={d('tail')} labels={{ ...L, ...shortTail }} /></Row>
              <Row label="주둥이"><Chips list={DOG_SNOUTS} value={dog.snout} onChange={d('snout')} labels={snoutLabel} /></Row>
              <Row label="하네스 색"><Swatches list={HARNESS_COLORS} value={dog.harness} onChange={d('harness')} /></Row>
            </>
          )}
        </div>
        <div className="pt-3 flex gap-2 shrink-0">
          {mode === 'onboarding' && tab === 'human'
            ? <button className="btn btn-peach flex-1 py-3 text-lg" onClick={() => setTab('dog')}>다음: 강아지 만들기 →</button>
            : <>
                {mode === 'edit' && <button className="btn btn-ghost px-5 py-3" onClick={() => set({ panel: 'none' })}>취소</button>}
                <button className="btn btn-peach flex-1 py-3 text-lg" disabled={busy} onClick={save}>{busy ? '저장 중…' : mode === 'onboarding' ? '완성! 산책 나가기 🐾' : '저장하기'}</button>
              </>}
        </div>
      </div>
    </div>
  );

  if (mode === 'onboarding') {
    return (
      <div className="h-full bg-cream p-3 md:p-6 flex flex-col">
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <span className="text-2xl">✨</span>
          <h1 className="font-display text-2xl">아바타 만들기</h1>
          <span className="text-sm text-cocoa-soft ml-2 hidden sm:inline">나와 우리 강아지를 닮은 로우폴리 아바타를 꾸며 주세요</span>
        </div>
        <div className="panel p-3 md:p-5 flex-1 min-h-0">{body}</div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-40 bg-[#5a403333] p-2 md:p-8 grid place-items-center">
      <div className="panel pop p-3 md:p-5 w-full max-w-5xl h-[94vh] md:h-[82vh] flex flex-col">
        <div className="flex items-center gap-2 mb-3"><span className="text-xl">✨</span><h2 className="font-display text-xl">아바타 꾸미기</h2></div>
        <div className="flex-1 min-h-0">{body}</div>
      </div>
    </div>
  );
}
