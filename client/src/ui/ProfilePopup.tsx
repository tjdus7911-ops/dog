import { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { PublicProfile } from '@shared/protocol';
import { Human, newHumanDriver } from '../game/models/Human';
import { set, useStore } from '../store';
import { friendAction, openDm, report } from '../net/socket';
import { Modal } from './common';

function SpinningHuman({ profile }: { profile: PublicProfile }) {
  const g = useRef<THREE.Group>(null!);
  const d = useRef(newHumanDriver());
  d.current.leash = false;
  useFrame((_, dt) => { g.current.rotation.y += dt * 0.8; });
  return <group ref={g} position={[0, -0.72, 0]}><Human avatar={profile.human} driver={d} /></group>;
}

export function ProfilePopup() {
  const pop = useStore((s) => s.profilePopup)!;
  const { profile: p, status } = pop;
  const close = () => set({ profilePopup: null });
  const [busy, setBusy] = useState(false);
  const act = async (ev: Parameters<typeof friendAction>[0], ask?: string) => {
    if (ask && !confirm(ask)) return;
    setBusy(true);
    await friendAction(ev, p.id);
    setBusy(false);
  };

  return (
    <Modal onClose={close} className="max-w-[380px] p-0">
      <div className="relative">
        <div className="h-40 bg-gradient-to-br from-[#fde3d6] to-[#e3efdc] rounded-t-[22px] overflow-hidden">
          {p.dogPhoto
            ? <img src={p.dogPhoto} alt={`${p.dogName} 사진`} className="w-full h-full object-cover" />
            : <div className="w-full h-full grid place-items-center text-cocoa-soft text-sm"><div className="text-center"><div className="text-4xl">🐶</div>등록된 강아지 사진이 없어요</div></div>}
        </div>
        <button className="absolute top-3 right-3 btn btn-ghost w-9 h-9" onClick={close} aria-label="닫기">✕</button>
        <div className="absolute -bottom-10 left-4 w-24 h-24 rounded-full bg-cream border-4 border-white shadow-md overflow-hidden">
          <Canvas camera={{ position: [0, 0.3, 1.55], fov: 34 }} dpr={[1, 2]}>
            <hemisphereLight args={['#fffaf2', '#efe2cc', 2.1]} />
            <directionalLight position={[2, 4, 3]} intensity={1.3} />
            <SpinningHuman profile={p} />
          </Canvas>
        </div>
      </div>
      <div className="px-5 pt-12 pb-5">
        <div className="font-display text-2xl">{p.nickname}</div>
        <div className="mt-1 text-cocoa-soft">🐶 <b className="text-cocoa">{p.dogName}</b>와(과) 산책 중</div>
        {p.dogIntro && <p className="mt-2 text-sm bg-cream-2 rounded-2xl px-3 py-2">{p.dogIntro}</p>}

        <div className="mt-4 grid gap-2">
          {status === 'none' && <button disabled={busy} className="btn btn-peach py-2.5" onClick={() => act('friend:request')}>💌 친구 신청</button>}
          {status === 'outgoing' && <button disabled={busy} className="btn btn-ghost py-2.5 border border-[#f1e2d2]" onClick={() => act('friend:cancel')}>⏳ 신청 중 · 취소하기</button>}
          {status === 'incoming' && (
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy} className="btn btn-peach py-2.5" onClick={() => act('friend:accept')}>받은 신청 수락</button>
              <button disabled={busy} className="btn btn-ghost py-2.5" onClick={() => act('friend:decline')}>거절</button>
            </div>
          )}
          {status === 'friends' && (
            <div className="grid grid-cols-2 gap-2">
              <span className="btn bg-sage-soft py-2.5 text-sage-deep">🐾 친구</span>
              <button className="btn btn-peach py-2.5" onClick={() => openDm(p)}>💬 1:1 대화</button>
            </div>
          )}
          {status === 'blocked' && <button disabled={busy} className="btn btn-ghost py-2.5 border border-[#f1e2d2]" onClick={() => act('unblock')}>🚫 차단됨 · 차단 해제</button>}
          {status !== 'friends' && status !== 'blocked' && <p className="text-xs text-cocoa-soft text-center">1:1 대화는 친구가 되면 이용할 수 있어요.</p>}

          <button disabled className="btn btn-ghost py-2.5 !shadow-none border border-dashed border-[#e8d6c3]" title="개인 강아지 집은 5단계에서 구현 예정">
            🏠 강아지 집 방문 · 준비 중
          </button>
          <div className="flex gap-2 text-sm">
            {status === 'friends' && <button className="flex-1 text-cocoa-soft underline py-1" onClick={() => act('friend:remove', `${p.nickname}님을 친구에서 삭제할까요?`)}>친구 삭제</button>}
            {status !== 'blocked' && <button className="flex-1 text-cocoa-soft underline py-1" onClick={() => act('block', `${p.nickname}님을 차단할까요? 친구 관계가 끊기고 서로의 아바타와 채팅이 보이지 않아요.`)}>차단</button>}
            <button className="flex-1 text-[#c4553a] underline py-1" onClick={() => set({ reportTarget: p, profilePopup: null })}>신고</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const REASONS = ['욕설/비하', '도배/스팸', '불쾌한 닉네임/사진', '사칭/사기', '기타'];

export function ReportDialog({ profile }: { profile: PublicProfile }) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const close = () => set({ reportTarget: null });
  async function submit() {
    if (!(await report(profile.id, reason, detail))) return;
    if (alsoBlock) await friendAction('block', profile.id);
    close();
  }
  return (
    <Modal onClose={close} className="max-w-[380px] p-5">
      <h2 className="font-display text-xl">🚨 {profile.nickname}님 신고</h2>
      <p className="text-xs text-cocoa-soft mt-1">공원에서 이 사용자가 보낸 최근 채팅이 서버 기록에서 함께 첨부돼요.</p>
      <div className="mt-3 grid gap-1.5">
        {REASONS.map((r) => (
          <label key={r} className={`flex items-center gap-2 rounded-xl px-3 py-2 cursor-pointer ${reason === r ? 'bg-peach-soft' : 'bg-white'}`}>
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} /> {r}
          </label>
        ))}
      </div>
      <textarea className="field mt-3 text-sm" rows={3} maxLength={300} placeholder="자세한 내용 (선택)" value={detail} onChange={(e) => setDetail(e.target.value)} />
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} /> 이 사용자 차단하기</label>
      <div className="flex gap-2 mt-4">
        <button className="btn btn-ghost flex-1 py-2.5" onClick={close}>취소</button>
        <button className="btn btn-peach flex-1 py-2.5" disabled={!reason} onClick={submit}>신고하기</button>
      </div>
    </Modal>
  );
}
