// 개발용: 레퍼런스와 같은 각도(정면·측면·후면)로 모델을 렌더링하는 비교 화면
import * as THREE from 'three';
import { createHuman } from '../src/game/models/humanModel';
import { createDog } from '../src/game/models/dogModel';
import { BREED_PRESETS, DEFAULT_HUMAN, HARNESS_COLORS, type HumanAvatar } from '@shared/avatar';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.setClearColor('#ffffff');
r.setScissorTest(true);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#fffaf2', '#efe2cc', 2.2));
const sun = new THREE.DirectionalLight('#fff6e8', 1.1); sun.position.set(2, 4, 5); scene.add(sun);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);

const base: HumanAvatar = { ...DEFAULT_HUMAN, skin: '#ffe0c7', top: 'hoodie', topColor: '#f3e3c3', bottom: 'shorts', bottomColor: '#5b7fb8', shoes: 'sneaker', shoeColor: '#ffffff', hat: 'none', accessory: 'none' };
const W = 600, H = 600;
// 각 행: [대상 생성, 카메라 중심 y, 화면 반높이]
const rows: [() => THREE.Object3D, number, number, (o: THREE.Object3D) => void][] = [
  [() => { return createHuman(base, true).root; }, 0.66, 0.72, (o) => hideHair(o)],
  [() => createHuman({ ...base, hairStyle: 'bob', hairColor: '#cbbcb0' }).root, 1.02, 0.42, () => {}],
  [() => createHuman({ ...base, hairStyle: 'bob', hairColor: '#6b4127', hat: 'cap', hatColor: '#f3e3c3' }).root, 1.05, 0.42, () => {}],
  [() => createDog({ ...BREED_PRESETS.corgi.dog, harness: HARNESS_COLORS[0] }).root, 0.32, 0.38, () => {}],
];
function hideHair(_o: THREE.Object3D) {}
const views = [0, -Math.PI / 2, Math.PI];
rows.forEach(([make, cy, half, after], ri) => {
  views.forEach((yaw, vi) => {
    const o = make(); after(o);
    o.rotation.y = -yaw;
    scene.add(o);
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix();
    cam.position.set(0, cy, 5); cam.lookAt(0, cy, 0);
    const x = vi * W, y = (rows.length - 1 - ri) * H;
    r.setViewport(x, y, W, H); r.setScissor(x, y, W, H);
    r.render(scene, cam);
    scene.remove(o);
  });
});
(window as any).__done = true;
