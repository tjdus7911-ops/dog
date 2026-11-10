// 내 강아지의 산책 행동 — 보호자를 따라 걷기/달리기, 멈추면 주변 살피기 → 앉기, 다른 강아지와 인사
import { DogAnim, RUN_SPEED, WALK_SPEED } from '@shared/protocol';
import { space } from './space';
import { LEASH_LENGTH } from './Leash';

const MAX_DIST = LEASH_LENGTH - 0.25; // 목줄이 팽팽해지는 거리
const GREET_RANGE = 1.5;
const GREET_TIME = 2.2;
const GREET_COOLDOWN = 9;

export class DogBrain {
  x = 0; z = 0; rot = 0;
  speed = 0;
  anim: number = DogAnim.Stand;
  look = 0;
  private idleTime = 0;
  private wanderTarget: [number, number] | null = null;
  private wanderTimer = 0;
  private greetTimer = 0;
  private greetCooldown = new Map<number, number>();
  private time = 0;
  /** 보호자가 벤치에 앉아 있는 동안 대기 자리에서 보낸 시간 */
  private restTime = 0;

  /** 서버가 시작한 배변: 이 시각까지 제자리에서 볼일 자세 */
  poopUntil = 0;
  /** 이 시각까지 제자리에 서서 지정한 곳(쓰다듬는 사람·보호자)을 바라봄 */
  holdUntil = 0;
  holdLook: { x: number; z: number } | null = null;
  /** 배변 후 보호자를 바라보기 */
  lookOwnerUntil = 0;

  /** 배변 시작 (서버 이벤트) */
  startPoop(ms: number) {
    const now = performance.now();
    this.poopUntil = now + ms;
    this.lookOwnerUntil = now + ms + 2200;
  }
  /** 쓰다듬기를 받는 동안 멈춰서 상대를 바라봄 */
  hold(ms: number, lookX: number, lookZ: number) {
    if (performance.now() < this.poopUntil) return;
    this.holdUntil = performance.now() + ms;
    this.holdLook = { x: lookX, z: lookZ };
  }

  place(x: number, z: number, rot: number) {
    this.x = x; this.z = z; this.rot = rot; this.speed = 0; this.idleTime = 0; this.wanderTarget = null;
  }

  /**
   * @param ox,oz,orot 보호자 위치·방향
   * @param ospeed 보호자 현재 속도
   * @param others 주변 강아지 [id, x, z]
   * @param sitCommand '앉아' 명령 중
   * @param rest 보호자가 벤치에 앉았을 때 강아지가 기다릴 자리 (없으면 평소 산책)
   */
  update(dt: number, ox: number, oz: number, orot: number, ospeed: number, others: [number, number, number][], sitCommand: boolean, scale: number,
    rest: { x: number; z: number; rot: number } | null = null) {
    this.time += dt;
    const ownerMoving = ospeed > 0.2;
    const ownerRunning = ospeed > WALK_SPEED * 1.25;
    this.idleTime = ownerMoving ? 0 : this.idleTime + dt;

    // 목표 지점: 보호자의 오른쪽 약간 앞 (목줄을 오른손에 쥠)
    let tx: number, tz: number;
    const side = 0.85, ahead = ownerMoving ? 0.45 : 0.2;
    const sx = Math.cos(orot), sz = -Math.sin(orot); // 보호자 기준 오른쪽(-x 방향이 모델 오른쪽)
    tx = ox - sx * side + Math.sin(orot) * ahead;
    tz = oz - sz * side + Math.cos(orot) * ahead;

    // 벤치 대기: 지정 자리로 가서 앉았다가 엎드려 쉬기, 고개는 주변을 살피고 꼬리는 천천히
    if (rest) {
      this.wanderTarget = null;
      const dx = rest.x - this.x, dz = rest.z - this.z;
      const dist = Math.hypot(dx, dz);
      const desired = dist < 0.08 ? 0 : Math.min(WALK_SPEED * 1.1, dist * 2.4);
      this.speed += (desired - this.speed) * Math.min(1, dt * 6);
      if (dist > 0.001 && this.speed > 0.01) {
        const step = Math.min(dist, this.speed * dt);
        this.x += (dx / dist) * step; this.z += (dz / dist) * step;
        this.rot = turnToward(this.rot, Math.atan2(dx, dz), dt * 8);
        this.restTime = 0;
      } else {
        this.rot = turnToward(this.rot, rest.rot, dt * 3);
        this.restTime += dt;
      }
      this.anim = this.speed > 0.15 ? DogAnim.Walk : this.restTime < 3.5 ? DogAnim.Sit : DogAnim.Lie;
      const lookTarget = this.anim === DogAnim.Walk ? 0 : Math.sin(this.time * 0.7) * 0.6;
      this.look += (lookTarget - this.look) * Math.min(1, dt * 3);
      return;
    }
    this.restTime = 0;

    // 배변 중 / 쓰다듬기를 받는 중 / 배변 후 보호자 바라보기: 제자리에 멈춘다
    const nowMs = performance.now();
    const pooping = nowMs < this.poopUntil;
    const holding = nowMs < this.holdUntil;
    const lookingOwner = !pooping && nowMs < this.lookOwnerUntil && !ownerMoving;
    if (pooping || holding || lookingOwner) {
      this.speed = 0;
      this.wanderTarget = null;
      const lt = holding && this.holdLook ? this.holdLook : !pooping ? { x: ox, z: oz } : null;
      if (lt) this.rot = turnToward(this.rot, Math.atan2(lt.x - this.x, lt.z - this.z), dt * 6);
      // 보호자가 멀리 가면 목줄에 끌려간다
      const od = Math.hypot(this.x - ox, this.z - oz);
      if (od > MAX_DIST) {
        this.x = ox + ((this.x - ox) / od) * MAX_DIST;
        this.z = oz + ((this.z - oz) / od) * MAX_DIST;
        [this.x, this.z] = space.collide(this.x, this.z, 0.22 * scale);
      }
      this.anim = pooping ? DogAnim.Poop : DogAnim.Stand;
      this.look += (0 - this.look) * Math.min(1, dt * 4);
      return;
    }

    // 인사: 가까운 다른 강아지 발견
    if (this.greetTimer > 0) this.greetTimer -= dt;
    let greetWith: [number, number, number] | null = null;
    for (const o of others) {
      const d = Math.hypot(o[1] - this.x, o[2] - this.z);
      if (d < GREET_RANGE) {
        const until = this.greetCooldown.get(o[0]) ?? 0;
        if (this.time > until) {
          this.greetTimer = GREET_TIME;
          this.greetCooldown.set(o[0], this.time + GREET_COOLDOWN);
        }
        if (this.greetTimer > 0) greetWith = o;
      }
    }

    // 보호자가 쉬는 중: 주변을 조금 돌아다니며 냄새 맡기
    if (!ownerMoving && !sitCommand && this.idleTime > 1.2 && this.idleTime < 7 && !greetWith) {
      this.wanderTimer -= dt;
      if (!this.wanderTarget || this.wanderTimer <= 0) {
        const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.1;
        this.wanderTarget = [ox + Math.sin(a) * r, oz + Math.cos(a) * r];
        this.wanderTimer = 2 + Math.random() * 2.5;
      }
      [tx, tz] = this.wanderTarget;
    } else if (ownerMoving) this.wanderTarget = null;
    if (greetWith) { tx = this.x; tz = this.z; }

    // 이동
    const dx = tx - this.x, dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    const maxSpeed = (ownerRunning ? RUN_SPEED * 1.15 : WALK_SPEED * 1.25);
    let desired = dist < 0.12 ? 0 : Math.min(maxSpeed, dist * 2.6);
    if (sitCommand && !ownerMoving) desired = 0;
    if (!ownerMoving && this.wanderTarget) desired = Math.min(desired, 0.9);
    this.speed += (desired - this.speed) * Math.min(1, dt * 6);
    if (dist > 0.001 && this.speed > 0.01) {
      const step = Math.min(dist, this.speed * dt);
      this.x += (dx / dist) * step;
      this.z += (dz / dist) * step;
      // 이동 방향으로 부드럽게 회전
      const want = Math.atan2(dx, dz);
      this.rot = turnToward(this.rot, want, dt * 8);
    } else if (greetWith) {
      this.rot = turnToward(this.rot, Math.atan2(greetWith[1] - this.x, greetWith[2] - this.z), dt * 6);
    } else if (!ownerMoving && this.idleTime > 0.5) {
      // 멈춰 있으면 보호자 쪽을 바라봄
      this.rot = turnToward(this.rot, Math.atan2(ox - this.x, oz - this.z), dt * 2);
    }

    // 장애물 · 목줄 길이 제한 (멀어지거나 걸리지 않게)
    [this.x, this.z] = space.collide(this.x, this.z, 0.22 * scale);
    let od = Math.hypot(this.x - ox, this.z - oz);
    if (od > MAX_DIST) {
      this.x = ox + ((this.x - ox) / od) * MAX_DIST;
      this.z = oz + ((this.z - oz) / od) * MAX_DIST;
      [this.x, this.z] = space.collide(this.x, this.z, 0.22 * scale);
      od = Math.hypot(this.x - ox, this.z - oz);
      // 장애물 때문에 여전히 멀다면 보호자 곁으로 이동 (끼임 방지)
      if (od > MAX_DIST + 0.4) { this.x = tx; this.z = tz; [this.x, this.z] = space.collide(this.x, this.z, 0.22 * scale); }
    }

    // 애니메이션 상태
    if (greetWith) this.anim = DogAnim.Greet;
    else if (this.speed > WALK_SPEED * 1.35) this.anim = DogAnim.Run;
    else if (this.speed > 0.15) this.anim = DogAnim.Walk;
    else if (sitCommand || this.idleTime > 6) this.anim = DogAnim.Sit;
    else if (this.idleTime > 1.5) this.anim = DogAnim.Look;
    else this.anim = DogAnim.Stand;

    // 주변 살피기: 고개를 천천히 좌우로
    const lookTarget = this.anim === DogAnim.Look || this.anim === DogAnim.Sit ? Math.sin(this.time * 0.9) * 0.7 : 0;
    this.look += (lookTarget - this.look) * Math.min(1, dt * 3);
  }
}

export function turnToward(cur: number, target: number, maxStep: number) {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
