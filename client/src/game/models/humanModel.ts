// SD 비율 사람 아바타 빌더 — 사용자가 승인한 레퍼런스(점토 장난감 질감의 민머리 아이 + 단발 + 캡모자)에 맞춰 제작
// 큰 둥근 머리 · 작은 몸 · 짧은 팔다리. 파츠를 조합한 뒤 관절별로 병합한다.
// 관절: body(상하 반동) > legL, legR, torso > armL, armR, head  /  hand(목줄 잡는 위치)
import * as THREE from 'three';
import type { HumanAvatar } from '@shared/avatar';
import { bone, group, onSurface, part, shape, templateCache } from './bake';

type V3 = [number, number, number];

const EYE = '#1f1714';
const WHITE = '#ffffff';
const BLUSH = '#f7a3a0';
const MOUTH = '#c2463e';
const TONGUE = '#f2837e';
const SOCK = '#fbf8f3';
const SOLE = '#ece4d8';

/** 색을 밝게/어둡게 (같은 옷의 디테일 표현용) */
export function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}
const isLight = (hex: string) => { const c = new THREE.Color(hex); return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.6; };

// 머리 기준값 (head 관절 좌표계) — 레퍼런스처럼 약간 가로로 넓은 큰 머리
const HC: V3 = [0, 0.3, 0];
const HR: V3 = [0.318, 0.3, 0.292];

export const HUMAN_LAYOUT = { headCenter: 1.0, chest: 0.5, hips: 0.3, feet: 0.05, top: 1.32 };

function buildHuman(a: HumanAvatar, bald = false): THREE.Group {
  const root = new THREE.Group();
  root.name = 'human';
  const body = bone(root, 'body');

  // ---------- 다리: 짧은 다리 + 흰 양말 + 통통한 운동화 ----------
  const legColor = a.bottom === 'pants' ? a.bottomColor : a.skin;
  for (const side of [1, -1]) {
    const leg = bone(body, side > 0 ? 'legL' : 'legR', [side * 0.072, 0.305, 0]);
    part(leg, shape.capsule(0.056, 0.13), legColor, [0, -0.12, 0]);
    if (a.bottom !== 'pants') part(leg, shape.cyl(0.06, 0.062, 0.085, 20), SOCK, [0, -0.205, 0]);
    if (a.bottom === 'pants') part(leg, shape.torus(0.058, 0.011), shade(a.bottomColor, -0.06), [0, -0.205, 0], 1, [Math.PI / 2, 0, 0]);
    if (a.shoes === 'boots') {
      part(leg, shape.cyl(0.066, 0.07, 0.1, 20), a.shoeColor, [0, -0.225, 0]);
      part(leg, shape.ball(), a.shoeColor, [0, -0.268, 0.03], [0.072, 0.045, 0.105]);
      part(leg, shape.ball(), shade(a.shoeColor, -0.15), [0, -0.292, 0.025], [0.076, 0.016, 0.11]);
    } else {
      // 운동화: 통통한 몸통 + 밑창 + 발등 끈
      part(leg, shape.ball(), a.shoeColor, [0, -0.258, 0.028], [0.072, 0.05, 0.106]);
      part(leg, shape.ball(), isLight(a.shoeColor) ? SOLE : shade(a.shoeColor, 0.3), [0, -0.288, 0.028], [0.077, 0.02, 0.112]);
      part(leg, shape.ball(), shade(a.shoeColor, isLight(a.shoeColor) ? -0.06 : 0.12), [0, -0.232, 0.085], [0.035, 0.016, 0.03], [-0.5, 0, 0]);
      for (const z of [0.045, 0.07]) part(leg, shape.capsule(0.006, 0.04), shade(a.shoeColor, isLight(a.shoeColor) ? -0.12 : 0.2), [0, -0.218 - (z - 0.045) * 0.6, z + 0.01], 1, [0, 0, Math.PI / 2]);
    }
  }

  // ---------- 몸통 ----------
  const torso = bone(body, 'torso', [0, 0.3, 0]);
  // 하의
  if (a.bottom === 'skirt') {
    part(torso, shape.cyl(0.14, 0.215, 0.16, 24), a.bottomColor, [0, 0.03, 0]);
    part(torso, shape.torus(0.212, 0.012), shade(a.bottomColor, -0.08), [0, -0.05, 0], 1, [Math.PI / 2, 0, 0]);
  } else {
    part(torso, shape.ball(), a.bottomColor, [0, 0.05, 0], [0.152, 0.1, 0.125]);
    for (const s of [-1, 1]) {
      part(torso, shape.cyl(0.074, 0.077, a.bottom === 'shorts' ? 0.075 : 0.06, 20), a.bottomColor, [s * 0.072, -0.03, 0]);
      // 반바지 밑단 접힘
      if (a.bottom === 'shorts') part(torso, shape.torus(0.074, 0.013), shade(a.bottomColor, 0.06), [s * 0.072, -0.07, 0], 1, [Math.PI / 2, 0, 0]);
    }
  }

  // 상의 몸판 — 아래로 살짝 넓어지는 후드티 실루엣
  const overalls = a.top === 'overalls';
  const shirt = overalls || a.top === 'jacket' ? '#fffaf2' : a.topColor;
  part(torso, shape.ball(), shirt, [0, 0.2, 0], [0.158, 0.165, 0.128]);
  part(torso, shape.cyl(0.13, 0.162, 0.12, 24), shirt, [0, 0.12, 0]);
  part(torso, shape.torus(0.158, 0.02), shade(shirt, -0.05), [0, 0.065, 0], [1, 0.82, 1], [Math.PI / 2, 0, 0]); // 밑단 시보리
  part(torso, shape.cyl(0.07, 0.08, 0.05, 20), a.skin, [0, 0.36, 0]); // 목

  if (a.top === 'hoodie') {
    // 후드: 목 뒤로 넘어간 두툼한 모자 + 앞 V넥 테두리
    part(torso, shape.ball(), a.topColor, [0, 0.35, -0.09], [0.15, 0.12, 0.085], [0.35, 0, 0]);
    part(torso, shape.torus(0.088, 0.036, Math.PI * 2, 12, 28), a.topColor, [0, 0.35, -0.005], [1.2, 1, 1], [Math.PI / 2 - 0.3, 0, 0]);
    // 캥거루 주머니
    part(torso, shape.ball(), shade(a.topColor, -0.035), [0, 0.13, 0.112], [0.105, 0.055, 0.025]);
    // 끈 + 끝 장식
    for (const s of [-1, 1]) {
      part(torso, shape.capsule(0.0075, 0.075), WHITE, [s * 0.032, 0.285, 0.122], 1, [0.22, 0, 0]);
      part(torso, shape.capsule(0.011, 0.016), WHITE, [s * 0.032, 0.235, 0.133], 1, [0.22, 0, 0]);
    }
  }
  if (a.top === 'tee' || a.top === 'stripe') {
    part(torso, shape.torus(0.072, 0.014), shade(a.topColor, -0.07), [0, 0.352, 0.004], 1, [Math.PI / 2 - 0.2, 0, 0]);
  }
  if (a.top === 'stripe') {
    const stripe = isLight(a.topColor) ? '#4a5a78' : '#fffaf2';
    for (const y of [0.1, 0.17, 0.24, 0.3]) {
      const dy = (y - 0.2) / 0.165;
      const r = Math.sqrt(Math.max(0, 1 - dy * dy));
      const rx = y < 0.18 ? 0.162 - (0.18 - y) * 0.1 + 0.004 : 0.159 * r + 0.003;
      const rz = y < 0.18 ? 0.135 : 0.129 * r + 0.003;
      part(torso, shape.torus(1, 0.09, Math.PI * 2, 6, 32), stripe, [0, y, 0], [rx, rz, 0.13], [Math.PI / 2, 0, 0]);
    }
  }
  if (overalls) {
    part(torso, shape.ball(), a.topColor, [0, 0.12, 0.02], [0.16, 0.13, 0.13]);
    part(torso, shape.box(0.15, 0.13, 0.03), a.topColor, [0, 0.21, 0.105]);
    part(torso, shape.box(0.07, 0.05, 0.01), shade(a.topColor, -0.07), [0, 0.2, 0.122]);
    for (const s of [-1, 1]) {
      part(torso, shape.capsule(0.017, 0.2), a.topColor, [s * 0.075, 0.25, 0.01], 1, [0, 0, s * 0.08]);
      part(torso, shape.cyl(0.016, 0.016, 0.01, 12), '#f2c14e', [s * 0.06, 0.265, 0.12], 1, [Math.PI / 2, 0, 0]);
    }
  }
  if (a.top === 'jacket') {
    for (const s of [-1, 1]) {
      part(torso, shape.ball(), a.topColor, [s * 0.075, 0.2, 0.004], [0.098, 0.168, 0.13]);
      part(torso, shape.cyl(0.075, 0.09, 0.12, 20), a.topColor, [s * 0.072, 0.12, 0], [1, 1, 1]);
      part(torso, shape.cone(0.045, 0.1, 3), shade(a.topColor, -0.08), [s * 0.04, 0.31, 0.11], [1, 1, 0.35], [0.25, 0, s * 2.8]);
    }
  }

  // ---------- 팔: 소매 + 소매단 + 동그란 손 ----------
  const longSleeve = a.top === 'hoodie' || a.top === 'jacket';
  const sleeve = overalls ? shirt : a.topColor;
  for (const side of [1, -1]) {
    const arm = bone(torso, side > 0 ? 'armL' : 'armR', [side * 0.155, 0.31, 0]);
    const g = group(arm, [0, 0, 0], [0, 0, side * 0.16]);
    part(g, shape.ball(), sleeve, [side * 0.004, -0.02, 0], [0.058, 0.058, 0.058]); // 어깨
    if (longSleeve) {
      part(g, shape.capsule(0.052, 0.12), sleeve, [side * 0.012, -0.1, 0]);
      part(g, shape.cyl(0.054, 0.052, 0.035, 20), shade(sleeve, -0.05), [side * 0.012, -0.18, 0]);
    } else {
      part(g, shape.cyl(0.062, 0.058, 0.07, 20), sleeve, [side * 0.01, -0.05, 0]);
      part(g, shape.capsule(0.04, 0.1), a.skin, [side * 0.012, -0.12, 0]);
    }
    // 손 (엄지가 있는 동그란 손)
    part(g, shape.ball(), a.skin, [side * 0.014, -0.225, 0.004], [0.046, 0.052, 0.04]);
    part(g, shape.ball(), a.skin, [side * 0.004, -0.212, 0.035], [0.018, 0.024, 0.018], [0.4, 0, 0]);
    if (side < 0) {
      const hand = new THREE.Object3D();
      hand.name = 'hand';
      hand.position.set(side * 0.05, -0.235, 0.01);
      arm.add(hand);
    }
  }

  // 가방
  if (a.accessory === 'backpack') {
    part(torso, shape.ball(), '#e6b25c', [0, 0.19, -0.15], [0.12, 0.13, 0.065]);
    part(torso, shape.ball(), '#d39b45', [0, 0.13, -0.205], [0.075, 0.05, 0.022]);
    for (const s of [-1, 1]) part(torso, shape.torus(0.1, 0.012, Math.PI, 8, 16), '#c98a3a', [s * 0.085, 0.25, -0.025], [1, 1.25, 1], [0, Math.PI / 2, -Math.PI / 2]);
  }
  if (a.accessory === 'crossbag') {
    part(torso, shape.torus(0.2, 0.009), '#a8693a', [0, 0.2, 0], [0.92, 1.05, 0.8], [Math.PI / 2, 0.72, 0]);
    part(torso, shape.ball(), '#c98f62', [-0.145, 0.06, 0.07], [0.065, 0.058, 0.03], [0, 0.6, 0]);
    part(torso, shape.ball(), '#f2c14e', [-0.13, 0.065, 0.1], 0.011);
  }

  // ---------- 머리 ----------
  const head = bone(torso, 'head', [0, 0.375, 0]);
  part(head, shape.ball(32, 24), a.skin, HC, HR);
  // 귀 — 레퍼런스처럼 크고 동그랗게
  for (const s of [-1, 1]) {
    const p = onSurface(HC, HR, s * 1.52, -0.06, 0.95);
    part(head, shape.ball(), a.skin, p, [0.038, 0.06, 0.05], [0, 0, s * -0.15]);
    part(head, shape.ball(), shade(a.skin, -0.05), [p[0] + s * 0.012, p[1], p[2] + 0.005], [0.02, 0.038, 0.028]);
  }
  // 눈: 세로로 긴 반짝이는 눈 + 하이라이트 2개
  for (const s of [-1, 1]) {
    const yaw = s * 0.34, pitch = -0.08;
    part(head, shape.ball(), EYE, onSurface(HC, HR, yaw, pitch, 0.99), [0.034, 0.05, 0.02], [0, yaw, 0]);
    part(head, shape.ball(), WHITE, onSurface(HC, HR, yaw + 0.045, pitch + 0.075, 1.035), 0.012);
    part(head, shape.ball(), WHITE, onSurface(HC, HR, yaw - 0.03, pitch - 0.07, 1.03), 0.006);
    // 눈썹 (부드러운 아치)
    if (a.hat !== 'cap' && a.hat !== 'bucket') {
      const bp = onSurface(HC, HR, s * 0.35, 0.12, 1.0);
      part(head, shape.torus(0.05, 0.0085, 1.3, 8, 16), '#9b6a45', bp, [1, 0.55, 1], [0, s * 0.35, Math.PI / 2 - 0.65]);
    }
    // 볼터치
    part(head, shape.ball(), BLUSH, onSurface(HC, HR, s * 0.6, -0.27, 0.985), [0.055, 0.036, 0.014], [0, s * 0.6, 0]);
  }
  // 코 (작은 볼록)
  part(head, shape.ball(), shade(a.skin, -0.04), onSurface(HC, HR, 0, -0.18, 0.995), [0.016, 0.012, 0.012]);
  // 입: 크게 웃는 입 + 혀
  const mp = onSurface(HC, HR, 0, -0.33, 1.0);
  part(head, shape.halfDisc(0.048), MOUTH, [mp[0], mp[1] + 0.008, mp[2] + 0.004], [1.05, 0.9, 1], [0.33, 0, 0]);
  part(head, shape.ball(), TONGUE, [mp[0], mp[1] - 0.022, mp[2] + 0.001], [0.026, 0.013, 0.008], [0.33, 0, 0]);

  if (!bald) buildHair(head, a);
  buildHat(head, a);

  if (a.accessory === 'glasses' || a.accessory === 'square_glasses') {
    const frame = '#4a3a33';
    for (const s of [-1, 1]) {
      const p = onSurface(HC, HR, s * 0.34, -0.08, 1.075);
      if (a.accessory === 'glasses') part(head, shape.torus(0.068, 0.0095), frame, p, 1, [0, s * 0.3, 0]);
      else part(head, shape.torus(0.08, 0.0095, Math.PI * 2, 6, 4), frame, p, [1, 0.82, 1], [0, s * 0.3, Math.PI / 4]);
      part(head, shape.capsule(0.007, 0.13), frame, onSurface(HC, HR, s * 0.98, -0.04, 1.02), 1, [Math.PI / 2, 0, 0]);
    }
    part(head, shape.capsule(0.0075, 0.05), frame, onSurface(HC, HR, 0, -0.03, 1.075), 1, [0, 0, Math.PI / 2]);
  }
  return root;
}

/** 머리카락: 얼굴 부분이 열린 매끈한 헬멧형 껍질 + 결 홈 + 일자 앞머리 (레퍼런스 단발 구조) */
function buildHair(head: THREE.Object3D, a: HumanAvatar) {
  const h = a.hairColor;
  const tie = '#f39a7b';
  const R: V3 = [HR[0] * 1.09, HR[1] * 1.1, HR[2] * 1.11];
  const C: V3 = [0, HC[1] + 0.012, -0.006];
  const open = 0.88; // 얼굴 쪽 열린 각도(반폭)
  /** 옆·뒤를 감싸는 껍질 (가닥 결 포함). bottom: 위에서부터 내려오는 깊이(π 비율) */
  const shellTo = (bottom: number) => {
    part(head, shape.hair(Math.PI / 2 + open, Math.PI * 2 - open * 2, Math.PI * bottom, 9), h, C, R);
    part(head, shape.dome(0.3), h, C, R);
  };
  /** 일자 앞머리: 이마를 덮는 곡면에 세 갈래 결 */
  const bangs = (bottom: number) => {
    // 모자를 쓰면 앞머리를 모자 안쪽으로 (결이 모자 밖으로 비치지 않게)
    const hat = a.hat !== 'none' && a.hat !== 'headphones';
    const B: V3 = hat ? [R[0] * 0.995, R[1] * 0.99, R[2] * 1.0] : [R[0] * 1.012, R[1] * 1.01, R[2] * 1.035];
    part(head, shape.hair(Math.PI / 2 - open - 0.1, open * 2 + 0.2, Math.PI * bottom, 3, hat ? 0 : 0.03), h, C, B);
  };
  switch (a.hairStyle) {
    case 'bob':
      shellTo(0.8);
      bangs(0.45);
      break;
    case 'long':
      shellTo(0.8);
      bangs(0.43);
      // 등 뒤로 내려오는 긴 머리
      part(head, shape.ball(), h, [0, HC[1] - 0.32, -0.15], [0.29, 0.26, 0.13]);
      for (const s of [-1, 1]) part(head, shape.ball(), h, [s * 0.27, HC[1] - 0.3, 0.0], [0.07, 0.2, 0.09]);
      break;
    case 'bun':
      shellTo(0.62);
      bangs(0.43);
      part(head, shape.ball(), h, [0, HC[1] + 0.34, -0.1], 0.115);
      part(head, shape.torus(0.075, 0.02), tie, [0, HC[1] + 0.26, -0.075], 1, [Math.PI / 2 + 0.3, 0, 0]);
      break;
    case 'twin':
      shellTo(0.66);
      bangs(0.43);
      for (const s of [-1, 1]) {
        part(head, shape.ball(), h, [s * 0.39, HC[1] - 0.08, -0.06], [0.075, 0.16, 0.075], [0, 0, s * 0.3]);
        part(head, shape.ball(), tie, [s * 0.35, HC[1] + 0.04, -0.06], 0.03);
      }
      break;
    case 'pony':
      shellTo(0.64);
      bangs(0.43);
      part(head, shape.ball(), h, [0, HC[1] - 0.1, -0.38], [0.08, 0.19, 0.08], [0.45, 0, 0]);
      part(head, shape.ball(), tie, [0, HC[1] + 0.04, -0.34], 0.035);
      break;
    case 'short':
      shellTo(0.56);
      bangs(0.36);
      break;
    case 'spiky':
      shellTo(0.56);
      bangs(0.34);
      for (let i = 0; i < 7; i++) {
        const yaw = (i / 7) * Math.PI * 2 + 0.3;
        part(head, shape.cone(0.06, 0.14), h, onSurface(C, R, yaw, 0.95, 0.98), 1, [Math.cos(yaw) * 0.55, 0, -Math.sin(yaw) * 0.55]);
      }
      break;
  }
}

function buildHat(head: THREE.Object3D, a: HumanAvatar) {
  const c = a.hatColor;
  const dark = shade(c, -0.07);
  switch (a.hat) {
    case 'cap': {
      // 레퍼런스 캡: 둥근 크라운 + 꼭지 단추 + 봉제선 + 휘어진 챙 + 발바닥 자수 + 뒤 버클
      const g = group(head, [0, HC[1] + 0.06, -0.01], [-0.06, 0, 0]);
      const cr: V3 = [HR[0] * 1.13, HR[1] * 1.0, HR[2] * 1.15];
      part(g, shape.dome(0.5), c, [0, 0, 0], cr);
      part(g, shape.ball(), c, [0, cr[1] + 0.005, 0], [0.032, 0.02, 0.032]);
      // 챙: 납작하게 눌린 반달 모양, 끝이 살짝 아래로
      part(g, shape.ball(), c, [0, 0.0, 0.31], [0.215, 0.022, 0.165], [0.16, 0, 0]);
      part(g, shape.ball(), dark, [0, -0.016, 0.3], [0.2, 0.01, 0.15], [0.16, 0, 0]);
      // 앞면 발바닥 자수
      const paw = '#a96d43';
      const pc = onSurface([0, 0, 0], cr, 0, 0.4, 1.0);
      part(g, shape.ball(), paw, pc, [0.045, 0.034, 0.012], [-0.4, 0, 0]);
      for (const [dx, dy] of [[-0.058, 0.03], [-0.022, 0.062], [0.022, 0.062], [0.058, 0.03]]) {
        part(g, shape.ball(), paw, [pc[0] + dx, pc[1] + dy * 0.92, pc[2] - dy * 0.42 - Math.abs(dx) * 0.25], [0.015, 0.019, 0.01], [-0.4, dx * -4, 0]);
      }
      // 뒤 버클 스트랩
      part(g, shape.box(0.12, 0.022, 0.02), dark, [0, 0.03, -cr[2] * 0.97]);
      part(g, shape.box(0.03, 0.03, 0.015), shade(c, -0.15), [0.03, 0.03, -cr[2] * 0.99]);
      break;
    }
    case 'bucket':
      part(head, shape.dome(0.5), c, [0, HC[1] + 0.07, 0], [HR[0] * 1.1, HR[1] * 0.92, HR[2] * 1.12]);
      part(head, shape.cyl(0.36, 0.45, 0.06, 32), c, [0, HC[1] + 0.065, 0.01], 1, [0.06, 0, 0]);
      part(head, shape.torus(0.35, 0.012), dark, [0, HC[1] + 0.1, 0.005], 1, [Math.PI / 2, 0, 0]);
      break;
    case 'beanie':
      part(head, shape.dome(0.56), c, [0, HC[1] + 0.025, -0.005], [HR[0] * 1.12, HR[1] * 1.14, HR[2] * 1.13]);
      part(head, shape.torus(1, 0.075, Math.PI * 2, 12, 36), dark, [0, HC[1] + 0.05, -0.005], [HR[0] * 1.1, HR[2] * 1.11, 0.62], [Math.PI / 2, 0, 0]);
      part(head, shape.ball(), shade(c, 0.12), [0, HC[1] + HR[1] * 1.16 + 0.05, -0.01], 0.07);
      break;
    case 'headphones':
      part(head, shape.torus(0.37, 0.026, Math.PI, 10, 24), c, [0, HC[1] + 0.02, -0.02], [1, 1.06, 1]);
      for (const s of [-1, 1]) {
        part(head, shape.cyl(0.09, 0.09, 0.07, 24), c, [s * 0.365, HC[1] - 0.04, -0.01], 1, [0, 0, Math.PI / 2]);
        part(head, shape.cyl(0.072, 0.072, 0.03, 24), '#fffaf2', [s * 0.325, HC[1] - 0.04, -0.01], 1, [0, 0, Math.PI / 2]);
      }
      break;
  }
}

const cache = templateCache();

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

/** bald: 레퍼런스 비교용 민머리 (게임에서는 사용하지 않음) */
export function createHuman(a: HumanAvatar, bald = false): HumanRig {
  const root = cache(JSON.stringify(a) + (bald ? ':bald' : ''), () => buildHuman(a, bald));
  const g = (n: string) => root.getObjectByName(n)!;
  return { root, body: g('body'), torso: g('torso'), head: g('head'), legL: g('legL'), legR: g('legR'), armL: g('armL'), armR: g('armR'), hand: g('hand') };
}
