// 로우폴리 공용 재질·지오메트리 캐시
// - 모든 오브젝트는 flatShading Lambert 재질(무광, PBR 미사용)로 통일해 면이 또렷한 로우폴리 질감을 만든다.
// - 같은 색/형태는 하나의 재질·지오메트리를 공유해 GPU 메모리와 드로우 비용을 줄인다.
import * as THREE from 'three';

const mats = new Map<string, THREE.MeshLambertMaterial>();
export function mat(color: string) {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    mats.set(color, m);
  }
  return m;
}

const geos = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) { g = make(); geos.set(key, g); }
  return g;
}

export const geo = {
  box: (w: number, h: number, d: number) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  ico: (r: number, detail = 0) => cached(`i${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail)),
  dodeca: (r: number) => cached(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
  cyl: (rt: number, rb: number, h: number, seg = 6) => cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
  cone: (r: number, h: number, seg = 6) => cached(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  sphere: (r: number, w = 7, h = 5, thetaLen = Math.PI) =>
    cached(`s${r},${w},${h},${thetaLen}`, () => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, thetaLen)),
  torus: (r: number, t: number, arc = Math.PI * 2, rs = 4, ts = 8) => cached(`t${r},${t},${arc},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  circle: (r: number, seg = 10) => cached(`o${r},${seg}`, () => new THREE.CircleGeometry(r, seg)),
  ring: (ri: number, ro: number, seg = 40) => cached(`r${ri},${ro},${seg}`, () => new THREE.RingGeometry(ri, ro, seg, 1)),
};

/** 캐릭터 발밑 원형 그림자 (실시간 그림자맵 대신 사용 — 가볍고 부드러운 표현) */
export const blobShadowMat = new THREE.MeshBasicMaterial({ color: '#4a3b2a', transparent: true, opacity: 0.1, depthWrite: false });

export const PALETTE = {
  grass: '#a9d38f',
  grassDark: '#8fc27a',
  path: '#efe0c6',
  pathEdge: '#e2cfae',
  stone: '#d9d2c7',
  stoneDark: '#c3b9ab',
  water: '#8fd3e8',
  wood: '#b98559',
  woodDark: '#9a6b44',
  trunk: '#9b6a45',
  cherry: ['#f7b8c8', '#f4a6b8', '#fac9d5'],
  leaf: ['#8fc27a', '#7cb36b', '#a3cf8a'],
  pine: ['#6fa36b', '#5f955d'],
  flower: ['#ffffff', '#f6c453', '#f4a6b8', '#f39a7b', '#b59ad6'],
};
