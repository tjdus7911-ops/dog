// 강아지 빌더 — 승인된 코기 레퍼런스(큰 머리·둥근 몸·짧은 다리·점토 질감)에 맞춰 제작
// 견종 특징은 미리 만든 파츠(귀·주둥이·꼬리·무늬·털 길이·체형)를 조합해 표현한다. (AI 분석 결과도 같은 값으로 들어옴)
// 관절: body > head, tail, legFL, legFR, legBL, legBR, tongue  /  anchor(하네스 고리 — 목줄 연결점)
import * as THREE from 'three';
import type { DogAvatar } from '@shared/avatar';
import { bone, group, onSurface, part, shape, templateCache } from './bake';
import { shade } from './humanModel';

type V3 = [number, number, number];
const EYE = '#1f1714';
const NOSE = '#3a2620';
const WHITE = '#ffffff';
const PINK = '#f6a9a6';
const INNER_EAR = '#f5b3ae';
const GOLD = '#f2c14e';

const HC: V3 = [0, 0, 0];

const LEG_EXTRA = { short: 0, normal: 0.045, long: 0.09 } as const;
const BODY_EXTRA = { short: -0.035, normal: 0, long: 0.065 } as const;
const BUILD_W = { slim: 0.88, normal: 1, chubby: 1.14 } as const;
const EAR_SCALE = { small: 0.78, medium: 1, large: 1.22 } as const;
const lum = (hex: string) => { const c = new THREE.Color(hex); return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; };

function buildDog(a: DogAvatar): THREE.Group {
  const root = new THREE.Group();
  root.name = 'dog';
  // 다리가 길면 몸 전체를 올린다 (산책 애니메이션은 root.userData.baseY 기준으로 위아래로 움직임)
  const legD = LEG_EXTRA[a.legLen] ?? 0;
  const dz = BODY_EXTRA[a.bodyLen] ?? 0;
  const w = BUILD_W[a.build] ?? 1;
  const es = EAR_SCALE[a.earSize] ?? 1;
  root.userData.baseY = legD;
  const body = bone(root, 'body', [0, legD, 0]);
  /** 몸 길이 보정: 앞쪽은 앞으로, 뒤쪽은 뒤로 */
  const Z = (z: number) => (z > 0.04 ? z + dz : z < -0.04 ? z - dz : z);
  const long = a.fur === 'long';
  const coat = a.coat;
  const sec = a.secondary;
  const marked = a.pattern === 'mask' || a.pattern === 'socks';
  const f = long ? 1.1 : 1;
  const belly = marked ? sec : shade(coat, 0.06);

  // ---------- 몸통: 통통한 타원 + 밝은 배 + 가슴털 ----------
  const tz = 0.24 + dz * 0.9;
  part(body, shape.ball(), coat, [0, 0.27, -0.03], [0.165 * f * w, 0.15 * f * (0.5 + w / 2), tz * f]);
  part(body, shape.ball(), belly, [0, 0.22, -0.02], [0.14 * f * w, 0.1 * f, (tz - 0.025) * f]);
  // 엉덩이 아래 밝은 털 (뒤에서 보면 하트 모양)
  if (marked) for (const s of [-1, 1]) part(body, shape.ball(), sec, [s * 0.06 * w, 0.2, Z(-0.2)], [0.07 * w, 0.08, 0.06]);
  // 가슴 — 목과 몸을 잇는 볼륨 + 보송한 가슴털
  part(body, shape.ball(), coat, [0, 0.36, Z(0.13)], [0.135 * f * w, 0.14 * f, 0.12 * f]);
  part(body, shape.ball(), marked ? sec : shade(coat, 0.08), [0, 0.32, Z(0.19)], [0.11 * f * w, 0.13 * f, 0.075 * f]);
  if (marked || long) for (const x of [-0.04, 0.04]) part(body, shape.ball(), marked ? sec : coat, [x * w, 0.235, Z(0.2)], [0.045, 0.03, 0.03]);
  if (long) part(body, shape.ball(), coat, [0, 0.4, Z(0.12)], [0.16 * w, 0.12, 0.12]);
  if (a.pattern === 'saddle') part(body, shape.ball(), sec, [0, 0.33, -0.06], [0.16 * w, 0.09, 0.2 + dz * 0.8]);
  if (a.pattern === 'patch') {
    part(body, shape.ball(), sec, [0.11 * w, 0.31, Z(-0.09)], [0.07, 0.08, 0.1]);
    part(body, shape.ball(), sec, [-0.08 * w, 0.36, 0.0], [0.06, 0.05, 0.07]);
  }

  // 목걸이 + 금색 이름표 + 목줄 고리
  const h = a.harness;
  part(body, shape.torus(0.1, 0.018), h, [0, 0.42, Z(0.17)], [w, 1, 1], [Math.PI / 2 - 0.6, 0, 0]);
  const tag = group(body, [0, 0.355, Z(0.255)], [-0.35, 0, 0]);
  part(tag, shape.cyl(0.026, 0.026, 0.01, 20), GOLD, [0, 0, 0], 1, [Math.PI / 2, 0, 0]);
  part(tag, shape.ball(), shade(GOLD, -0.22), [0, -0.003, 0.006], [0.009, 0.007, 0.003]);
  for (const dx of [-0.008, 0, 0.008]) part(tag, shape.ball(), shade(GOLD, -0.22), [dx, 0.007, 0.006], 0.0035);
  part(body, shape.torus(0.024, 0.007), '#c9c9cf', [0, 0.49, Z(0.1)], 1, [0, Math.PI / 2, 0]);
  const anchor = new THREE.Object3D();
  anchor.name = 'anchor';
  anchor.position.set(0, 0.5, Z(0.1));
  body.add(anchor);

  // ---------- 다리: 짧고 통통 + 밝은 발 ----------
  const legs: [string, number, number][] = [['legFL', 0.08, 0.12], ['legFR', -0.08, 0.12], ['legBL', 0.085, -0.15], ['legBR', -0.085, -0.15]];
  for (const [name, x, z] of legs) {
    const leg = bone(body, name, [x * w, 0.19, Z(z)]);
    const front = z > 0;
    if (!front) part(leg, shape.ball(), coat, [0, 0.03, -0.005], [0.07 * w, 0.085, 0.085]); // 허벅지
    // 다리 길이: 위쪽 관절 위치는 그대로, 발끝을 아래로 늘림 (몸은 legD만큼 올라가 있음)
    part(leg, shape.capsule(0.045 * f, 0.08 + legD), coat, [0, -0.065 - legD / 2, 0]);
    const paw = marked || a.pattern === 'saddle' ? sec : shade(coat, 0.05);
    part(leg, shape.capsule(0.047 * f, 0.03), paw, [0, -0.125 - legD, 0.004]);
    part(leg, shape.ball(), paw, [0, -0.168 - legD, 0.018], [0.05, 0.026, 0.062]);
    // 발가락 홈
    for (const dx of [-0.017, 0.017]) part(leg, shape.ball(), shade(paw, -0.1), [dx, -0.163 - legD, 0.074], [0.004, 0.012, 0.004]);
  }

  // ---------- 꼬리 ----------
  const tail = bone(body, 'tail', [0, 0.33, -0.255 - dz]);
  switch (a.tail) {
    case 'curl':
      part(tail, shape.torus(0.06, 0.032 * f, Math.PI * 1.55), coat, [0, 0.07, -0.01], 1, [0, Math.PI / 2, 0.4]);
      part(tail, shape.ball(), marked ? sec : coat, [0, 0.125, 0.035], 0.032 * f);
      break;
    case 'straight':
      part(tail, shape.capsule(0.024, 0.14), coat, [0, 0.065, -0.055], 1, [-0.75, 0, 0]);
      part(tail, shape.ball(), a.pattern === 'saddle' || marked ? sec : coat, [0, 0.12, -0.11], 0.028);
      break;
    case 'fluffy':
      part(tail, shape.ball(), coat, [0, 0.09, -0.05], [0.06, 0.065, 0.12], [-0.9, 0, 0]);
      part(tail, shape.ball(), marked ? sec : shade(coat, 0.06), [0, 0.155, -0.015], 0.048);
      break;
    case 'short':
      // 코기형: 동그란 솜뭉치 꼬리
      part(tail, shape.ball(), coat, [0, 0.0, -0.005], 0.04);
      part(tail, shape.ball(), marked ? sec : shade(coat, 0.08), [0, 0.01, -0.03], [0.05, 0.05, 0.045]);
      break;
  }

  // ---------- 머리 (몸보다 크게) ----------
  const head = bone(body, 'head', [0, 0.47, 0.2 + dz]);
  const hr: V3 = [0.205 * f, 0.185 * f, 0.175 * f];
  part(head, shape.ball(32, 24), coat, HC, hr);
  if (long) part(head, shape.ball(), coat, [0, 0.06, -0.02], [0.17, 0.11, 0.14]);
  // 얼굴 아래쪽 밝은 털(볼·턱) + 이마 흰 줄
  const len = a.snout === 'short' ? 0.045 : a.snout === 'medium' ? 0.07 : 0.1;
  const muzzleColor = marked || a.breed === 'beagle' ? sec : shade(coat, 0.1);
  if (marked) {
    part(head, shape.ball(), sec, [0, -0.06, 0.04], [0.165 * f, 0.105, 0.13]);
    part(head, shape.ball(), sec, [0, 0.04, 0.12], [0.03, 0.1, 0.045], [-0.3, 0, 0]);
  }
  const mz = 0.105 + len * 0.45;
  const DARK = '#2e2522';
  part(head, shape.ball(), a.marking === 'darkmask' ? DARK : muzzleColor, [0, -0.052, mz], [0.085, 0.064, len + 0.03]);
  // 얼굴 무늬 (사진 분석으로 더 닮게)
  const lightCol = lum(sec) > 0.75 ? sec : '#fbf4ea';
  if (a.marking === 'blaze') {
    // 이마에서 코까지 내려오는 흰 줄
    part(head, shape.ball(), lightCol, [0, 0.06, 0.14], [0.034, 0.12, 0.05], [-0.42, 0, 0]);
    part(head, shape.ball(), lightCol, [0, -0.01, 0.165], [0.05, 0.06, 0.05]);
    part(head, shape.ball(), lightCol, [0, -0.052, mz + 0.004], [0.08, 0.06, len + 0.028]);
  } else if (a.marking === 'eyepatch') {
    const patch = lum(coat) > 0.55 ? (lum(sec) < lum(coat) - 0.15 ? sec : '#6b4a36') : DARK;
    part(head, shape.ball(), patch, onSurface(HC, hr, 0.44, 0.09, 0.9), [0.075, 0.072, 0.024], [0, 0.44, 0]);
  } else if (a.marking === 'darkmask') {
    for (const s of [-1, 1]) part(head, shape.ball(), shade(coat, -0.28), onSurface(HC, hr, s * 0.43, 0.07, 0.905), [0.05, 0.048, 0.035], [0, s * 0.43, 0]);
  }
  if (a.pattern === 'patch') part(head, shape.ball(), sec, onSurface(HC, hr, 0.45, 0.2, 0.93), [0.07, 0.07, 0.04], [0, 0.45, 0]);
  // 코 · 입
  const noseZ = mz + len + 0.022;
  part(head, shape.ball(), NOSE, [0, -0.025, noseZ], [0.03, 0.022, 0.022]);
  part(head, shape.ball(), WHITE, [0.01, -0.016, noseZ + 0.018], 0.006);
  part(head, shape.torus(0.026, 0.0045, Math.PI, 8, 16), '#3a2620', [0, -0.062, noseZ - 0.012], [1.2, 1, 1], [0, 0, Math.PI]);
  // 눈 · 볼터치
  for (const s of [-1, 1]) {
    const eye = onSurface(HC, hr, s * 0.42, 0.06, 0.975);
    part(head, shape.ball(), EYE, eye, [0.031, 0.037, 0.018], [0, s * 0.42, 0]);
    part(head, shape.ball(), WHITE, [eye[0] + 0.009, eye[1] + 0.014, eye[2] + 0.014], 0.0095);
    part(head, shape.ball(), WHITE, [eye[0] - 0.006, eye[1] - 0.012, eye[2] + 0.013], 0.0045);
    part(head, shape.ball(), PINK, onSurface(HC, hr, s * 0.72, -0.24, 0.975), [0.034, 0.022, 0.01], [0, s * 0.72, 0]);
  }
  // 귀
  for (const s of [-1, 1]) {
    const earColor = a.pattern === 'patch' && s > 0 ? sec : a.pattern === 'saddle' || a.breed === 'beagle' ? sec : coat;
    if (a.ear === 'pointy') {
      const g = group(head, [s * 0.105 * f, 0.15 * f, -0.03], [0, 0, -s * 0.1]);
      g.scale.setScalar(es);
      part(g, shape.cone(0.09, 0.23), earColor, [0, 0.09, 0], [1, 1, 0.48]);
      part(g, shape.ball(), earColor, [0, 0.0, 0], [0.085, 0.04, 0.045]);
      part(g, shape.cone(0.064, 0.17), INNER_EAR, [0, 0.08, 0.03], [1, 1, 0.2]);
    } else if (a.ear === 'floppy') {
      part(head, shape.ball(), earColor, [s * (0.17 + 0.006 * es) * f, -0.03 - (es - 1) * 0.04, -0.01], [0.045 * es, (long ? 0.13 : 0.11) * es, 0.075 * es], [0, 0, s * 0.18]);
    } else {
      const g = group(head, [s * 0.11 * f, 0.13 * f, 0.02], [0.75, 0, -s * 0.35]);
      g.scale.setScalar(es);
      part(g, shape.cone(0.06, 0.12), earColor, [0, 0.05, 0], [1, 1, 0.5]);
    }
  }
  // 혀 (뛰거나 인사할 때만 보이도록 별도 관절)
  const tongue = bone(head, 'tongue', [0, -0.09, mz + len * 0.6]);
  part(tongue, shape.ball(), '#f2838f', [0, -0.012, 0.006], [0.022, 0.012, 0.028], [0.5, 0, 0]);
  return root;
}

const cache = templateCache();

export interface DogRig {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  tail: THREE.Object3D;
  tongue: THREE.Object3D;
  legs: THREE.Object3D[];
  anchor: THREE.Object3D;
  /** 다리 길이에 따른 몸 기본 높이 */
  baseY: number;
}

export function createDog(a: DogAvatar): DogRig {
  const root = cache(JSON.stringify(a), () => buildDog(a));
  const g = (n: string) => root.getObjectByName(n)!;
  return {
    root, body: g('body'), head: g('head'), tail: g('tail'), tongue: g('tongue'),
    legs: [g('legFL'), g('legFR'), g('legBL'), g('legBR')], anchor: g('anchor'),
    baseY: Number(root.userData.baseY) || 0,
  };
}
