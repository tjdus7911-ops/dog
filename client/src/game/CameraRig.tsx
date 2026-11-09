// 3인칭 추적 카메라 — 수평 360도 회전, 상하 각도 제한, 확대/축소
// PC: 마우스 드래그 회전 / 휠 줌 · 모바일: 한 손가락 드래그 회전 / 두 손가락 핀치 줌
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { local } from './local';
import { readMove } from './input';

export const cam = { yaw: 0, pitch: 0.42, dist: 7.5, lastUserInput: 0 };
const MIN_DIST = 3.2, MAX_DIST = 16, MIN_PITCH = 0.08, MAX_PITCH = 1.25;

export function CameraRig() {
  const { camera, gl } = useThree();
  const target = useRef(new THREE.Vector3(local.x, 1, local.z));
  const initialized = useRef(false);

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
      initialized.current = true;
    }
    // 앞으로 걷는 중이고 최근에 직접 회전하지 않았다면 천천히 아바타 뒤로 정렬 (뒤에서 따라오는 카메라)
    const mv = readMove();
    if (mv.y > 0.5 && Math.abs(mv.x) < 0.3 && performance.now() - cam.lastUserInput > 1800) {
      const desired = local.rot + Math.PI;
      let d = desired - cam.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      cam.yaw += d * Math.min(1, dt * 1.2);
    }
    local.camYaw = cam.yaw;
    const k = 1 - Math.exp(-dt * 10);
    target.current.lerp(new THREE.Vector3(local.x, 1.05, local.z), k);
    const t = target.current;
    const cp = Math.cos(cam.pitch);
    camera.position.set(
      t.x + Math.sin(cam.yaw) * cam.dist * cp,
      Math.max(0.5, t.y + Math.sin(cam.pitch) * cam.dist),
      t.z + Math.cos(cam.yaw) * cam.dist * cp,
    );
    camera.lookAt(t);
  });

  return null;
}
