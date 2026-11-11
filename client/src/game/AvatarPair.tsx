// 사람 + 강아지 + 목줄 + 이름표/말풍선 묶음 (내 아바타와 다른 사용자 공통)
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PublicProfile } from '@shared/protocol';
import { Human, type HumanDriver } from './models/Human';
import { DOG_SCALE, Dog, type DogDriver } from './models/Dog';
import { Leash } from './Leash';
import { blobShadowMat, geo } from './lowpoly';
import { useStore } from '../store';
import { dogDrivers } from './fx';

const BUBBLE_MS = 6000;

export interface PairRefs {
  human: MutableRefObject<THREE.Group | null>;
  dog: MutableRefObject<THREE.Group | null>;
  humanDriver: MutableRefObject<HumanDriver>;
  dogDriver: MutableRefObject<DogDriver>;
  /** 이름표 DOM (거리별 표시 제어용) */
  tag: MutableRefObject<HTMLDivElement | null>;
  /** 잠잘 때 Zzz 표시 (사람 / 강아지) */
  zzz: MutableRefObject<HTMLDivElement | null>;
  dogZzz: MutableRefObject<HTMLDivElement | null>;
  /** 발밑 그림자 (가구 위에 있으면 숨김) */
  blob?: MutableRefObject<THREE.Mesh | null>;
}

export function AvatarPair({ profile, refs, isMe, onSelect, onSelectDog }: { profile: PublicProfile; refs: PairRefs; isMe?: boolean; onSelect?: () => void; onSelectDog?: () => void }) {
  const hand = useRef<THREE.Object3D | null>(null);
  const anchor = useRef<THREE.Object3D | null>(null);
  const bubble = useStore((s) => s.bubbles[profile.id]);
  // 집(원룸·투룸·쓰리룸) 안에서는 하네스·리드줄을 벗음 — 같은 공간의 모든 사람 화면에서 똑같이 (공간으로 정해지므로 따로 주고받을 필요 없음)
  const atHome = useStore((s) => s.park?.kind === 'home');
  useLayoutEffect(() => { refs.humanDriver.current.leash = !atHome; }, [atHome, refs.humanDriver]);
  const [showBubble, setShowBubble] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!bubble) return;
    const left = BUBBLE_MS - (Date.now() - bubble.ts);
    if (left <= 0) return;
    setShowBubble(true);
    const t = setTimeout(() => setShowBubble(false), left);
    return () => clearTimeout(t);
  }, [bubble]);

  // 쓰다듬기 반응을 재생할 수 있게 강아지 드라이버 등록
  useEffect(() => {
    dogDrivers.set(profile.id, refs.dogDriver);
    return () => { if (dogDrivers.get(profile.id) === refs.dogDriver) dogDrivers.delete(profile.id); };
  }, [profile.id, refs.dogDriver]);

  useEffect(() => { document.body.style.cursor = hover ? 'pointer' : ''; return () => { document.body.style.cursor = ''; }; }, [hover]);

  const dogScale = DOG_SCALE[profile.dog.size];
  const clickable = !!onSelect;
  const mk = (fn?: () => void) => fn ? {
    onClick: (e: any) => { if (e.delta > 8) return; e.stopPropagation(); fn(); },
    onPointerOver: (e: any) => { e.stopPropagation(); setHover(true); },
    onPointerOut: () => setHover(false),
  } : {};
  const handlers = mk(onSelect);
  // 강아지를 누르면 강아지 메뉴 (없으면 사람과 같은 동작)
  const dogHandlers = mk(onSelectDog ?? onSelect);

  return (
    <>
      <group ref={refs.human}>
        <Human avatar={profile.human} driver={refs.humanDriver} handRef={hand} />
        <mesh ref={refs.blob} geometry={geo.circle(0.38, 10)} material={blobShadowMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} />
        {/* 클릭 판정용 투명 캡슐 (작은 파츠 대신 넉넉한 영역) */}
        {clickable && (
          <mesh {...handlers} position={[0, 0.7, 0]}>
            <cylinderGeometry args={[0.38, 0.38, 1.45, 6]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
        <Html position={[0, 1.55, 0]} zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div ref={refs.tag} className="flex flex-col items-center" style={{ transform: 'translate(-50%, -100%)' }}>
            {showBubble && bubble && <div className="bubble pop">{bubble.text}</div>}
            <div className="name-tag" style={profile.guest ? { background: isMe ? '#8fb7d9' : '#eef5fb', color: isMe ? 'white' : '#4b6a86', border: '1.5px dashed #8fb7d9' } : isMe ? { background: '#f39a7b', color: 'white' } : hover ? { background: '#fff3e8' } : undefined}>
              {/* 둘러보기 방문자는 회원과 구분되는 이름표 */}
              {profile.guest && <span className="mr-1 rounded-full bg-white/80 px-1.5 text-[10px] text-[#4b6a86]">👀 방문자</span>}
              {profile.nickname} {!profile.guest && <span style={{ opacity: 0.75 }}>· 🐶 {profile.dogName}</span>}
            </div>
          </div>
        </Html>
        <Html position={[0, 0.6, -1.0]} zIndexRange={[19, 9]} style={{ pointerEvents: 'none' }}>
          <div ref={refs.zzz} className="zzz" style={{ display: 'none' }}>Z<span>z</span><span>z</span></div>
        </Html>
      </group>
      <group ref={refs.dog}>
        <Dog avatar={profile.dog} driver={refs.dogDriver} anchorRef={anchor} harness={!atHome} />
        <Html position={[0, 0.7 * dogScale, 0]} zIndexRange={[19, 9]} style={{ pointerEvents: 'none' }}>
          <div ref={refs.dogZzz} className="zzz zzz-sm" style={{ display: 'none' }}>z<span>z</span></div>
        </Html>
        <mesh geometry={geo.circle(0.3 * dogScale, 10)} material={blobShadowMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} scale={[0.8, 1.3, 1]} />
        {(clickable || onSelectDog) && (
          <mesh {...dogHandlers} position={[0, 0.35 * dogScale, 0]}>
            <boxGeometry args={[0.5 * dogScale, 0.7 * dogScale, 0.9 * dogScale]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
      </group>
      {!atHome && <Leash from={hand} to={anchor} color={isMe ? '#f6c453' : '#f2b880'} />}
    </>
  );
}
