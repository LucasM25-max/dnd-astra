import * as THREE from 'three';
import { SCATTER, SPENT_ARROWS, TRAIL_TRAPS, type ScatterProp, type TrailTrap } from '../game/ambush';
import { TRAIL, terrainHeight, trailPointAtDistance, type CollisionField } from './landscape';
import { buildArrow, type CombatMaterials } from './actors/combat-materials';

/**
 * The physical evidence at the ambush site: black-fletched arrows trodden into
 * the leaf litter, torn fabric, turned-out saddlebags, and the empty map case
 * that explains why any of this happened.
 *
 * Every piece is a real object in the world with a position the interaction
 * system can reach, not a line of description attached to a trigger volume.
 */

export interface InspectableProp {
  id: string;
  data: ScatterProp;
  object: THREE.Object3D;
  position: THREE.Vector3;
  /** Set once the player has read it. */
  examined: boolean;
  /** Set once its skill check has been attempted, so it is not re-rolled. */
  checked: boolean;
  checkSucceeded: boolean;
  highlight: THREE.Mesh;
}

export class AmbushSite {
  readonly group = new THREE.Group();
  readonly props: InspectableProp[] = [];
  private clock = 0;

  constructor(private materials: CombatMaterials) {
    this.group.name = 'Ambush evidence';
    this.buildArrows();
    for (const data of SCATTER) this.buildScatter(data);
  }

  /** Spent arrows, half-buried and angled as though they struck and stuck. */
  private buildArrows() {
    for (const spec of SPENT_ARROWS) {
      const arrow = buildArrow(this.materials, 1);
      const y = terrainHeight(spec.position.x, spec.position.z);
      arrow.position.set(spec.position.x, y + 0.055, spec.position.z);
      // Pitched steeply so the head is in the ground and the fletching is up.
      arrow.rotation.set(spec.pitch, spec.rotation, 0);
      arrow.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(arrow);
    }
  }

  private buildScatter(data: ScatterProp) {
    const group = new THREE.Group();
    const y = terrainHeight(data.position.x, data.position.z);
    group.position.set(data.position.x, y, data.position.z);
    group.rotation.y = data.rotation;

    if (data.kind === 'mapCase') {
      // A capped leather tube, lying open with its cut end toward the road.
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.056, 0.44, 16, 1, true), this.materials.leather);
      tube.rotation.z = Math.PI / 2;
      tube.position.y = 0.056;
      tube.castShadow = true; tube.receiveShadow = true;
      group.add(tube);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.060, 0.060, 0.055, 16), this.materials.leather);
      cap.rotation.z = Math.PI / 2; cap.position.set(-0.235, 0.056, 0);
      cap.castShadow = true;
      group.add(cap);
      // The cut lip: a flared, torn opening rather than a clean cylinder end.
      const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.050, 0.035, 16, 1, true), this.materials.leather);
      lip.rotation.z = Math.PI / 2; lip.position.set(0.225, 0.058, 0);
      group.add(lip);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.008, 6, 14), this.materials.leather);
      strap.position.set(0.06, 0.056, 0);
      group.add(strap);
      // A dark interior so it reads as genuinely empty at a glance.
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.048, 16), new THREE.MeshBasicMaterial({ color: '#0b0806' }));
      inner.rotation.y = Math.PI / 2; inner.position.set(0.238, 0.056, 0);
      group.add(inner);
    } else if (data.kind === 'saddlebag') {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.30, 3, 3, 3), this.materials.leather);
      // Slump the geometry so it reads as emptied, not as a crate.
      const attr = bag.geometry.getAttribute('position');
      for (let i = 0; i < attr.count; i++) {
        const x = attr.getX(i), yv = attr.getY(i), z = attr.getZ(i);
        const sag = yv > 0 ? -0.055 * (1 - Math.abs(x) / 0.21) : 0;
        attr.setXYZ(i, x * (1 + yv * 0.25), yv + sag, z * (1 + yv * 0.3));
      }
      bag.geometry.computeVertexNormals();
      bag.position.y = 0.11; bag.rotation.set(0.09, 0, -0.13);
      bag.castShadow = true; bag.receiveShadow = true;
      group.add(bag);
      // Cut straps hanging loose.
      for (const side of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.20, 0.012), this.materials.leather);
        strap.position.set(side * 0.13, 0.13, -0.16);
        strap.rotation.x = 0.5 + side * 0.2;
        group.add(strap);
      }
      const flap = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.20), this.materials.leather);
      flap.position.set(0, 0.10, 0.19); flap.rotation.x = -1.25;
      flap.material.side = THREE.DoubleSide;
      group.add(flap);
    } else if (data.kind === 'fabric') {
      // A torn rag, built as a subdivided plane pushed into folds.
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.22, 8, 6), this.materials.creatureCloth.clone());
      (cloth.material as THREE.MeshStandardMaterial).color.set(data.id === 'fabric-1' ? '#3d5540' : '#b0a48c');
      const attr = cloth.geometry.getAttribute('position');
      for (let i = 0; i < attr.count; i++) {
        const x = attr.getX(i), yv = attr.getY(i);
        // Folds plus a ragged edge.
        const fold = Math.sin(x * 14) * 0.018 + Math.cos(yv * 11) * 0.012;
        const edge = Math.abs(x) > 0.12 ? Math.sin(yv * 30) * 0.02 : 0;
        attr.setXYZ(i, x + edge, fold + 0.012, yv);
      }
      cloth.geometry.computeVertexNormals();
      cloth.rotation.x = -Math.PI / 2;
      cloth.castShadow = true; cloth.receiveShadow = true;
      group.add(cloth);
    } else {
      // Oddments: a tin cup, a comb, and a few nails, scattered together.
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.031, 0.062, 12, 1, true), this.materials.steel);
      cup.position.set(0.04, 0.031, 0.02); cup.rotation.set(1.5, 0, 0.3);
      cup.castShadow = true;
      group.add(cup);
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.026, 0.042), this.materials.caveRock);
      stone.position.set(-0.07, 0.014, -0.03); stone.rotation.y = 0.6;
      stone.castShadow = true;
      group.add(stone);
      for (let i = 0; i < 3; i++) {
        const nail = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.048, 4), this.materials.steel);
        nail.position.set(-0.02 + i * 0.035, 0.006, 0.06 - i * 0.02);
        nail.rotation.set(Math.PI / 2, 0, i * 1.1);
        group.add(nail);
      }
    }

    // A soft ground halo that fades in when the player is close enough to read
    // the prop. It never appears unless the object is genuinely interactable.
    const highlight = new THREE.Mesh(
      new THREE.RingGeometry(0.20, 0.30, 32),
      new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    highlight.rotation.x = -Math.PI / 2;
    highlight.position.set(data.position.x, y + 0.02, data.position.z);
    highlight.renderOrder = 3;

    this.group.add(group, highlight);
    this.props.push({
      id: data.id, data, object: group, examined: false, checked: false, checkSucceeded: false,
      position: new THREE.Vector3(data.position.x, y, data.position.z), highlight,
    });
  }

  /** The nearest prop within reach of the player, if any. */
  nearest(position: THREE.Vector3, reach = 1.9): InspectableProp | null {
    let best: InspectableProp | null = null, bestDistance = reach;
    for (const prop of this.props) {
      const d = Math.hypot(prop.position.x - position.x, prop.position.z - position.z);
      if (d < bestDistance) { best = prop; bestDistance = d; }
    }
    return best;
  }

  update(dt: number, playerPosition: THREE.Vector3, enabled: boolean) {
    this.clock += dt;
    const nearest = enabled ? this.nearest(playerPosition, 2.4) : null;
    for (const prop of this.props) {
      const material = prop.highlight.material as THREE.MeshBasicMaterial;
      const isNear = prop === nearest;
      const wanted = !enabled ? 0 : isNear ? 0.55 : prop.examined ? 0 : 0.16;
      material.opacity = THREE.MathUtils.damp(material.opacity, wanted, 7, dt);
      prop.highlight.visible = material.opacity > 0.01;
      if (isNear) prop.highlight.scale.setScalar(1 + Math.sin(this.clock * 2.8) * 0.05);
      else prop.highlight.scale.setScalar(1);
    }
  }

  addTo(scene: THREE.Scene) { scene.add(this.group); }

  dispose(scene: THREE.Scene) {
    this.group.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const material = o.material as THREE.Material | THREE.Material[];
        (Array.isArray(material) ? material : [material]).forEach(m => m.dispose());
      }
    });
    scene.remove(this.group);
    this.props.length = 0;
  }
}

export type TrailHazardState = 'hidden' | 'spotted' | 'triggered' | 'disarmed';
export interface TrailHazardVisual {
  trap: TrailTrap;
  position: THREE.Vector3;
  object: THREE.Group;
  state: TrailHazardState;
}

/**
 * Physical, inspectable versions of the two module traps. They stay camouflaged
 * until the search check succeeds or the trigger fires; after that the player
 * can see the cord/pit rather than receiving a text-only teleport.
 */
export class TrailHazards {
  readonly group = new THREE.Group();
  readonly hazards: TrailHazardVisual[] = [];
  private clock = 0;

  constructor(private materials: CombatMaterials, _collision: CollisionField) {
    this.group.name = 'Goblin trail traps';
    for (const trap of TRAIL_TRAPS) this.build(trap);
  }

  private build(trap: TrailTrap) {
    const point = trailPointAtDistance(trap.atMetres);
    const position = new THREE.Vector3(point.x, terrainHeight(point.x, point.z), point.z);
    const object = new THREE.Group();
    object.position.copy(position);
    object.rotation.y = Math.atan2(1.1, .7) + trap.atMinutes;
    object.visible = false;

    if (trap.id === 'snare') {
      const cord = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
          new THREE.Vector3(-.78, .025, .10), new THREE.Vector3(-.20, .018, -.02),
          new THREE.Vector3(.34, .026, .06), new THREE.Vector3(.78, .018, -.08),
        ]), 12, .012, 5, false),
        this.materials.leather,
      );
      cord.name = 'snare cord';
      const sapling = new THREE.Mesh(new THREE.CylinderGeometry(.025, .045, 1.9, 7), this.materials.woodShaft);
      sapling.position.set(.63, .88, .02); sapling.rotation.z = -.33;
      const loop = new THREE.Mesh(new THREE.TorusGeometry(.24, .012, 6, 22), this.materials.leather);
      loop.rotation.x = Math.PI / 2; loop.position.set(0, .035, 0);
      object.add(cord, sapling, loop);
    } else {
      const earth = new THREE.Mesh(new THREE.CylinderGeometry(.92, .78, .08, 28), this.materials.caveRock);
      earth.name = 'six-foot pit opening'; earth.position.y = -.02;
      const dark = new THREE.Mesh(new THREE.CircleGeometry(.75, 28), new THREE.MeshBasicMaterial({ color: '#0b0a07', side: THREE.DoubleSide }));
      dark.rotation.x = -Math.PI / 2; dark.position.y = .026;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.95, .045, 6, 28), this.materials.leather);
      rim.rotation.x = -Math.PI / 2; rim.position.y = .035;
      const branch = new THREE.Mesh(new THREE.BoxGeometry(1.65, .035, .045), this.materials.woodShaft);
      branch.position.y = .055; branch.rotation.y = .35;
      object.add(earth, dark, rim, branch);
    }
    object.traverse(child => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
    this.group.add(object);
    this.hazards.push({ trap, position, object, state: 'hidden' });
  }

  setState(id: string, state: TrailHazardState) {
    const hazard = this.hazards.find(h => h.trap.id === id);
    if (!hazard) return;
    hazard.state = state;
    hazard.object.visible = state !== 'hidden';
    hazard.object.traverse(child => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) child.material.transparent = state === 'spotted';
    });
  }

  stateOf(id: string) { return this.hazards.find(h => h.trap.id === id)?.state ?? 'hidden' as TrailHazardState; }

  update(dt: number, playerPosition: THREE.Vector3) {
    this.clock += dt;
    for (const hazard of this.hazards) {
      if (!hazard.object.visible) continue;
      const near = Math.hypot(playerPosition.x - hazard.position.x, playerPosition.z - hazard.position.z) < 6;
      hazard.object.position.y = hazard.position.y + (near ? Math.sin(this.clock * 2.5) * .004 : 0);
    }
  }

  addTo(scene: THREE.Scene) { scene.add(this.group); }
  dispose(scene: THREE.Scene) {
    this.group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => m.dispose());
      }
    });
    scene.remove(this.group);
  }
}

/**
 * The goblin trail behind the northern thickets: a beaten path through the
 * undergrowth that only becomes visible once the fight is over and the player
 * looks for it.
 */
export function buildTrailMarker(materials: CombatMaterials, collision: CollisionField) {
  const group = new THREE.Group();
  group.name = 'Goblin trail';

  // Trodden earth, laid as a continuous ribbon for the entire visible
  // approach. The old marker stopped a few metres into the brush, which made
  // the destination text feel like a promise the world could not keep.
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < TRAIL.length; i += 3) {
    const p = TRAIL[i];
    points.push(new THREE.Vector3(p.x, terrainHeight(p.x, p.z) + 0.02, p.z));
  }
  const last = TRAIL[TRAIL.length - 1];
  points.push(new THREE.Vector3(last.x, terrainHeight(last.x, last.z) + 0.02, last.z));
  const curve = new THREE.CatmullRomCurve3(points);
  const ribbon = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(80, points.length * 4), 0.42, 4, false),
    new THREE.MeshStandardMaterial({ color: '#4a4032', roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  ribbon.scale.y = 0.03;
  ribbon.receiveShadow = true;
  group.add(ribbon);

  // The first few metres carry the physical aftermath described by the
  // inspection text: many small overlapping tracks and two parallel drag
  // grooves from human-sized bodies. These are deliberately subtle until the
  // player is close, but they make the trail read as used rather than painted.
  const trackMaterial = new THREE.MeshStandardMaterial({ color: '#29251d', roughness: 1, transparent: true, opacity: .66, depthWrite: false });
  for (let i = 0; i < 24; i++) {
    const t = .012 + (i / 24) * .19, p = curve.getPointAt(t), tangent = curve.getTangentAt(t).normalize();
    const side = i % 2 ? 1 : -1, mark = new THREE.Mesh(new THREE.CircleGeometry(.068, 7), trackMaterial);
    mark.position.set(p.x + tangent.z * side * .18, p.y + .027, p.z - tangent.x * side * .18);
    mark.scale.set(.72, 1, 1.35); mark.rotation.x = -Math.PI / 2; mark.rotation.z = Math.atan2(tangent.z, tangent.x);
    group.add(mark);
  }
  for (const side of [-1, 1]) {
    const dragPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = .018 + i / 12 * .16, p = curve.getPointAt(t), tangent = curve.getTangentAt(t).normalize();
      dragPoints.push(new THREE.Vector3(p.x + tangent.z * side * .34, p.y + .024, p.z - tangent.x * side * .34));
    }
    const drag = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dragPoints), 18, .026, 5, false), materials.blood);
    drag.name = `human body drag groove ${side}`; drag.scale.y = .35; group.add(drag);
  }

  // Broken saplings and pushed-aside brush marking the mouth of the trail.
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const p = curve.getPointAt(t * 0.35);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.020, 0.55, 5), materials.woodShaft);
    stick.position.set(p.x + Math.sin(i * 2.7) * 0.6, p.y + 0.2, p.z + Math.cos(i * 1.9) * 0.6);
    stick.rotation.set(1.1 + Math.sin(i) * 0.3, i * 1.4, 0.4);
    stick.castShadow = true;
    group.add(stick);
  }

  // A distant, deliberately understated destination silhouette: the trail is
  // headed somewhere. The cave is decorative and does not block the path, so
  // the opening can later be replaced by the full Cragmaw Hideout scene.
  const end = TRAIL[TRAIL.length - 1], previous = TRAIL[Math.max(0, TRAIL.length - 2)];
  const mouth = new THREE.Group();
  const cave = new THREE.Mesh(new THREE.CircleGeometry(2.25, 32), new THREE.MeshBasicMaterial({ color: '#090a08', side: THREE.DoubleSide }));
  cave.position.set(end.x, terrainHeight(end.x, end.z) + 2.1, end.z);
  cave.lookAt(new THREE.Vector3(end.x + (end.x - previous.x), cave.position.y, end.z + (end.z - previous.z)));
  const arch = new THREE.Mesh(new THREE.TorusGeometry(2.32, .28, 8, 28, Math.PI), materials.caveRock);
  arch.position.copy(cave.position); arch.rotation.copy(cave.rotation); arch.rotateZ(Math.PI);
  mouth.add(cave, arch); mouth.name = 'Distant Cragmaw Hideout entrance'; group.add(mouth);

  // The trail mouth is walkable: no collider is added across the path itself.
  void collision;
  return group;
}
