// SD 비율 로우폴리 사람 아바타 빌더
// 큰 둥근 머리 · 작은 몸 · 짧은 팔다리 — 모든 파츠는 둥근 저폴리 도형으로 구성하고 관절별로 병합한다.
// 관절: body(상하 반동) > legL, legR, torso > armL, armR, head  /  hand(목줄 잡는 위치)
import * as THREE from 'three';
import type { HumanAvatar } from '@shared/avatar';
import { bone, onSurface, part, shape, templateCache } from './bake';

type V3 = [number, number, number];

const EYE = '#2b211d';
const WHITE = '#ffffff';
const BLUSH = '#f7a7a0';
const MOUTH = '#8a3b32';
const TONGUE = '#f28b8b';
const SOLE = '#f7efe4';

/** 색을 밝게/어둡게 (같은 옷의 디테일 표현용) */
export function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}
const isLight = (hex: string) => { const c = new THREE.Color(hex); return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.6; };

// 머리 기준값 (head 관절 좌표계)
const R = 0.335;
const HC: V3 = [0, 0.3, 0];
const HR: V3 = [R * 1.05, R * 0.97, R * 0.95];

/** 외부(썸네일 카메라 등)에서 쓰는 주요 높이 (월드 기준, 발바닥 = 0) */
export const HUMAN_LAYOUT = { headCenter: 1.03, chest: 0.5, hips: 0.3, feet: 0.05, top: 1.38 };

function buildHuman(a: HumanAvatar): THREE.Group {
  const root = new THREE.Group();
  root.name = 'human';
  const body = bone(root, 'body');

  // ---------- 다리 & 신발 ----------
  const legColor = a.bottom === 'pants' ? a.bottomColor : a.skin;
  for (const side of [1, -1]) {
    const leg = bone(body, side > 0 ? 'legL' : 'legR', [side * 0.075, 0.305, 0]);
    part(leg, shape.capsule(0.062, 0.12, 3, 8), legColor, [0, -0.13, 0]);
    if (a.bottom === 'shorts') part(leg, shape.cyl(0.078, 0.074, 0.09, 10), a.bottomColor, [0, -0.04, 0]);
    if (a.bottom === 'pants') part(leg, shape.cyl(0.07, 0.072, 0.03, 10), shade(a.bottomColor, -0.06), [0, -0.225, 0]);
    if (a.shoes === 'boots') {
      part(leg, shape.cyl(0.07, 0.074, 0.11, 10), a.shoeColor, [0, -0.215, 0]);
      part(leg, shape.blob(1), a.shoeColor, [0, -0.268, 0.035], [0.075, 0.045, 0.1]);
      part(leg, shape.cyl(0.074, 0.074, 0.02, 10), shade(a.shoeColor, -0.12), [0, -0.165, 0]);
    } else {
      part(leg, shape.blob(1), a.shoeColor, [0, -0.252, 0.03], [0.078, 0.052, 0.112]);
      part(leg, shape.blob(1), SOLE, [0, -0.287, 0.03], [0.082, 0.022, 0.115]);
      part(leg, shape.blob(1), shade(a.shoeColor, isLight(a.shoeColor) ? -0.15 : 0.15), [0, -0.235, 0.105], [0.03, 0.012, 0.02]);
    }
  }

  // ---------- 몸통 ----------
  const torso = bone(body, 'torso', [0, 0.3, 0]);
  // 하의 (골반)
  if (a.bottom === 'skirt') {
    part(torso, shape.cyl(0.15, 0.225, 0.17, 12), a.bottomColor, [0, 0.03, 0]);
    part(torso, shape.cyl(0.226, 0.226, 0.018, 12), shade(a.bottomColor, -0.08), [0, -0.05, 0]);
  } else {
    part(torso, shape.blob(2), a.bottomColor, [0, 0.06, 0], [0.155, 0.1, 0.13]);
  }
  // 상체
  const inner = a.top === 'overalls' ? '#fffaf2' : a.top === 'jacket' ? '#fffaf2' : a.topColor;
  part(torso, shape.blob(2), a.top === 'overalls' ? inner : a.topColor, [0, 0.2, 0], [0.165, 0.17, 0.135]);
  part(torso, shape.cyl(0.075, 0.09, 0.06, 10), a.skin, [0, 0.38, 0]); // 목

  if (a.top === 'hoodie') {
    // 후드 (목 뒤에 둥글게) + 주머니 + 끈
    part(torso, shape.torus(0.11, 0.055, Math.PI * 2, 6, 14), a.topColor, [0, 0.355, -0.03], [1.15, 1, 1], [Math.PI / 2 - 0.25, 0, 0]);
    part(torso, shape.blob(1), shade(a.topColor, -0.05), [0, 0.14, 0.115], [0.1, 0.05, 0.03]);
    for (const s of [-1, 1]) {
      part(torso, shape.capsule(0.009, 0.06, 2, 4), WHITE, [s * 0.035, 0.28, 0.13], 1, [0.25, 0, 0]);
      part(torso, shape.blob(0), WHITE, [s * 0.035, 0.235, 0.14], 0.014);
    }
  }
  if (a.top === 'stripe') {
    const stripe = isLight(a.topColor) ? '#4a5a78' : '#fffaf2';
    for (const y of [0.11, 0.19, 0.27]) {
      const dy = (y - 0.2) / 0.17;
      const r = Math.sqrt(Math.max(0, 1 - dy * dy));
      part(torso, shape.torus(1, 0.075, Math.PI * 2, 3, 16), stripe, [0, y, 0], [0.168 * r, 0.138 * r, 0.14], [Math.PI / 2, 0, 0]);
    }
  }
  if (a.top === 'tee' || a.top === 'stripe') {
    part(torso, shape.torus(0.075, 0.016, Math.PI * 2, 4, 12), shade(a.topColor, -0.08), [0, 0.355, 0.005], 1, [Math.PI / 2 - 0.2, 0, 0]);
  }
  if (a.top === 'overalls') {
    // 멜빵: 앞판 + 어깨끈 + 단추
    part(torso, shape.blob(1), a.topColor, [0, 0.16, 0.085], [0.12, 0.12, 0.06]);
    part(torso, shape.blob(1), shade(a.topColor, -0.07), [0, 0.15, 0.135], [0.05, 0.035, 0.012]);
    for (const s of [-1, 1]) {
      part(torso, shape.capsule(0.018, 0.2, 2, 4), a.topColor, [s * 0.085, 0.25, 0], [1, 1, 1], [0, 0, s * 0.1]);
      part(torso, shape.blob(0), '#f6c453', [s * 0.08, 0.26, 0.125], 0.018);
    }
  }
  if (a.top === 'jacket') {
    // 앞이 열린 재킷: 좌우 앞판 + 옷깃
    for (const s of [-1, 1]) {
      part(torso, shape.blob(2), a.topColor, [s * 0.075, 0.2, 0.01], [0.1, 0.17, 0.13]);
      part(torso, shape.cone(0.05, 0.11, 3), shade(a.topColor, -0.08), [s * 0.045, 0.3, 0.115], [1, 1, 0.4], [0.3, 0, s * 2.7]);
      part(torso, shape.blob(1), shade(a.topColor, -0.06), [s * 0.1, 0.12, 0.12], [0.04, 0.025, 0.01]);
    }
  }

  // 팔 (어깨 피벗) — 긴소매(후드·재킷), 반소매(그 외)
  const longSleeve = a.top === 'hoodie' || a.top === 'jacket';
  const sleeve = a.top === 'overalls' ? inner : a.topColor;
  for (const side of [1, -1]) {
    const arm = bone(torso, side > 0 ? 'armL' : 'armR', [side * 0.165, 0.315, 0]);
    part(arm, shape.capsule(0.05, 0.12, 3, 8), longSleeve ? sleeve : a.skin, [side * 0.012, -0.105, 0], 1, [0, 0, side * 0.12]);
    if (!longSleeve) part(arm, shape.blob(1), sleeve, [side * 0.005, -0.03, 0], [0.068, 0.07, 0.066]);
    else part(arm, shape.cyl(0.054, 0.056, 0.025, 10), shade(sleeve, -0.07), [side * 0.024, -0.2, 0], 1, [0, 0, side * 0.12]);
    part(arm, shape.blob(1), a.skin, [side * 0.028, -0.235, 0.005], [0.055, 0.058, 0.055]);
    if (side < 0) {
      const hand = new THREE.Object3D();
      hand.name = 'hand';
      hand.position.set(side * 0.028, -0.25, 0.02);
      arm.add(hand);
    }
  }

  // 가방 · 크로스백
  if (a.accessory === 'backpack') {
    part(torso, shape.blob(2), '#e0a35e', [0, 0.2, -0.155], [0.13, 0.14, 0.07]);
    part(torso, shape.blob(1), '#c98a4a', [0, 0.14, -0.215], [0.08, 0.05, 0.025]);
    for (const s of [-1, 1]) part(torso, shape.torus(0.1, 0.014, Math.PI, 3, 8), '#c98a4a', [s * 0.09, 0.26, -0.03], [1, 1.3, 1], [0, Math.PI / 2, -Math.PI / 2]);
  }
  if (a.accessory === 'crossbag') {
    part(torso, shape.torus(0.205, 0.012, Math.PI * 2, 3, 18), '#a8693a', [0, 0.2, 0], [0.95, 1.05, 0.82], [Math.PI / 2, 0.75, 0]);
    part(torso, shape.blob(1), '#c98f62', [-0.15, 0.06, 0.06], [0.07, 0.06, 0.035], [0, 0.6, 0]);
    part(torso, shape.blob(0), '#f6c453', [-0.135, 0.06, 0.1], 0.012);
  }

  // ---------- 머리 ----------
  const head = bone(torso, 'head', [0, 0.42, 0]);
  part(head, shape.blob(2), a.skin, HC, HR);
  // 귀
  for (const s of [-1, 1]) part(head, shape.blob(1), a.skin, onSurface(HC, HR, s * 1.5, -0.08, 0.97), [0.045, 0.06, 0.04]);
  // 눈 (세로로 긴 동그란 눈 + 하이라이트)
  for (const s of [-1, 1]) {
    const yaw = s * 0.34, pitch = -0.06;
    part(head, shape.sphere(8, 6), EYE, onSurface(HC, HR, yaw, pitch, 0.985), [0.04, 0.056, 0.03], [0, yaw, 0]);
    part(head, shape.sphere(6, 4), WHITE, onSurface(HC, HR, yaw + 0.05 * s * 0 + 0.045, pitch + 0.07, 1.02), 0.013);
    part(head, shape.sphere(8, 6), BLUSH, onSurface(HC, HR, s * 0.66, -0.3, 0.975), [0.055, 0.03, 0.02], [0, s * 0.66, 0]);
  }
  // 입 (웃는 입 + 혀)
  const mouthPos = onSurface(HC, HR, 0, -0.35, 1.0);
  part(head, shape.halfDisc(0.045), MOUTH, [mouthPos[0], mouthPos[1], mouthPos[2] + 0.004], [1, 0.8, 1], [0.3, 0, 0]);
  part(head, shape.sphere(8, 4), TONGUE, [mouthPos[0], mouthPos[1] - 0.02, mouthPos[2] - 0.002], [0.025, 0.014, 0.01], [0.3, 0, 0]);
  // 코 (작은 점)
  part(head, shape.sphere(6, 4), shade(a.skin, -0.12), onSurface(HC, HR, 0, -0.2, 1.0), [0.012, 0.009, 0.008]);

  buildHair(head, a);
  buildHat(head, a);

  if (a.accessory === 'glasses' || a.accessory === 'square_glasses') {
    const frame = '#4a3a33';
    for (const s of [-1, 1]) {
      const p = onSurface(HC, HR, s * 0.34, -0.06, 1.08);
      if (a.accessory === 'glasses') part(head, shape.torus(0.072, 0.011, Math.PI * 2, 4, 14), frame, p, 1, [0, s * 0.3, 0]);
      else part(head, shape.torus(0.085, 0.011, Math.PI * 2, 3, 4), frame, p, [1, 0.85, 1], [0, s * 0.3, Math.PI / 4]);
      part(head, shape.capsule(0.008, 0.12, 2, 4), frame, onSurface(HC, HR, s * 0.95, -0.03, 1.02), 1, [Math.PI / 2, 0, 0]);
    }
    part(head, shape.capsule(0.009, 0.05, 2, 4), frame, onSurface(HC, HR, 0, -0.02, 1.08), 1, [0, 0, Math.PI / 2]);
  }
  return root;
}

function buildHair(head: THREE.Object3D, a: HumanAvatar) {
  const h = a.hairColor;
  const dark = shade(h, -0.05);
  const tie = '#f39a7b';
  // 정수리 껍질 + 뒷머리 볼륨
  part(head, shape.dome(0.56), h, [0, HC[1] + 0.012, -0.012], [HR[0] * 1.075, HR[1] * 1.07, HR[2] * 1.075]);
  part(head, shape.blob(2), h, [0, HC[1] - 0.03, -0.07], [HR[0] * 1.04, HR[1] * 0.92, HR[2] * 0.82]);
  // 앞머리: 이마를 덮는 매끈한 곡면(앞쪽 구면 조각) + 끝부분의 부드러운 결
  const shortCut = a.hairStyle === 'short' || a.hairStyle === 'spiky';
  const fringeLen = shortCut ? 0.36 : 0.455;
  part(head, shape.fringe(fringeLen), h, HC, [HR[0] * 1.085, HR[1] * 1.075, HR[2] * 1.085]);
  for (let i = 0; i < 4; i++) {
    const t = i / 3 - 0.5;
    const yaw = t * 1.15;
    const pitch = Math.PI / 2 - Math.PI * fringeLen + 0.035;
    part(head, shape.blob(1), h, onSurface(HC, HR, yaw, pitch, 1.065), [0.075, 0.035, 0.03], [0, yaw, 0]);
  }
  const side = (len: number, width = 0.075, yaw = 1.06, pitch = -0.12) => {
    for (const s of [-1, 1]) part(head, shape.blob(2), h, onSurface(HC, HR, s * yaw, pitch, 0.98), [width, len, 0.11], [0, s * 0.25, s * 0.08]);
  };
  switch (a.hairStyle) {
    case 'bob':
      side(0.17);
      part(head, shape.blob(2), h, [0, HC[1] - 0.14, -0.1], [HR[0] * 1.08, 0.16, HR[2] * 0.75]);
      break;
    case 'long':
      side(0.3, 0.08, 1.1, -0.35);
      part(head, shape.blob(2), h, [0, HC[1] - 0.3, -0.13], [HR[0] * 1.02, 0.3, 0.17]);
      for (const s of [-1, 1]) part(head, shape.blob(1), dark, [s * 0.25, HC[1] - 0.48, -0.02], [0.07, 0.07, 0.07]);
      break;
    case 'bun':
      side(0.11, 0.07);
      part(head, shape.blob(2), h, [0, HC[1] + 0.33, -0.1], 0.12);
      part(head, shape.torus(0.075, 0.022, Math.PI * 2, 4, 12), tie, [0, HC[1] + 0.25, -0.08], 1, [Math.PI / 2 + 0.3, 0, 0]);
      break;
    case 'twin':
      side(0.13, 0.07);
      for (const s of [-1, 1]) {
        part(head, shape.blob(2), h, [s * 0.4, HC[1] - 0.1, -0.06], [0.085, 0.16, 0.085], [0, 0, s * 0.25]);
        part(head, shape.blob(1), tie, [s * 0.36, HC[1] + 0.02, -0.06], 0.035);
      }
      break;
    case 'pony':
      side(0.12, 0.07);
      part(head, shape.blob(2), h, [0, HC[1] - 0.12, -0.39], [0.09, 0.2, 0.09], [0.45, 0, 0]);
      part(head, shape.blob(1), tie, [0, HC[1] + 0.03, -0.34], 0.04);
      break;
    case 'short':
      side(0.07, 0.06, 1.2, 0);
      break;
    case 'spiky':
      side(0.07, 0.06, 1.2, 0);
      for (let i = 0; i < 6; i++) {
        const yaw = (i / 6) * Math.PI * 2;
        part(head, shape.cone(0.07, 0.15, 5), h, onSurface(HC, HR, yaw, 0.95, 1.02), 1, [Math.cos(yaw) * 0.5, 0, -Math.sin(yaw) * 0.5]);
      }
      break;
  }
}

function buildHat(head: THREE.Object3D, a: HumanAvatar) {
  const c = a.hatColor;
  const dark = shade(c, -0.1);
  switch (a.hat) {
    case 'cap': {
      const g = new THREE.Group();
      g.position.set(0, HC[1] + 0.1, -0.01);
      g.rotation.x = -0.12;
      head.add(g);
      const cr: V3 = [HR[0] * 1.1, HR[1] * 0.92, HR[2] * 1.1];
      part(g, shape.dome(0.5, 14, 5), c, [0, 0, 0], cr);
      // 챙: 이마 위쪽에서 앞으로
      part(g, shape.cyl(0.19, 0.19, 0.022, 14, false), c, [0, 0.0, 0.33], [1.05, 1, 0.85], [0.06, 0, 0]);
      part(g, shape.blob(0), dark, [0, cr[1], 0], 0.028);
      // 발바닥 자수
      const paw = '#b07a52';
      const pc = onSurface([0, 0, 0], cr, 0, 0.45, 1.0);
      part(g, shape.sphere(8, 4), paw, pc, [0.045, 0.034, 0.015], [-0.45, 0, 0]);
      for (const [dx, dy] of [[-0.055, 0.035], [-0.02, 0.065], [0.02, 0.065], [0.055, 0.035]]) {
        part(g, shape.sphere(6, 4), paw, [pc[0] + dx, pc[1] + dy * 0.9, pc[2] - dy * 0.45], [0.015, 0.018, 0.012], [-0.45, 0, 0]);
      }
      break;
    }
    case 'bucket':
      part(head, shape.dome(0.5, 14, 5), c, [0, HC[1] + 0.06, 0], [HR[0] * 1.1, HR[1] * 0.95, HR[2] * 1.1]);
      part(head, shape.cyl(0.36, 0.46, 0.07, 14), c, [0, HC[1] + 0.06, 0.01], 1, [0.05, 0, 0]);
      part(head, shape.cyl(0.385, 0.385, 0.03, 14), dark, [0, HC[1] + 0.1, 0]);
      break;
    case 'beanie':
      part(head, shape.dome(0.55, 14, 6), c, [0, HC[1] + 0.03, -0.005], [HR[0] * 1.12, HR[1] * 1.12, HR[2] * 1.12]);
      part(head, shape.torus(1, 0.07, Math.PI * 2, 5, 16), dark, [0, HC[1] + 0.06, -0.005], [HR[0] * 1.1, HR[2] * 1.1, 0.7], [Math.PI / 2, 0, 0]);
      part(head, shape.blob(1), '#fffaf2', [0, HC[1] + HR[1] * 1.15 + 0.05, -0.01], 0.075);
      break;
    case 'headphones':
      part(head, shape.torus(0.375, 0.028, Math.PI, 5, 16), c, [0, HC[1] + 0.02, -0.02], [1, 1.05, 1]);
      for (const s of [-1, 1]) {
        part(head, shape.cyl(0.095, 0.095, 0.075, 12), c, [s * 0.37, HC[1] - 0.04, -0.01], 1, [0, 0, Math.PI / 2]);
        part(head, shape.cyl(0.075, 0.075, 0.03, 12), '#fffaf2', [s * 0.33, HC[1] - 0.04, -0.01], 1, [0, 0, Math.PI / 2]);
      }
      break;
  }
}

const cache = templateCache();
const keyOf = (a: HumanAvatar) => JSON.stringify(a);

export interface HumanRig {
  root: THREE.Group;
  body: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  hand: THREE.Object3D;
}

export function createHuman(a: HumanAvatar): HumanRig {
  const root = cache(keyOf(a), () => buildHuman(a));
  const g = (n: string) => root.getObjectByName(n)!;
  return { root, body: g('body'), torso: g('torso'), head: g('head'), legL: g('legL'), legR: g('legR'), armL: g('armL'), armR: g('armR'), hand: g('hand') };
}
