// 파츠 조립 → 관절(bone)별 단일 메시로 병합하는 유틸
// - 캐릭터는 수십 개의 둥근 파츠로 만들지만, 렌더링 시에는 관절 수(약 7개)만큼만 그린다.
// - 병합 결과는 아바타 설정별로 캐시해 같은 모습의 캐릭터·썸네일이 지오메트리를 공유한다.
// - v3: 첨부 레퍼런스(말랑한 점토 장난감 질감)에 맞춰 부드러운 셰이딩 사용
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** 모든 캐릭터가 공유하는 재질: 정점 색상 + 부드러운 셰이딩, 무광 점토 느낌 */
export const characterMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

/** 파츠용 기본 도형 — 부드러운 곡면이 나오도록 충분히 분할 */
export const shape = {
  /** 둥근 덩어리 (구) */
  ball: (w = 24, h = 18) => cached(`ball${w},${h}`, () => new THREE.SphereGeometry(1, w, h)),
  /** 위쪽 일부만 있는 구 (thetaFrac*π 까지) */
  dome: (thetaFrac: number, w = 28, h = 12) => cached(`dome${thetaFrac},${w},${h}`, () => new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, Math.PI * thetaFrac)),
  /** 앞쪽 일부 구면 (phi 범위) */
  shell: (phiStart: number, phiLen: number, thetaStart: number, thetaLen: number) =>
    cached(`sh${phiStart},${phiLen},${thetaStart},${thetaLen}`, () => new THREE.SphereGeometry(1, 28, 16, phiStart, phiLen, thetaStart, thetaLen)),
  capsule: (r: number, len: number) => cached(`cap${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 16)),
  cyl: (rt: number, rb: number, h: number, seg = 20, open = false) => cached(`cyl${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  cone: (r: number, h: number, seg = 16) => cached(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  torus: (r: number, t: number, arc = Math.PI * 2, rs = 10, ts = 28) => cached(`tor${r},${t},${arc},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  /** 머리카락 껍질: 구면 일부에 세로 가닥 결(볼록한 줄)을 새긴 형태 */
  hair: (phiStart: number, phiLen: number, thetaLen: number, lobes: number, amp = 0.035) =>
    cached(`hair${phiStart},${phiLen},${thetaLen},${lobes},${amp}`, () => {
      const g = new THREE.SphereGeometry(1, 72, 24, phiStart, phiLen, 0, thetaLen);
      const pos = g.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const theta = Math.acos(Math.max(-1, Math.min(1, v.y)));
        let phi = Math.atan2(v.z, -v.x);
        if (phi < 0) phi += Math.PI * 2;
        const t = (phi - phiStart) / phiLen; // 0~1
        const w = Math.min(1, Math.max(0, (theta - 0.35) / 0.55)); // 위쪽은 매끈, 아래로 갈수록 결이 뚜렷
        const lobe = Math.pow(Math.abs(Math.cos(t * lobes * Math.PI)), 0.6);
        // 아래 끝은 안쪽으로 살짝 말림
        const tuck = Math.max(0, (theta - thetaLen + 0.25) / 0.25);
        const k = 1 + amp * w * lobe - 0.06 * tuck * tuck;
        pos.setXYZ(i, v.x * k, v.y, v.z * k);
      }
      g.computeVertexNormals();
      return g;
    }),
  /** 아래쪽 반원 (웃는 입) */
  halfDisc: (r: number) => cached(`hd${r}`, () => new THREE.CircleGeometry(r, 16, Math.PI, Math.PI)),
  disc: (r: number) => cached(`dc${r}`, () => new THREE.CircleGeometry(r, 20)),
  box: (w: number, h: number, d: number) => cached(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
};

type V3 = [number, number, number];

/** 파츠 추가 헬퍼: parent 아래에 색상 메시를 배치 */
export function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: string, pos: V3 = [0, 0, 0], scale: V3 | number = 1, rot: V3 = [0, 0, 0]) {
  const m = new THREE.Mesh(geo);
  m.userData.color = color;
  m.position.set(...pos);
  typeof scale === 'number' ? m.scale.setScalar(scale) : m.scale.set(...scale);
  m.rotation.set(...rot);
  parent.add(m);
  return m;
}

/** 이름 있는 관절 그룹 생성 */
export function bone(parent: THREE.Object3D, name: string, pos: V3 = [0, 0, 0]) {
  const g = new THREE.Group();
  g.name = name;
  g.userData.bone = true;
  g.position.set(...pos);
  parent.add(g);
  return g;
}

/** 보조 그룹 (병합 시 부모 관절에 합쳐짐) */
export function group(parent: THREE.Object3D, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(...pos);
  g.rotation.set(...rot);
  parent.add(g);
  return g;
}

/** 타원체 표면 위의 점 (yaw: 좌우, pitch: 상하) — 얼굴 파츠를 머리 표면에 붙일 때 사용 */
export function onSurface(center: V3, radii: V3, yaw: number, pitch: number, k = 1): V3 {
  return [
    center[0] + Math.sin(yaw) * Math.cos(pitch) * radii[0] * k,
    center[1] + Math.sin(pitch) * radii[1] * k,
    center[2] + Math.cos(yaw) * Math.cos(pitch) * radii[2] * k,
  ];
}

const tmpColor = new THREE.Color();

/** 관절별로 하위 파츠를 하나의 지오메트리로 합친다 (부드러운 법선 유지). */
export function bake(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const bones: THREE.Object3D[] = [root];
  root.traverse((o) => { if (o !== root && o.userData.bone) bones.push(o); });
  const owner = (o: THREE.Object3D) => {
    let p = o.parent;
    while (p && !p.userData.bone && p !== root) p = p.parent;
    return p ?? root;
  };
  const groups = new Map<THREE.Object3D, THREE.Mesh[]>();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.color) {
      const b = owner(o);
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b)!.push(o as THREE.Mesh);
    }
  });
  const inv = new THREE.Matrix4();
  const rel = new THREE.Matrix4();
  for (const b of bones) {
    const meshes = groups.get(b);
    if (!meshes?.length) continue;
    inv.copy(b.matrixWorld).invert();
    const geos: THREE.BufferGeometry[] = [];
    for (const m of meshes) {
      const g = m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.index) {
        const n = g.attributes.position.count;
        g.setIndex(Array.from({ length: n }, (_, i) => i));
      }
      rel.multiplyMatrices(inv, m.matrixWorld);
      g.applyMatrix4(rel);
      // 음수 스케일(좌우 반전)로 면 방향이 뒤집힌 경우 인덱스 순서 보정
      if (rel.determinant() < 0) {
        const idx = g.index!.array as Uint16Array | Uint32Array;
        for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      }
      tmpColor.set(m.userData.color);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geos.push(g);
      m.removeFromParent();
    }
    const merged = mergeGeometries(geos, false)!;
    geos.forEach((g) => g.dispose());
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, characterMaterial);
    mesh.name = `${b.name || 'root'}-mesh`;
    b.add(mesh);
  }
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.type === 'Group' && !o.userData.bone && o !== root && o.children.length === 0) empty.push(o); });
  empty.forEach((o) => o.removeFromParent());
  return root;
}

/** 설정별 템플릿 캐시 → clone 시 지오메트리 공유 */
export function templateCache(max = 120) {
  const map = new Map<string, THREE.Group>();
  return (key: string, build: () => THREE.Group) => {
    let t = map.get(key);
    if (!t) {
      t = bake(build());
      map.set(key, t);
      if (map.size > max) map.delete(map.keys().next().value!);
    }
    return t.clone(true);
  };
}
