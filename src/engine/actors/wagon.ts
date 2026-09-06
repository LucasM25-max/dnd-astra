import * as THREE from 'three';
import { CONTAINERS, type ContainerId, type ItemId } from '../../game/items';
import { InventoryStore } from '../../game/save';
import { terrainHeight, type Collider } from '../landscape';
import { Assembly, FlexibleRope, curvedTube, lathe } from './geometry';
import { AnimalFactory, type LivingAnimal } from './animals';
import { stencil, type AdventureMaterials } from './materials';

type CargoVisual = { id: ContainerId; root: THREE.Group; lid?: THREE.Group; opened: number; stacks: { item: ItemId; meshes: THREE.InstancedMesh[] }[]; oilSurface?: THREE.Mesh };
export class SupplyWagon {
  readonly root = new THREE.Group();
  readonly seat = new THREE.Object3D();
  readonly oxen: LivingAnimal[];
  readonly cargo: CargoVisual[] = [];
  readonly wheels: { mount: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  private reins: FlexibleRope[] = [];
  private traceRopes: FlexibleRope[] = [];
  private wheelTravel = 0;
  private clock = 0;
  private storeRevision = -1;
  private cargoDirty = false;
  private mat: AdventureMaterials;
  mounted = true;
  visualAnimating = false;
  speed = 0;
  steering = 0;
  constructor(factory: AnimalFactory, private store: InventoryStore, private heightAt: (x: number, z: number) => number = terrainHeight) {
    this.mat = factory.materials;
    this.root.name = 'Gundren’s provision wagon'; this.root.rotation.order = 'YXZ';
    this.root.add(buildWagonFrame(this.mat));
    const template = buildWheel(this.mat);
    for (const side of [-1, 1]) for (const front of [true, false]) {
      const mount = new THREE.Group(); mount.position.set(side * 1.13, .63, front ? -1.20 : 1.17); mount.rotation.y = Math.PI / 2;
      const spin = template.clone(true); mount.add(spin); this.root.add(mount); this.wheels.push({ mount, spin, front });
    }
    this.seat.position.set(0, 1.105, -1.52); this.root.add(this.seat);
    this.oxen = [factory.create('ox', '#cfbfa0', 1), factory.create('ox', '#a99676', 3)];
    this.oxen.forEach((animal, i) => { animal.root.position.set(i === 0 ? -.73 : .73, 0, -4.96); this.root.add(animal.root); });
    this.addCargo();
    for (let i = 0; i < 2; i++) {
      const reins = new FlexibleRope(this.mat.leather); this.reins.push(reins);
      const trace = new FlexibleRope(this.mat.rope, .012); this.traceRopes.push(trace);
    }
    this.refreshCargo(); this.update(0, 0, false);
  }
  addTo(scene: THREE.Scene) { scene.add(this.root); for (const rope of [...this.reins, ...this.traceRopes]) scene.add(rope.mesh); }
  setPose(x: number, z: number, yaw: number) {
    this.root.position.set(x, this.heightAt(x, z) + .012, z); this.root.rotation.y = yaw;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const front = this.heightAt(x + forward.x * 1.15, z + forward.z * 1.15), back = this.heightAt(x - forward.x * 1.15, z - forward.z * 1.15);
    const left = this.heightAt(x - side.x * .9, z - side.z * .9), right = this.heightAt(x + side.x * .9, z + side.z * .9);
    this.root.rotation.x = Math.atan2(front - back, 2.3); this.root.rotation.z = Math.atan2(right - left, 1.8);
    this.root.updateMatrixWorld(true);
  }
  seatPosition() { this.root.updateMatrixWorld(true); return this.seat.getWorldPosition(new THREE.Vector3()); }
  cargoPosition(id: ContainerId) {
    const cargo = this.cargo.find(c => c.id === id)!; this.root.updateMatrixWorld(true);
    return cargo.root.getWorldPosition(new THREE.Vector3());
  }
  dismountPoints() {
    this.root.updateMatrixWorld(true);
    return [new THREE.Vector3(-1.85, 0, -.95), new THREE.Vector3(1.85, 0, -.95), new THREE.Vector3(0, 0, 2.65)]
      .map(p => { this.root.localToWorld(p); p.y = this.heightAt(p.x, p.z); return p; });
  }
  refreshCargo() {
    const revision = this.store.revision;
    if (revision === this.storeRevision) return;
    this.storeRevision = revision; this.cargoDirty = true;
    for (const visual of this.cargo) {
      const stock = this.store.stock(visual.id);
      for (const stack of visual.stacks) for (const mesh of stack.meshes) mesh.count = stock[stack.item];
      if (visual.oilSurface) { visual.oilSurface.visible = stock.oil > 0; visual.oilSurface.position.y = .075 + stock.oil / 50 * .255; }
    }
  }
  update(dt: number, distance: number, paused: boolean) {
    dt = Math.max(0, Math.min(.1, dt));
    this.refreshCargo();
    this.visualAnimating = this.cargoDirty; this.cargoDirty = false;
    if (!paused) { this.clock += dt; this.wheelTravel += distance; }
    for (const wheel of this.wheels) { wheel.spin.rotation.z = -this.wheelTravel / .63; wheel.mount.rotation.y = Math.PI / 2 + (wheel.front ? -this.steering : 0); }
    for (const c of this.cargo) {
      const target = this.store.isOpen(c.id) ? 1 : 0, next = THREE.MathUtils.damp(c.opened, target, 6, dt);
      if (Math.abs(next - target) > .002) this.visualAnimating = true;
      c.opened = Math.abs(next - target) < .002 ? target : next;
      if (c.lid) c.lid.rotation.x = -c.opened * 1.85;
    }
    this.root.updateMatrixWorld(true);
    this.oxen.forEach((ox, i) => {
      if (!paused) {
        const world = this.root.localToWorld(new THREE.Vector3(i === 0 ? -.73 : .73, 0, -4.96));
        ox.root.position.y = this.heightAt(world.x, world.z) - world.y + .015;
        ox.update(dt, distance, false);
      }
      const start = this.root.localToWorld(new THREE.Vector3(i === 0 ? -.24 : .24, this.mounted ? 1.80 : 1.25, this.mounted ? -1.84 : -1.75));
      const bit = ox.bitPosition(); this.reins[i]?.update(start, bit, this.mounted ? .19 : .42, this.clock);
      const traceA = this.root.localToWorld(new THREE.Vector3(i === 0 ? -.83 : .83, .81, -1.39));
      const traceB = this.root.localToWorld(new THREE.Vector3(i === 0 ? -.96 : .96, 1.24, -5.37));
      this.traceRopes[i]?.update(traceA, traceB, .10, this.clock * .65);
    });
  }
  colliders(): Collider[] {
    const result: Collider[] = [];
    for (const z of [-1.12, 0, 1.12]) {
      const center = this.root.localToWorld(new THREE.Vector3(0, 0, z));
      result.push({ x: center.x, z: center.z, radius: 1.12, bottom: center.y + .15, top: center.y + 1.9, group: 'wagon' });
    }
    for (const ox of this.oxen) {
      const center = ox.root.getWorldPosition(new THREE.Vector3());
      for (const local of [-.42, .48]) { const p = ox.root.localToWorld(new THREE.Vector3(0, 0, local)); result.push({ x: p.x, z: p.z, radius: .46, bottom: center.y, top: center.y + 1.55, group: 'wagon' }); }
    }
    return result;
  }
  private addCargo() {
    const mat = this.mat;
    const a = crate('flour-a', .91, .69, 1.0, mat); a.root.position.set(-.49, .86, .99);
    const b = crate('flour-b', .91, .69, 1.0, mat); b.root.position.set(.49, .86, .99);
    for (const c of [a, b]) {
      const placements: THREE.Matrix4[] = [];
      for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) {
        placements.push(matrix(new THREE.Vector3((col - .5) * .36, .09, (row - 1) * .28), new THREE.Euler((row - 1) * .025, row * .4 + col * .12, (col - .5) * .04)));
      }
      const bags = new THREE.InstancedMesh(sackGeometry(), mat.cloth, 6);
      const ties = new THREE.InstancedMesh(new THREE.TorusGeometry(.031, .009, 5, 13), mat.rope, 6);
      placements.forEach((p, i) => {
        bags.setMatrixAt(i, p);
        const t = p.clone().multiply(new THREE.Matrix4().makeTranslation(0, .485, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); ties.setMatrixAt(i, t);
      });
      for (const mesh of [bags, ties]) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); c.root.add(mesh); }
      c.stacks.push({ item: 'flour', meshes: [bags, ties] });
    }
    const rack = crate('provisions', 1.43, .38, .93, mat, true); rack.root.position.set(-.25, .86, -.07);
    const barrels = buildBarrel(mat, .20, .56);
    let n = 0;
    for (const item of ['pork', 'ale'] as const) {
      const count = item === 'pork' ? 4 : 2;
      const templates = barrels.children.filter(o => o instanceof THREE.Mesh) as THREE.Mesh[];
      const stacks = templates.map(m => new THREE.InstancedMesh(m.geometry, m.material, count));
      for (let i = 0; i < count; i++, n++) {
        const m = matrix(new THREE.Vector3((n % 3 - 1) * .445, .065, (Math.floor(n / 3) - .5) * .42), new THREE.Euler(0, i * .38, 0));
        for (const mesh of stacks) mesh.setMatrixAt(i, m);
      }
      for (const mesh of stacks) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); rack.root.add(mesh); }
      rack.stacks.push({ item, meshes: stacks });
    }
    const tools = crate('tools', .40, .38, 2.57, mat); tools.root.position.set(.99, 1.06, .02);
    for (const [k, item] of (['shovel', 'pick', 'crowbar'] as const).entries()) {
      const model = toolGeometry(item, mat), meshes = (model.children as THREE.Mesh[]).map(m => new THREE.InstancedMesh(m.geometry, m.material, 12));
      for (let i = 0; i < 12; i++) {
        const p = matrix(new THREE.Vector3((i % 3 - 1) * .080, .13 + Math.floor(i / 3) * .028 + k * .07, -.73 + k * .42), new THREE.Euler(Math.PI / 2, 0, (i % 3 - 1) * .025));
        meshes.forEach(mesh => mesh.setMatrixAt(i, p));
      }
      meshes.forEach(mesh => { mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); tools.root.add(mesh); });
      tools.stacks.push({ item, meshes });
    }
    const lamps = crate('lanterns', .68, .36, .51, mat); lamps.root.position.set(.11, 1.50, -.09);
    const lamp = lanternGeometry(mat), lampMeshes = (lamp.children as THREE.Mesh[]).map(m => new THREE.InstancedMesh(m.geometry, m.material, 5));
    for (let i = 0; i < 5; i++) {
      const p = matrix(new THREE.Vector3((i % 3 - 1) * .19, .064, (Math.floor(i / 3) - .5) * .19), new THREE.Euler(0, i * .36, 0));
      lampMeshes.forEach(m => m.setMatrixAt(i, p));
    }
    lampMeshes.forEach(mesh => { mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); lamps.root.add(mesh); });
    lamps.stacks.push({ item: 'lantern', meshes: lampMeshes });
    const oil: CargoVisual = { id: 'oil', root: buildBarrel(mat, .17, .40, false), opened: 0, stacks: [] };
    oil.root.position.set(-.80, .84, -.91); oil.root.userData.containerId = 'oil';
    const oilLid = new THREE.Group(); oilLid.position.set(0, .40, -.14);
    const lidDisk = new THREE.Mesh(new THREE.CylinderGeometry(.149, .149, .022, 28), mat.woodEnd); lidDisk.position.set(0, 0, .14); oilLid.add(lidDisk); oil.root.add(oilLid); oil.lid = oilLid;
    const fluid = new THREE.Mesh(new THREE.CircleGeometry(.145, 28), mat.oil); fluid.rotation.x = -Math.PI / 2; fluid.position.y = .33; oil.root.add(fluid); oil.oilSurface = fluid;
    const warning = new THREE.Mesh(new THREE.PlaneGeometry(.24, .075), stencil('LAMP OIL')); warning.position.set(0, .20, .173); oil.root.add(warning);
    this.cargo.push(a, b, rack, tools, lamps, oil);
    for (const c of this.cargo) { this.root.add(c.root); c.root.userData.containerId = c.id; c.opened = this.store.isOpen(c.id) ? 1 : 0; }
  }
}
function matrix(position: THREE.Vector3, rotation = new THREE.Euler(), scale = new THREE.Vector3(1, 1, 1)) { return new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale); }
function buildWagonFrame(mat: AdventureMaterials) {
  const b = new Assembly();
  for (const x of [-.79, .79]) b.box(.14, .18, 3.74, mat.woodDark, x, .69, 0);
  for (const z of [-1.2, 0, 1.17]) b.box(2.36, .12, .14, mat.woodDark, 0, .67, z);
  for (let i = 0; i < 15; i++) b.box(.133, .075, 3.35, mat.wood, (i - 7) * .141, .825, 0);
  for (const side of [-1, 1]) {
    for (const y of [.995, 1.22, 1.435]) b.box(.066, .185, 3.17, mat.wood, side * 1.045, y, .08);
    for (const z of [-1.48, -.38, .63, 1.57]) {
      b.box(.10, .94, .10, mat.woodDark, side * 1.095, 1.10, z);
      b.box(.018, .88, .076, mat.iron, side * 1.155, 1.10, z);
      for (const y of [.82, 1.08, 1.34, 1.49]) b.add(new THREE.SphereGeometry(.018, 6, 4), mat.iron, new THREE.Vector3(side * 1.169, y, z), new THREE.Euler(), new THREE.Vector3(.4, 1, 1));
    }
    b.box(.07, .09, 3.31, mat.woodDark, side * 1.045, 1.565, .07);
  }
  for (const y of [.99, 1.21, 1.43]) b.box(2.07, .18, .07, mat.wood, 0, y, 1.70);
  for (const x of [-.73, .73]) {
    b.box(.10, .66, .035, mat.iron, x, 1.15, 1.755);
    b.add(new THREE.CylinderGeometry(.038, .038, .17, 10), mat.iron, new THREE.Vector3(x, .83, 1.76), new THREE.Euler(0, 0, Math.PI / 2));
  }
  b.box(1.66, .14, .43, mat.woodDark, 0, 1.035, -1.53);
  for (const side of [-1, 1]) { b.box(.10, .42, .12, mat.wood, side * .63, .83, -1.53); b.box(.09, .62, .09, mat.woodDark, side * .79, 1.25, -1.31); }
  b.box(1.68, .12, .075, mat.wood, 0, 1.50, -1.31);
  b.box(.14, .12, 4.13, mat.woodDark, 0, .84, -3.32, .065, 0, 0);
  b.add(curvedTube([new THREE.Vector3(-1.24, 1.43, -5.47), new THREE.Vector3(-.65, 1.385, -5.47), new THREE.Vector3(0, 1.42, -5.47), new THREE.Vector3(.65, 1.385, -5.47), new THREE.Vector3(1.24, 1.43, -5.47)], .078, 28, 9), mat.woodDark);
  for (const x of [-.73, .73]) {
    b.add(curvedTube([new THREE.Vector3(x - .25, 1.42, -5.46), new THREE.Vector3(x - .29, 1.04, -5.46), new THREE.Vector3(x, .91, -5.46), new THREE.Vector3(x + .29, 1.04, -5.46), new THREE.Vector3(x + .25, 1.42, -5.46)], .025, 26, 7), mat.wood);
    b.add(new THREE.TorusGeometry(.085, .014, 7, 16), mat.iron, new THREE.Vector3(x, 1.45, -5.48), new THREE.Euler(Math.PI / 2, 0, 0));
  }
  b.box(.23, .16, .19, mat.iron, 0, 1.37, -5.46);
  for (const z of [-1.2, 1.17]) b.add(new THREE.CylinderGeometry(.065, .065, 2.62, 12), mat.iron, new THREE.Vector3(0, .63, z), new THREE.Euler(0, 0, Math.PI / 2));
  const group = b.build('Oak wagon · planked deck, iron fittings, yoke & drawbar');
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.50, .17), stencil('BARTHEN’S PROVISIONS')); plaque.position.set(0, 1.22, 1.745); group.add(plaque);
  const rearRope = new THREE.Mesh(curvedTube([new THREE.Vector3(-1.1, 1.55, .80), new THREE.Vector3(-.48, 1.73, .99), new THREE.Vector3(.47, 1.73, 1.04), new THREE.Vector3(1.1, 1.55, 1.10)], .013, 20, 6), mat.rope); group.add(rearRope);
  return group;
}
function buildWheel(mat: AdventureMaterials) {
  const b = new Assembly();
  b.add(lathe([[.505, -.073], [.59, -.073], [.62, -.053], [.62, .053], [.59, .073], [.505, .073], [.505, -.073]], 40), mat.woodDark, new THREE.Vector3(), new THREE.Euler(Math.PI / 2, 0, 0));
  b.add(new THREE.CylinderGeometry(.634, .634, .142, 40, 1, true), mat.iron, new THREE.Vector3(), new THREE.Euler(Math.PI / 2, 0, 0));
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    b.box(.055, .40, .074, mat.wood, Math.sin(a) * .326, Math.cos(a) * .326, 0, 0, 0, -a, .009);
    b.add(new THREE.SphereGeometry(.017, 6, 4), mat.iron, new THREE.Vector3(Math.sin(a) * .567, Math.cos(a) * .567, .076), new THREE.Euler(), new THREE.Vector3(1, 1, .55));
  }
  b.add(new THREE.CylinderGeometry(.118, .135, .27, 16), mat.woodEnd, new THREE.Vector3(), new THREE.Euler(Math.PI / 2, 0, 0));
  b.add(new THREE.CylinderGeometry(.088, .088, .285, 12), mat.iron, new THREE.Vector3(), new THREE.Euler(Math.PI / 2, 0, 0));
  return b.build('Twelve-spoke iron-shod wheel');
}
function crate(id: ContainerId, width: number, height: number, depth: number, mat: AdventureMaterials, openRack = false): CargoVisual {
  const b = new Assembly();
  b.box(width, .055, depth, mat.woodDark, 0, .032, 0);
  const slats = openRack ? 2 : Math.max(2, Math.round(height / .17));
  for (let i = 0; i < slats; i++) {
    const y = .105 + i * (height - .12) / Math.max(1, slats - 1), h = openRack ? .075 : height / slats * .82;
    for (const x of [-width / 2, width / 2]) b.box(.042, h, depth, mat.wood, x, y, 0);
    for (const z of [-depth / 2, depth / 2]) b.box(width, h, .043, mat.wood, 0, y, z);
  }
  for (const x of [-width / 2, width / 2]) for (const z of [-depth / 2, depth / 2]) {
    b.box(.058, height + .055, .058, mat.woodDark, x, height / 2 + .025, z);
    for (const y of [.10, height - .07]) b.add(new THREE.SphereGeometry(.014, 6, 4), mat.iron, new THREE.Vector3(x, y, z + (z < 0 ? -.035 : .035)), new THREE.Euler(), new THREE.Vector3(1, 1, .4));
  }
  const root = b.build(CONTAINERS.find(c => c.id === id)!.name);
  let lid: THREE.Group | undefined;
  if (!openRack) {
    const assembly = new Assembly();
    for (let i = 0; i < 4; i++) assembly.box((width + .045) / 4 - .007, .048, depth + .055, mat.wood, (i - 1.5) * (width + .045) / 4, 0, depth / 2);
    for (const z of [depth * .15, depth * .85]) assembly.box(width + .06, .024, .055, mat.woodDark, 0, .032, z);
    for (const x of [-width * .32, width * .32]) assembly.box(.051, .019, .13, mat.iron, x, .034, .02);
    lid = assembly.build('Hinged wooden lid'); lid.position.set(0, height + .05, -depth / 2); root.add(lid);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(width * .80, Math.min(.13, height * .4)), stencil(id.startsWith('flour') ? 'FLOUR · DRY STORES' : id === 'tools' ? 'ROCKSEEKER · TOOLS' : 'FIELD LANTERNS'));
    label.position.set(0, height * .55, depth / 2 + .027); root.add(label);
  }
  root.userData.containerId = id;
  return { id, root, lid, opened: 0, stacks: [] };
}
function sackGeometry() {
  const g = lathe([[.0, .015], [.105, .017], [.166, .055], [.181, .15], [.175, .29], [.147, .39], [.082, .445], [.036, .47], [.040, .494], [.069, .525], [.034, .541], [0, .548]], 22);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const wrinkle = 1 + Math.sin(a * 9 + y * 24) * .037 + Math.cos(a * 5 - y * 36) * .018;
    p.setXYZ(i, x * wrinkle, y + Math.sin(a * 5) * .004, z * wrinkle * .80);
  }
  g.computeVertexNormals(); return g;
}
function buildBarrel(mat: AdventureMaterials, radius: number, height: number, lid = true) {
  const b = new Assembly();
  b.add(lathe([[radius * .82, .015], [radius * .89, .055], [radius * .98, height * .25], [radius, height * .5], [radius * .98, height * .75], [radius * .87, height * .96], [radius * .84, height], [radius * .75, height], [radius * .80, height * .55], [radius * .73, .045]], 32), mat.wood);
  for (const y of [height * .1, height * .27, height * .74, height * .93]) {
    const r = y < height * .18 || y > height * .85 ? radius * .915 : radius * 1.005;
    b.add(new THREE.CylinderGeometry(r, r, .038, 32, 1, true), mat.iron, new THREE.Vector3(0, y, 0));
  }
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    const seam = curvedTube([new THREE.Vector3(Math.cos(a) * radius * .886, .04, Math.sin(a) * radius * .886), new THREE.Vector3(Math.cos(a) * (radius + .002), height * .5, Math.sin(a) * (radius + .002)), new THREE.Vector3(Math.cos(a) * radius * .855, height * .985, Math.sin(a) * radius * .855)], .0018, 8, 3);
    b.add(seam, mat.woodDark);
  }
  b.add(new THREE.CylinderGeometry(radius * .80, radius * .80, .03, 28), mat.woodEnd, new THREE.Vector3(0, .025, 0));
  if (lid) { b.add(new THREE.CylinderGeometry(radius * .82, radius * .82, .027, 28), mat.woodEnd, new THREE.Vector3(0, height - .014, 0)); b.add(new THREE.CylinderGeometry(.025, .022, .018, 12), mat.woodDark, new THREE.Vector3(radius * .22, height + .005, 0)); }
  return b.build('Coopered oak cask with iron hoops');
}
function toolGeometry(item: 'shovel' | 'pick' | 'crowbar', mat: AdventureMaterials) {
  const b = new Assembly();
  if (item === 'crowbar') {
    b.add(curvedTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, .70, 0), new THREE.Vector3(.025, .83, 0), new THREE.Vector3(.11, .86, 0)], .014, 18, 6), mat.iron);
    b.box(.044, .10, .008, mat.iron, 0, .025, 0, 0, 0, 0, .003);
  } else {
    b.add(new THREE.CylinderGeometry(.018, .026, .94, 9), mat.woodDark, new THREE.Vector3(0, .56, 0));
    if (item === 'shovel') {
      const shape = new THREE.Shape(); shape.moveTo(-.085, .18); shape.lineTo(.085, .18); shape.lineTo(.10, .06); shape.quadraticCurveTo(.075, -.055, 0, -.075); shape.quadraticCurveTo(-.075, -.055, -.10, .06); shape.closePath();
      b.add(new THREE.ExtrudeGeometry(shape, { depth: .014, bevelEnabled: true, bevelSize: .008, bevelThickness: .004, bevelSegments: 1, steps: 1, curveSegments: 6 }), mat.iron, new THREE.Vector3(0, .075, -.006));
      b.add(new THREE.TorusGeometry(.048, .013, 6, 12), mat.woodDark, new THREE.Vector3(0, 1.02, 0));
    } else {
      b.add(curvedTube([new THREE.Vector3(-.23, .14, 0), new THREE.Vector3(-.11, .22, 0), new THREE.Vector3(0, .24, 0), new THREE.Vector3(.14, .20, 0), new THREE.Vector3(.24, .12, 0)], .026, 16, 6), mat.iron);
      b.add(new THREE.CylinderGeometry(.037, .035, .082, 10), mat.iron, new THREE.Vector3(0, .24, 0));
    }
  }
  return b.build(item);
}
function lanternGeometry(mat: AdventureMaterials) {
  const b = new Assembly();
  b.add(lathe([[.0, .0], [.072, .0], [.076, .025], [.05, .055], [.04, .065]], 18), mat.iron);
  b.add(new THREE.CylinderGeometry(.043, .051, .125, 18, 1, true), mat.glass, new THREE.Vector3(0, .13, 0));
  b.add(lathe([[.048, .19], [.066, .20], [.049, .23], [.025, .246], [0, .246]], 18), mat.iron);
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; b.add(new THREE.CylinderGeometry(.006, .006, .152, 5), mat.iron, new THREE.Vector3(Math.sin(a) * .052, .125, Math.cos(a) * .052)); }
  b.add(new THREE.TorusGeometry(.062, .005, 5, 16, Math.PI * 1.4), mat.iron, new THREE.Vector3(0, .27, 0), new THREE.Euler(0, 0, -.2));
  b.add(new THREE.CylinderGeometry(.012, .022, .036, 9), mat.brass, new THREE.Vector3(0, .061, 0));
  return b.build('Iron and glass field lantern');
}
