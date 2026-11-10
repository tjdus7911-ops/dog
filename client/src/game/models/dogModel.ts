// 강아지 빌더 — 승인된 코기 레퍼런스(큰 머리·둥근 몸·짧은 다리·점토 질감)에 맞춰 제작
// 견종 특징은 미리 만든 파츠(귀·주둥이·꼬리·무늬·털 길이·체형)를 조합해 표현한다. (AI 분석 결과도 같은 값으로 들어옴)
// 관절: body > head, tail, legFL, legFR, legBL, legBR, tongue  /  anchor(하네스 고리 — 목줄 연결점)
import * as THREE from 'three';
import type { DogAvatar } from '@shared/avatar';
import { bone, group, onSurface, part, shape, templateCache } from './bake';
import { shade } from './humanModel';
import { earSlab, mix, noise3, sculptSphere, smooth } from './sculpt';

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
  if (a.breed === 'corgi') return buildCorgi(a);
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
  // 감은 눈 (쓰다듬기 반응·잠자기): 털색으로 눈을 덮고 둥근 선 — 평소에는 숨김
  const lids = bone(head, 'lids');
  for (const s of [-1, 1]) {
    part(lids, shape.ball(14, 10), coat, onSurface(HC, hr, s * 0.42, 0.06, 0.975), [0.036, 0.042, 0.021], [0, s * 0.42, 0]);
    part(lids, shape.torus(0.024, 0.005, Math.PI * 0.8, 6, 14), EYE, onSurface(HC, hr, s * 0.42, 0.05, 1.085), 1, [0, s * 0.42, Math.PI + Math.PI * 0.1]);
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

// ====================================================================================
// 웰시코기 (v4 조형): 하나로 이어진 곡면 몸통·머리, 부드러운 경계의 털 무늬를 정점 색으로 직접 칠함
// ====================================================================================
function buildCorgi(a: DogAvatar): THREE.Group {
  const root = new THREE.Group();
  root.name = 'dog';
  const legD = LEG_EXTRA[a.legLen] ?? 0;
  const dz = BODY_EXTRA[a.bodyLen] ?? 0;
  const w = BUILD_W[a.build] ?? 1;
  // 귀 크기 옵션은 유지하되 코기는 과하지 않게 범위를 좁힘
  const es = 0.92 + ((EAR_SCALE[a.earSize] ?? 1) - 1) * 0.45;
  root.userData.baseY = legD;
  const body = bone(root, 'body', [0, legD, 0]);
  const coat = a.coat, white = a.secondary;
  const coatTop = shade(coat, -0.05), coatLight = shade(coat, 0.07);
  const Z = (z: number) => (z > 0.04 ? z + dz : z < -0.04 ? z - dz : z);

  // ---------- 몸통: 등선은 평평, 가슴은 앞아래로 볼록, 엉덩이는 동그란 한 덩어리 ----------
  const RX = 0.17 * w, RY = 0.15, RZ = 0.25 + dz * 0.95;
  const BC: V3 = [0, 0.27, -0.02];
  const bodyGeo = sculptSphere(`corgiBody${w}${dz}`, (d) => {
    const chest = smooth(0.15, 0.85, d.z) * smooth(0.3, -0.7, d.y);
    const back = smooth(0.35, 0.95, d.y);
    const rump = smooth(-0.3, -0.95, d.z);
    return new THREE.Vector3(
      d.x * (1 + 0.04 * rump - 0.04 * back),
      d.y * (1 - 0.1 * back) - 0.18 * chest + 0.04 * rump * smooth(0, 0.8, d.y),
      d.z * (1 + 0.1 * chest),
    );
  });
  const nz = (p: THREE.Vector3) => noise3(p.x * 9, p.y * 9, p.z * 9) * 0.012;
  part(body, bodyGeo, (p, n) => {
    const belly = smooth(0.215, 0.165, p.y + nz(p));
    const bib = smooth(BC[2] + RZ * 0.42, BC[2] + RZ * 0.72, p.z + nz(p)) * smooth(0.4, 0.3, p.y);
    // 코기 특유의 엉덩이 아래 흰 털 (하트 모양처럼 아래로 갈수록 넓게)
    const rump = smooth(BC[2] - RZ * 0.62, BC[2] - RZ * 0.85, p.z + nz(p)) * smooth(0.3 - Math.abs(p.x) * 0.5, 0.2, p.y);
    let c = mix(coat, coatTop, smooth(0.5, 0.95, n.y) * 0.8);
    c = mix(c, coatLight, smooth(0.0, -0.5, n.y) * 0.5);
    return mix(c, white, Math.max(belly, bib, rump));
  }, BC, [RX, RY, RZ]);

  // 목: 가슴과 머리를 잇는 볼륨 (앞은 흰 털)
  const neckC: V3 = [0, 0.375, Z(0.16)];
  part(body, shape.ball(28, 20), (p) => mix(coat, white, smooth(neckC[2] + 0.01, neckC[2] + 0.06, p.z + nz(p)) * smooth(0.48, 0.4, p.y)), neckC, [0.105 * w, 0.115, 0.105], [-0.35, 0, 0]);
  // 가슴 솜털: 동글동글한 털 뭉치
  part(body, shape.ball(24, 18), white, [0, 0.3, Z(0.2)], [0.072 * w, 0.075, 0.055]);
  // 엉덩이 하트(흰 털) — 뒤에서 보면 코기 특유의 하트 엉덩이


  // 목걸이 + 금색 이름표 + 목줄 고리
  part(body, shape.torus(0.105, 0.018), a.harness, [0, 0.43, Z(0.17)], [w, 1, 1], [Math.PI / 2 - 0.65, 0, 0]);
  const tag = group(body, [0, 0.355, Z(0.265)], [-0.35, 0, 0]);
  part(tag, shape.cyl(0.026, 0.026, 0.01, 20), GOLD, [0, 0, 0], 1, [Math.PI / 2, 0, 0], { gloss: true });
  part(tag, shape.ball(), shade(GOLD, -0.22), [0, -0.003, 0.006], [0.009, 0.007, 0.003]);
  part(body, shape.torus(0.024, 0.007), '#c9c9cf', [0, 0.5, Z(0.1)], 1, [0, Math.PI / 2, 0], { gloss: true });
  const anchor = new THREE.Object3D();
  anchor.name = 'anchor';
  anchor.position.set(0, 0.51, Z(0.1));
  body.add(anchor);

  // ---------- 다리: 짧고 통통, 흰 양말 + 발가락 ----------
  const legs: [string, number, number][] = [['legFL', 0.085, 0.14], ['legFR', -0.085, 0.14], ['legBL', 0.09, -0.16], ['legBR', -0.09, -0.16]];
  for (const [name, x, z] of legs) {
    const leg = bone(body, name, [x * w, 0.19, Z(z)]);
    const front = z > 0;
    const sock = (p: THREE.Vector3) => mix(coat, white, smooth(front ? -0.02 : -0.06, front ? -0.06 : -0.1, p.y - legD + noise3(p.x * 30, 0, p.z * 30) * 0.008));
    // 허벅지·어깨 근육이 몸통과 자연스럽게 이어지도록 큰 타원을 겹침
    // 뒷다리만 허벅지 볼륨을 몸통 안쪽으로 묻어 부드럽게 이어지게 (앞다리는 몸통에서 바로 내려옴)
    if (!front) part(leg, shape.ball(20, 16), coat, [x > 0 ? -0.018 : 0.018, 0.05, -0.005], [0.058 * w, 0.08, 0.078]);
    part(leg, shape.capsule(0.048, 0.07 + legD), sock, [0, -0.06 - legD / 2, 0.003]);
    // 발: 앞이 둥근 콩 모양 + 발가락 홈 3줄
    part(leg, shape.ball(20, 14), white, [0, -0.152 - legD, 0.02], [0.054, 0.032, 0.066]);
    for (const dx of [-0.02, 0, 0.02]) part(leg, shape.ball(8, 6), shade(white, -0.12), [dx, -0.15 - legD, 0.083], [0.0035, 0.014, 0.004]);
  }

  // ---------- 꼬리: 몽실한 솜털 꼬리 ----------
  const tail = bone(body, 'tail', [0, 0.35, BC[2] - RZ + 0.01]);
  part(tail, shape.ball(16, 12), coat, [0, 0.01, -0.02], [0.05, 0.05, 0.05]);
  part(tail, shape.ball(16, 12), coatLight, [0, 0.03, -0.045], [0.042, 0.042, 0.04]);

  // ---------- 머리: 주둥이가 이어진 한 덩어리 곡면 ----------
  const head = bone(body, 'head', [0, 0.465, 0.205 + dz]);
  const hr: V3 = [0.178, 0.16, 0.158];
  const len = a.snout === 'short' ? 0.3 : a.snout === 'medium' ? 0.42 : 0.58;
  const M = new THREE.Vector3(0, -0.42, 1).normalize();
  const headGeo = sculptSphere(`corgiHead${len}`, (d) => {
    const t = smooth(0.5, 0.97, d.dot(M));
    const cheek = smooth(-0.05, -0.55, d.y) * smooth(0.3, 0.8, Math.abs(d.x));
    const v = d.clone();
    v.x *= (1 - 0.38 * t) * (1 + 0.06 * cheek);
    v.y *= 1 - 0.18 * t;
    v.addScaledVector(M, len * t * t);
    // 이마는 살짝 둥글게 솟고, 주둥이 위(스톱)는 살짝 들어감
    v.y += 0.04 * smooth(0.55, 0.95, d.y) * smooth(0.0, 0.6, d.z);
    return v;
  });
  // 칠하기 기준: 머리 좌표 → 단위 방향
  const blushPts = [-1, 1].map((s) => new THREE.Vector3(s * 0.112, -0.062, 0.105));
  part(head, headGeo, (p) => {
    const u = new THREE.Vector3(p.x / hr[0], p.y / hr[1], p.z / hr[2]);
    const r = u.length();
    const dir = u.clone().normalize();
    const muzzle = smooth(0.86, 0.93, dir.dot(M) + nz(p) * 3) * smooth(0.95, 1.05, r * 0.98 + 0.06);
    const lowFront = smooth(-0.4, -0.65, dir.y) * smooth(0.3, 0.7, dir.z);
    const blazeW = 0.035 + 0.03 * smooth(0.2, -0.15, p.y);
    const blaze = smooth(blazeW + 0.012, blazeW - 0.004, Math.abs(p.x)) * smooth(0.0, 0.08, p.z) * smooth(0.2, 0.12, p.y);
    let c = mix(coat, coatTop, smooth(0.4, 0.95, dir.y) * 0.7);
    c = mix(c, white, Math.max(muzzle, lowFront, blaze));
    for (const b of blushPts) c = mix(c, '#f7a6a0', (1 - smooth(0.015, 0.05, p.distanceTo(b))) * 0.55);
    return c;
  }, [0, 0, 0], hr);
  // 코: 반짝이는 둥근 세모 코 + 하이라이트
  const tip = M.clone().multiplyScalar(1 + len * 0.98);
  const nosePos: V3 = [0, tip.y * hr[1] * 0.82 + 0.012, tip.z * hr[2]];
  part(head, shape.ball(20, 14), NOSE, nosePos, [0.025, 0.019, 0.018], [0.25, 0, 0], { gloss: true });
  part(head, shape.ball(8, 6), WHITE, [nosePos[0], nosePos[1] + 0.009, nosePos[2] + 0.014], [0.007, 0.004, 0.003]);
  // 입: 코 아래 'ㅅ' 선 + 웃는 입꼬리 두 개
  // 입: 단순한 'ω' 미소 (코 바로 아래 작은 두 곡선)
  const mouthY = nosePos[1] - 0.03, mouthZ = nosePos[2] - 0.01;
  for (const s of [-1, 1]) part(head, shape.torus(0.013, 0.0035, Math.PI * 0.85, 6, 14), '#4a3028', [s * 0.0125, mouthY, mouthZ], 1, [-0.25, s * 0.3, Math.PI + 0.22]);
  // 눈: 좌우 대칭의 반짝이는 검은 눈 (머리 표면에 거의 붙여 튀어나오지 않게) + 작은 하이라이트
  for (const s of [-1, 1]) {
    const yaw = s * 0.4, pitch = 0.1;
    // 표면 방향(좌우 yaw → 위아래 pitch 순)으로 눕혀 붙여야 눈 모양이 찌그러지지 않음
    const eg = group(head, onSurface([0, 0, 0], hr, yaw, pitch, 1.0), [0, yaw, 0]);
    part(eg, shape.ball(20, 16), EYE, [0, 0, 0], [0.026, 0.03, 0.012], [-pitch, 0, 0], { gloss: true });
    part(head, shape.ball(10, 8), WHITE, onSurface([0, 0, 0], hr, yaw + s * 0.035, pitch + 0.07, 1.035), [0.0085, 0.009, 0.004], [0, yaw, 0]);
  }
  // 감은 눈 (쓰다듬기 반응·잠자기)
  const lids = bone(head, 'lids');
  for (const s of [-1, 1]) {
    const yaw = s * 0.4, pitch = 0.1;
    part(lids, shape.ball(14, 10), mix(coat, coatTop, 0.25).getStyle(), onSurface([0, 0, 0], hr, yaw, pitch, 1.0), [0.03, 0.034, 0.016], [-pitch, yaw, 0]);
    part(lids, shape.torus(0.02, 0.0048, Math.PI * 0.8, 6, 14), EYE, onSurface([0, 0, 0], hr, yaw, pitch - 0.01, 1.1), 1, [-pitch, yaw, Math.PI + Math.PI * 0.1]);
  }
  // 귀: 크게 쫑긋 선 둥근 삼각형 (두께·오목함 있음) + 안쪽 분홍 털
  for (const s of [-1, 1]) {
    // 귀: 적당한 크기의 둥근 삼각형, 머리 위 옆에서 살짝 바깥으로 기울어짐
    const g = group(head, [s * 0.088, 0.105, -0.035], [-0.15, s * -0.2, s * -0.32]);
    g.scale.setScalar(es);
    part(g, earSlab(0.112, 0.135, 0.014, 0.28), shade(coat, -0.02), [0, 0, 0]);
    part(g, earSlab(0.068, 0.088, 0.005, 0.28), (p) => mix(INNER_EAR, '#fff1ea', smooth(0.0, 0.07, p.y - 0.08)), [0, 0.014, 0.015]);
  }
  // 혀 (뛰거나 인사할 때만 보이도록 별도 관절)
  const tongue = bone(head, 'tongue', [0, mouthY - 0.01, mouthZ - 0.005]);
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
  /** 감은 눈 */
  lids: THREE.Object3D;
  /** 다리 길이에 따른 몸 기본 높이 */
  baseY: number;
}

export function createDog(a: DogAvatar): DogRig {
  const root = cache(JSON.stringify(a), () => buildDog(a));
  const g = (n: string) => root.getObjectByName(n)!;
  return {
    root, body: g('body'), head: g('head'), tail: g('tail'), tongue: g('tongue'),
    legs: [g('legFL'), g('legFR'), g('legBL'), g('legBR')], anchor: g('anchor'), lids: g('lids'),
    baseY: Number(root.userData.baseY) || 0,
  };
}
