// 사람 + 강아지 + 목줄 + 이름표/말풍선 묶음 (내 아바타와 다른 사용자 공통)
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PublicProfile } from '@shared/protocol';
import { Human, type HumanDriver } from './models/Human';
import { DOG_SCALE, Dog, type DogDriver } from './models/Dog';
import { Leash } from './Leash';
import { blobShadowMat, geo } from './lowpoly';
import { useStore } from '../store';

const BUBBLE_MS = 6000;

export interface PairRefs {
  human: MutableRefObject<THREE.Group | null>;
  dog: MutableRefObject<THREE.Group | null>;
  humanDriver: MutableRefObject<HumanDriver>;
  dogDriver: MutableRefObject<DogDriver>;
  /** 이름표 DOM (거리별 표시 제어용) */
  tag: MutableRefObject<HTMLDivElement | null>;
}

export function AvatarPair({ profile, refs, isMe, onSelect }: { profile: PublicProfile; refs: PairRefs; isMe?: boolean; onSelect?: () => void }) {
  const hand = useRef<THREE.Object3D | null>(null);
  const anchor = useRef<THREE.Object3D | null>(null);
  const bubble = useStore((s) => s.bubbles[profile.id]);
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

  useEffect(() => { document.body.style.cursor = hover ? 'pointer' : ''; return () => { document.body.style.cursor = ''; }; }, [hover]);

  const dogScale = DOG_SCALE[profile.dog.size];
  const clickable = !!onSelect;
  const handlers = clickable ? {
    onClick: (e: any) => { if (e.delta > 8) return; e.stopPropagation(); onSelect!(); },
    onPointerOver: (e: any) => { e.stopPropagation(); setHover(true); },
    onPointerOut: () => setHover(false),
  } : {};

  return (
    <>
      <group ref={refs.human}>
        <Human avatar={profile.human} driver={refs.humanDriver} handRef={hand} />
        <mesh geometry={geo.circle(0.38, 10)} material={blobShadowMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} />
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
            <div className="name-tag" style={isMe ? { background: '#f39a7b', color: 'white' } : hover ? { background: '#fff3e8' } : undefined}>
              {profile.nickname} <span style={{ opacity: 0.75 }}>· 🐶 {profile.dogName}</span>
            </div>
          </div>
        </Html>
      </group>
      <group ref={refs.dog}>
        <Dog avatar={profile.dog} driver={refs.dogDriver} anchorRef={anchor} />
        <mesh geometry={geo.circle(0.3 * dogScale, 10)} material={blobShadowMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} scale={[0.8, 1.3, 1]} />
        {clickable && (
          <mesh {...handlers} position={[0, 0.35 * dogScale, 0]}>
            <boxGeometry args={[0.5 * dogScale, 0.7 * dogScale, 0.9 * dogScale]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
      </group>
      <Leash from={hand} to={anchor} color={isMe ? '#f6c453' : '#f2b880'} />
    </>
  );
}
