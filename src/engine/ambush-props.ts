import * as THREE from 'three';
import { SCATTER, SPENT_ARROWS, type ScatterProp } from '../game/ambush';
import { terrainHeight, type CollisionField } from './landscape';
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

/**
 * The goblin trail behind the northern thickets: a beaten path through the
 * undergrowth that only becomes visible once the fight is over and the player
 * looks for it.
 */
export function buildTrailMarker(materials: CombatMaterials, collision: CollisionField) {
  const group = new THREE.Group();
  group.name = 'Goblin trail';

  // Trodden earth, laid as a ribbon of darkened ground heading northwest.
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = 12.4 - t * 5.4 + Math.sin(t * 3.1) * 0.55;
    const z = -6.8 - t * 7.8 + Math.cos(t * 2.2) * 0.7;
    points.push(new THREE.Vector3(x, terrainHeight(x, z) + 0.02, z));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const ribbon = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 40, 0.42, 4, false),
    new THREE.MeshStandardMaterial({ color: '#4a4032', roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  ribbon.scale.y = 0.03;
  ribbon.receiveShadow = true;
  group.add(ribbon);

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

  // The trail mouth is walkable: no collider is added across the path itself.
  void collision;
  return group;
}
