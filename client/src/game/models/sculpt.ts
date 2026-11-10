// 코드로 만드는 곡면 도형 — 구·박스 조합을 넘어 자연스러운 형태를 만들기 위한 도구
// - strand: 곡선을 따라 굵기가 줄어드는 납작한 가닥 (머리카락·털 뭉치)
// - sculptSphere: 정점을 함수로 밀고 당긴 구 (주둥이가 이어진 강아지 머리, 볼살 있는 얼굴)
// - lathe: 단면 곡선을 회전시킨 매끈한 몸통·분수대
// - roundedShapeSlab: 둥근 모서리 판을 두께 있게 뽑아 휘게 만든 귀
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];
const cache = new Map<string, THREE.BufferGeometry>();
function memo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = cache.get(key) as T | undefined;
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}

/**
 * 가닥: points를 지나는 부드러운 곡선을 따라 타원 단면 튜브를 만든다.
 * r0→r1로 가늘어지고 끝은 둥글게 모인다. flat<1이면 바깥(center 반대) 방향으로 납작해져 머리에 붙어 보인다.
 */
export function strand(points: V3[], r0: number, r1: number, opts: { center?: V3; flat?: number; seg?: number; radial?: number } = {}) {
  const key = `st${JSON.stringify(points)}${r0},${r1},${JSON.stringify(opts)}`;
  return memo(key, () => {
    const seg = opts.seg ?? 18, radial = opts.radial ?? 10, flat = opts.flat ?? 1;
    const center = new THREE.Vector3(...(opts.center ?? [0, 0, 0]));
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    const pos: number[] = [], idx: number[] = [];
    const P = new THREE.Vector3(), T = new THREE.Vector3(), out = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      curve.getPointAt(u, P);
      curve.getTangentAt(u, T).normalize();
      out.copy(P).sub(center);
      if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
      out.normalize();
      side.crossVectors(T, out);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      up.crossVectors(side, T).normalize();
      // 굵기: 시작은 두툼, 끝은 둥글게 모임
      const taper = r0 + (r1 - r0) * Math.pow(u, 0.9);
      const tip = u > 0.86 ? Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.86) / 0.14, 2))) : 1;
      const r = Math.max(0.0005, taper * tip);
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const cx = Math.cos(a) * r, cy = Math.sin(a) * r * flat;
        pos.push(P.x + side.x * cx + up.x * cy, P.y + side.y * cx + up.y * cy, P.z + side.z * cx + up.z * cy);
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

/** 정점을 함수로 조형한 단위 구 (반지름 1 기준 방향 d를 받아 새 위치를 돌려준다) */
export function sculptSphere(key: string, fn: (d: THREE.Vector3) => THREE.Vector3, w = 48, h = 36) {
  return memo(`sc${key}${w},${h}`, () => {
    const g = new THREE.SphereGeometry(1, w, h);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const r = fn(v.clone());
      pos.setXYZ(i, r.x, r.y, r.z);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** 단면 [반지름, 높이] 를 회전시킨 매끈한 회전체 */
export function lathe(key: string, profile: [number, number][], seg = 40) {
  return memo(`la${key}${seg}`, () => {
    const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
    const g = new THREE.LatheGeometry(pts, seg);
    g.computeVertexNormals();
    return g;
  });
}

/** 부드러운 곡선 단면: 몇 개의 점을 Catmull-Rom으로 이어 촘촘한 lathe 단면을 만든다 */
export function smoothProfile(points: [number, number][], n = 28): [number, number][] {
  const c = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return c.getPoints(n).map((p) => [p.x, p.y]);
}

/**
 * 둥근 삼각형 판(귀): 너비 w, 높이 h, 두께 t. 모서리를 둥글게 깎고(bevel) 안쪽으로 오목하게 휜다(cup).
 * 원점은 아래 가운데, 앞면은 +z.
 */
export function earSlab(w: number, h: number, t: number, cup = 0.35, tipRound = 0.3) {
  return memo(`ear${w},${h},${t},${cup},${tipRound}`, () => {
    const s = new THREE.Shape();
    const tr = Math.min(w, h) * tipRound * 0.3;
    s.moveTo(-w / 2, 0);
    s.quadraticCurveTo(-w * 0.42, h * 0.55, -tr, h - tr * 0.6);
    s.quadraticCurveTo(0, h + tr * 0.25, tr, h - tr * 0.6);
    s.quadraticCurveTo(w * 0.42, h * 0.55, w / 2, 0);
    s.quadraticCurveTo(0, -h * 0.06, -w / 2, 0);
    let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: t * 0.6, bevelSize: t * 0.7, bevelSegments: 5, curveSegments: 22 });
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-5);
    g.translate(0, 0, -t / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      // 가운데가 오목한 컵 모양 + 위로 갈수록 살짝 앞으로 숙임
      const nx = x / (w / 2);
      pos.setZ(i, pos.getZ(i) + cup * t * 6 * (nx * nx) - (y / h) * (y / h) * t * 1.2);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** 부드러운 경계: a~b 사이에서 0→1 */
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 두 색 섞기 */
const ca = new THREE.Color(), cb = new THREE.Color();
export function mix(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number) {
  return ca.set(a).lerp(cb.set(b), Math.min(1, Math.max(0, t))).clone();
}

/** 결정적인 작은 노이즈 (무늬 경계를 자연스럽게 흔들 때) */
export function noise3(x: number, y: number, z: number) {
  return Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 0.5 + Math.sin(x * 5.1 - z * 7.3 + y * 3.7) * 0.5;
}
