import * as THREE from 'three';
import { CollisionField, SPAWN, clamp, terrainHeight } from './landscape';
import { Humanoid } from './actors/humanoid';
import type { CombatMaterials } from './actors/combat-materials';

export type CameraMode = 'first' | 'third';
export class PlayerController {
  readonly avatar = new THREE.Group();
  readonly position = new THREE.Vector3(SPAWN.x, terrainHeight(SPAWN.x, SPAWN.z), SPAWN.z);
  readonly keys = new Set<string>();
  readonly velocity = new THREE.Vector3();
  readonly touchMove = { x: 0, y: 0 };
  yaw = SPAWN.yaw;
  pitch = .17;
  mode: CameraMode = 'third';
  controlMode: 'foot' | 'wagon' | 'cinematic' = 'foot';
  cameraOverride = false;
  private vehicleYaw = 0;
  private arms = new THREE.Group();
  private equipment = new THREE.Group();
  started = false;
  paused = false;
  grounded = true;
  sprinting = false;
  sensitivity = 1;
  invertY = false;
  walkDistance = 0;
  zoom = 5.4;
  private verticalVelocity = 0;
  private dragging = false;
  private lockAvailable = true;
  private ignoreNextLook = false;
  private suppressUnlock = false;
  private lastPointer = { x: 0, y: 0 };
  private jumpQueued = false;
  private elapsed = 0;
  private look = new THREE.Vector3();
  private desiredCamera = new THREE.Vector3();
  private rig = new THREE.Group();
  /** The skinned player body, installed once the PBR materials have loaded. */
  private body: Humanoid | null = null;
  private bodyPose: 'idle' | 'walk' | 'run' = 'idle';
  private contactShadow: THREE.Mesh;
  private disposed = new AbortController();
  onStart = () => {};
  onUnlock = () => {};
  onPointerFallback = () => {};

  constructor(private camera: THREE.PerspectiveCamera, private canvas: HTMLCanvasElement, private collision: CollisionField, scene: THREE.Scene) {
    // The avatar's arms, used only in first person where the body is hidden.
    const skinMat = new THREE.MeshStandardMaterial({ color: '#c9a184', roughness: .72, metalness: 0 });
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(side * .265, .95, -.02), new THREE.Vector3(side * .365, .77, -.17), new THREE.Vector3(side * .24, .90, -.33)]);
      const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, .067, 8, false), skinMat); arm.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(.071, 10, 8), skinMat); hand.position.set(side * .24, .90, -.33); hand.castShadow = true;
      this.arms.add(arm, hand);
    }
    this.arms.visible = false; this.rig.add(this.arms); this.rig.add(this.equipment);
    const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
    const shadowCtx = shadowCanvas.getContext('2d')!;
    const gradient = shadowCtx.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(12,16,10,.65)'); gradient.addColorStop(.4, 'rgba(12,16,10,.3)'); gradient.addColorStop(1, 'rgba(12,16,10,0)');
    shadowCtx.fillStyle = gradient; shadowCtx.fillRect(0, 0, 64, 64);
    this.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.05), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, opacity: .62, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.contactShadow.rotation.x = -Math.PI / 2; this.contactShadow.renderOrder = 1; scene.add(this.contactShadow);
    this.avatar.add(this.rig); this.avatar.position.copy(this.position); this.avatar.rotation.y = this.yaw; scene.add(this.avatar);
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Interactive 3D woodland. Use WASD to move, drag to look, V to switch camera.');
    this.bindInput();
    this.updateCamera(1);
  }
  /**
   * Swaps the placeholder for a real skinned character body, using the same
   * rig and locomotion system that drives the goblins. Called once the PBR
   * material set has loaded, so the avatar is never a white capsule after the
   * world has finished coming up.
   */
  installBody(materials: CombatMaterials, sheet: { species?: string; classId?: string } | null) {
    this.body?.dispose();
    const tall = sheet?.species === 'lightfootHalfling' ? 1.32
      : sheet?.species === 'hillDwarf' || sheet?.species === 'mountainDwarf' ? 1.42
      : sheet?.species === 'halfOrc' ? 1.92 : 1.78;
    const stocky = sheet?.species === 'hillDwarf' || sheet?.species === 'mountainDwarf' || sheet?.species === 'halfOrc';
    const elf = sheet?.species === 'highElf' || sheet?.species === 'woodElf';
    const skin = sheet?.species === 'halfOrc' ? '#8ea07a' : sheet?.species === 'tiefling' ? '#a8544a' : '#c9a184';
    const cloth = sheet?.classId === 'wizard' ? '#3b3a5c'
      : sheet?.classId === 'cleric' ? '#c9c2ae'
      : sheet?.classId === 'rogue' ? '#33322b'
      : sheet?.classId === 'ranger' ? '#4a5940' : '#6a5a44';

    this.body = new Humanoid(
      { height: tall, build: stocky ? 'stocky' : 'lean', earLength: elf ? tall * 0.075 : tall * 0.03, noseLength: tall * 0.035 },
      materials, skin, cloth, 1337, 1,
    );
    this.body.root.position.set(0, 0, 0);
    this.rig.add(this.body.root);
  }

  /**
   * Visible kit on the avatar, per class. Small, but it is the difference
   * between "a bean" and "my character" the moment the player looks down.
   */
  setEquipment(classId: 'fighter' | 'wizard' | 'rogue' | 'cleric' | 'ranger' | null) {
    this.equipment.clear();
    if (!classId) return;
    const steel = new THREE.MeshStandardMaterial({ color: '#aab2b6', metalness: 1, roughness: .32 });
    const wood = new THREE.MeshStandardMaterial({ color: '#7a6242', roughness: .88 });
    const leather = new THREE.MeshStandardMaterial({ color: '#5a4530', roughness: .82 });
    const brass = new THREE.MeshStandardMaterial({ color: '#a2803f', metalness: .9, roughness: .42 });

    const sheathe = (length: number, x: number, tilt: number) => {
      const scabbard = new THREE.Mesh(new THREE.CylinderGeometry(.032, .026, length, 8), leather);
      scabbard.position.set(x, .58, .07); scabbard.rotation.set(.22, 0, tilt);
      scabbard.castShadow = true;
      const mouth = new THREE.Mesh(new THREE.CylinderGeometry(.036, .036, .03, 8), brass);
      mouth.position.copy(scabbard.position).add(new THREE.Vector3(0, length * .48, 0));
      mouth.rotation.copy(scabbard.rotation);
      return [scabbard, mouth];
    };

    if (classId === 'fighter') {
      // A sheathed longsword at the hip and a shield slung on the back.
      this.equipment.add(...sheathe(.66, .30, -.28));
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .12, 6), leather);
      grip.position.set(.38, .92, .04); grip.rotation.z = -.28; grip.castShadow = true;
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(.022, 10, 8), brass);
      pommel.position.set(.40, .99, .04);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(.15, .018, .028), brass);
      guard.position.set(.36, .855, .04); guard.rotation.z = -.28;
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, .035, 20), wood);
      shield.position.set(0, .78, .34); shield.rotation.set(1.42, 0, .12); shield.castShadow = true;
      const boss = new THREE.Mesh(new THREE.SphereGeometry(.055, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel);
      boss.position.set(0, .78, .36); boss.rotation.x = -Math.PI / 2 + 1.42;
      this.equipment.add(grip, pommel, guard, shield, boss);
    } else if (classId === 'wizard') {
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(.021, .026, 1.42, 8), wood);
      staff.position.set(-.34, .70, .05); staff.rotation.set(.10, 0, .13); staff.castShadow = true;
      const knot = new THREE.Mesh(new THREE.IcosahedronGeometry(.05, 1), wood);
      knot.position.set(-.42, 1.38, .02);
      const book = new THREE.Mesh(new THREE.BoxGeometry(.24, .30, .075), new THREE.MeshStandardMaterial({ color: '#4a2e24', roughness: .78 }));
      book.position.set(.30, .62, .14); book.rotation.set(.12, -.28, -.10); book.castShadow = true;
      const clasp = new THREE.Mesh(new THREE.BoxGeometry(.022, .20, .012), brass);
      clasp.position.set(.30, .62, .18); clasp.rotation.set(.12, -.28, -.10);
      this.equipment.add(staff, knot, book, clasp);
    } else if (classId === 'rogue') {
      // Two daggers, worn where a rogue would actually reach for them.
      for (const side of [-1, 1]) {
        const hilt = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .085, 6), leather);
        hilt.position.set(side * .30, .60, .12); hilt.rotation.set(.4, 0, side * .5); hilt.castShadow = true;
        const blade = new THREE.Mesh(new THREE.ConeGeometry(.017, .19, 4), steel);
        blade.position.set(side * .32, .48, .14); blade.rotation.set(Math.PI + .4, 0, side * .5);
        this.equipment.add(hilt, blade);
      }
      const pouch = new THREE.Mesh(new THREE.SphereGeometry(.062, 10, 8), leather);
      pouch.position.set(0, .55, .29); pouch.scale.set(1, .85, .6); pouch.castShadow = true;
      const hood = new THREE.Mesh(new THREE.SphereGeometry(.20, 14, 10, 0, Math.PI * 2, 0, Math.PI * .55), new THREE.MeshStandardMaterial({ color: '#33322b', roughness: .95, side: THREE.DoubleSide }));
      hood.position.set(0, 1.02, .06); hood.rotation.x = .28; hood.castShadow = true;
      this.equipment.add(pouch, hood);
    } else if (classId === 'cleric') {
      const mace = new THREE.Mesh(new THREE.CylinderGeometry(.017, .019, .42, 7), wood);
      mace.position.set(.31, .60, .08); mace.rotation.z = -.22; mace.castShadow = true;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .085, 8), steel);
      head.position.set(.36, .40, .08); head.rotation.z = -.22; head.castShadow = true;
      // A holy symbol on a chain: the read that says "cleric" at a glance.
      const symbol = new THREE.Mesh(new THREE.TorusGeometry(.045, .009, 6, 16), brass);
      symbol.position.set(0, .84, -.30); symbol.castShadow = true;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(.075, .010, .010), brass);
      bar.position.set(0, .84, -.30);
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, .032, 18), wood);
      shield.position.set(0, .78, .33); shield.rotation.set(1.42, 0, -.1); shield.castShadow = true;
      this.equipment.add(mace, head, symbol, bar, shield);
    } else {
      // Ranger: a longbow across the back and a quiver at the shoulder.
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-.05, .18, .30), new THREE.Vector3(.02, .62, .36),
        new THREE.Vector3(.06, 1.02, .34), new THREE.Vector3(.02, 1.40, .28),
      ]);
      const bow = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, .014, 6, false), wood);
      bow.castShadow = true;
      const quiver = new THREE.Mesh(new THREE.CylinderGeometry(.055, .048, .40, 10), leather);
      quiver.position.set(-.22, .92, .24); quiver.rotation.set(.30, 0, .34); quiver.castShadow = true;
      this.equipment.add(bow, quiver);
      for (let i = 0; i < 4; i++) {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.005, .005, .30, 4), wood);
        shaft.position.set(-.22 + (i % 2) * .026, 1.11, .21 + Math.floor(i / 2) * .026);
        shaft.rotation.set(.30, 0, .34);
        const fletch = new THREE.Mesh(new THREE.PlaneGeometry(.032, .05), new THREE.MeshStandardMaterial({ color: '#2c3128', roughness: 1, side: THREE.DoubleSide }));
        fletch.position.copy(shaft.position).add(new THREE.Vector3(0, .13, 0));
        fletch.rotation.copy(shaft.rotation);
        this.equipment.add(shaft, fletch);
      }
      const sword = new THREE.Mesh(new THREE.CylinderGeometry(.026, .022, .42, 8), leather);
      sword.position.set(.29, .55, .07); sword.rotation.z = -.26; sword.castShadow = true;
      this.equipment.add(sword);
    }
    for (const child of this.equipment.children) child.castShadow = true;
  }

  /**
   * During the player's combat turn, movement is limited to the remaining
   * budget. The controller asks for the limit each frame rather than being
   * told, so the encounter stays authoritative.
   */
  movementLimit: (() => number) | null = null;
  private turnOrigin = new THREE.Vector3();
  private turnBudgetActive = false;

  beginCombatTurn() { this.turnOrigin.copy(this.position); this.turnBudgetActive = true; }
  endCombatTurn() { this.turnBudgetActive = false; }

  private bindInput() {
    const opts = { signal: this.disposed.signal };
    window.addEventListener('keydown', e => {
      if (this.paused || (this.controlMode === 'cinematic' && this.started) || isFormControl(e.target) || (e.code === 'Space' && e.target instanceof HTMLButtonElement)) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        e.preventDefault();
        if (!this.started) this.onStart();
        if (this.controlMode === 'cinematic') return;
        if (e.code !== 'Space') this.canvas.focus({ preventScroll: true });
        this.keys.add(e.code);
        if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
      }
    }, opts);
    window.addEventListener('keyup', e => this.keys.delete(e.code), opts);
    window.addEventListener('blur', () => this.clearInput(), opts);
    this.canvas.addEventListener('contextmenu', e => e.preventDefault(), opts);
    this.canvas.addEventListener('pointerdown', e => {
      if (this.paused) return;
      if (!this.started) this.onStart();
      if (this.controlMode === 'cinematic') return;
      this.canvas.focus({ preventScroll: true });
      this.dragging = true; this.lastPointer = { x: e.clientX, y: e.clientY };
      if (e.pointerType === 'mouse' && e.button === 0) this.capturePointer();
      if (e.pointerType !== 'mouse') this.canvas.setPointerCapture(e.pointerId);
    }, opts);
    window.addEventListener('pointerup', () => { this.dragging = false; }, opts);
    window.addEventListener('pointercancel', () => { this.dragging = false; }, opts);
    window.addEventListener('pointermove', e => {
      if (this.paused || !this.started || this.controlMode === 'cinematic') return;
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && !this.dragging) return;
      if (locked && this.ignoreNextLook) { this.ignoreNextLook = false; this.lastPointer = { x: e.clientX, y: e.clientY }; return; }
      const dx = locked ? e.movementX : e.clientX - this.lastPointer.x;
      const dy = locked ? e.movementY : e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * .0022 * this.sensitivity;
      this.pitch = clamp(this.pitch + dy * .0019 * this.sensitivity * (this.invertY ? -1 : 1), this.mode === 'first' ? -1.35 : -.42, this.mode === 'first' ? 1.35 : 1.12);
    }, opts);
    this.canvas.addEventListener('wheel', e => {
      if (this.paused || this.mode === 'first' || this.controlMode === 'cinematic') return;
      e.preventDefault(); this.zoom = clamp(this.zoom + e.deltaY * .006, this.controlMode === 'wagon' ? 4.5 : 2.2, this.controlMode === 'wagon' ? 11.5 : 8.2);
    }, { ...opts, passive: false });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) { this.ignoreNextLook = true; this.suppressUnlock = false; }
      if (!document.pointerLockElement) {
        this.dragging = false; this.clearInput();
        const intentional = this.suppressUnlock; this.suppressUnlock = false;
        if (this.started && !this.paused && !intentional) this.onUnlock();
      }
    }, opts);
  }
  capturePointer() {
    if (this.controlMode === 'cinematic' || !this.lockAvailable || !this.started || this.paused || document.pointerLockElement === this.canvas) return;
    try {
      const result = this.canvas.requestPointerLock?.();
      Promise.resolve(result).catch(() => { this.lockAvailable = false; this.onPointerFallback(); });
    } catch { this.lockAvailable = false; this.onPointerFallback(); }
  }
  start() { this.started = true; this.paused = false; }
  setPaused(paused: boolean) {
    this.paused = paused; this.clearInput();
    if (paused && document.pointerLockElement === this.canvas) { this.suppressUnlock = true; document.exitPointerLock(); }
  }
  clearInput() { this.keys.clear(); this.touchMove.x = this.touchMove.y = 0; this.velocity.set(0, 0, 0); this.jumpQueued = false; }
  setMode(mode: CameraMode) { this.mode = mode; this.pitch = clamp(this.pitch, -.42, 1.12); this.updateCamera(1); }
  jump() { if (!this.paused && this.started && this.controlMode === 'foot') this.jumpQueued = true; }
  setControlMode(mode: 'foot' | 'wagon' | 'cinematic') {
    this.controlMode = mode; this.clearInput(); this.cameraOverride = mode === 'cinematic';
    this.arms.visible = mode !== 'foot'; this.rig.scale.y = mode === 'foot' ? 1 : .78;
    this.rig.position.y = 0; this.rig.rotation.set(0, 0, 0); this.zoom = mode === 'foot' ? 5.4 : 8.2;
  }
  attachToSeat(position: THREE.Vector3, yaw: number) {
    if (this.controlMode === 'wagon') this.yaw += Math.atan2(Math.sin(yaw - this.vehicleYaw), Math.cos(yaw - this.vehicleYaw));
    else this.yaw = yaw;
    this.vehicleYaw = yaw; this.position.copy(position); this.avatar.position.copy(position); this.avatar.rotation.y = yaw;
    this.grounded = true; this.verticalVelocity = 0;
  }
  placeOnFoot(position: THREE.Vector3, yaw: number) {
    this.setControlMode('foot'); this.position.copy(position); this.position.y = terrainHeight(position.x, position.z);
    this.yaw = yaw; this.avatar.rotation.y = yaw; this.avatar.position.copy(this.position); this.pitch = .16;
    this.grounded = true; this.verticalVelocity = 0;
  }
  reset() {
    this.position.set(SPAWN.x, terrainHeight(SPAWN.x, SPAWN.z), SPAWN.z); this.yaw = SPAWN.yaw; this.pitch = .17;
    this.verticalVelocity = 0; this.grounded = true; this.clearInput(); this.avatar.position.copy(this.position); this.updateCamera(1);
  }
  update(dt: number) {
    dt = Math.max(0, Math.min(.1, dt)); this.elapsed += dt;
    if (this.started && !this.paused && this.controlMode === 'foot') {
      let forward = +(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - +(this.keys.has('KeyS') || this.keys.has('ArrowDown')) + this.touchMove.y;
      let strafe = +(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - +(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) + this.touchMove.x;
      const len = Math.hypot(forward, strafe);
      if (len > 1) { forward /= len; strafe /= len; }
      this.sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const speed = this.sprinting ? 4.7 : 2.25;
      const vx = (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe) * speed;
      const vz = (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe) * speed;
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, vx, 13, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, vz, 13, dt);
      if (this.jumpQueued && this.grounded) { this.verticalVelocity = 4.25; this.grounded = false; }
      this.jumpQueued = false;
      const substeps = Math.max(1, Math.ceil(dt / .016));
      for (let i = 0; i < substeps; i++) this.physicsStep(dt / substeps);
      const moveSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      this.walkDistance += moveSpeed * dt;
      if (moveSpeed > .12) {
        const direction = Math.atan2(-this.velocity.x, -this.velocity.z);
        const diff = Math.atan2(Math.sin(direction - this.avatar.rotation.y), Math.cos(direction - this.avatar.rotation.y));
        this.avatar.rotation.y += diff * Math.min(1, dt * 12);
      }
      const moving = Math.min(1, moveSpeed / 2);
      // A real skinned body animates itself; the capsule bob is only a
      // fallback for the frames before the character model has loaded.
      if (this.body) {
        this.rig.position.y = 0; this.rig.rotation.set(0, 0, 0);
      } else {
        this.rig.position.y = this.grounded ? Math.abs(Math.sin(this.walkDistance * 4.8)) * .032 * moving : 0;
        this.rig.rotation.z = Math.sin(this.walkDistance * 4.8) * .027 * moving;
        this.rig.rotation.x = -.025 * moving;
      }
    }
    this.avatar.position.copy(this.position);
    if (this.body) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      this.bodyPose = speed > 3.4 ? 'run' : speed > .25 ? 'walk' : 'idle';
      this.body.update(dt, { speed, pose: this.bodyPose, crouch: 0, actionPhase: 0 });
    }
    const floor = terrainHeight(this.position.x, this.position.z);
    this.contactShadow.position.set(this.position.x, floor + .016, this.position.z);
    (this.contactShadow.material as THREE.MeshBasicMaterial).opacity = .62 / (1 + Math.max(0, this.position.y - floor) * 3);
    this.contactShadow.visible = this.mode === 'third' && this.controlMode === 'foot';
    this.updateCamera(dt);
  }
  private physicsStep(dt: number) {
    const dx = this.velocity.x * dt, dz = this.velocity.z * dt;
    let nx = this.position.x + dx, nz = this.position.z + dz;
    const currentGround = terrainHeight(this.position.x, this.position.z);
    const nextGround = terrainHeight(nx, nz);
    if (nextGround - Math.max(currentGround, this.position.y) > Math.max(.055, Math.hypot(dx, dz) * 1.1)) {
      if (terrainHeight(nx, this.position.z) - currentGround > Math.max(.04, Math.abs(dx) * 1.1)) nx = this.position.x;
      if (terrainHeight(this.position.x, nz) - currentGround > Math.max(.04, Math.abs(dz) * 1.1)) nz = this.position.z;
    }
    const resolved = this.collision.resolve(nx, nz, this.position.y);
    this.position.x = resolved.x; this.position.z = resolved.z;
    // In combat the player walks their own movement, but only as far as the
    // turn allows. Past the budget they are held on the edge of the circle
    // rather than snapped back, so it feels like a limit and not a bug.
    if (this.turnBudgetActive && this.movementLimit) {
      const limit = this.movementLimit();
      if (Number.isFinite(limit)) {
        const ox = this.position.x - this.turnOrigin.x, oz = this.position.z - this.turnOrigin.z;
        const walked = Math.hypot(ox, oz);
        if (walked > limit) {
          const scale = limit / walked;
          this.position.x = this.turnOrigin.x + ox * scale;
          this.position.z = this.turnOrigin.z + oz * scale;
        }
      }
    }
    const floor = terrainHeight(resolved.x, resolved.z);
    if (!this.grounded) {
      this.verticalVelocity -= 11.4 * dt;
      this.position.y += this.verticalVelocity * dt;
      if (this.position.y <= floor) { this.position.y = floor; this.verticalVelocity = 0; this.grounded = true; }
    } else {
      if (this.position.y - floor > .24) { this.grounded = false; this.verticalVelocity = 0; }
      else this.position.y = floor;
    }
  }
  private updateCamera(dt: number) {
    if (this.cameraOverride) { this.avatar.visible = true; this.rig.children.forEach(o => { o.visible = true; }); return; }
    const seated = this.controlMode === 'wagon';
    const breathing = this.paused ? 0 : Math.sin(this.elapsed * 1.4) * .004;
    if (this.mode === 'first') {
      this.avatar.visible = seated;
      this.rig.children.forEach(o => { o.visible = seated && o === this.arms; });
      const bob = this.grounded && this.started && !this.paused ? Math.sin(this.walkDistance * 9.6) * .012 * Math.min(1, this.velocity.length()) : 0;
      this.camera.position.copy(this.position).add(new THREE.Vector3(0, (seated ? 1.02 : 1.35) + bob + breathing, 0));
      this.look.set(-Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)).add(this.camera.position);
      this.camera.lookAt(this.look);
    } else {
      this.rig.children.forEach(o => { o.visible = o !== this.arms || seated; });
      const yaw = this.started ? this.yaw : this.yaw + Math.sin(this.elapsed * .055) * .022;
      const pitch = this.started ? this.pitch : .19;
      const distance = this.started ? this.zoom : 7.7;
      this.look.copy(this.position).add(new THREE.Vector3(0, (seated ? .86 : 1.02) + breathing, 0));
      const offset = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      this.desiredCamera.copy(this.look).addScaledVector(offset, distance);
      // Lift a low orbit above the floor BEFORE testing the sight line. Otherwise
      // looking up unnecessarily pulls the camera into the back of the character.
      this.desiredCamera.y = Math.max(this.desiredCamera.y, terrainHeight(this.desiredCamera.x, this.desiredCamera.z) + .38);
      offset.copy(this.desiredCamera).sub(this.look);
      const orbitDistance = offset.length(); offset.normalize();
      let safeDistance = orbitDistance;
      for (let d = .3; d < orbitDistance; d += .22) {
        const p = this.desiredCamera.copy(this.look).addScaledVector(offset, d);
        if (this.collision.cameraBlocked(p.x, p.y, p.z, seated ? 'wagon' : undefined)) { safeDistance = Math.max(.42, d - .22); break; }
      }
      this.desiredCamera.copy(this.look).addScaledVector(offset, safeDistance);
      this.desiredCamera.y = Math.max(this.desiredCamera.y, terrainHeight(this.desiredCamera.x, this.desiredCamera.z) + .28);
      this.camera.position.lerp(this.desiredCamera, 1 - Math.exp(-9 * dt));
      this.camera.lookAt(this.look);
      this.avatar.visible = this.camera.position.distanceTo(this.look) > .75;
    }
  }
  dispose() {
    this.body?.dispose(); this.disposed.abort(); if (document.pointerLockElement === this.canvas) document.exitPointerLock(); }
}
export function isFormControl(target: EventTarget | null) {
  return target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
}
