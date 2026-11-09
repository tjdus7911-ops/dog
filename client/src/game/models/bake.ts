// 파츠 조립 → 관절(bone)별 단일 메시로 병합하는 유틸
// - 캐릭터는 수십 개의 둥근 로우폴리 파츠로 만들지만, 렌더링 시에는 관절 수(약 7개)만큼만 그린다.
// - 병합 결과는 아바타 설정별로 캐시해 같은 모습의 캐릭터·썸네일이 지오메트리를 공유한다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** 모든 캐릭터가 공유하는 재질: 정점 색상 + 플랫 셰이딩(로우폴리 면), 무광 */
export const characterMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

/** 파츠용 기본 도형 (세그먼트 수를 낮게 유지해 면이 보이는 로우폴리 질감) */
export const shape = {
  /** 둥근 덩어리: 이십면체 2단계 분할 — 부드럽지만 면이 살아 있는 형태 */
  blob: (detail = 2) => cached(`blob${detail}`, () => new THREE.IcosahedronGeometry(1, detail)),
  sphere: (w = 10, h = 8) => cached(`sph${w},${h}`, () => new THREE.SphereGeometry(1, w, h)),
  dome: (thetaFrac: number, w = 14, h = 6) => cached(`dome${thetaFrac},${w},${h}`, () => new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, Math.PI * thetaFrac)),
  capsule: (r: number, len: number, cap = 3, radial = 8) => cached(`cap${r},${len},${cap},${radial}`, () => new THREE.CapsuleGeometry(r, len, cap, radial)),
  cyl: (rt: number, rb: number, h: number, seg = 10, open = false) => cached(`cyl${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  cone: (r: number, h: number, seg = 4) => cached(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  torus: (r: number, t: number, arc = Math.PI * 2, rs = 5, ts = 14) => cached(`tor${r},${t},${arc},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  /** 앞머리용: 정면 쪽 구면 조각 (위에서부터 thetaFrac*π 까지) */
  fringe: (thetaFrac: number) => cached(`fr${thetaFrac}`, () => new THREE.SphereGeometry(1, 18, 8, Math.PI / 2 - 1.05, 2.1, 0, Math.PI * thetaFrac)),
  halfDisc: (r: number) => cached(`hd${r}`, () => new THREE.CircleGeometry(r, 8, Math.PI, Math.PI)),
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

/** 타원체 표면 위의 점 (yaw: 좌우, pitch: 상하) — 얼굴 파츠를 머리 표면에 붙일 때 사용 */
export function onSurface(center: V3, radii: V3, yaw: number, pitch: number, k = 1): V3 {
  return [
    center[0] + Math.sin(yaw) * Math.cos(pitch) * radii[0] * k,
    center[1] + Math.sin(pitch) * radii[1] * k,
    center[2] + Math.cos(yaw) * Math.cos(pitch) * radii[2] * k,
  ];
}

const tmpColor = new THREE.Color();

/** 관절별로 하위 파츠를 하나의 지오메트리로 합친다. */
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
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
      rel.multiplyMatrices(inv, m.matrixWorld);
      g.applyMatrix4(rel);
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
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, characterMaterial);
    mesh.name = `${b.name || 'root'}-mesh`;
    b.add(mesh);
  }
  // 빈 보조 그룹 정리
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
      if (map.size > max) {
        const first = map.keys().next().value!;
        const old = map.get(first)!;
        map.delete(first);
        // 다른 인스턴스가 공유 중일 수 있어 즉시 dispose 하지 않는다 (GC 대상)
        void old;
      }
    }
    return t.clone(true);
  };
}

export function findBone(root: THREE.Object3D, name: string) {
  const b = root.getObjectByName(name);
  if (!b) throw new Error(`bone ${name} not found`);
  return b;
}
