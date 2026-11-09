// 옵션 썸네일 렌더러 — 실제 3D 모델에 해당 옵션을 적용해 작은 이미지로 렌더링한다.
// WebGL 컨텍스트 1개를 재사용하고, 요청은 큐에 모아 프레임마다 몇 장씩 처리해 화면이 끊기지 않게 한다.
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { DogAvatar, HumanAvatar } from '@shared/avatar';
import { createHuman } from './models/humanModel';
import { createDog } from './models/dogModel';
import { DOG_SCALE } from './models/Dog';

export type HumanView = 'head' | 'hair' | 'bust' | 'top' | 'bottom' | 'shoes' | 'back';
export type DogView = 'full' | 'head' | 'side' | 'tail';

type Job = { key: string; draw: () => void };

const SIZE = 192;
let renderer: THREE.WebGLRenderer | null = null;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
scene.add(new THREE.HemisphereLight('#fffaf2', '#efe2cc', 2.2));
const sun = new THREE.DirectionalLight('#fff6e8', 1.1);
sun.position.set(2, 4, 5);
scene.add(sun);

const results = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const queue: Job[] = [];
let pumping = false;

function getRenderer() {
  if (!renderer) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
  }
  return renderer;
}

function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const start = performance.now();
    while (queue.length && performance.now() - start < 12) {
      const job = queue.shift()!;
      if (results.has(job.key)) continue;
      try { job.draw(); } catch (e) { console.warn('썸네일 렌더 실패', e); results.set(job.key, ''); }
      listeners.get(job.key)?.forEach((f) => f());
    }
    if (queue.length) requestAnimationFrame(step);
    else pumping = false;
  };
  requestAnimationFrame(step);
}

function capture(key: string, obj: THREE.Object3D, target: THREE.Vector3, dist: number, yaw = 0.35, pitch = 0.12) {
  const r = getRenderer();
  scene.add(obj);
  camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  camera.lookAt(target);
  r.render(scene, camera);
  results.set(key, r.domElement.toDataURL('image/png'));
  scene.remove(obj);
}

function request(key: string, draw: () => void) {
  if (results.has(key) || queue.some((j) => j.key === key)) return;
  queue.push({ key, draw });
  pump();
}

function humanJob(key: string, a: HumanAvatar, view: HumanView) {
  return () => {
    const rig = createHuman(a);
    rig.armR.rotation.z = -0.08;
    const v = new THREE.Vector3();
    switch (view) {
      case 'head': capture(key, rig.root, v.set(0, 1.07, 0), 1.45, 0.3, 0.08); break;
      case 'hair': capture(key, rig.root, v.set(0, 1.0, 0), 1.75, 0.85, 0.1); break;
      case 'bust': capture(key, rig.root, v.set(0, 0.92, 0), 2.05, 0.35, 0.08); break;
      case 'top':
        rig.head.visible = false; rig.legL.visible = false; rig.legR.visible = false;
        capture(key, rig.root, v.set(0, 0.5, 0), 1.25, 0.3, 0.1); break;
      case 'bottom':
        rig.head.visible = false; rig.armL.visible = false; rig.armR.visible = false;
        capture(key, rig.root, v.set(0, 0.28, 0), 1.05, 0.3, 0.12); break;
      case 'shoes':
        rig.head.visible = false;
        capture(key, rig.root, v.set(0, 0.06, 0.02), 0.62, 0.65, 0.35); break;
      case 'back': capture(key, rig.root, v.set(0, 0.75, 0), 2.6, 2.4, 0.15); break;
    }
  };
}

function dogJob(key: string, d: DogAvatar, view: DogView) {
  return () => {
    const rig = createDog(d);
    const holder = new THREE.Group();
    holder.add(rig.root);
    holder.scale.setScalar(DOG_SCALE[d.size]);
    const s = DOG_SCALE[d.size];
    const v = new THREE.Vector3();
    switch (view) {
      case 'full': capture(key, holder, v.set(0, 0.33 * s, 0), 2.0 * s, 0.75, 0.15); break;
      case 'head': capture(key, holder, v.set(0, 0.52 * s, 0.25 * s), 0.95 * s, 0.4, 0.1); break;
      case 'side': capture(key, holder, v.set(0, 0.47 * s, 0.3 * s), 0.95 * s, 1.35, 0.05); break;
      case 'tail': capture(key, holder, v.set(0, 0.36 * s, -0.12 * s), 1.4 * s, 2.3, 0.2); break;
    }
  };
}

function useResult(key: string, schedule: () => void) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(f);
    schedule();
    return () => { listeners.get(key)?.delete(f); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return results.get(key) || null;
}

/** 사람 아바타 썸네일 (data URL, 렌더 전에는 null) */
export function useHumanThumb(a: HumanAvatar, view: HumanView) {
  const key = `h:${view}:${JSON.stringify(a)}`;
  return useResult(key, () => request(key, humanJob(key, a, view)));
}

export function useDogThumb(d: DogAvatar, view: DogView) {
  const key = `d:${view}:${JSON.stringify(d)}`;
  return useResult(key, () => request(key, dogJob(key, d, view)));
}
