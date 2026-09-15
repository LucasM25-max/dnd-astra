import * as THREE from 'three';
import { InventoryStore } from '../game/save';
import { Narrator, type NarratorState } from '../game/narrator';
import { GameClock } from '../game/time';
import { journeyPose } from '../game/road';
import { CONTAINERS, emptyStock, type ContainerId, type ItemId } from '../game/items';
import { CollisionField, WORLD_LIMIT, pathDistance, terrainHeight } from './landscape';
import { PlayerController } from './controller';
import { loadAdventureMaterials, type AdventureMaterials } from './actors/materials';
import { AnimalFactory, type LivingAnimal } from './actors/animals';
import { SupplyWagon } from './actors/wagon';
import { FlexibleRope } from './actors/geometry';

export interface Interaction { kind: 'cargo' | 'horses'; id: string; label: string }
const HANDS_LEFT = new THREE.Vector3(), HANDS_RIGHT = new THREE.Vector3();
export interface AdventureState {
  story: NarratorState; mounted: boolean; interaction: Interaction | null; canMount: boolean;
  wagon: { x: number; z: number; yaw: number; speed: number }; inventoryRevision: number;
  horses: { x: number; z: number; yaw: number; sniffing: boolean }[];
}
function browserStorage() { try { return window.localStorage; } catch { return undefined; } }
export class Adventure {
  readonly inventory = new InventoryStore(browserStorage());
  readonly narrator = new Narrator();
  /** The Calendar of Harptos clock: starts 15 Ches, 14:30 — a quiet afternoon. */
  readonly clock = new GameClock();
  readonly wagon: SupplyWagon;
  readonly horses: LivingAnimal[];
  private runClock = 0;
  private lastSave = 0;
  private lastBlockedToast = -10;
  private cameraLook = new THREE.Vector3();
  private horseSniff = [false, false];
  private lastWagonPosition = new THREE.Vector3();
  private previouslyPaused = false;
  private cinematicProgress = 0;
  private disposed = false;
  /** Roadside hitching stakes the horses are tied to once calmed. */
  readonly tiePoints = [new THREE.Vector3(6.6, 0, 3.4), new THREE.Vector3(7.9, 0, 3.65)];
  private stakeTops: THREE.Vector3[] = [];
  private leadRopes: FlexibleRope[] = [];
  private tie: { t: number; from: THREE.Vector3[] } | null = null;
  private tied = false;
  mounted = true;
  onHandoff = () => {};
  onNotice: (message: string) => void = () => {};
  private constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private controller: PlayerController, private collision: CollisionField, private factory: AnimalFactory, readonly materials: AdventureMaterials) {
    this.wagon = new SupplyWagon(factory, this.inventory); this.wagon.addTo(scene);
    this.horses = [factory.create('horse', '#765339', 2), factory.create('horse', '#b0aca0', 7)];
    this.horses.forEach(h => scene.add(h.root));
    this.buildStakes(scene);
    const saved = this.inventory.snapshot(), pose = saved.arrived && saved.wagon ? saved.wagon : journeyPose(saved.arrived ? 1 : 0);
    if (saved.time) this.clock.restore(saved.time.month, saved.time.day, saved.time.minuteOfDay);
    this.wagon.setPose(pose.x, pose.z, pose.yaw); this.lastWagonPosition.copy(this.wagon.root.position);
    this.controller.setControlMode('cinematic'); this.controller.attachToSeat(this.wagon.seatPosition(), pose.yaw);
    this.narrator.onHandoff = () => this.handoff();
    this.narrator.onComplete = () => this.save();
    this.inventory.onChange = () => this.wagon.refreshCargo();
    this.updateHorses(.001); this.wagon.update(.001, 0, false);
    this.updateCamera(true); this.updateCollision();
  }
  static async create(scene: THREE.Scene, camera: THREE.PerspectiveCamera, controller: PlayerController, collision: CollisionField, renderer: THREE.WebGLRenderer) {
    const materials = await loadAdventureMaterials(renderer), factory = await AnimalFactory.load(materials);
    const adventure = new Adventure(scene, camera, controller, collision, factory, materials);
    await adventure.narrator.initialize(); return adventure;
  }
  begin() {
    if (this.narrator.state.phase !== 'title') return;
    this.controller.start();
    if (this.inventory.arrived) {
      const saved = this.inventory.snapshot(); this.mounted = saved.mounted;
      if (!this.mounted && saved.player) this.controller.placeOnFoot(new THREE.Vector3(saved.player.x, 0, saved.player.z), saved.player.yaw);
      else this.mount();
      this.controller.cameraOverride = false;
      this.narrator.start(true);
      this.onNotice('Your cargo and inventory are right where you left them.');
    } else { this.mounted = true; this.controller.setControlMode('cinematic'); this.narrator.start(); }
  }
  private handoff() {
    const pose = journeyPose(1); this.wagon.setPose(pose.x, pose.z, pose.yaw); this.wagon.speed = 0; this.lastWagonPosition.copy(this.wagon.root.position);
    this.inventory.setArrived(); this.mount(); this.controller.pitch = .23;
    this.controller.cameraOverride = false;
    this.camera.position.copy(this.wagon.root.localToWorld(new THREE.Vector3(0, 4.05, 6.7)));
    this.camera.lookAt(this.wagon.seatPosition().add(new THREE.Vector3(0, .86, 0)));
    this.camera.fov = this.controller.mode === 'first' ? 72 : 59; this.camera.updateProjectionMatrix();
    this.save(); this.onHandoff();
  }
  setPaused(paused: boolean) {
    this.controller.setPaused(paused); this.narrator.setPaused(paused, 'menu');
    if (paused) this.save();
  }
  update(dt: number, realDelta: number) {
    this.narrator.update(realDelta);
    const paused = this.controller.paused, phase = this.narrator.state.phase;
    if (!paused) {
      this.runClock += dt;
      // The world clock runs once the opening cutscene is over. Real-time based
      // (2 real hours = 1 game day), capped so a backgrounded tab can't leap ahead.
      if (this.inventory.arrived && phase !== 'journey' && this.controller.started) this.clock.advance(Math.min(realDelta, 2));
    }
    let distance = 0;
    if (phase === 'journey') {
      this.cinematicProgress = Math.max(this.cinematicProgress, this.narrator.state.journeyProgress);
      const pose = journeyPose(this.cinematicProgress);
      this.wagon.setPose(pose.x, pose.z, pose.yaw);
      distance = this.wagon.root.position.distanceTo(this.lastWagonPosition);
      this.lastWagonPosition.copy(this.wagon.root.position);
      this.controller.attachToSeat(this.wagon.seatPosition(), pose.yaw);
      this.wagon.speed = paused || this.narrator.state.paused ? 0 : distance / Math.max(dt, .001);
    } else if (phase !== 'title' && this.mounted && !paused) distance = this.drive(dt);
    if (this.mounted) { this.controller.attachToSeat(this.wagon.seatPosition(), this.wagon.root.rotation.y); this.wagon.mounted = true; }
    else this.wagon.mounted = false;
    const hands: { left: THREE.Vector3; right: THREE.Vector3 } | null = this.mounted
      ? { left: this.controller.handPosition('left', HANDS_LEFT), right: this.controller.handPosition('right', HANDS_RIGHT) }
      : null;
    this.wagon.update(dt, paused ? 0 : distance, paused, hands);
    if (!paused) this.updateHorses(dt);
    if (this.leadRopes.length) this.updateRopes();
    this.updateCollision();
    if (phase === 'title' || phase === 'journey') this.updateCamera(phase === 'title');
    else if (Math.abs(this.camera.fov - (this.controller.mode === 'first' ? 72 : 59)) > .1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.controller.mode === 'first' ? 72 : 59, 5, dt); this.camera.updateProjectionMatrix();
    }
    if (phase !== 'title' && phase !== 'journey' && this.runClock - this.lastSave > 2.5) { this.lastSave = this.runClock; this.save(); }
    this.previouslyPaused = paused;
  }
  private drive(dt: number) {
    const keys = this.controller.keys;
    const forward = +(keys.has('KeyW') || keys.has('ArrowUp')) - +(keys.has('KeyS') || keys.has('ArrowDown')) + this.controller.touchMove.y;
    const steering = +(keys.has('KeyD') || keys.has('ArrowRight')) - +(keys.has('KeyA') || keys.has('ArrowLeft')) + this.controller.touchMove.x;
    this.wagon.steering = THREE.MathUtils.damp(this.wagon.steering, steering * .38, 6, dt);
    const targetSpeed = keys.has('Space') ? 0 : forward > 0 ? forward * 1.18 : forward * .52;
    this.wagon.speed = THREE.MathUtils.damp(this.wagon.speed, targetSpeed, keys.has('Space') ? 12 : 2.6, dt);
    if (Math.abs(this.wagon.speed) < .006) { this.wagon.speed = 0; return 0; }
    const old = this.wagon.root.position.clone(), oldYaw = this.wagon.root.rotation.y;
    const yaw = oldYaw - this.wagon.speed / 2.4 * Math.tan(this.wagon.steering) * dt;
    const x = old.x - Math.sin(yaw) * this.wagon.speed * dt, z = old.z - Math.cos(yaw) * this.wagon.speed * dt;
    if (!this.canDriveAt(x, z, yaw)) {
      this.wagon.speed = 0;
      if (this.runClock - this.lastBlockedToast > 7) { this.lastBlockedToast = this.runClock; this.onNotice('The wagon needs room. Steer back to the road, or press R to go on foot.'); }
      return 0;
    }
    this.wagon.setPose(x, z, yaw); this.lastWagonPosition.copy(this.wagon.root.position);
    return Math.hypot(x - old.x, z - old.z) * Math.sign(this.wagon.speed);
  }
  private canDriveAt(x: number, z: number, yaw: number) {
    if (Math.abs(x) > WORLD_LIMIT - 7 || Math.abs(z) > WORLD_LIMIT - 7) return false;
    const y = terrainHeight(x, z);
    const points = [[-.98, -1.2], [.98, -1.2], [-.98, 1.2], [.98, 1.2], [-.72, -4.95], [.72, -4.95]];
    for (const [px, pz] of points) {
      const wx = x + px * Math.cos(yaw) + pz * Math.sin(yaw), wz = z - px * Math.sin(yaw) + pz * Math.cos(yaw);
      if (terrainHeight(wx, wz) - y > .44) return false;
      for (const c of this.collision.query(wx, wz, .2)) {
        if (c.group === 'wagon') continue;
        if (Math.hypot(wx - c.x, wz - c.z) < c.radius + .17 && c.top > y + .3) return false;
      }
    }
    return true;
  }
  toggleMounted() {
    if (!this.inventory.arrived || this.narrator.state.phase === 'journey') return false;
    if (this.mounted) {
      const candidate = this.wagon.dismountPoints().find(p => {
        const clear = this.collision.resolve(p.x, p.z, p.y);
        return Math.hypot(clear.x - p.x, clear.z - p.z) < .12 && Math.abs(p.x) < WORLD_LIMIT && Math.abs(p.z) < WORLD_LIMIT;
      });
      if (!candidate) { this.onNotice('There isn’t space beside the wagon. Move to a clearer stretch first.'); return false; }
      this.wagon.speed = 0; this.mounted = false; this.wagon.mounted = false;
      this.controller.placeOnFoot(candidate, this.wagon.root.rotation.y); this.controller.cameraOverride = false;
      this.onNotice('On foot · E to open nearby cargo · I for your inventory');
    } else {
      if (!this.canMount()) { this.onNotice('Walk back to the driver’s bench to take the reins.'); return false; }
      this.mount(); this.onNotice('At the reins · W/S to guide · A/D to steer · Space to brake');
    }
    this.save(); return true;
  }
  private mount() {
    this.mounted = true; this.wagon.mounted = true; this.wagon.speed = 0;
    // Set the attachment heading before enabling free look so boarding cannot rotate the camera twice.
    this.controller.setControlMode('cinematic'); this.controller.attachToSeat(this.wagon.seatPosition(), this.wagon.root.rotation.y);
    this.controller.setControlMode('wagon'); this.controller.attachToSeat(this.wagon.seatPosition(), this.wagon.root.rotation.y);
    this.controller.pitch = .23;
  }
  canMount() { return this.inventory.arrived && this.controller.position.distanceTo(this.wagon.seatPosition()) < 3.4; }
  returnToWagon() { if (this.inventory.arrived) { this.mount(); this.save(); } }
  /**
   * An optional long rest: skip ahead to 06:00. Rests are never forced.
   * Recovery effects arrive in a later chapter; for now the day simply turns.
   */
  longRest(): string | null {
    if (!this.inventory.arrived || this.narrator.state.phase === 'journey' || !this.controller.started) return null;
    this.clock.restUntilMorning();
    this.save();
    return `You rest until the morning. ${this.clock.dateLabel()} · 6:00 am`;
  }
  canReach(id: ContainerId) {
    if (!CONTAINERS.some(c => c.id === id) || !this.inventory.arrived || this.mounted || this.narrator.state.phase === 'journey') return false;
    const p = this.wagon.cargoPosition(id), player = this.controller.position;
    return Math.hypot(p.x - player.x, p.z - player.z) < 2.6 && Math.abs(p.y - player.y) < 2.3;
  }
  openCargo(id: ContainerId) { return this.canReach(id) && this.inventory.open(id); }
  closeCargo(id: ContainerId) { return this.canReach(id) && this.inventory.close(id); }
  take(id: ContainerId, item: ItemId, quantity: number) { return this.canReach(id) && this.inventory.take(id, item, quantity); }
  takeAll(id: ContainerId) { return this.canReach(id) ? this.inventory.takeAll(id) : emptyStock(); }
  interaction(): Interaction | null {
    if (!this.inventory.arrived || this.narrator.state.phase === 'journey' || !this.controller.started) return null;
    const player = this.controller.position;
    const nearby = CONTAINERS.filter(c => this.canReach(c.id)).map(c => ({ c, d: this.wagon.cargoPosition(c.id).distanceTo(player) })).sort((a, b) => a.d - b.d)[0];
    if (nearby) return { kind: 'cargo', id: nearby.c.id, label: `${this.inventory.isOpen(nearby.c.id) ? 'Close' : 'Open'} ${nearby.c.name.toLowerCase()}` };
    // The ransacked belongings are a cinematic world interaction now (InteractionManager).
    return null;
  }
  private buildStakes(scene: THREE.Scene) {
    for (const p of this.tiePoints) {
      const y = terrainHeight(p.x, p.z);
      const stake = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.045, .06, 1.0, 8), this.materials.woodDark);
      post.position.y = .42; post.rotation.set(.06, 0, .09);
      post.castShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), this.materials.woodEnd);
      cap.position.y = .92;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.05, .012, 6, 12), this.materials.iron);
      ring.position.y = .8; ring.rotation.x = Math.PI / 2;
      stake.add(post, cap, ring);
      stake.position.set(p.x, y, p.z);
      scene.add(stake);
      this.stakeTops.push(new THREE.Vector3(p.x, y + .8, p.z));
    }
  }
  get horsesTied(): boolean { return this.tied; }
  /** Begin the tie-off: the horses lead themselves to the stakes. */
  beginTie(): void {
    if (this.tied || this.tie) return;
    this.tie = { t: 0, from: this.horses.map(h => h.root.position.clone()) };
    for (const h of this.horses) h.actor.playOneShot('tie_react');
  }
  /** A botched check: the horses spook and can be tried again. */
  startleHorses(): void {
    for (const h of this.horses) h.actor.playOneShot('startle');
  }
  /** Restore the tied state from a save: horses already at the stakes. */
  restoreTied(): void {
    this.tied = true; this.tie = null;
    this.horses.forEach((h, i) => {
      const p = this.tiePoints[i];
      h.root.position.set(p.x, terrainHeight(p.x, p.z) + .02, p.z);
      h.root.rotation.y = i === 0 ? .25 : -.2;
      h.setGait('tied');
    });
    this.buildRopes();
  }
  private buildRopes() {
    if (this.leadRopes.length) return;
    for (let i = 0; i < this.horses.length; i++) {
      const rope = new FlexibleRope(this.materials.rope, .014);
      this.scene.add(rope.mesh);
      this.leadRopes.push(rope);
    }
    this.updateRopes();
  }
  private updateRopes() {
    for (let i = 0; i < this.leadRopes.length; i++) {
      this.leadRopes[i].update(this.stakeTops[i], this.horses[i].bitPosition(), .12, this.runClock);
    }
  }
  private updateHorses(dt: number) {
    if (this.tied) {
      for (const h of this.horses) h.update(dt, 0, false);
      this.updateRopes();
      return;
    }
    if (this.tie) {
      this.tie.t += dt;
      const k = THREE.MathUtils.smoothstep(Math.min(1, this.tie.t / 4.5), 0, 1);
      for (let i = 0; i < this.horses.length; i++) {
        const horse = this.horses[i], old = horse.root.position.clone();
        const target = this.tiePoints[i].clone(); target.y = terrainHeight(target.x, target.z) + .02;
        const next = this.tie.from[i].clone().lerp(target, k);
        next.y = target.y;
        const moved = Math.hypot(next.x - old.x, next.z - old.z);
        if (k < 1 && moved > .0004) {
          const angle = Math.atan2(-(next.x - old.x), -(next.z - old.z));
          horse.root.rotation.y += Math.atan2(Math.sin(angle - horse.root.rotation.y), Math.cos(angle - horse.root.rotation.y)) * Math.min(1, dt * 3);
        }
        horse.root.position.copy(next);
        horse.update(dt, k < 1 ? moved : 0, false);
      }
      if (this.tie.t >= 4.5) { this.tied = true; this.tie = null; this.buildRopes(); }
      return;
    }
    for (let i = 0; i < this.horses.length; i++) {
      const horse = this.horses[i], old = horse.root.position.clone();
      const cycle = (this.runClock + i * 12) % 34;
      const from = new THREE.Vector3(i === 0 ? 9.3 : 12.6, 0, i === 0 ? 2.9 : 1.2);
      const to = new THREE.Vector3(i === 0 ? 8.35 : 11.1, 0, i === 0 ? 2.10 : 1.8);
      let t: number;
      if (cycle < 6) t = THREE.MathUtils.smoothstep(cycle / 6, 0, 1);
      else if (cycle < 19) t = 1;
      else if (cycle < 26) t = 1 - THREE.MathUtils.smoothstep((cycle - 19) / 7, 0, 1);
      else t = 0;
      const next = from.clone().lerp(to, t);
      next.y = terrainHeight(next.x, next.z) + .025;
      if (pathDistance(next.x, next.z) > .15) next.z = Math.min(next.z, 2.9);
      let horizontalDistance = Math.hypot(next.x - old.x, next.z - old.z);
      const sniffing = cycle > 7 && cycle < 18; this.horseSniff[i] = sniffing;
      if (old.lengthSq() < .01) horizontalDistance = 0;
      if (horizontalDistance > .0005 && horizontalDistance < 1) {
        const angle = Math.atan2(-(next.x - old.x), -(next.z - old.z));
        horse.root.rotation.y += Math.atan2(Math.sin(angle - horse.root.rotation.y), Math.cos(angle - horse.root.rotation.y)) * Math.min(1, dt * 3);
      } else if (sniffing) horse.root.rotation.y = THREE.MathUtils.damp(horse.root.rotation.y, i === 0 ? -.85 : 1.4, .7, dt);
      horse.root.position.copy(next); horse.update(dt, horizontalDistance < 1 ? horizontalDistance : 0, sniffing);
    }
  }
  private updateCollision() {
    this.collision.setDynamic('wagon', this.wagon.colliders());
    this.collision.setDynamic('horses', this.horses.flatMap(h => [-.35, .4].map(z => {
      const p = h.root.localToWorld(new THREE.Vector3(0, 0, z));
      return { x: p.x, z: p.z, radius: .36, bottom: h.root.position.y, top: h.root.position.y + 1.55, group: 'horses' };
    })));
  }
  private updateCamera(title: boolean) {
    const p = this.cinematicProgress;
    // Four continuous tracking compositions; the wagon always advances on the same road.
    let offset: THREE.Vector3, targetLocal: THREE.Vector3;
    if (title || p < .26) { const t = title ? .35 : p / .26; offset = new THREE.Vector3(-7.7 + t * .7, 4.4, -9.3 + t * 1.1); targetLocal = new THREE.Vector3(0, 1.18, -1.9); }
    else if (p < .54) { const t = (p - .26) / .28; offset = new THREE.Vector3(-5.8, 3.5 + t * .4, -.6 + t * 1.4); targetLocal = new THREE.Vector3(0, 1.25, -.6); }
    else if (p < .73) { const t = (p - .54) / .19; offset = new THREE.Vector3(4.6 - t * .7, 2.7, -6.8); targetLocal = new THREE.Vector3(0, 1.4, -3.4); }
    else { const t = (p - .73) / .27; offset = new THREE.Vector3(-3 + t * 2.4, 4.5, 7.1); targetLocal = new THREE.Vector3(0, 1.35, -3.2); }
    const target = this.wagon.root.localToWorld(targetLocal), desired = this.wagon.root.localToWorld(offset);
    desired.y = Math.max(desired.y, terrainHeight(desired.x, desired.z) + 1.0);
    // Avoid putting the lens inside a trunk; tall foliage may still frame a shot naturally.
    if (this.collision.cameraBlocked(desired.x, desired.y, desired.z, 'wagon')) desired.y += 2;
    if (title || this.cameraLook.lengthSq() === 0) { this.camera.position.copy(desired); this.cameraLook.copy(target); }
    else { this.camera.position.lerp(desired, .055); this.cameraLook.lerp(target, .07); }
    this.camera.lookAt(this.cameraLook); this.camera.fov = 50; this.camera.updateProjectionMatrix();
  }
  get state(): AdventureState {
    return { story: this.narrator.state, mounted: this.mounted, interaction: this.interaction(), canMount: this.canMount(),
      wagon: { x: this.wagon.root.position.x, z: this.wagon.root.position.z, yaw: this.wagon.root.rotation.y, speed: this.wagon.speed },
      inventoryRevision: this.inventory.revision,
      horses: this.horses.map((h, i) => ({ x: h.root.position.x, z: h.root.position.z, yaw: h.root.rotation.y, sniffing: this.horseSniff[i] })) };
  }
  get needsRender() { return this.wagon.visualAnimating || this.previouslyPaused !== this.controller.paused; }
  save() {
    if (!this.inventory.arrived) return;
    const p = this.controller.position, w = this.wagon.root.position;
    this.inventory.savePosition({ x: w.x, z: w.z, yaw: this.wagon.root.rotation.y }, { x: p.x, z: p.z, yaw: this.controller.yaw }, this.mounted);
    this.inventory.saveTime({ month: this.clock.month, day: this.clock.day, minuteOfDay: Math.floor(this.clock.minuteOfDay) });
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.save(); this.narrator.dispose(); this.factory.dispose();
    this.collision.removeDynamic('wagon'); this.collision.removeDynamic('horses');
    this.materials.textures.forEach(t => t.dispose());
    this.horses.forEach(h => h.dispose()); this.wagon.oxen.forEach(h => h.dispose());
  }
}
