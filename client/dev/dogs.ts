// 개발용: 견종 프리셋과 세부 특징(얼굴 무늬·귀 크기·체형·몸/다리 길이)을 한 화면에 렌더링
import * as THREE from 'three';
import { createDog } from '../src/game/models/dogModel';
import { BREED_PRESETS, HARNESS_COLORS, type DogAvatar } from '@shared/avatar';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.setClearColor('#ffffff');
r.setScissorTest(true);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#fffaf2', '#efe2cc', 2.2));
const sun = new THREE.DirectionalLight('#fff6e8', 1.1); sun.position.set(2, 4, 5); scene.add(sun);
const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
const h = HARNESS_COLORS[0];
const P = (k: string, extra: Partial<DogAvatar> = {}): DogAvatar => ({ ...BREED_PRESETS[k].dog, harness: h, ...extra });
const list: DogAvatar[] = [
  ...Object.keys(BREED_PRESETS).map((k) => P(k)),
  P('mix', { marking: 'eyepatch', coat: '#f7f1e6', secondary: '#3a302c', pattern: 'none' }),
  P('shiba', { marking: 'darkmask', coat: '#e6b47a' }),
  P('corgi', { legLen: 'long', bodyLen: 'short', earSize: 'small' }),
  P('retriever', { build: 'slim' }),
];
const S = 400, COLS = 4;
(window as any).__count = list.length;
list.forEach((d, i) => {
  const o = createDog(d).root;
  scene.add(o);
  const yaw = 0.75;
  cam.position.set(Math.sin(yaw) * 2.0, 0.55, Math.cos(yaw) * 2.0);
  cam.lookAt(0, 0.36, 0);
  const x = (i % COLS) * S, y = (Math.ceil(list.length / COLS) - 1 - Math.floor(i / COLS)) * S;
  r.setViewport(x, y, S, S); r.setScissor(x, y, S, S);
  r.render(scene, cam);
  scene.remove(o);
});
(window as any).__done = true;
