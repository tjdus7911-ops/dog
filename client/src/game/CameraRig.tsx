// 3인칭 추적 카메라 — 수평 360도 회전, 상하 각도 제한, 확대/축소
import type { SpaceKind } from '@shared/spaces';
// PC: 마우스 드래그 회전 / 휠 줌 · 모바일: 한 손가락 드래그 회전 / 두 손가락 핀치 줌
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { local } from './local';
import { readMove } from './input';
import { space } from './space';
import { isTouchDevice } from './input';
import { BUILDINGS, TREES } from '@shared/world';

export const cam = {
  yaw: 0, pitch: 0.36, dist: 10, lastUserInput: 0, pendingReset: null as null | SpaceKind,
  /** 월드 좌표 → 화면 좌표(px) (자동 화면 테스트에서 3D 오브젝트를 실제로 누르기 위해 사용) */
  project: (_x: number, _y: number, _z: number): [number, number, boolean] => [0, 0, false],
};
const MIN_DIST = 3.2, MAX_DIST = 20, MIN_PITCH = 0.08, MAX_PITCH = 1.25;

/**
 * 공원 카메라 기본값 — 기존(거리 7.5)보다 약 35% 멀리, 조금 낮은 각도에서 앞쪽 마을이 넓게 보이게.
 * lookUp: 바라보는 점을 캐릭터 위로 올려 캐릭터가 화면 아래쪽 가운데에 오도록 한다.
 * 세로 화면(모바일)은 가로 폭이 좁아 시야각을 넓히고 조금 더 멀리 둔다.
 */
function parkView() {
  const portrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
  if (portrait) return { dist: 10.4, pitch: 0.34, lookUp: 1.55, fov: 58 };
  if (isTouchDevice()) return { dist: 10, pitch: 0.36, lookUp: 1.1, fov: 52 };
  return { dist: 10, pitch: 0.36, lookUp: 1.0, fov: 50 };
}
const INDOOR_FOV = 50;

/** 카메라와 캐릭터 사이를 막는 건물·나무 (높이 포함) */
const BLOCK_BOXES = BUILDINGS.map((b) => ({ x: b.x, z: b.z, hw: b.w / 2 + 0.3, hd: b.d / 2 + 0.3, h: b.kind === 'apartment' ? 13 : 5.5 }));
const BLOCK_TREES = TREES.map((t) => ({ x: t.x, z: t.z, r: 1.25 * t.scale, y0: 1.2 * t.scale, y1: 4.6 * t.scale }));
/** 바라보는 점(t)에서 카메라 방향으로 나가며 처음 막히는 거리. 막힌 게 없으면 want 그대로 */
function clearDistance(t: THREE.Vector3, dir: THREE.Vector3, want: number) {
  const STEP = 0.35;
  for (let d = 1.2; d <= want; d += STEP) {
    const x = t.x + dir.x * d, y = t.y + dir.y * d, z = t.z + dir.z * d;
    for (const b of BLOCK_BOXES) if (y < b.h && Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd) return Math.max(2.4, d - 0.6);
    for (const c of BLOCK_TREES) {
      if (y < c.y0 || y > c.y1) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return Math.max(2.4, d - 0.6);
    }
  }
  return want;
}

/** 아바타 뒤쪽 방향(base)이 나무·건물에 막혀 있으면 가까운 옆 각도 중 트인 쪽을 고름 (장소 이동 직후 카메라가 머리에 붙지 않게) */
function clearYaw(t: THREE.Vector3, base: number, pitch: number, dist: number) {
  const cp = Math.cos(pitch);
  let best = base, bestD = -1;
  for (const o of [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6, 0.8, -0.8, 1.0, -1.0]) {
    const y = base + o;
    const d = clearDistance(t, new THREE.Vector3(Math.sin(y) * cp, Math.sin(pitch), Math.cos(y) * cp), dist);
    if (d >= dist * 0.85) return y;
    if (d > bestD) { bestD = d; best = y; }
  }
  return best;
}

export function CameraRig() {
  const { camera, gl } = useThree();
  cam.project = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const r = gl.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height, v.z < 1 && v.z > -1];
  };
  const target = useRef(new THREE.Vector3(local.x, 1, local.z));
  const initialized = useRef(false);
  /** 충돌로 줄어든 실제 거리 (부드럽게 따라감) */
  const curDist = useRef(cam.dist);
  const view = useRef(parkView());
  useEffect(() => {
    const onResize = () => { view.current = parkView(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 1) {
        const sens = e.pointerType === 'touch' ? 0.008 : 0.006;
        cam.yaw -= dx * sens;
        cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * sens * 0.8, MIN_PITCH, MAX_PITCH);
        cam.lastUserInput = performance.now();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) cam.dist = THREE.MathUtils.clamp(cam.dist * (pinchDist / d), MIN_DIST, MAX_DIST);
        pinchDist = d;
      }
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.1), MIN_DIST, MAX_DIST);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [gl]);

  useFrame((_, dt) => {
    if (!initialized.current) {
      // 시작 시 아바타 뒤쪽에서 바라보기
      cam.yaw = local.rot + Math.PI;
      cam.dist = view.current.dist; cam.pitch = view.current.pitch;
      curDist.current = cam.dist;
      initialized.current = true;
    }
    if (cam.pendingReset && !local.teleport) {
      // 장소 전환: 카메라 위치·방향 초기화 (실내는 열린 앞쪽 대각선에서 내려다봄)
      const kind = cam.pendingReset;
      cam.pendingReset = null;
      view.current = parkView();
      if (kind === 'park') {
        cam.pitch = view.current.pitch; cam.dist = view.current.dist;
        cam.yaw = clearYaw(new THREE.Vector3(local.x, 1.05 + view.current.lookUp, local.z), local.rot + Math.PI, cam.pitch, cam.dist);
      }
      else { cam.yaw = 0.55; cam.pitch = 0.62; cam.dist = kind === 'home' ? 7.2 : 7.8; }
      cam.lastUserInput = performance.now();
      curDist.current = cam.dist;
      target.current.set(local.x, 1.05 + (kind === 'park' ? view.current.lookUp : 0), local.z);
    }
    // 앞으로 걷는 중이고 최근에 직접 회전하지 않았다면 천천히 아바타 뒤로 정렬 (뒤에서 따라오는 카메라)
    const mv = readMove();
    if (space.kind === 'park' && mv.y > 0.5 && Math.abs(mv.x) < 0.3 && performance.now() - cam.lastUserInput > 1800) {
      const desired = local.rot + Math.PI;
      let d = desired - cam.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      cam.yaw += d * Math.min(1, dt * 1.2);
    }
    local.camYaw = cam.yaw;
    const park = space.kind === 'park';
    const v = view.current;
    // 시야각: 공원은 화면 방향(세로/가로)에 맞춰, 실내는 기본
    const fov = park ? v.fov : INDOOR_FOV;
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(pc.fov - fov) > 0.01) { pc.fov = fov; pc.updateProjectionMatrix(); }
    // 부드럽게 따라가기 (이동 중엔 약간 늦게 따라와 자연스럽게)
    const k = 1 - Math.exp(-dt * 7);
    target.current.lerp(new THREE.Vector3(local.x, 1.05 + (park ? v.lookUp : 0), local.z), k);
    const t = target.current;
    const cp = Math.cos(cam.pitch);
    const dir = new THREE.Vector3(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    // 건물·나무에 가리면 그 앞까지 당기고, 비면 천천히 원래 거리로
    const want = park ? clearDistance(t, dir, cam.dist) : cam.dist;
    curDist.current += (want - curDist.current) * (want < curDist.current ? Math.min(1, dt * 14) : Math.min(1, dt * 2.5));
    const d = curDist.current;
    camera.position.set(t.x + dir.x * d, Math.max(0.5, t.y + dir.y * d), t.z + dir.z * d);
    camera.lookAt(t);
  });

  return null;
}
