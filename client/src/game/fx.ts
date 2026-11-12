// 상호작용 연출 공유 상태 (React 렌더 없이 매 프레임 읽음)
// 쓰다듬기 하트 · 강아지 반응 · 휴지통 뚜껑 · 다른 사람의 쓰다듬기 손 높이
import type { MutableRefObject } from 'react';
import type { DogDriver } from './models/Dog';
import type { ScreenSlide } from '@shared/screen';

/** 광장 스크린에 지금 보이는 슬라이드 (BigScreen이 갱신) */
export const screenNow: { get: () => ScreenSlide | 'empty'; all: () => ScreenSlide[] } = { get: () => 'empty', all: () => [] };

/** 사용자 id → 그 사용자 강아지의 애니메이션 드라이버 (쓰다듬기 반응 재생용) */
export const dogDrivers = new Map<number, MutableRefObject<DogDriver>>();

/** 화면에 띄울 하트 (월드 좌표) */
export interface Heart { x: number; y: number; z: number; t0: number; dx: number }
export const hearts: Heart[] = [];

/** 휴지통 id → 뚜껑이 열린 시각 (ms) */
export const binOpenAt = new Map<string, number>();

/** 쓰다듬는 사람 id → 손 높이(0: 큰 강아지, 1: 작은 강아지 — 더 깊이 숙임) */
export const petLow = new Map<number, number>();
export const PET_LOW = { small: 1, medium: 0.62, large: 0.3 } as const;

/** 내 동작 (쓰다듬기·줍기·버리기) 재생 시간 */
export const ACTION_MS = { pet: 1700, scoop: 1300, toss: 1000 } as const;

/** 하트 뿅뿅 + 강아지 반응 */
export function playPet(targetId: number, at: { x: number; z: number } | undefined, dogScale: number) {
  const d = dogDrivers.get(targetId)?.current;
  if (d) d.happyUntil = performance.now() + 2600;
  if (!at) return;
  const now = performance.now();
  for (let i = 0; i < 4; i++) hearts.push({ x: at.x, y: 0.55 * dogScale + 0.15, z: at.z, t0: now + i * 260, dx: (i % 2 ? 1 : -1) * (0.08 + i * 0.04) });
  if (hearts.length > 40) hearts.splice(0, hearts.length - 40);
}
