import { useState, type FormEvent } from 'react';
import { api, tokenStore } from '../lib/api';
import { set } from '../store';
import type { MyProfile } from '@shared/protocol';
import { LegalModal, type LegalDoc } from './Legal';

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [form, setForm] = useState({ username: '', password: '', nickname: '', dogName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const up = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (mode === 'signup' && !agree) throw new Error('만 14세 이상 확인과 약관 동의에 체크해 주세요.');
      const body = mode === 'login' ? { username: form.username, password: form.password } : { ...form, agree };
      const r = await api<{ token: string; profile: MyProfile }>(`/api/auth/${mode}`, { body, token: null });
      tokenStore.set(r.token);
      set({ me: r.profile, onboarding: mode === 'signup' });
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_20%_10%,#fde3d6,transparent_45%),radial-gradient(circle_at_85%_90%,#e3efdc,transparent_45%)] bg-cream">
      <div className="min-h-full grid place-items-center p-5">
        <div className="w-full max-w-[420px]">
          <div className="text-center mb-6">
            <div className="text-5xl">🐾</div>
            <h1 className="font-display text-4xl mt-2">멍글마을</h1>
            <p className="text-cocoa-soft mt-1 text-sm">우리 강아지와 함께 걷고, 만나고, 자랑하는 3D 커뮤니티</p>
          </div>
          <form onSubmit={submit} className="panel p-6 space-y-3">
            <div className="grid grid-cols-2 gap-1 bg-cream-2 rounded-full p-1 mb-2">
              {(['login', 'signup'] as const).map((m) => (
                <button type="button" key={m} onClick={() => { setMode(m); setError(''); }}
                  className={`btn py-2 text-sm ${mode === m ? 'bg-white shadow-sm' : 'text-cocoa-soft'}`}>
                  {m === 'login' ? '로그인' : '처음이에요 (가입)'}
                </button>
              ))}
            </div>
            <label className="block text-sm">아이디
              <input className="field mt-1" value={form.username} onChange={up('username')} autoComplete="username" placeholder="영문·숫자 4~20자" required />
            </label>
            <label className="block text-sm">비밀번호
              <input className="field mt-1" type="password" value={form.password} onChange={up('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="8자 이상" required />
            </label>
            {mode === 'signup' && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">내 닉네임
                  <input className="field mt-1" value={form.nickname} onChange={up('nickname')} maxLength={12} placeholder="2~12자" required />
                </label>
                <label className="block text-sm">강아지 이름
                  <input className="field mt-1" value={form.dogName} onChange={up('dogName')} maxLength={12} placeholder="예: 사슴이" required />
                </label>
              </div>
            )}
            {mode === 'signup' && <p className="text-xs text-cocoa-soft">아이디는 로그인에만 쓰이고 다른 사용자에게는 닉네임과 강아지 정보만 보여요.</p>}
            {mode === 'signup' && (
              <label className="flex items-start gap-2 text-sm bg-cream-2 rounded-2xl px-3 py-2.5 cursor-pointer">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[#f2836b]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>
                  만 14세 이상이며,{' '}
                  <button type="button" className="underline text-cocoa" onClick={(e) => { e.preventDefault(); setLegal('terms'); }}>이용약관</button>과{' '}
                  <button type="button" className="underline text-cocoa" onClick={(e) => { e.preventDefault(); setLegal('privacy'); }}>개인정보 처리방침</button>에 동의해요. <span className="text-[#c4553a]">(필수)</span>
                </span>
              </label>
            )}
            {error && <p className="text-sm text-[#c4553a] bg-[#fff0ec] rounded-xl px-3 py-2">{error}</p>}
            <button className="btn btn-peach w-full py-3 text-lg" disabled={busy}>
              {busy ? '잠시만요…' : mode === 'login' ? '산책 나가기' : '가입하고 아바타 만들기 →'}
            </button>
          </form>
          <p className="text-center text-xs text-cocoa-soft mt-4">
            <button type="button" className="underline" onClick={() => setLegal('terms')}>이용약관</button>
            {' · '}
            <button type="button" className="underline" onClick={() => setLegal('privacy')}>개인정보 처리방침</button>
          </p>
        </div>
        {legal && <LegalModal doc={legal} onClose={() => setLegal(null)} />}
      </div>
    </div>
  );
}
