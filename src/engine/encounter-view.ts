import * as THREE from 'three';
import { Encounter, type Combatant, type Vec2 } from '../game/encounter';
import { AMBUSHERS, GOBLIN_TRAIL_MOUTH } from '../game/ambush';
import { MONSTERS } from '../game/bestiary';
import { feetToMetres, hasCondition, metresToFeet } from '../game/rules';
import { WEAPONS, isRanged } from '../game/equipment';
import { terrainHeight, type CollisionField } from './landscape';
import { Humanoid, type HumanoidPose } from './actors/humanoid';
import { buildArrow, buildWeapon, type CombatMaterials } from './actors/combat-materials';
import { CombatFx } from './combat-fx';

/**
 * The bridge between the deterministic encounter engine and the 3D world.
 *
 * The engine owns positions in metres and never touches Three.js. This view
 * owns the actors, the tactical overlays, and the interpolation that makes a
 * discrete turn read as a continuous physical event: a goblin does not
 * teleport to its new square, it runs there, swings, and the log entry lands
 * when the blade does.
 */

interface ActorView {
  combatant: Combatant;
  body: Humanoid;
  /** Smoothed world position, chasing the engine's authoritative one. */
  visual: THREE.Vector3;
  velocity: number;
  actionPhase: number;
  actionPose: HumanoidPose;
  hidden: boolean;
  revealed: boolean;
  revealT: number;
  selectionRing: THREE.Mesh;
  healthBar: { group: THREE.Group; fill: THREE.Mesh; back: THREE.Mesh };
  /** Director-driven one-shot pose that outranks the engine's animation flag. */
  override: { pose: HumanoidPose; t: number; duration: number; atImpact: number } | null;
  /** Engine pose changes are ignored until this presentation clock time. */
  holdUntil: number;
  /** Health the bar has actually revealed (damage lands with the blow, not the rules tick). */
  shownHp: number;
  hpRevealed: boolean;
}

interface Tracer { mesh: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; duration: number; arc: number }

export class EncounterView {
  readonly group = new THREE.Group();
  readonly fx: CombatFx;
  private actors = new Map<string, ActorView>();
  private tracers: Tracer[] = [];
  private moveOverlay: THREE.Mesh;
  private threatOverlay: THREE.Mesh;
  private pathLine: THREE.Line;
  private targetMarker: THREE.Group;
  private clock = 0;
  private detail: number;

  /** Set by the world when the player is choosing a destination. */
  hoverPoint: THREE.Vector3 | null = null;
  hoveredActorId: string | null = null;
  onLogAdvance: () => void = () => {};

  constructor(
    private encounter: Encounter,
    private materials: CombatMaterials,
    quality: 'performance' | 'balanced' | 'high',
  ) {
    this.detail = quality === 'performance' ? 0.6 : quality === 'balanced' ? 0.85 : 1;
    this.group.name = 'Encounter';
    this.fx = new CombatFx(this.group);

    // --- tactical overlays -------------------------------------------------
    // A soft, shader-driven movement disc rather than a hard grid: it shows
    // reach honestly without turning the forest floor into a spreadsheet.
    this.moveOverlay = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 1, 96, 1),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color('#7fd4ff') }, uTime: { value: 0 }, uOpacity: { value: 0 } },
        vertexShader: 'varying vec2 vUv; varying vec3 vPos; void main(){vUv=uv;vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `
          uniform vec3 uColor; uniform float uTime, uOpacity; varying vec2 vUv; varying vec3 vPos;
          void main(){
            float r = length(vPos.xy);
            // A bright rim, a faint fill, and a slow sweep so it reads as live.
            float rim = smoothstep(.86, 1., r) * (1. - smoothstep(.995, 1., r));
            float fill = (1. - smoothstep(.0, 1., r)) * .16;
            float sweep = .5 + .5 * sin(atan(vPos.y, vPos.x) * 3. - uTime * 1.6);
            float a = (rim * (.55 + sweep * .45) + fill) * uOpacity;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    );
    this.moveOverlay.rotation.x = -Math.PI / 2;
    this.moveOverlay.renderOrder = 3;
    this.moveOverlay.visible = false;
    this.group.add(this.moveOverlay);

    this.threatOverlay = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 1, 72, 1),
      new THREE.MeshBasicMaterial({ color: '#ff6b52', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.threatOverlay.rotation.x = -Math.PI / 2;
    this.threatOverlay.renderOrder = 2;
    this.threatOverlay.visible = false;
    this.group.add(this.threatOverlay);

    const pathGeometry = new THREE.BufferGeometry();
    pathGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(64 * 3), 3));
    this.pathLine = new THREE.Line(pathGeometry, new THREE.LineBasicMaterial({ color: '#bfe9ff', transparent: true, opacity: 0.85, depthTest: false }));
    this.pathLine.renderOrder = 5;
    this.pathLine.visible = false;
    this.group.add(this.pathLine);

    this.targetMarker = this.buildTargetMarker();
    this.group.add(this.targetMarker);
  }

  private buildTargetMarker() {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: '#ff8264', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
    // Four corner brackets, the universal "this one" reticle.
    for (let i = 0; i < 4; i++) {
      const bracket = new THREE.Group();
      const a = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.028), material);
      a.position.x = 0.08;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.16), material);
      b.position.y = -0.08;
      bracket.add(a, b);
      bracket.rotation.z = i * Math.PI / 2;
      bracket.position.set(0.34 * (i === 0 || i === 3 ? -1 : 1), 0.34 * (i < 2 ? 1 : -1), 0);
      group.add(bracket);
    }
    group.renderOrder = 6;
    group.visible = false;
    return group;
  }

  /** Build a 3D actor for every combatant the engine knows about. */
  spawnAll(scene: THREE.Scene) {
    for (const combatant of this.encounter.combatants) {
      if (combatant.side !== 'enemy') continue;   // the player uses the existing avatar
      this.spawnEnemy(combatant);
    }
    scene.add(this.group);
  }

  private spawnEnemy(combatant: Combatant) {
    const monster = combatant.monsterId ? MONSTERS[combatant.monsterId] : undefined;
    if (!monster) return;
    const visual = monster.visual;

    const body = new Humanoid(
      {
        height: visual.height, build: visual.height > 1.6 ? 'stocky' : 'lean',
        earLength: visual.height * 0.16, noseLength: visual.height * 0.085,
        species: visual.archetype === 'goblinoid' ? 'goblin' : 'human',
      },
      this.materials, visual.skin, visual.cloth,
      Math.floor(Math.abs(Math.sin(combatant.id.length * 7.3) * 1000)), this.detail,
    );
    body.place(combatant.position.x, combatant.position.z, combatant.facing);

    const weapon = buildWeapon(visual.weapon, this.materials, visual.height / 1.6);
    // A bow is carried in the left hand, across the body.
    if (visual.weapon === 'shortbow') {
      weapon.rotation.set(0, Math.PI / 2, 0.35);
      body.bones[8].add(weapon);          // handL
    } else {
      body.weapon.add(weapon);
      // The printed goblin stat block includes a shield. Give the melee
      // variants a visible, battered one so their defensive animation reads
      // as more than a floating sword hand.
      const shield = new THREE.Mesh(
        new THREE.CylinderGeometry(visual.height * .13, visual.height * .15, visual.height * .045, 14),
        this.materials.leather,
      );
      shield.rotation.x = Math.PI / 2;
      shield.position.set(0, 0, -.055);
      shield.castShadow = true;
      const boss = new THREE.Mesh(new THREE.SphereGeometry(visual.height * .032, 8, 6), this.materials.bronze);
      boss.position.z = -.08;
      shield.add(boss);
      body.bones[8].add(shield); // off hand
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.42, 40),
      new THREE.MeshBasicMaterial({ color: '#ff7a5c', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 4;

    const healthBar = this.buildHealthBar();
    healthBar.group.visible = false;

    this.group.add(body.root, ring, healthBar.group);

    const view: ActorView = {
      combatant, body, visual: new THREE.Vector3(combatant.position.x, 0, combatant.position.z),
      velocity: 0, actionPhase: 0, actionPose: 'idle',
      hidden: true, revealed: false, revealT: 0, selectionRing: ring, healthBar,
      override: null, holdUntil: 0, shownHp: combatant.health.hp, hpRevealed: false,
    };
    this.actors.set(combatant.id, view);

    body.onFootfall = (_side, x, z, strength) => this.onFootfall?.(x, z, strength);
  }

  onFootfall: ((x: number, z: number, strength: number) => void) | undefined;

  private buildHealthBar() {
    const group = new THREE.Group();
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.075),
      new THREE.MeshBasicMaterial({ color: '#120d0a', transparent: true, opacity: 0.72, depthTest: false }),
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.60, 0.055),
      new THREE.MeshBasicMaterial({ color: '#c8503c', depthTest: false }),
    );
    fill.position.z = 0.001;
    group.add(back, fill);
    group.renderOrder = 7;
    return { group, fill, back };
  }

  /** Goblins stay in the thicket until the ambush springs. */
  reveal() {
    for (const view of this.actors.values()) {
      view.revealed = true;
      view.hidden = false;
    }
  }

  /** Where the engine wants each enemy to be, snapped to the terrain. */
  private groundAt(x: number, z: number) { return terrainHeight(x, z); }

  update(dt: number, camera: THREE.PerspectiveCamera, playerPosition: THREE.Vector3) {
    this.clock += dt;
    this.encounter.tick(dt);

    const active = this.encounter.active;
    const material = this.moveOverlay.material as THREE.ShaderMaterial;
    material.uniforms.uTime.value = this.clock;

    for (const view of this.actors.values()) {
      const c = view.combatant;
      // Nimble Escape and a successful Hide are visual state, not just a log
      // line: the body fades back into a crouched thicket silhouette and can
      // no longer be clicked as a target until it is revealed again.
      const concealed = hasCondition(c.conditions, 'invisible');
      view.hidden = !view.revealed || concealed;
      const target = new THREE.Vector3(c.position.x, 0, c.position.z);
      const gap = view.visual.distanceTo(target);

      // Chase the authoritative position; the speed is the creature's own,
      // so a 30 ft move takes the time a 30 ft move should take.
      const runSpeed = feetToMetres(c.speed) / 1.4;
      if (gap > 0.02) {
        const step = Math.min(gap, runSpeed * dt);
        view.visual.lerp(target, step / gap);
        view.velocity = step / Math.max(dt, 1e-4);
        // Face the direction of travel while moving.
        const desired = Math.atan2(target.x - view.visual.x, target.z - view.visual.z);
        view.body.root.rotation.y = this.dampAngle(view.body.root.rotation.y, desired, 9, dt);
      } else {
        view.velocity = THREE.MathUtils.damp(view.velocity, 0, 10, dt);
        if (view.velocity < 0.05) {
          view.body.root.rotation.y = this.dampAngle(view.body.root.rotation.y, c.facing, 7, dt);
        }
      }

      view.body.root.position.set(view.visual.x, this.groundAt(view.visual.x, view.visual.z), view.visual.z);

      // A director-driven strike outranks the engine's animation flag, and a
      // hold stops the engine's instant resolution from leaking onto the
      // target before the blow actually lands.
      if (view.override) {
        view.override.t += dt;
        const o = view.override;
        if (o.t >= o.duration) {
          view.override = null;
          view.actionPose = 'idle';
          view.actionPhase = 0;
        } else {
          view.actionPose = o.pose;
          // The animation phase is warped so the strike connects exactly at
          // `atImpact` — wind-up before it, follow-through after.
          const phase = o.t < o.atImpact
            ? (o.t / o.atImpact) * o.atImpact
            : o.atImpact + ((o.t - o.atImpact) / Math.max(0.001, o.duration - o.atImpact)) * (1 - o.atImpact);
          view.actionPhase = THREE.MathUtils.clamp(phase, 0, 1);
        }
      } else if (this.clock >= view.holdUntil) {
        const enginePose = c.animation;
        if (enginePose === 'attack' || enginePose === 'cast' || enginePose === 'hurt') {
          const monster = c.monsterId ? MONSTERS[c.monsterId] : undefined;
          const ranged = monster?.visual.weapon === 'shortbow';
          const pose = enginePose === 'attack' ? (ranged ? 'shoot' : 'attack') : enginePose;
          if (view.actionPose !== pose) { view.actionPose = pose; view.actionPhase = 0; }
          view.actionPhase = Math.min(1, view.actionPhase + dt / (pose === 'shoot' ? 0.9 : 0.65));
        } else if (enginePose === 'down' || enginePose === 'dead') {
          view.actionPose = enginePose;
        } else if (view.actionPhase >= 1 || view.actionPose === 'idle') {
          view.actionPose = 'idle'; view.actionPhase = 0;
        } else {
          view.actionPhase = Math.min(1, view.actionPhase + dt / 0.65);
        }
      }

      // A hidden goblin crouches in the bracken and does not look at you.
      view.revealT = THREE.MathUtils.damp(view.revealT, view.hidden ? 0 : 1, 3.5, dt);
      const crouch = (1 - view.revealT) * 0.95;

      view.body.update(dt, {
        speed: view.velocity,
        pose: view.actionPose === 'idle' ? (view.velocity > 2.0 ? 'run' : view.velocity > 0.3 ? 'walk' : 'idle') : view.actionPose,
        crouch,
        lookAt: view.hidden ? undefined : playerPosition,
        actionPhase: view.actionPhase,
      });

      // --- overlays --------------------------------------------------------
      const alive = c.health.hp > 0 && !c.health.dead;
      const isActive = active?.id === c.id;
      const isHovered = this.hoveredActorId === c.id;

      const ringMat = view.selectionRing.material as THREE.MeshBasicMaterial;
      const wanted = !alive ? 0 : isActive ? 0.85 : isHovered ? 0.6 : 0.22;
      ringMat.opacity = THREE.MathUtils.damp(ringMat.opacity, view.hidden ? 0 : wanted, 8, dt);
      ringMat.color.set(isActive ? '#ffcf6b' : '#ff7a5c');
      view.selectionRing.position.set(view.visual.x, this.groundAt(view.visual.x, view.visual.z) + 0.03, view.visual.z);
      const pulse = isActive ? 1 + Math.sin(this.clock * 3.4) * 0.06 : 1;
      view.selectionRing.scale.setScalar(pulse);

      // Health bars billboard to the camera and hide when full and unhovered.
      const bar = view.healthBar;
      const showBar = alive && !view.hidden && (isHovered || isActive || c.health.hp < c.health.maxHp);
      bar.group.visible = showBar;
      if (showBar) {
        bar.group.position.set(view.visual.x, this.groundAt(view.visual.x, view.visual.z) + view.body.headHeight + 0.30, view.visual.z);
        bar.group.quaternion.copy(camera.quaternion);
        if (view.hpRevealed) view.shownHp = THREE.MathUtils.damp(view.shownHp, Math.max(0, c.health.hp), 9, dt);
        const ratio = Math.max(0, Math.min(1, view.shownHp / c.health.maxHp));
        bar.fill.scale.x = Math.max(0.001, ratio);
        bar.fill.position.x = -0.30 * (1 - ratio);
        (bar.fill.material as THREE.MeshBasicMaterial).color.set(ratio > 0.5 ? '#8fbf5a' : ratio > 0.25 ? '#e0a63c' : '#c8503c');
        // Scale the bar down with distance so a distant goblin is not a billboard.
        const d = camera.position.distanceTo(bar.group.position);
        bar.group.scale.setScalar(THREE.MathUtils.clamp(d / 12, 0.6, 2.2));
      }
    }

    this.updateOverlays(dt, playerPosition);
    this.updateTracers(dt);
    this.fx.update(dt, camera, window.innerWidth, window.innerHeight);
  }

  // -- director choreography ------------------------------------------------

  /** Force a one-shot pose; `atImpact` is the animation fraction where the blow connects. */
  playPose(id: string, pose: HumanoidPose, duration: number, atImpact = 0.5) {
    const view = this.actors.get(id);
    if (!view) return;
    view.override = { pose, t: 0, duration, atImpact };
    view.actionPose = pose;
    view.actionPhase = 0;
  }

  /** Suppress engine-driven pose changes until the presentation clock reaches +seconds. */
  holdPose(id: string, seconds: number) {
    const view = this.actors.get(id);
    if (view) view.holdUntil = this.clock + seconds;
  }

  /** The struck body reacts: a flinch, or a collapse when it dropped. */
  reactToHit(id: string, killed: boolean) {
    const view = this.actors.get(id);
    if (!view) return;
    view.holdUntil = 0;
    view.hpRevealed = true;
    if (killed || view.combatant.health.dead) this.playPose(id, 'down', 1.0, 0.35);
    else this.playPose(id, 'hurt', 0.55, 0.16);
  }

  /** Has the movement chase caught up with the engine's square? */
  settled(id: string): boolean {
    const view = this.actors.get(id);
    if (!view) return true;
    const target = new THREE.Vector3(view.combatant.position.x, 0, view.combatant.position.z);
    return view.visual.distanceTo(target) < 0.09;
  }

  /** How far the actor still has to run, in metres. */
  remainingMove(id: string): number {
    const view = this.actors.get(id);
    if (!view) return 0;
    return view.visual.distanceTo(new THREE.Vector3(view.combatant.position.x, 0, view.combatant.position.z));
  }

  /** Chest-height anchor for arcs, bursts and blood. */
  chestOf(id: string): THREE.Vector3 | null {
    const view = this.actors.get(id);
    if (!view) return null;
    return new THREE.Vector3(view.visual.x, this.groundAt(view.visual.x, view.visual.z) + view.body.headHeight * 0.62, view.visual.z);
  }

  /** Loose an arrow from one actor at another; returns the flight time in seconds. */
  fireArrow(attackerId: string, targetId: string): number {
    const from = this.chestOf(attackerId), to = this.chestOf(targetId);
    if (!from || !to) return 0.35;
    this.spawnTracer(from, to, 'arrow');
    return Math.max(0.14, from.distanceTo(to) / 34);
  }

  /** Loose a spell bolt; returns the flight time in seconds. */
  fireBolt(fromId: string, toId: string, kind: 'fire' | 'frost' | 'force'): number {
    const from = this.chestOf(fromId), to = this.chestOf(toId);
    if (!from || !to) return 0.3;
    this.spawnTracer(from, to, kind);
    return Math.max(0.14, from.distanceTo(to) / 22);
  }

  /** Reveal everyone's true health — used when the encounter ends. */
  revealAllHealth() {
    for (const view of this.actors.values()) view.hpRevealed = true;
  }

  private dampAngle(current: number, target: number, lambda: number, dt: number) {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + delta * (1 - Math.exp(-lambda * dt));
  }

  /** Movement radius, threatened zones, and the path preview. */
  private updateOverlays(dt: number, playerPosition: THREE.Vector3) {
    const active = this.encounter.active;
    const material = this.moveOverlay.material as THREE.ShaderMaterial;

    const showMove = !!active && active.side === 'party' && !this.encounter.finished && active.health.hp > 0;
    if (showMove && active) {
      const remainingFeet = Math.max(0, active.budget.movement - active.budget.movementUsed);
      const radius = feetToMetres(remainingFeet);
      this.moveOverlay.visible = radius > 0.2;
      this.moveOverlay.position.set(playerPosition.x, this.groundAt(playerPosition.x, playerPosition.z) + 0.02, playerPosition.z);
      this.moveOverlay.scale.setScalar(Math.max(0.001, radius));
      material.uniforms.uOpacity.value = THREE.MathUtils.damp(material.uniforms.uOpacity.value, 0.9, 6, dt);
    } else {
      material.uniforms.uOpacity.value = THREE.MathUtils.damp(material.uniforms.uOpacity.value, 0, 6, dt);
      if (material.uniforms.uOpacity.value < 0.02) this.moveOverlay.visible = false;
    }

    // Threat: the reach of whichever enemy is nearest the cursor.
    const hovered = this.hoveredActorId ? this.actors.get(this.hoveredActorId) : null;
    if (hovered && hovered.combatant.health.hp > 0 && !hovered.hidden) {
      const monster = hovered.combatant.monsterId ? MONSTERS[hovered.combatant.monsterId] : undefined;
      const reach = feetToMetres(monster?.actions.find(a => a.kind === 'melee')?.reach ?? 5);
      this.threatOverlay.visible = true;
      this.threatOverlay.position.set(hovered.visual.x, this.groundAt(hovered.visual.x, hovered.visual.z) + 0.025, hovered.visual.z);
      this.threatOverlay.scale.setScalar(reach + 0.4);
      this.targetMarker.visible = true;
      this.targetMarker.position.set(hovered.visual.x, this.groundAt(hovered.visual.x, hovered.visual.z) + hovered.body.headHeight * 0.55, hovered.visual.z);
      this.targetMarker.scale.setScalar(Math.max(0.7, hovered.body.headHeight));
    } else {
      this.threatOverlay.visible = false;
      this.targetMarker.visible = false;
    }

    // Path preview from the player to the hovered ground point.
    if (showMove && this.hoverPoint && !this.hoveredActorId) {
      const from = playerPosition, to = this.hoverPoint;
      const total = Math.hypot(to.x - from.x, to.z - from.z);
      const remaining = feetToMetres(Math.max(0, active!.budget.movement - active!.budget.movementUsed));
      const reachable = Math.min(total, remaining);
      const attr = this.pathLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const segments = attr.count;
      for (let i = 0; i < segments; i++) {
        const t = (i / (segments - 1)) * reachable;
        const x = from.x + (to.x - from.x) / (total || 1) * t;
        const z = from.z + (to.z - from.z) / (total || 1) * t;
        attr.setXYZ(i, x, this.groundAt(x, z) + 0.07, z);
      }
      attr.needsUpdate = true;
      this.pathLine.visible = reachable > 0.3;
      (this.pathLine.material as THREE.LineBasicMaterial).color.set(total > remaining ? '#ffa06b' : '#bfe9ff');
    } else {
      this.pathLine.visible = false;
    }
  }

  /** Feet of movement the given ground point would cost the active combatant. */
  moveCostFeet(from: THREE.Vector3, to: THREE.Vector3) {
    return metresToFeet(Math.hypot(to.x - from.x, to.z - from.z));
  }

  /** Fire a visible projectile from one actor to another. */
  launchArrow(fromId: string, toId: string) {
    const from = this.actors.get(fromId), to = this.actors.get(toId);
    const origin = from
      ? new THREE.Vector3(from.visual.x, this.groundAt(from.visual.x, from.visual.z) + from.body.headHeight * 0.82, from.visual.z)
      : null;
    const target = to
      ? new THREE.Vector3(to.visual.x, this.groundAt(to.visual.x, to.visual.z) + to.body.headHeight * 0.6, to.visual.z)
      : null;
    if (!origin || !target) return;
    this.spawnTracer(origin, target, 'arrow');
  }

  /** Arrow or bolt of flame between two arbitrary world points. */
  spawnTracer(from: THREE.Vector3, to: THREE.Vector3, kind: 'arrow' | 'fire' | 'frost' | 'force') {
    let mesh: THREE.Object3D;
    if (kind === 'arrow') {
      mesh = buildArrow(this.materials, 1);
    } else {
      const colour = kind === 'fire' ? '#ff8b3c' : kind === 'frost' ? '#9fd8ff' : '#c4a6ff';
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 12, 10),
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.95 }),
      );
      const light = new THREE.PointLight(colour, 4, 5, 2);
      mesh.add(light);
    }
    mesh.position.copy(from);
    this.group.add(mesh);
    const distance = from.distanceTo(to);
    this.tracers.push({
      mesh, from: from.clone(), to: to.clone(), t: 0,
      duration: Math.max(0.14, distance / (kind === 'arrow' ? 34 : 22)),
      arc: kind === 'arrow' ? distance * 0.045 : 0,
    });
  }

  private updateTracers(dt: number) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.t += dt / tracer.duration;
      if (tracer.t >= 1) {
        this.group.remove(tracer.mesh);
        tracer.mesh.traverse(o => {
          if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
        });
        this.tracers.splice(i, 1);
        continue;
      }
      const t = tracer.t;
      const position = tracer.from.clone().lerp(tracer.to, t);
      // A shallow ballistic arc so an arrow does not travel on a laser line.
      position.y += Math.sin(t * Math.PI) * tracer.arc;
      tracer.mesh.position.copy(position);
      // Point the arrow along its own velocity.
      const ahead = tracer.from.clone().lerp(tracer.to, Math.min(1, t + 0.03));
      ahead.y += Math.sin(Math.min(1, t + 0.03) * Math.PI) * tracer.arc;
      if (ahead.distanceToSquared(position) > 1e-8) {
        tracer.mesh.lookAt(ahead);
        tracer.mesh.rotateY(Math.PI);
      }
    }
  }

  /** World position of an enemy, for the camera and the UI. */
  positionOf(id: string): THREE.Vector3 | null {
    const view = this.actors.get(id);
    if (!view) return null;
    return new THREE.Vector3(view.visual.x, this.groundAt(view.visual.x, view.visual.z), view.visual.z);
  }

  /** Screen-space projection, so the HUD can pin a nameplate to a goblin. */
  screenPosition(id: string, camera: THREE.PerspectiveCamera, width: number, height: number) {
    const view = this.actors.get(id);
    if (!view) return null;
    const p = new THREE.Vector3(view.visual.x, this.groundAt(view.visual.x, view.visual.z) + view.body.headHeight + 0.55, view.visual.z);
    p.project(camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height, behind: p.z > 1 };
  }

  /** Ray-pick an enemy under the cursor. */
  pick(raycaster: THREE.Raycaster): string | null {
    let best: { id: string; distance: number } | null = null;
    for (const [id, view] of this.actors) {
      if (view.combatant.health.hp <= 0 || view.hidden) continue;
      const centre = new THREE.Vector3(view.visual.x, this.groundAt(view.visual.x, view.visual.z) + view.body.headHeight * 0.5, view.visual.z);
      const sphere = new THREE.Sphere(centre, Math.max(0.55, view.body.headHeight * 0.55));
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectSphere(sphere, hit)) {
        const distance = raycaster.ray.origin.distanceTo(hit);
        if (!best || distance < best.distance) best = { id, distance };
      }
    }
    return best?.id ?? null;
  }

  /** The surviving goblin breaks for the trail rather than dying in place. */
  fleeToTrail(id: string) {
    const view = this.actors.get(id);
    if (!view) return;
    view.combatant.position = { ...GOBLIN_TRAIL_MOUTH };
  }

  dispose(scene: THREE.Scene) {
    for (const view of this.actors.values()) {
      view.body.dispose();
      view.selectionRing.geometry.dispose();
      (view.selectionRing.material as THREE.Material).dispose();
      view.healthBar.fill.geometry.dispose();
      view.healthBar.back.geometry.dispose();
    }
    this.actors.clear();
    for (const tracer of this.tracers) this.group.remove(tracer.mesh);
    this.tracers = [];
    this.moveOverlay.geometry.dispose(); (this.moveOverlay.material as THREE.Material).dispose();
    this.threatOverlay.geometry.dispose(); (this.threatOverlay.material as THREE.Material).dispose();
    this.pathLine.geometry.dispose(); (this.pathLine.material as THREE.Material).dispose();
    scene.remove(this.group);
  }
}

/** Line of sight and cover, sampled against the world's collision field. */
export function makeVisibility(collision: CollisionField) {
  const lineOfSight = (a: Vec2, b: Vec2) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(distance / 0.35));
    // Sample at chest height; a fallen log does not block a crossbow.
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t, z = a.z + dz * t;
      const y = terrainHeight(x, z) + 1.1;
      if (collision.cameraBlocked(x, y, z)) return false;
    }
    return true;
  };

  /** Partial obstruction between two points becomes half or three-quarters cover. */
  const coverBetween = (a: Vec2, b: Vec2) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.4) return 'none' as const;
    const steps = Math.max(2, Math.ceil(distance / 0.3));
    let blockedLow = 0, blockedHigh = 0, samples = 0;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t, z = a.z + dz * t;
      const ground = terrainHeight(x, z);
      samples++;
      if (collision.cameraBlocked(x, ground + 0.55, z)) blockedLow++;
      if (collision.cameraBlocked(x, ground + 1.35, z)) blockedHigh++;
    }
    if (!samples) return 'none' as const;
    const high = blockedHigh / samples;
    const low = blockedLow / samples;
    if (high > 0.5) return 'total' as const;
    if (high > 0.12) return 'threeQuarters' as const;
    if (low > 0.12) return 'half' as const;
    return 'none' as const;
  };

  const passable = (x: number, z: number) => {
    const ground = terrainHeight(x, z);
    return !collision.cameraBlocked(x, ground + 0.9, z);
  };

  return { lineOfSight, coverBetween, passable };
}

/** Which weapon a party member should swing, given the distance. */
export function chooseWeapon(combatant: Combatant, gapFeet: number) {
  const candidates = combatant.weapons.map(id => WEAPONS[id]).filter(Boolean);
  const melee = candidates.find(w => !isRanged(w));
  const ranged = candidates.find(w => isRanged(w));
  if (gapFeet <= 5 && melee) return melee.id;
  if (ranged) return ranged.id;
  return melee?.id ?? combatant.equippedWeapon;
}

export { AMBUSHERS };
