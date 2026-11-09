// 귀여운 로우폴리 강아지 빌더 — 큰 머리, 둥근 몸, 짧은 다리
// 견종 특징은 미리 만든 파츠(귀·주둥이·꼬리·무늬·털 길이·체형)를 조합해 표현한다. (AI 분석 결과도 같은 값으로 들어옴)
// 관절: body > head, tail, legFL, legFR, legBL, legBR, tongue  /  anchor(하네스 고리 — 목줄 연결점)
import * as THREE from 'three';
import type { DogAvatar } from '@shared/avatar';
import { bone, onSurface, part, shape, templateCache } from './bake';
import { shade } from './humanModel';

type V3 = [number, number, number];
const EYE = '#231a17';
const NOSE = '#2e2420';
const WHITE = '#ffffff';
const PINK = '#f4a7a7';
const GOLD = '#f2c14e';

const HEAD_C: V3 = [0, 0, 0];

function buildDog(a: DogAvatar): THREE.Group {
  const root = new THREE.Group();
  root.name = 'dog';
  const body = bone(root, 'body');
  const long = a.fur === 'long';
  const coat = a.coat;
  const sec = a.secondary;
  const white = a.pattern === 'mask' || a.pattern === 'socks';
  const fluff = long ? 1.12 : 1;

  // ---------- 몸통 ----------
  part(body, shape.blob(2), coat, [0, 0.29, -0.02], [0.17 * fluff, 0.155 * fluff, 0.26 * fluff]);
  // 가슴 (목과 몸을 자연스럽게 잇는 볼륨)
  part(body, shape.blob(2), white ? sec : coat, [0, 0.33, 0.15], [0.14 * fluff, 0.15 * fluff, 0.13 * fluff]);
  if (white) part(body, shape.blob(1), sec, [0, 0.22, 0.02], [0.12, 0.08, 0.2]);
  if (long) {
    // 장모: 목 주변 풍성한 털
    part(body, shape.blob(1), coat, [0, 0.4, 0.15], [0.17, 0.13, 0.12]);
    if (white) part(body, shape.blob(1), sec, [0, 0.36, 0.23], [0.12, 0.11, 0.06]);
  }
  if (a.pattern === 'saddle') part(body, shape.blob(2), sec, [0, 0.36, -0.05], [0.165, 0.09, 0.21]);
  if (a.pattern === 'patch') {
    part(body, shape.blob(1), sec, [0.12, 0.34, -0.08], [0.07, 0.08, 0.1]);
    part(body, shape.blob(1), sec, [-0.09, 0.39, 0.02], [0.06, 0.05, 0.07]);
  }
  // 목걸이 + 하네스 + 이름표
  const h = a.harness;
  part(body, shape.torus(0.105, 0.017, Math.PI * 2, 4, 16), h, [0, 0.42, 0.2], [1, 1, 1], [Math.PI / 2 - 0.55, 0, 0]);
  part(body, shape.cyl(0.028, 0.028, 0.012, 10), GOLD, [0, 0.355, 0.285], 1, [Math.PI / 2 - 0.35, 0, 0]);
  part(body, shape.sphere(6, 4), shade(GOLD, -0.2), [0, 0.357, 0.292], [0.011, 0.009, 0.004]);
  // 가슴 둘레 하네스 밴드 (몸통 단면에 맞춘 타원)
  part(body, shape.torus(0.158 * fluff, 0.018, Math.PI * 2, 4, 18), h, [0, 0.29, 0.06], [1, 0.95, 1]);
  part(body, shape.blob(1), h, [0, 0.29 + 0.16 * fluff, 0.08], [0.05, 0.02, 0.06]);
  part(body, shape.torus(0.025, 0.008, Math.PI * 2, 4, 10), '#c9c9cf', [0, 0.31 + 0.16 * fluff, 0.08], 1, [0, Math.PI / 2, 0]);
  const anchor = new THREE.Object3D();
  anchor.name = 'anchor';
  anchor.position.set(0, 0.33 + 0.16 * fluff, 0.08);
  body.add(anchor);

  // ---------- 다리 ----------
  const legs: [string, number, number][] = [['legFL', 0.085, 0.13], ['legFR', -0.085, 0.13], ['legBL', 0.085, -0.15], ['legBR', -0.085, -0.15]];
  for (const [name, x, z] of legs) {
    const leg = bone(body, name, [x, 0.2, z]);
    const front = z > 0;
    part(leg, shape.capsule(0.045 * fluff, 0.09, 3, 8), coat, [0, -0.075, 0]);
    if (!front) part(leg, shape.blob(1), coat, [0, 0.02, -0.01], [0.07, 0.08, 0.08]);
    part(leg, shape.blob(1), white || a.pattern === 'saddle' ? sec : shade(coat, 0.04), [0, -0.165, 0.018], [0.052, 0.036, 0.065]);
    if (long) part(leg, shape.blob(1), coat, [0, -0.11, -0.012], [0.05, 0.05, 0.05]);
  }

  // ---------- 꼬리 ----------
  const tail = bone(body, 'tail', [0, 0.36, -0.26]);
  switch (a.tail) {
    case 'curl':
      part(tail, shape.torus(0.065, 0.034 * fluff, Math.PI * 1.55, 5, 10), coat, [0, 0.075, -0.01], 1, [0, Math.PI / 2, 0.4]);
      part(tail, shape.blob(1), white ? sec : coat, [0, 0.13, 0.04], 0.034 * fluff);
      break;
    case 'straight':
      part(tail, shape.capsule(0.026, 0.15, 3, 6), coat, [0, 0.07, -0.06], 1, [-0.75, 0, 0]);
      part(tail, shape.blob(1), a.pattern === 'saddle' ? sec : coat, [0, 0.13, -0.12], 0.03);
      break;
    case 'fluffy':
      part(tail, shape.blob(2), coat, [0, 0.1, -0.05], [0.065, 0.07, 0.13], [-0.9, 0, 0]);
      part(tail, shape.blob(1), white ? sec : shade(coat, 0.05), [0, 0.17, -0.02], 0.05);
      break;
    case 'short':
      part(tail, shape.blob(1), coat, [0, 0.01, -0.02], 0.04);
      break;
  }

  // ---------- 머리 (몸보다 크게 — 귀여운 비율) ----------
  const head = bone(body, 'head', [0, 0.5, 0.22]);
  const hr: V3 = [0.165 * fluff, 0.15 * fluff, 0.15 * fluff];
  part(head, shape.blob(2), coat, HEAD_C, hr);
  if (long) part(head, shape.blob(1), coat, [0, 0.07, -0.02], [0.15, 0.1, 0.13]);
  // 주둥이
  const len = a.snout === 'short' ? 0.055 : a.snout === 'medium' ? 0.085 : 0.12;
  const muzzle = white || a.breed === 'beagle' ? sec : shade(coat, 0.1);
  const mz = 0.1 + len * 0.55;
  part(head, shape.blob(2), muzzle, [0, -0.05, mz], [0.085, 0.065, len]);
  if (white) {
    // 얼굴 가운데 흰 줄무늬와 볼
    part(head, shape.blob(1), sec, [0, 0.03, 0.13], [0.035, 0.08, 0.04], [-0.4, 0, 0]);
    for (const s of [-1, 1]) part(head, shape.blob(1), sec, [s * 0.07, -0.05, 0.1], [0.06, 0.05, 0.05]);
  }
  if (a.pattern === 'patch') part(head, shape.blob(1), sec, onSurface(HEAD_C, hr, 0.45, 0.2, 0.92), [0.07, 0.07, 0.04], [0, 0.45, 0]);
  // 코 · 입
  part(head, shape.blob(1), NOSE, [0, -0.018, mz + len * 0.93], [0.028, 0.02, 0.02]);
  part(head, shape.sphere(6, 4), WHITE, [0.008, -0.01, mz + len * 0.93 + 0.017], 0.006);
  part(head, shape.halfDisc(0.022), '#5a3a33', [0, -0.07, mz + len * 0.75], [1.3, 0.8, 1], [0.15, 0, 0]);
  // 눈 · 볼터치
  for (const s of [-1, 1]) {
    const eye = onSurface(HEAD_C, hr, s * 0.48, 0.08, 0.95);
    part(head, shape.sphere(8, 6), EYE, eye, [0.03, 0.036, 0.022], [0, s * 0.48, 0]);
    part(head, shape.sphere(6, 4), WHITE, [eye[0] + s * 0.008 + 0.006, eye[1] + 0.014, eye[2] + 0.014], 0.009);
    part(head, shape.sphere(8, 4), PINK, onSurface(HEAD_C, hr, s * 0.82, -0.25, 0.96), [0.035, 0.02, 0.012], [0, s * 0.82, 0]);
  }
  // 귀
  for (const s of [-1, 1]) {
    const earColor = a.pattern === 'patch' && s > 0 ? sec : a.pattern === 'saddle' || a.breed === 'beagle' ? sec : coat;
    if (a.ear === 'pointy') {
      const p: V3 = [s * 0.095 * fluff, 0.13 * fluff, -0.015];
      part(head, shape.cone(0.065, 0.15, 4), earColor, p, [1, 1, 0.55], [0, Math.PI / 4, -s * 0.28]);
      part(head, shape.cone(0.04, 0.1, 4), PINK, [p[0] - s * 0.004, p[1] - 0.01, p[2] + 0.017], [1, 1, 0.3], [0, Math.PI / 4, -s * 0.28]);
    } else if (a.ear === 'floppy') {
      part(head, shape.blob(1), earColor, [s * 0.155 * fluff, -0.02, -0.01], [0.045, long ? 0.13 : 0.11, 0.075], [0, 0, s * 0.18]);
    } else {
      part(head, shape.cone(0.06, 0.11, 4), earColor, [s * 0.1 * fluff, 0.13 * fluff, 0.02], [1, 1, 0.55], [0.9, Math.PI / 4, -s * 0.35]);
    }
  }
  // 혀 (뛰거나 인사할 때만 보이도록 별도 관절)
  const tongue = bone(head, 'tongue', [0, -0.085, mz + len * 0.65]);
  part(tongue, shape.blob(1), '#f28b9b', [0, -0.012, 0.005], [0.024, 0.012, 0.03], [0.5, 0, 0]);
  return root;
}

const cache = templateCache();

export interface DogRig {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  tail: THREE.Object3D;
  tongue: THREE.Object3D;
  legs: THREE.Object3D[]; // FL, FR, BL, BR
  anchor: THREE.Object3D;
}

export function createDog(a: DogAvatar): DogRig {
  const root = cache(JSON.stringify(a), () => buildDog(a));
  const g = (n: string) => root.getObjectByName(n)!;
  return {
    root, body: g('body'), head: g('head'), tail: g('tail'), tongue: g('tongue'),
    legs: [g('legFL'), g('legFR'), g('legBL'), g('legBR')], anchor: g('anchor'),
  };
}
