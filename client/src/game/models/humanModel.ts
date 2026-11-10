// SD 비율 사람 아바타 빌더 — 사용자가 승인한 레퍼런스(점토 장난감 질감의 민머리 아이 + 단발 + 캡모자)에 맞춰 제작
// 큰 둥근 머리 · 작은 몸 · 짧은 팔다리. 파츠를 조합한 뒤 관절별로 병합한다.
// 관절: body(상하 반동) > legL, legR, torso > armL, armR, head  /  hand(목줄 잡는 위치)
import * as THREE from 'three';
import type { HumanAvatar } from '@shared/avatar';
import { bone, group, onSurface, part, shape, templateCache } from './bake';
import { lathe, mix, sculptSphere, smooth, smoothProfile } from './sculpt';

type V3 = [number, number, number];

const EYE = '#1f1714';
const WHITE = '#ffffff';
const BLUSH = '#f3a5a0';
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
/** 얼굴 배치 (헤어스타일과 무관하게 고정) */
const FACE = { eyeYaw: 0.31, eyePitch: -0.13, browPitch: 0.06 };

/** 볼살 있는 머리 (단위 구 조형) */
const HEAD_GEO = () => sculptSphere('humanHead', (d) => {
  const y = d.y;
  // 볼: 얼굴 아래 앞쪽을 살짝 부풀림, 턱 끝은 동그랗게 / 정수리는 아주 약간 납작
  const cheek = smooth(0.45, -0.2, Math.abs(y + 0.32) * 2) * smooth(-0.3, 0.6, d.z);
  const k = 1 + 0.055 * cheek;
  return new THREE.Vector3(d.x * k, y > 0.55 ? y * (1 - (y - 0.55) * 0.06) : y * (1 - 0.03 * smooth(-0.6, -1, y)), d.z * (1 + 0.035 * cheek));
});

/** 팔·다리 회전체 (원통 대신 어깨·허벅지는 둥글고 끝으로 갈수록 자연스럽게 가늘어짐) */
const SLEEVE_LONG = () => lathe('sleeveL5', smoothProfile([[0.001, 0.052], [0.04, 0.042], [0.058, 0.005], [0.057, -0.06], [0.052, -0.13], [0.05, -0.17], [0.046, -0.18], [0.001, -0.182]], 26), 28);
const SLEEVE_SHORT = () => lathe('sleeveS5', smoothProfile([[0.001, 0.052], [0.04, 0.042], [0.058, 0.005], [0.062, -0.06], [0.06, -0.085], [0.001, -0.086]], 20), 28);
const ARM_SKIN = () => lathe('armSkin5', smoothProfile([[0.001, 0.0], [0.04, -0.01], [0.039, -0.08], [0.036, -0.13], [0.001, -0.14]], 18), 24);
const LEG_GEO = () => lathe('leg5', smoothProfile([[0.001, 0.03], [0.05, 0.012], [0.059, -0.04], [0.055, -0.13], [0.05, -0.2], [0.001, -0.215]], 22), 28);

export const HUMAN_LAYOUT = { headCenter: 1.0, chest: 0.5, hips: 0.3, feet: 0.05, top: 1.32 };

function buildHuman(a: HumanAvatar, bald = false): THREE.Group {
  const root = new THREE.Group();
  root.name = 'human';
  const body = bone(root, 'body');

  // ---------- 다리: 짧은 다리 + 흰 양말 + 통통한 운동화 ----------
  const legColor = a.bottom === 'pants' ? a.bottomColor : a.skin;
  for (const side of [1, -1]) {
    const leg = bone(body, side > 0 ? 'legL' : 'legR', [side * 0.072, 0.305, 0]);
    part(leg, LEG_GEO(), legColor, [0, 0, 0]);
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
  // 몸판: 매끈한 회전체 (밑단은 넉넉, 어깨는 둥글게 좁아짐) + 위쪽이 살짝 밝은 그라데이션
  const shirtTop = shade(shirt, 0.035), shirtLow = shade(shirt, -0.035);
  part(torso, lathe('torso', smoothProfile([[0.148, 0.05], [0.166, 0.08], [0.165, 0.15], [0.16, 0.23], [0.145, 0.29], [0.11, 0.34], [0.062, 0.372]], 30), 40),
    (p) => mix(shirtLow, shirtTop, smooth(0.08, 0.32, p.y)), [0, 0, 0], [1, 1, 0.8]);
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
    // 소매: 어깨에서 둥글게 시작해 손목으로 살짝 가늘어지는 회전체 (몸통 안에서 시작해 접합부가 보이지 않게)
    if (longSleeve) {
      part(g, SLEEVE_LONG(), (p) => mix(sleeve, shade(sleeve, -0.04), smooth(-0.05, -0.17, p.y)), [side * 0.01, 0, 0]);
      part(g, shape.torus(0.049, 0.011, Math.PI * 2, 8, 24), shade(sleeve, -0.05), [side * 0.012, -0.178, 0], 1, [Math.PI / 2, 0, 0]);
    } else {
      part(g, SLEEVE_SHORT(), sleeve, [side * 0.01, 0, 0]);
      part(g, ARM_SKIN(), a.skin, [side * 0.012, -0.06, 0]);
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
  // 말랑한 얼굴: 볼살이 살짝 도톰하고 턱이 동그란 구 + 볼터치·턱 밑 그늘을 피부에 직접 그라데이션으로 칠함
  // 볼터치(v6): 이전보다 약 40% 넓게, 가운데에서 바깥으로 아주 부드럽게 옅어지는 코랄 핑크.
  // 눈 아래·입 옆 사이(볼 가장 도톰한 곳)에 두어 눈·입과 겹치지 않고, 옆에서 봐도 볼을 따라 자연스럽게 감싼다.
  const cheeks = [-1, 1].map((s) => new THREE.Vector3(...onSurface(HC, HR, s * 0.6, -0.31, 1.0)));
  const skinShadow = shade(a.skin, -0.05);
  // 어두운 피부에서는 볼터치가 분홍 스티커처럼 떠 보이지 않게 조금 옅게
  const blushK = 0.62 * (0.55 + 0.45 * Math.min(1, new THREE.Color(a.skin).getHSL({ h: 0, s: 0, l: 0 }).l / 0.85));
  const warm = mix(a.skin, '#ffc4ae', 0.07); // 얼굴 아래쪽에 아주 살짝 도는 혈색
  part(head, HEAD_GEO(), (p) => {
    let c = mix(a.skin, warm, smooth(0.0, 0.14, HC[1] - p.y) * (1 - smooth(0.16, 0.3, HC[1] - p.y)));
    c = mix(c, skinShadow, smooth(0.18, 0.3, HC[1] - p.y) * 0.5);
    for (const ch of cheeks) {
      const t = 1 - smooth(0.0, 0.105, p.distanceTo(ch));
      c = mix(c, BLUSH, t * t * (3 - 2 * t) * blushK);
    }
    return c;
  }, HC, HR);
  // 귀 — 레퍼런스처럼 크고 동그랗게
  // 귀를 덮는 머리(단발·긴머리 등)일 때는 귀가 머리카락을 뚫고 보이지 않게 생략
  const earsHidden = !bald && (HAIR_CUTS[a.hairStyle]?.side ?? 0) < -0.1;
  for (const s of earsHidden ? [] : [-1, 1]) {
    const p = onSurface(HC, HR, s * 1.52, -0.06, 0.95);
    part(head, shape.ball(), a.skin, p, [0.038, 0.06, 0.05], [0, 0, s * -0.15]);
    part(head, shape.ball(), shade(a.skin, -0.05), [p[0] + s * 0.012, p[1], p[2] + 0.005], [0.02, 0.038, 0.028]);
  }
  // 얼굴 (v5): 헤어스타일·모자와 무관하게 항상 같은 크기·위치로 그린다.
  // 눈은 머리 표면에 거의 붙은 얇은 타원(튀어나오지 않게) — 또렷한 검은 눈 + 작은 하이라이트
  const brow = mix(a.hairColor, '#6b4a36', 0.35).getStyle();
  for (const s of [-1, 1]) {
    const yaw = s * FACE.eyeYaw, pitch = FACE.eyePitch;
    const eg = group(head, onSurface(HC, HR, yaw, pitch, 0.998), [0, yaw, 0]);
    part(eg, shape.ball(24, 18), EYE, [0, 0, 0], [0.033, 0.045, 0.012], [-pitch, 0, 0], { gloss: true });
    part(head, shape.ball(12, 10), WHITE, onSurface(HC, HR, yaw + s * 0.028, pitch + 0.055, 1.025), [0.0105, 0.0115, 0.004], [0, yaw, 0]);
    part(head, shape.ball(8, 6), WHITE, onSurface(HC, HR, yaw - s * 0.022, pitch - 0.05, 1.02), [0.0048, 0.0048, 0.003], [0, yaw, 0]);
    // 얇고 자연스러운 눈썹 (살짝 둥근 아치)
    part(head, shape.torus(0.048, 0.0052, 1.05, 6, 16), brow, onSurface(HC, HR, s * 0.34, FACE.browPitch, 1.0), [1, 0.5, 1], [0, s * 0.34, Math.PI / 2 - 0.52]);
  }
  // 감은 눈 (잠자기): 눈을 살색으로 덮고 아래로 둥근 속눈썹 선 — 평소에는 숨김 (rig.lids)
  const lids = bone(head, 'lids');
  for (const s of [-1, 1]) {
    const yaw = s * FACE.eyeYaw, pitch = FACE.eyePitch;
    // 눈(두께 0.012)보다 조금 두꺼운 납작한 눈꺼풀 + 그 위에 감은 눈 선
    part(lids, shape.ball(16, 12), a.skin, onSurface(HC, HR, yaw, pitch, 0.998), [0.04, 0.05, 0.017], [-pitch, yaw, 0]);
    part(lids, shape.torus(0.028, 0.006, Math.PI * 0.8, 6, 14), '#3a2a24', onSurface(HC, HR, yaw, pitch - 0.01, 1.058), 1, [-pitch, yaw, Math.PI + Math.PI * 0.1]);
  }
  // 코 (아주 작게)
  part(head, shape.ball(12, 10), shade(a.skin, -0.05), onSurface(HC, HR, 0, -0.2, 0.995), [0.012, 0.009, 0.009]);
  // 입: 부드러운 미소 선
  part(head, shape.torus(0.026, 0.0055, Math.PI * 0.75, 6, 18), '#a2493f', onSurface(HC, HR, 0, -0.3, 1.0), [1, 0.85, 1], [0.3, 0, Math.PI + Math.PI * 0.125]);

  if (!bald) buildHair(head, a);
  buildHat(head, a);

  if (a.accessory === 'glasses' || a.accessory === 'square_glasses') {
    const frame = '#4a3a33';
    for (const s of [-1, 1]) {
      const p = onSurface(HC, HR, s * FACE.eyeYaw, FACE.eyePitch, 1.075);
      if (a.accessory === 'glasses') part(head, shape.torus(0.068, 0.0095), frame, p, 1, [0, s * 0.3, 0]);
      else part(head, shape.torus(0.08, 0.0095, Math.PI * 2, 6, 4), frame, p, [1, 0.82, 1], [0, s * 0.3, Math.PI / 4]);
      part(head, shape.capsule(0.007, 0.13), frame, onSurface(HC, HR, s * 0.98, -0.04, 1.02), 1, [Math.PI / 2, 0, 0]);
    }
    part(head, shape.capsule(0.0075, 0.05), frame, onSurface(HC, HR, 0, -0.03, 1.075), 1, [0, 0, Math.PI / 2]);
  }
  return root;
}

/**
 * 머리카락 (v5): 하나로 이어진 헤어 메시.
 * 머리보다 조금 큰 구를 조형해서 ①얼굴 창(앞머리 선·구레나룻) 안쪽은 피부 속으로 부드럽게 말려 들어가고
 * ②아래 끝(머리 길이)도 안쪽으로 말리며 ③아래쪽에만 아주 얕은 결을 넣는다. 가닥을 따로 붙이지 않아 경계가 자연스럽다.
 */
interface HairCut { fringe: number; win: number; back: number; side: number; bangs: number }
const HAIR_CUTS: Record<string, HairCut> = {
  bob: { fringe: 0.17, win: 0.98, back: -0.62, side: -0.5, bangs: 1 },
  long: { fringe: 0.22, win: 0.98, back: -0.85, side: -0.62, bangs: 1 },
  bun: { fringe: 0.26, win: 1.02, back: -0.35, side: -0.22, bangs: 0.7 },
  twin: { fringe: 0.24, win: 1.0, back: -0.35, side: -0.25, bangs: 0.8 },
  pony: { fringe: 0.26, win: 1.02, back: -0.35, side: -0.22, bangs: 0.7 },
  short: { fringe: 0.34, win: 1.08, back: -0.2, side: 0.05, bangs: 0.5 },
  spiky: { fringe: 0.38, win: 1.08, back: -0.2, side: 0.05, bangs: 0.3 },
};
function hairGeometry(style: string) {
  const c = HAIR_CUTS[style] ?? HAIR_CUTS.bob;
  return sculptSphere(`hair5${style}`, (d) => {
    const yaw = Math.atan2(d.x, d.z);
    const ay = Math.abs(yaw);
    const pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    // 앞머리 선: 가운데가 가장 낮고 관자놀이로 갈수록 살짝 올라감 + 아주 약한 물결
    const fringe = c.fringe + 0.07 * Math.pow(ay / c.win, 2) + 0.018 * Math.cos(yaw * 9) * c.bangs;
    // 얼굴 창 안쪽 거리 (부드러운 최솟값 → 앞머리와 옆머리가 이어지는 모서리가 둥글게)
    const sk = 0.06, ea = c.win - ay, eb = fringe - pitch;
    const inWin = -sk * Math.log(Math.exp(-ea / sk) + Math.exp(-eb / sk)); // >0 이면 얼굴 창 안
    // 머리 길이: 뒤(back) → 옆(side)으로 이어짐
    const bottom = c.side + (c.back - c.side) * smooth(1.2, 2.6, ay);
    const belowCut = bottom - pitch; // >0 이면 길이 아래
    let k = 1;
    k -= 0.15 * smooth(-0.02, 0.07, inWin);
    k -= 0.18 * smooth(-0.03, 0.1, belowCut);
    // 끝이 안쪽으로 둥글게 말리기 직전 살짝 도톰하게
    k += 0.03 * smooth(-0.22, -0.06, belowCut) * (1 - smooth(-0.03, 0.06, belowCut));
    // 앞머리 두께 (이마 위 볼륨)
    k += 0.025 * c.bangs * smooth(0.45, 0.0, ay) * smooth(fringe + 0.45, fringe + 0.05, pitch) * (1 - smooth(-0.02, 0.05, inWin));
    // 아래쪽만 아주 얕은 머리 결
    k *= 1 + 0.008 * Math.cos(yaw * 22) * smooth(0.5, -0.2, pitch);
    // 정수리는 살짝 납작하게
    const y = d.y > 0.7 ? d.y * (1 - (d.y - 0.7) * 0.08) : d.y;
    return new THREE.Vector3(d.x * k, y * k, d.z * k);
  }, 72, 48);
}

function buildHair(head: THREE.Object3D, a: HumanAvatar) {
  const h = a.hairColor;
  const tie = '#f39a7b';
  const R: V3 = [HR[0] * 1.075, HR[1] * 1.08, HR[2] * 1.09];
  const C: V3 = [0, HC[1] + 0.012, -0.004];
  // 위는 살짝 밝고(윤기) 아래는 살짝 어둡게
  const hi = shade(h, 0.06), lo = shade(h, -0.035);
  part(head, hairGeometry(a.hairStyle), (p) => mix(lo, hi, smooth(-0.22, 0.2, p.y - C[1])), C, R);
  switch (a.hairStyle) {
    case 'long':
      part(head, shape.ball(), lo, [0, HC[1] - 0.3, -0.16], [0.27, 0.25, 0.12]);
      for (const s of [-1, 1]) part(head, shape.ball(), h, [s * 0.26, HC[1] - 0.29, -0.01], [0.065, 0.19, 0.085]);
      break;
    case 'bun':
      part(head, shape.ball(), h, [0, HC[1] + 0.34, -0.1], 0.115);
      part(head, shape.torus(0.075, 0.02), tie, [0, HC[1] + 0.26, -0.075], 1, [Math.PI / 2 + 0.3, 0, 0]);
      break;
    case 'twin':
      for (const s of [-1, 1]) {
        part(head, shape.ball(), h, [s * 0.38, HC[1] - 0.08, -0.06], [0.075, 0.16, 0.075], [0, 0, s * 0.3]);
        part(head, shape.ball(), tie, [s * 0.34, HC[1] + 0.04, -0.06], 0.03);
      }
      break;
    case 'pony':
      part(head, shape.ball(), h, [0, HC[1] - 0.1, -0.38], [0.08, 0.19, 0.08], [0.45, 0, 0]);
      part(head, shape.ball(), tie, [0, HC[1] + 0.04, -0.34], 0.035);
      break;
    case 'spiky':
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
      // 눈을 가리지 않도록 이마 위에 얹음
      part(head, shape.dome(0.56), c, [0, HC[1] + 0.055, -0.005], [HR[0] * 1.12, HR[1] * 1.08, HR[2] * 1.13]);
      part(head, shape.torus(1, 0.075, Math.PI * 2, 12, 36), dark, [0, HC[1] + 0.085, -0.005], [HR[0] * 1.1, HR[2] * 1.11, 0.6], [Math.PI / 2, 0, 0]);
      part(head, shape.ball(), shade(c, 0.12), [0, HC[1] + HR[1] * 1.1 + 0.07, -0.01], 0.07);
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
  /** 감은 눈 (잠자기) */
  lids: THREE.Object3D;
}

/** bald: 레퍼런스 비교용 민머리 (게임에서는 사용하지 않음) */
export function createHuman(a: HumanAvatar, bald = false): HumanRig {
  const root = cache(JSON.stringify(a) + (bald ? ':bald' : ''), () => buildHuman(a, bald));
  const g = (n: string) => root.getObjectByName(n)!;
  return { root, body: g('body'), torso: g('torso'), head: g('head'), legL: g('legL'), legR: g('legR'), armL: g('armL'), armR: g('armR'), hand: g('hand'), lids: g('lids') };
}
