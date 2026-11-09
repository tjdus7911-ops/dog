// AI 강아지 사진 분석 — 정면(필수)·측면·전신 사진을 서버로 보내 특징을 추출하고, 결과를 파츠 값으로 적용한다.
// 분석 결과는 미리 만든 파츠 조합으로만 표현되며, 적용 후 아래 항목에서 언제든 직접 수정할 수 있다.
import { useEffect, useRef, useState } from 'react';
import { BREED_PRESETS, type DogAvatar } from '@shared/avatar';
import { api } from '../lib/api';
import { toast } from '../store';
import { FUR_LABEL, LABEL, SNOUT_LABEL, TAIL_LABEL } from './avatarOptions';
import { resizeImage } from '../lib/image';

type Slot = 'front' | 'side' | 'full';
const SLOTS: { key: Slot; label: string; hint: string }[] = [
  { key: 'front', label: '정면', hint: '필수' },
  { key: 'side', label: '측면', hint: '선택' },
  { key: 'full', label: '전신', hint: '선택' },
];

interface Analysis {
  avatar: Omit<DogAvatar, 'harness'>;
  breedGuess: string;
  summary: string;
  confidence: number;
}

export function DogAiPanel({ current, onApply, onUseAsProfile }: { current: DogAvatar; onApply: (d: DogAvatar) => void; onUseAsProfile: (dataUrl: string) => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<Slot, string>>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const pick = useRef<Slot>('front');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ available: boolean }>('/api/dog-analysis/status').then((r) => setAvailable(r.available)).catch(() => setAvailable(false));
  }, []);

  async function onFile(f: File | undefined) {
    if (!f) return;
    try {
      const url = await resizeImage(f, 768);
      setPhotos((p) => ({ ...p, [pick.current]: url }));
      setResult(null); setError('');
    } catch { toast('이미지를 읽지 못했어요.', 'error'); }
  }

  async function analyze() {
    if (!photos.front) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ result: Analysis }>('/api/dog-analysis', {
        body: { photos: SLOTS.filter((s) => photos[s.key]).map((s) => ({ kind: s.key, dataUrl: photos[s.key] })) },
      });
      setResult(r.result);
      onApply({ ...r.result.avatar, harness: current.harness });
      toast('AI 분석 결과를 적용했어요. 아래에서 자유롭게 고칠 수 있어요 🐶');
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  const traits = result ? [
    ['견종 유형', `${BREED_PRESETS[result.avatar.breed]?.label ?? result.avatar.breed}${result.breedGuess ? ` (${result.breedGuess})` : ''}`],
    ['체형', LABEL[result.avatar.size]],
    ['털 길이', FUR_LABEL[result.avatar.fur]],
    ['귀', LABEL[result.avatar.ear]],
    ['꼬리', TAIL_LABEL[result.avatar.tail]],
    ['주둥이', SNOUT_LABEL[result.avatar.snout]],
    ['무늬', LABEL[result.avatar.pattern]],
  ] : [];

  return (
    <div className="my-3 rounded-[22px] p-4 bg-gradient-to-br from-[#eef6e9] to-[#fff4ea] border-2 border-white shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-xl">🤖</span>
        <h3 className="font-display text-lg flex-1">AI 강아지 사진 분석</h3>
        {available === false && <span className="text-[11px] rounded-full bg-white px-2 py-0.5 text-cocoa-soft">사용 불가</span>}
      </div>
      <p className="text-[13px] text-cocoa-soft mt-1 leading-relaxed">
        우리 강아지 사진을 올리면 AI가 견종 유형·털색·털 길이·귀·꼬리·체형·무늬를 분석해 닮은 로우폴리 강아지로 맞춰 드려요.
      </p>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="grid grid-cols-3 gap-2 mt-3">
        {SLOTS.map((s) => (
          <button key={s.key} type="button" onClick={() => { pick.current = s.key; fileRef.current?.click(); }}
            className="relative h-24 md:h-28 rounded-2xl overflow-hidden bg-white border-2 border-dashed border-[#e9d8c6] hover:border-[#f4776a] grid place-items-center">
            {photos[s.key]
              ? <img src={photos[s.key]} alt={`${s.label} 사진`} className="absolute inset-0 w-full h-full object-cover" />
              : <div className="text-center"><div className="text-2xl">📷</div><div className="font-display text-sm mt-0.5">{s.label}</div><div className="text-[11px] text-cocoa-soft">{s.hint}</div></div>}
            {photos[s.key] && <span className="absolute bottom-1 left-1 name-tag !text-[11px]">{s.label} · 바꾸기</span>}
          </button>
        ))}
      </div>

      {available === false ? (
        <p className="text-xs mt-3 rounded-xl bg-white/80 px-3 py-2 leading-relaxed">
          ⚠️ 서버에 AI 분석 키가 설정되지 않아 지금은 분석할 수 없어요. 아래에서 견종 유형과 특징을 직접 골라 주세요.
          <span className="block text-cocoa-soft mt-0.5">(운영자: 서버 환경 변수 <code>ANTHROPIC_API_KEY</code> 설정 시 활성화)</span>
        </p>
      ) : (
        <button type="button" className="btn btn-coral w-full py-2.5 mt-3" disabled={!photos.front || busy || available === null} onClick={analyze}>
          {busy ? '🔍 사진을 분석하는 중… (10~20초)' : photos.front ? 'AI로 분석하기' : '정면 사진을 먼저 올려 주세요'}
        </button>
      )}
      {error && <p className="text-sm text-[#c4553a] bg-[#fff0ec] rounded-xl px-3 py-2 mt-2">{error}</p>}

      {result && (
        <div className="mt-3 rounded-2xl bg-white p-3">
          <div className="flex items-center gap-2">
            <span className="font-display">분석 결과</span>
            <span className="text-xs text-cocoa-soft">신뢰도 {Math.round(result.confidence * 100)}%</span>
          </div>
          {result.summary && <p className="text-[13px] mt-1">{result.summary}</p>}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {traits.map(([k, v]) => <span key={k} className="text-xs rounded-full bg-[#fff1ec] px-2.5 py-1"><b className="font-display text-[#e2604f]">{k}</b> {v}</span>)}
            <span className="text-xs rounded-full bg-[#fff1ec] px-2.5 py-1 flex items-center gap-1"><b className="font-display text-[#e2604f]">털색</b>
              <i className="w-3.5 h-3.5 rounded-full border border-white inline-block" style={{ background: result.avatar.coat }} />
              {result.avatar.pattern !== 'none' && <i className="w-3.5 h-3.5 rounded-full border border-white inline-block" style={{ background: result.avatar.secondary }} />}
            </span>
          </div>
          <p className="text-[11px] text-cocoa-soft mt-2">적용 완료 · 실제와 다른 부분은 아래 항목에서 직접 수정해 주세요.</p>
          {photos.front && <button type="button" className="text-xs underline text-cocoa-soft mt-1" onClick={() => onUseAsProfile(photos.front!)}>정면 사진을 프로필 사진으로 쓰기</button>}
        </div>
      )}
    </div>
  );
}
