import { useState, type FormEvent } from 'react';
import { api, tokenStore } from '../lib/api';
import { set, toast } from '../store';
import { COIN_REWARDS } from '@shared/coins';
import { showCoinFx } from './Coins';
import type { MyProfile } from '@shared/protocol';
import { LegalModal, type LegalDoc } from './Legal';
import { LogoMark } from './Logo';
import { InstallCard } from './Install';
import { backdropClose } from './common';

export function AuthScreen() {
  // 둘러보기 중 '회원가입하기'를 누르고 왔으면 가입 탭으로 시작
  const [mode, setMode] = useState<'login' | 'signup'>(() => {
    try { const m = sessionStorage.getItem('mungle.authMode'); sessionStorage.removeItem('mungle.authMode'); return m === 'signup' ? 'signup' : 'login'; } catch { return 'login'; }
  });
  const [browse, setBrowse] = useState(false);
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
      // 가입 선물 (서버가 계정당 한 번 지급 · 기록)
      if (mode === 'signup') { showCoinFx(COIN_REWARDS.signup.amount, '가입 선물'); toast(`🎁 가입을 환영해요! 가입 선물 ${COIN_REWARDS.signup.amount} 멍글코인을 드렸어요`); }
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  /** 둘러보기: 서버가 임시 방문자 계정(24시간)을 만들어 주고, 기본 방문자 캐릭터로 공원을 구경 */
  async function startBrowse() {
    setBusy(true); setError('');
    try {
      const r = await api<{ token: string; profile: MyProfile }>('/api/auth/guest', { body: {}, token: null });
      tokenStore.set(r.token);
      set({ me: r.profile, onboarding: false, moveInLater: true });
    } catch (err) { setError((err as Error).message); setBrowse(false); } finally { setBusy(false); }
  }

  return (
    <div className="h-full overflow-y-auto bg-[radial-gradient(circle_at_20%_10%,#fde3d6,transparent_45%),radial-gradient(circle_at_85%_90%,#e3efdc,transparent_45%)] bg-cream">
      <div className="min-h-full grid place-items-center p-5">
        <div className="w-full max-w-[420px]">
          <div className="text-center mb-6">
            <div className="inline-block"><LogoMark size={96} /></div>
            <h1 className="font-display text-4xl mt-1">멍글마을</h1>
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
            {mode === 'signup' && <p className="text-sm rounded-xl bg-[#fff4cf] text-[#9a6f12] px-3 py-1.5" data-testid="signup-gift">🎁 가입하면 <b>500 멍글코인</b>을 드려요 · 원룸 입주비 500코인</p>}
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
          <button type="button" className="btn btn-ghost w-full py-3 mt-3 border border-[#f1e2d2]" onClick={() => setBrowse(true)}>👀 그냥 둘러보기</button>
          <InstallCard />
          <p className="text-center text-xs text-cocoa-soft mt-4">
            <button type="button" className="underline" onClick={() => setLegal('terms')}>이용약관</button>
            {' · '}
            <button type="button" className="underline" onClick={() => setLegal('privacy')}>개인정보 처리방침</button>
          </p>
        </div>
        {legal && <LegalModal doc={legal} onClose={() => setLegal(null)} />}
        {browse && (
          <div className="fixed inset-0 z-40 grid place-items-center bg-[#5a403333] p-4" {...backdropClose(() => setBrowse(false))}>
            <div className="panel pop w-full max-w-[400px] p-6 text-center" role="dialog" aria-label="둘러보기 안내">
              <h2 className="font-display text-2xl">🐾 멍글마을을 먼저 구경해 볼까요?</h2>
              <p className="mt-3 text-sm leading-relaxed">둘러보기 모드에서는 마을을 자유롭게 구경할 수 있지만, 아바타 생성과 아파트 입주는 할 수 없어요.</p>
              <p className="mt-2 text-sm leading-relaxed">우리 강아지와 함께 산책하고, 친구를 만나고, 나만의 집을 꾸미고 싶다면 회원가입을 해주세요!</p>
              <div className="grid gap-2 mt-5">
                <button className="btn btn-ghost py-3 border border-[#f1e2d2]" disabled={busy} onClick={startBrowse}>{busy ? '잠시만요…' : '마을 둘러보기'}</button>
                <button className="btn btn-coral py-3" onClick={() => { setBrowse(false); setMode('signup'); setError(''); }}>회원가입하고 입주하기</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
