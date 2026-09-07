import * as THREE from 'three';
import { InventoryStore } from '../game/save';
import { Narrator, type NarratorState } from '../game/narrator';
import { journeyPose } from '../game/road';
import { CONTAINERS, emptyStock, type ContainerId, type ItemId } from '../game/items';
import { CollisionField, WORLD_LIMIT, pathDistance, terrainHeight } from './landscape';
import { PlayerController } from './controller';
import { loadAdventureMaterials, type AdventureMaterials } from './actors/materials';
import { AnimalFactory, type LivingAnimal } from './actors/animals';
import { HorseBrain, OxController, type HorseOutput, type WorldSnapshot } from './actors/behaviour';
import { SupplyWagon } from './actors/wagon';
import { AnimalAudio } from './audio';
import { loadCharacter, type CharacterSheet } from '../game/character';
import { createTrainingCombat, enemyTurn, takeAttack, takeSpell, type CombatState, type Combatant } from '../game/combat';
import { RulesEventLog } from '../game/rules';
import { addExperience } from '../game/progression';
import { saveCharacter } from '../game/character';

export interface Interaction { kind: 'cargo' | 'manifest' | 'horses'; id: string; label: string }
export interface AdventureState {
  story: NarratorState; mounted: boolean; interaction: Interaction | null; canMount: boolean; character: CharacterSheet | null;
  wagon: { x: number; z: number; yaw: number; speed: number }; inventoryRevision: number;
  horses: { x: number; z: number; yaw: number; sniffing: boolean }[];
  combat: CombatState | null;
}
function browserStorage() { try { return window.localStorage; } catch { return undefined; } }
export class Adventure {
  readonly inventory = new InventoryStore(browserStorage());
  readonly narrator = new Narrator();
  readonly wagon: SupplyWagon;
  readonly horses: LivingAnimal[];
  readonly animalAudio = new AnimalAudio();
  private horseBrains: HorseBrain[] = [];
  private combatSession: CombatState | null = null;
  readonly rulesEvents = new RulesEventLog();
  private oxController!: OxController;
  private horseOut: HorseOutput = { speed: 0, yaw: 0, head: { pitch: 0, yaw: 0 }, alert: 0, headDown: false };
  private clock = 0;
  private lastSave = 0;
  private lastBlockedToast = -10;
  private cameraLook = new THREE.Vector3();
  private horseSniff = [false, false];
  private lastWagonPosition = new THREE.Vector3();
  private previouslyPaused = false;
  private cinematicProgress = 0;
  private cameraLift = 0;
  private disposed = false;
  mounted = true;
  character: CharacterSheet | null;
  onHandoff = () => {};
  onNotice: (message: string) => void = () => {};
  private constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private controller: PlayerController, private collision: CollisionField, private factory: AnimalFactory, readonly materials: AdventureMaterials) {
    this.character = loadCharacter();
    this.controller.setEquipment(this.character?.classId ?? null);
    this.wagon = new SupplyWagon(factory, this.inventory); this.wagon.addTo(scene);
    this.horses = [factory.create('horse', '#765339', 2), factory.create('horse', '#b0aca0', 7)];
    this.horses.forEach(h => scene.add(h.root));
    this.horseBrains = [new HorseBrain(2), new HorseBrain(7)];
    this.horseBrains[0].place(9.3, 2.9, -.6); this.horseBrains[1].place(12.6, 1.2, 1.3);
    this.oxController = new OxController(this.wagon.oxen as [LivingAnimal, LivingAnimal]);
    this.oxController.onMoan = (side, strength) => { const ox = this.wagon.oxen[side], p = ox.root.position; this.animalAudio.low(p.x, p.z, strength, true); };
    for (let i = 0; i < 2; i++) {
      const i2 = i;
      this.horses[i].onFootfall = (_leg, x, z, strength) => this.animalAudio.hoof(x, z, strength, this.pathDistanceOf(x, z) < 1.2);
      this.wagon.oxen[i2].onFootfall = (_leg, x, z, strength) => this.animalAudio.hoof(x, z, strength * .85, this.pathDistanceOf(x, z) < 1.2);
    }
    const saved = this.inventory.snapshot(), pose = saved.arrived && saved.wagon ? saved.wagon : journeyPose(saved.arrived ? 1 : 0);
    this.wagon.setPose(pose.x, pose.z, pose.yaw); this.lastWagonPosition.copy(this.wagon.root.position);
    this.oxController.snap(pose.x, pose.z, pose.yaw);
    this.controller.setControlMode('cinematic'); this.controller.attachToSeat(this.wagon.seatPosition(), pose.yaw);
    this.narrator.onHandoff = () => this.handoff();
    this.narrator.onComplete = () => this.save();
    this.inventory.onChange = () => this.wagon.refreshCargo();
    this.updateHorses(.001); this.wagon.update(.001, 0, false);
    this.updateCamera(true); this.updateCollision();
  }
  static async create(scene: THREE.Scene, camera: THREE.PerspectiveCamera, controller: PlayerController, collision: CollisionField, renderer: THREE.WebGLRenderer, quality: 'performance' | 'balanced' | 'high' = 'high') {
    const materials = await loadAdventureMaterials(renderer), factory = await AnimalFactory.load(materials, quality === 'performance' ? .55 : quality === 'balanced' ? .8 : 1);
    const adventure = new Adventure(scene, camera, controller, collision, factory, materials);
    await adventure.narrator.initialize(); return adventure;
  }
  private pathDistanceOf(x: number, z: number) { return pathDistance(x, z); }
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
    this.oxController.snap(pose.x, pose.z, pose.yaw);
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
    if (!paused) this.clock += dt;
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
    if (!paused) this.updateOxen(dt, phase === 'journey');
    this.wagon.update(dt, paused ? 0 : distance, paused);
    if (!paused) this.updateHorses(dt);
    this.updateCollision();
    if (phase === 'title' || phase === 'journey') this.updateCamera(phase === 'title');
    else if (Math.abs(this.camera.fov - (this.controller.mode === 'first' ? 72 : 59)) > .1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.controller.mode === 'first' ? 72 : 59, 5, dt); this.camera.updateProjectionMatrix();
    }
    if (phase !== 'title' && phase !== 'journey' && this.clock - this.lastSave > 2.5) { this.lastSave = this.clock; this.save(); }
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
      // Ease to a stop instead of freezing mid-stride; the oxen settle.
      this.wagon.speed = THREE.MathUtils.damp(this.wagon.speed, 0, 10, dt);
      if (this.clock - this.lastBlockedToast > 7) { this.lastBlockedToast = this.clock; this.onNotice('The oxen don’t like that stretch. Steer back to the road, or press R to go on foot.'); }
      return 0;
    }
    this.wagon.setPose(x, z, yaw); this.lastWagonPosition.copy(this.wagon.root.position);
    return Math.hypot(x - old.x, z - old.z) * Math.sign(this.wagon.speed);
  }
  lastBlock: { probe: [number, number]; reason: string; x: number; z: number } | null = null;
  private canDriveAt(x: number, z: number, yaw: number) {
    if (Math.abs(x) > WORLD_LIMIT - 7 || Math.abs(z) > WORLD_LIMIT - 7) { this.lastBlock = { probe: [0, 0], reason: 'world edge', x, z }; return false; }
    const y = terrainHeight(x, z);
    const points = [[-.98, -1.2], [.98, -1.2], [-.98, 1.2], [.98, 1.2], [-.72, -4.95], [.72, -4.95]];
    for (const [px, pz] of points) {
      const wx = x + px * Math.cos(yaw) + pz * Math.sin(yaw), wz = z - px * Math.sin(yaw) + pz * Math.cos(yaw);
      if (terrainHeight(wx, wz) - y > .44) { this.lastBlock = { probe: [px, pz], reason: 'steep ground', x: wx, z: wz }; return false; }
      for (const c of this.collision.query(wx, wz, .2)) {
        if (c.group === 'wagon') continue;
        if (Math.hypot(wx - c.x, wz - c.z) < c.radius + .17 && c.top > y + .3) { this.lastBlock = { probe: [px, pz], reason: `collider (${c.group ?? 'static'}) @ ${c.x.toFixed(1)},${c.z.toFixed(1)} r${c.radius.toFixed(2)}`, x: wx, z: wz }; return false; }
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
  canMount() { return this.inventory.arrived && this.controller.position.distanceTo(this.wagon.seatPosition()) < 4.5; }
  returnToWagon() { if (this.inventory.arrived) { this.mount(); this.save(); } }
  canReach(id: ContainerId) {
    if (!CONTAINERS.some(c => c.id === id) || !this.inventory.arrived || this.narrator.state.phase === 'journey') return false;
    const p = this.wagon.cargoPosition(id), player = this.controller.position;
    // Mounted, the driver reaches across the bed; on foot, a forgiving ellipse.
    const reach = this.mounted ? 6.5 : 3.2;
    return Math.hypot(p.x - player.x, p.z - player.z) < reach && Math.abs(p.y - player.y) < 2.3;
  }
  openCargo(id: ContainerId) { return this.canReach(id) && this.inventory.open(id); }
  toggleCargo(id: ContainerId): 'opened' | 'closed' | false {
    if (!this.canReach(id)) return false;
    return this.inventory.isOpen(id) ? (this.inventory.close(id) ? 'closed' : false) : (this.inventory.open(id) ? 'opened' : false);
  }
  take(id: ContainerId, item: ItemId, quantity: number) { return this.canReach(id) && this.inventory.take(id, item, quantity); }
  takeAll(id: ContainerId) { return this.canReach(id) ? this.inventory.takeAll(id) : emptyStock(); }
  interaction(): Interaction | null {
    if (!this.inventory.arrived || this.narrator.state.phase === 'journey' || !this.controller.started) return null;
    if (this.mounted) return { kind: 'manifest', id: 'wagon', label: 'Inspect the cargo manifest' };
    const player = this.controller.position;
    const nearby = CONTAINERS.filter(c => this.canReach(c.id)).map(c => ({ c, d: this.wagon.cargoPosition(c.id).distanceTo(player) })).sort((a, b) => a.d - b.d)[0];
    if (nearby) return { kind: 'cargo', id: nearby.c.id, label: `${this.inventory.isOpen(nearby.c.id) ? 'Close' : 'Open'} ${nearby.c.name.toLowerCase()}` };
    if (Math.hypot(player.x - 9.7, player.z - 2) < 4) return { kind: 'horses', id: 'clearing', label: 'Examine the ransacked belongings' };
    return null;
  }
  private snapshot(): WorldSnapshot {
    return { time: this.clock, player: this.controller.position,
      wagon: { x: this.wagon.root.position.x, z: this.wagon.root.position.z, yaw: this.wagon.root.rotation.y, speed: this.wagon.speed } };
  }
  private updateOxen(dt: number, journey: boolean) {
    const wagon = this.wagon;
    this.oxController.update(dt, { x: wagon.root.position.x, z: wagon.root.position.z, yaw: wagon.root.rotation.y, speed: wagon.speed,
      steering: wagon.steering, braking: this.controller.keys.has('Space') && Math.abs(wagon.speed) > .25 }, journey);
  }
  /** The `Call` verb (Workstream E) routes here. */
  callHorse(): boolean {
    const p = this.controller.position;
    let best = -1, bestD = Infinity;
    this.horseBrains.forEach((b, i) => { const d = Math.hypot(b.x - p.x, b.z - p.z); if (d < bestD) { bestD = d; best = i; } });
    return best >= 0 ? this.horseBrains[best].call() : false;
  }
  private updateHorses(dt: number) {
    const world = this.snapshot();
    for (let i = 0; i < this.horses.length; i++) {
      const horse = this.horses[i], brain = this.horseBrains[i];
      const other = this.horseBrains[1 - i];
      brain.update(dt, { x: other.x, z: other.z }, world, this.horseOut);
      const out = this.horseOut;
      horse.root.position.x = brain.x; horse.root.position.z = brain.z;
      horse.root.position.y = terrainHeight(brain.x, brain.z) + .01;
      horse.root.rotation.y = brain.yaw;
      horse.update(dt, { speed: out.speed, head: out.head, alert: out.alert, strain: 0 });
      this.horseSniff[i] = out.headDown;
      if (brain.snortAt > 0) { this.animalAudio.snort(brain.x, brain.z); brain.snortAt = -1; }
      if (brain.whinnyAt > 0) { this.animalAudio.whinny(brain.x, brain.z); brain.whinnyAt = -1; }
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
    const blocked = this.collision.cameraBlocked(desired.x, desired.y, desired.z, 'wagon');
    this.cameraLift = THREE.MathUtils.damp(this.cameraLift, blocked ? 1 : 0, 4, .016);
    desired.y += this.cameraLift * 2;
    if (title || this.cameraLook.lengthSq() === 0) { this.camera.position.copy(desired); this.cameraLook.copy(target); }
    else { this.camera.position.lerp(desired, .055); this.cameraLook.lerp(target, .07); }
    this.camera.lookAt(this.cameraLook); this.camera.fov = 50; this.camera.updateProjectionMatrix();
  }
  startTrainingCombat() {
    if (!this.character || this.narrator.state.phase === 'journey' || this.narrator.state.phase === 'title' || this.combatSession) return false;
    const c: Combatant = { actor: { id: this.character.id, level: this.character.level, abilities: this.character.abilities, proficientAbilities: this.character.savingThrows, skills: Object.fromEntries(this.character.skillProficiencies.map(skill => [skill, { proficient: true }])) }, hp: { hp: this.character.maxHp, maxHp: this.character.maxHp, temporaryHp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: false }, armorClass: this.character.armorClass, conditions: [], budget: { movement: 30, movementUsed: 0, action: true, bonusAction: true, reaction: true, object: true, freeSpeech: true }, side: 'party', spells: this.character.classId === 'wizard' ? ['fireBolt', 'rayOfFrost', 'cureWounds'] : [] };
    this.combatSession = createTrainingCombat(c); this.rulesEvents.append('CombatStarted', this.clock, { encounter: 'ambush-training' }, this.character.id); this.setPaused(true); return true;
  }
  combatAttack(targetId: string) { if (!this.combatSession) return false; const ok = takeAttack(this.combatSession, targetId, Math.floor(this.clock * 1000) + this.combatSession.round); if (ok) this.advanceEnemyTurns(); return ok; }
  combatCast(spellId: string, targetId: string) { if (!this.combatSession) return false; const ok = takeSpell(this.combatSession, spellId, targetId, Math.floor(this.clock * 1000) + this.combatSession.round); if (ok) this.advanceEnemyTurns(); return ok; }
  private advanceEnemyTurns() { while (this.combatSession && !this.combatSession.finished && this.combatSession.combatants.find(c => c.actor.id === this.combatSession!.activeId)?.side === 'enemy') enemyTurn(this.combatSession, Math.floor(this.clock * 1000) + this.combatSession.round); }
  finishCombat() {
    if (!this.combatSession) return;
    if (this.combatSession.finished && this.combatSession.xp && this.character) {
      const result = addExperience(this.character, this.combatSession.xp); this.character = result.sheet; saveCharacter(this.character);
      this.rulesEvents.append('CombatFinished', this.clock, { xp: this.combatSession.xp, levels: result.levels }, this.character.id);
    }
    this.combatSession = null; this.setPaused(false);
  }
  get combat() { return this.combatSession; }
  get state(): AdventureState {
    return { story: this.narrator.state, mounted: this.mounted, interaction: this.interaction(), canMount: this.canMount(), character: this.character,
      wagon: { x: this.wagon.root.position.x, z: this.wagon.root.position.z, yaw: this.wagon.root.rotation.y, speed: this.wagon.speed },
      inventoryRevision: this.inventory.revision,
      horses: this.horses.map((h, i) => ({ x: h.root.position.x, z: h.root.position.z, yaw: h.root.rotation.y, sniffing: this.horseSniff[i] })), combat: this.combatSession };
  }
  get needsRender() { return this.wagon.visualAnimating || this.previouslyPaused !== this.controller.paused; }
  save() {
    if (!this.inventory.arrived) return;
    const p = this.controller.position, w = this.wagon.root.position;
    this.inventory.savePosition({ x: w.x, z: w.z, yaw: this.wagon.root.rotation.y }, { x: p.x, z: p.z, yaw: this.controller.yaw }, this.mounted);
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.save(); this.narrator.dispose(); this.factory.dispose(); this.animalAudio.dispose();
    this.collision.removeDynamic('wagon'); this.collision.removeDynamic('horses');
    this.materials.textures.forEach(t => t.dispose());
    this.horses.forEach(h => h.mesh.skeleton.dispose()); this.wagon.oxen.forEach(h => h.mesh.skeleton.dispose());
  }
}
