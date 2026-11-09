// 목줄 — 사람 손과 강아지 하네스를 잇는 베를레(Verlet) 로프
// 양 끝을 매 프레임 고정하고 중력 + 길이 제약으로 자연스럽게 처지고 따라오게 한다.
import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const SEGMENTS = 12;
export const LEASH_LENGTH = 2.9;

export function Leash({ from, to, color = '#f6c453' }: { from: MutableRefObject<THREE.Object3D | null>; to: MutableRefObject<THREE.Object3D | null>; color?: string }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const pts = useMemo(() => Array.from({ length: SEGMENTS + 1 }, () => ({ p: new THREE.Vector3(), o: new THREE.Vector3() })), []);
  const ready = useRef(false);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), d: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  const material = useMemo(() => new THREE.MeshLambertMaterial({ color, flatShading: true }), [color]);
  const geometry = useMemo(() => new THREE.CylinderGeometry(0.018, 0.018, 1, 4, 1), []);

  useFrame((_, rawDt) => {
    if (!from.current || !to.current) return;
    const dt = Math.min(rawDt, 1 / 30);
    const { a, b } = tmp;
    from.current.getWorldPosition(a);
    to.current.getWorldPosition(b);
    if (!ready.current || a.distanceTo(pts[0].p) > 5) {
      pts.forEach((pt, i) => { pt.p.lerpVectors(a, b, i / SEGMENTS); pt.o.copy(pt.p); });
      ready.current = true;
    }
    const rest = LEASH_LENGTH / SEGMENTS;
    // 적분
    for (let i = 1; i < SEGMENTS; i++) {
      const pt = pts[i];
      const vx = (pt.p.x - pt.o.x) * 0.96, vy = (pt.p.y - pt.o.y) * 0.96, vz = (pt.p.z - pt.o.z) * 0.96;
      pt.o.copy(pt.p);
      pt.p.x += vx; pt.p.y += vy - 9.8 * dt * dt; pt.p.z += vz;
      if (pt.p.y < 0.02) pt.p.y = 0.02; // 땅을 뚫지 않게
    }
    pts[0].p.copy(a); pts[SEGMENTS].p.copy(b);
    // 길이 제약
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < SEGMENTS; i++) {
        const p1 = pts[i].p, p2 = pts[i + 1].p;
        tmp.d.subVectors(p2, p1);
        const len = tmp.d.length() || 1e-4;
        const diff = (len - rest) / len;
        if (diff < 0) continue; // 로프는 늘어나지 않을 뿐, 줄어드는 것은 허용(처짐)
        const w1 = i === 0 ? 0 : 0.5, w2 = i + 1 === SEGMENTS ? 0 : 0.5;
        const tot = w1 + w2 || 1;
        p1.addScaledVector(tmp.d, (diff * w1) / tot);
        p2.addScaledVector(tmp.d, (-diff * w2) / tot);
      }
    }
    // 렌더: 세그먼트마다 얇은 원통
    for (let i = 0; i < SEGMENTS; i++) {
      const p1 = pts[i].p, p2 = pts[i + 1].p;
      tmp.d.subVectors(p2, p1);
      const len = tmp.d.length();
      tmp.q.setFromUnitVectors(tmp.up, tmp.d.normalize());
      tmp.s.set(1, len + 0.01, 1);
      tmp.m.compose(tmp.a.addVectors(p1, p2).multiplyScalar(0.5), tmp.q, tmp.s);
      mesh.current.setMatrixAt(i, tmp.m);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, SEGMENTS]} frustumCulled={false} />;
}
