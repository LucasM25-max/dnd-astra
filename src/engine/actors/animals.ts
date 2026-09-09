import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LoopSubdivision } from 'three-subdivide';
import { smoothstep } from '../landscape';
import { curvedTube, smoothNormals } from './geometry';
import type { AdventureMaterials } from './materials';

type Species = 'ox' | 'horse';
type LegRig = { upper: THREE.Bone; lower: THREE.Bone; foot: THREE.Bone; front: boolean; phase: number };
export class AnimalFactory {
  private geometries = new Map<Species, THREE.BufferGeometry>();
  private constructor(private source: THREE.BufferGeometry, readonly materials: AdventureMaterials) {}
  static async load(materials: AdventureMaterials) {
    const asset = await new GLTFLoader().loadAsync('/models/horse.glb');
    const source = asset.scene.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    if (!source) throw new Error('Animal reference mesh could not be loaded.');
    return new AnimalFactory(source.geometry, materials);
  }
  create(species: Species, color: string, seed = 0) {
    if (!this.geometries.has(species)) this.geometries.set(species, buildRestGeometry(this.source, species));
    return new LivingAnimal(this.geometries.get(species)!.clone(), species, color, this.materials, seed);
  }
  dispose() { this.source.dispose(); this.geometries.forEach(g => g.dispose()); }
}

function buildRestGeometry(source: THREE.BufferGeometry, species: Species) {
  const g = source.clone(); g.morphAttributes = {}; g.deleteAttribute('color');
  const p = g.getAttribute('position');
  // The source faces +Z and is in centimetres. Canonical animals face -Z in metres.
  const base: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i++) base.push(new THREE.Vector3(-p.getX(i) * .009, p.getY(i) * .009, -p.getZ(i) * .009));
  const legData = Array.from({ length: 4 }, () => ({ min: Infinity, points: [] as THREE.Vector3[] }));
  for (const v of base) {
    if (v.y > .94 || Math.abs(v.z) < .29) continue;
    const key = (v.z < 0 ? 0 : 2) + (v.x > 0 ? 1 : 0);
    legData[key].points.push(v); legData[key].min = Math.min(legData[key].min, v.y);
  }
  for (let i = 0; i < base.length; i++) {
    const original = base[i], v = original.clone();
    if (v.y < .94 && Math.abs(v.z) > .29) {
      const front = v.z < 0, side = v.x > 0 ? 1 : -1, key = (front ? 0 : 2) + (side > 0 ? 1 : 0), leg = legData[key];
      let sum = 0, cx = 0, cz = 0;
      for (const a of leg.points) { const weight = Math.exp(-(((a.y - v.y) / .115) ** 2)); sum += weight; cx += a.x * weight; cz += a.z * weight; }
      if (sum > 0) {
        cx /= sum; cz /= sum;
        const blend = (1 - smoothstep(.61, .94, v.y)) * smoothstep(.27, .40, Math.abs(v.z));
        const stance = species === 'ox' ? .285 : .205;
        const restZ = front ? -.50 - Math.sin(v.y * 3.4) * .018 : .64 + Math.sin(v.y * 4.2) * .038;
        v.z += (restZ - cz) * blend; v.x += (side * stance - cx) * blend;
        const low = Number.isFinite(leg.min) ? Math.max(0, leg.min - .008) : 0;
        v.y = THREE.MathUtils.lerp(v.y, (v.y - low) * (.94 / (.94 - low)), blend);
      }
    }
    // Repose the tail from the source's gallop into a relaxed downward fall.
    const tail = smoothstep(.85, 1.05, v.z) * smoothstep(.85, 1.03, v.y);
    v.y -= Math.max(0, v.z - .83) * .90 * tail;
    v.z -= Math.max(0, v.z - .83) * .53 * tail;
    if (species === 'ox') {
      const torso = smoothstep(.43, .83, v.y) * (1 - smoothstep(.60, .97, -v.z));
      v.x *= 1.28 + torso * .60;
      if (v.y > .82) v.y = .82 + (v.y - .82) * 1.10 + torso * .065;
      const head = smoothstep(.65, 1.03, -v.z) * smoothstep(.80, 1.05, v.y);
      v.z += Math.max(0, -v.z - .67) * .24 * head;
      v.x *= 1 + head * .22;
      v.y -= head * .15;
      if (original.y > 1.56 && original.z < -.75) v.y -= (original.y - 1.56) * .60;
      if (tail > .1) v.x *= .42;
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const smooth = LoopSubdivision.modify(g, 2, { split: false, uvSmooth: true, preserveEdges: false, maxTriangles: 24000 });
  g.dispose(); smoothNormals(smooth);
  smooth.computeBoundingBox(); smooth.computeBoundingSphere(); return smooth;
}

export class LivingAnimal {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly head = new THREE.Bone();
  readonly bit = new THREE.Object3D();
  private body = new THREE.Bone();
  private tail = new THREE.Bone();
  private legs: LegRig[] = [];
  private clock = 0;
  private gait = 0;
  private walking = 0;
  private sniffing = 0;
  readonly species: Species;
  constructor(geometry: THREE.BufferGeometry, species: Species, color: string, mat: AdventureMaterials, seed = 0) {
    this.species = species; this.clock = seed * 2.19; this.gait = seed * 1.37;
    const material = new THREE.MeshStandardMaterial({ map: mat.coat, normalMap: mat.coatNormal, normalScale: new THREE.Vector2(.25, .25), color, vertexColors: true, roughness: .96 });
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFurPosition; varying vec3 vFurNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurPosition = position; vFurNormal = normal;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFurPosition; varying vec3 vFurNormal;')
        .replace('#include <map_fragment>', `vec3 blend = pow(abs(normalize(vFurNormal)), vec3(4.)); blend /= (blend.x+blend.y+blend.z);
        vec3 fur = texture2D(map,vFurPosition.zy*3.5).rgb*blend.x + texture2D(map,vFurPosition.xz*3.5).rgb*blend.y + texture2D(map,vFurPosition.xy*3.5).rgb*blend.z;
        float grey=dot(fur,vec3(.299,.587,.114)); diffuseColor.rgb *= mix(fur,vec3(grey),.62);`);
    };
    this.body.name = 'torso'; const bones: THREE.Bone[] = [this.body];
    for (let i = 0; i < 4; i++) {
      const front = i < 2, side = i % 2 === 0 ? -1 : 1, stance = species === 'ox' ? .285 : .205;
      const upper = new THREE.Bone(), lower = new THREE.Bone(), foot = new THREE.Bone();
      upper.name = `leg-${i}-upper`; lower.name = `leg-${i}-lower`; foot.name = `leg-${i}-hoof`;
      upper.position.set(side * stance, .91, front ? -.51 : .665);
      lower.position.set(0, -.43, front ? -.025 : .03); foot.position.set(0, -.37, front ? .025 : -.03);
      upper.add(lower); lower.add(foot); this.body.add(upper); bones.push(upper, lower, foot);
      this.legs.push({ upper, lower, foot, front, phase: [0, Math.PI, Math.PI * 1.5, Math.PI * .5][i] });
    }
    this.head.name = 'neck-and-head'; this.head.position.set(0, species === 'horse' ? 1.18 : 1.08, species === 'horse' ? -.15 : -.57); this.body.add(this.head); bones.push(this.head);
    this.tail.name = 'tail'; this.tail.position.set(0, 1.16, .79); this.body.add(this.tail); bones.push(this.tail);
    const headIndex = bones.indexOf(this.head), tailIndex = bones.indexOf(this.tail);
    const positions = geometry.getAttribute('position'), indices: number[] = [], weights: number[] = [], colors: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      let a = 0, b = 0, wa = 1;
      if (z < -.59 && y > .76) { a = headIndex; wa = smoothstep(.57, .90, -z) * smoothstep(.77, 1.03, y); }
      else if (z > .86 && y > .28) { a = tailIndex; wa = smoothstep(.84, 1.06, z); }
      else if (y < .95 && Math.abs(z) > .31) {
        const leg = (z < 0 ? 0 : 2) + (x > 0 ? 1 : 0), upper = 1 + leg * 3, lower = upper + 1, foot = upper + 2;
        if (y > .76) { a = upper; b = 0; wa = 1 - smoothstep(.77, .95, y); }
        else if (y > .37) { a = upper; b = lower; wa = smoothstep(.37, .60, y); }
        else { a = lower; b = foot; wa = smoothstep(.10, .24, y); }
      }
      indices.push(a, b, 0, 0); weights.push(wa, 1 - wa, 0, 0);
      let shade = .88 + Math.min(1, Math.max(0, y)) * .12;
      if (y < .20) shade *= .13 + smoothstep(.06, .20, y) * .64;
      if (z > .99) shade *= species === 'ox' ? .52 : .36;
      const c = new THREE.Color().setRGB(shade, shade, shade); colors.push(c.r, c.g, c.b);
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.mesh = new THREE.SkinnedMesh(geometry, material); this.mesh.add(this.body);
    this.mesh.bind(new THREE.Skeleton(bones)); this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.root.add(this.mesh); this.root.name = species === 'ox' ? 'Yoked draught ox · skeletal walk rig' : 'Living horse · walk, breathe, sniff, look';
    this.addDetails(mat);
  }
  private addDetails(mat: AdventureMaterials) {
    const ox = this.species === 'ox';
    const vertices = this.mesh.geometry.getAttribute('position');
    let frontZ = Infinity;
    for (let i = 0; i < vertices.count; i++) if (vertices.getY(i) > .8) frontZ = Math.min(frontZ, vertices.getZ(i));
    const muzzleCenter = new THREE.Vector3(); let noseCount = 0;
    for (let i = 0; i < vertices.count; i++) if (vertices.getZ(i) < frontZ + .075 && vertices.getY(i) > .8) { muzzleCenter.add(new THREE.Vector3().fromBufferAttribute(vertices, i)); noseCount++; }
    muzzleCenter.divideScalar(noseCount || 1); muzzleCenter.z += .025; muzzleCenter.y -= .008;
    const muzzleLocal = muzzleCenter.clone().sub(this.head.position);
    const eyeHeight = ox ? 1.37 : 1.46, eyeZ = muzzleCenter.z + .18;
    for (const side of [-1, 1]) {
      let best = Infinity; const anchor = new THREE.Vector3();
      for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
        if (x * side < .025) continue;
        const score = (y - eyeHeight) ** 2 + (z - eyeZ) ** 2;
        if (score < best) { best = score; anchor.set(x, y, z); }
      }
      anchor.x += side * .007; anchor.sub(this.head.position);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.019, 12, 10), mat.eye);
      eye.scale.set(.67, .80, 1); eye.position.copy(anchor); this.head.add(eye);
      const lid = new THREE.Mesh(new THREE.TorusGeometry(.021, .0035, 5, 14, Math.PI * 1.25), mat.leather);
      lid.rotation.set(0, Math.PI / 2, -.15); lid.position.copy(eye.position); lid.position.x += side * .002; this.head.add(lid);
      if (ox) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), this.mesh.material);
        // Accessory geometry uses a non-skinned clone of the coat material.
        const earMaterial = (this.mesh.material as THREE.MeshStandardMaterial).clone(); earMaterial.vertexColors = false; earMaterial.color.multiplyScalar(.73); ear.material = earMaterial;
        ear.scale.set(.18, .041, .083); ear.position.set(side * .245, .31, -.25); ear.rotation.z = side * -.28; ear.castShadow = true; this.head.add(ear);
        const horn = hornGeometry(side); const mesh = new THREE.Mesh(horn, mat.horn); mesh.position.set(0, .41, -.245); mesh.castShadow = true; this.head.add(mesh);
      }
    }
    const muzzleMat = new THREE.MeshStandardMaterial({ color: ox ? '#5e5141' : '#625143', roughness: .66, normalMap: mat.coatNormal, normalScale: new THREE.Vector2(.16, .16) });
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), muzzleMat);
    muzzle.scale.set(ox ? .14 : .087, ox ? .075 : .070, ox ? .095 : .075);
    muzzle.position.copy(muzzleLocal); this.head.add(muzzle);
    for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(.014, 10, 8), mat.hoof);
      nostril.scale.set(.55, 1, 1.3); nostril.position.copy(muzzleLocal).add(new THREE.Vector3(side * (ox ? .113 : .069), .021, -.042)); nostril.rotation.y = side * -.3; this.head.add(nostril);
    }
    if (ox) {
      const halterMat = mat.leather;
      for (const side of [-1, 1]) {
        const cheek = new THREE.Mesh(curvedTube([new THREE.Vector3(side * .17, .31, -.26), new THREE.Vector3(side * .17, muzzleLocal.y + .16, muzzleLocal.z + .12), new THREE.Vector3(side * .146, muzzleLocal.y + .01, muzzleLocal.z + .026)], .012, 12, 5), halterMat);
        this.head.add(cheek);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.035, .005, 6, 14), mat.iron); ring.rotation.y = Math.PI / 2; ring.position.set(side * .151, muzzleLocal.y + .01, muzzleLocal.z + .026); this.head.add(ring);
      }
      const noseband = new THREE.Mesh(curvedTube([new THREE.Vector3(-.146, muzzleLocal.y + .01, muzzleLocal.z + .026), new THREE.Vector3(-.085, muzzleLocal.y + .035, muzzleLocal.z - .071), new THREE.Vector3(.085, muzzleLocal.y + .035, muzzleLocal.z - .071), new THREE.Vector3(.146, muzzleLocal.y + .01, muzzleLocal.z + .026)], .014, 16, 6), halterMat); this.head.add(noseband);
    }
    this.bit.position.copy(muzzleLocal).add(new THREE.Vector3(0, .015, .035)); this.head.add(this.bit);
  }
  update(dt: number, distance: number, sniff = false) {
    dt = Math.max(0, Math.min(.1, dt));
    this.clock += dt;
    this.gait += distance * (this.species === 'ox' ? 5.3 : 5.7);
    this.walking = THREE.MathUtils.clamp(THREE.MathUtils.damp(this.walking, Math.abs(distance) / Math.max(.001, dt) > .025 ? 1 : 0, 6, dt), 0, 1);
    this.sniffing = THREE.MathUtils.damp(this.sniffing, sniff ? 1 : 0, 1.7, dt);
    for (const leg of this.legs) {
      const cycle = this.gait + leg.phase, swing = Math.sin(cycle), lift = Math.max(0, Math.cos(cycle));
      leg.upper.rotation.x = swing * (this.species === 'ox' ? .145 : .24) * this.walking;
      leg.lower.rotation.x = lift * (leg.front ? (this.species === 'ox' ? -.28 : -.43) : (this.species === 'ox' ? .25 : .38)) * this.walking;
      leg.foot.rotation.x = -leg.upper.rotation.x * .25 - leg.lower.rotation.x * .32;
    }
    this.body.position.y = Math.sin(this.gait * 2) * .015 * this.walking + Math.sin(this.clock * 1.6) * .004;
    this.body.rotation.z = Math.sin(this.gait) * .008 * this.walking;
    this.head.rotation.x = -.95 * this.sniffing + Math.sin(this.clock * 1.35) * .017 + Math.sin(this.gait) * .028 * this.walking;
    this.head.rotation.y = Math.sin(this.clock * .38) * .045 * (1 - this.walking);
    this.head.position.y = (this.species === 'horse' ? 1.18 : 1.08) - this.sniffing * .18;
    this.tail.rotation.z = Math.sin(this.clock * 1.4) * .18 + Math.sin(this.clock * .31) * .14;
    this.tail.rotation.x = Math.sin(this.clock * .85) * .08;
    this.root.updateMatrixWorld(true);
  }
  bitPosition(target = new THREE.Vector3()) { return this.bit.getWorldPosition(target); }
}
function hornGeometry(side: number) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * .13, 0, 0), new THREE.Vector3(side * .30, .035, .025),
    new THREE.Vector3(side * .45, .14, .035), new THREE.Vector3(side * .47, .30, -.035), new THREE.Vector3(side * .39, .40, -.12),
  ]);
  const rings = 22, sides = 9, frames = curve.computeFrenetFrames(rings, false), positions: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, center = curve.getPoint(t), radius = .052 * (1 - t) ** .7 + .002;
    const color = new THREE.Color('#f1dfb0').lerp(new THREE.Color('#3e372a'), smoothstep(.53, 1, t));
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2, v = center.clone().addScaledVector(frames.normals[i], Math.cos(a) * radius).addScaledVector(frames.binormals[i], Math.sin(a) * radius);
      positions.push(v.x, v.y, v.z); colors.push(color.r, color.g, color.b); uv.push(j / sides, t);
      if (i < rings && j < sides) { const n = i * (sides + 1) + j; indices.push(n, n + sides + 1, n + 1, n + 1, n + sides + 1, n + sides + 2); }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
