import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Batch rigid, detailed parts by material rather than one draw call per nail. */
export class Assembly {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geometry: THREE.BufferGeometry, material: THREE.Material, position = new THREE.Vector3(), rotation = new THREE.Euler(), scale = new THREE.Vector3(1, 1, 1)) {
    const matrix = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g = g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const bucket = this.buckets.get(material) ?? []; bucket.push(g); this.buckets.set(material, bucket);
    geometry.dispose();
    return this;
  }
  box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, bevel = .012) {
    const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(bevel, w * .12, h * .12, d * .12));
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
    const dimensions = [w, h, d], axis = dimensions.indexOf(Math.max(...dimensions));
    const offset = Math.sin(x * 41 + y * 7 + z * 16) * 3;
    for (let i = 0; i < p.count; i++) {
      const v = [p.getX(i), p.getY(i), p.getZ(i)], normal = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))];
      const face = normal.indexOf(Math.max(...normal));
      const uAxis = face === axis ? (axis + 1) % 3 : axis;
      const vAxis = [0, 1, 2].find(a => a !== face && a !== uAxis) ?? 1;
      uv.setXY(i, v[uAxis] * 1.7 + offset, v[vAxis] * 2.2 + offset * .3);
    }
    return this.add(g, material, new THREE.Vector3(x, y, z), new THREE.Euler(rx, ry, rz));
  }
  build(name = 'Hand-crafted assembly') {
    const group = new THREE.Group(); group.name = name;
    for (const [material, geometries] of this.buckets) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(g => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere(); const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
    this.buckets.clear(); return group;
  }
}
export function curvedTube(points: THREE.Vector3[], radius: number, segments = 20, sides = 7) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, sides, false);
}
export function lathe(profile: [number, number][], segments = 32) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}
export function smoothNormals(g: THREE.BufferGeometry) {
  g.computeVertexNormals();
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), sums = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${Math.round(p.getX(i) * 100000)},${Math.round(p.getY(i) * 100000)},${Math.round(p.getZ(i) * 100000)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i), sum = sums.get(k) ?? new THREE.Vector3(); sum.x += n.getX(i); sum.y += n.getY(i); sum.z += n.getZ(i); sums.set(k, sum); }
  for (const sum of sums.values()) sum.normalize();
  for (let i = 0; i < p.count; i++) { const sum = sums.get(key(i))!; n.setXYZ(i, sum.x, sum.y, sum.z); }
  return g;
}
export class FlexibleRope {
  readonly mesh: THREE.Mesh;
  private points = Array.from({ length: 13 }, () => new THREE.Vector3());
  constructor(material: THREE.Material, radius = .008) {
    this.mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)), 12, radius, 5, false), material);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
  }
  update(a: THREE.Vector3, b: THREE.Vector3, sag: number, time = 0) {
    const p = this.mesh.geometry.getAttribute('position');
    for (let i = 0; i <= 12; i++) {
      const t = i / 12; this.points[i].copy(a).lerp(b, t);
      this.points[i].y -= Math.sin(t * Math.PI) * sag;
      this.points[i].x += Math.sin(t * 8 + time * 2) * Math.sin(t * Math.PI) * .008;
    }
    const tangent = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
    for (let i = 0; i <= 12; i++) {
      tangent.copy(this.points[Math.min(12, i + 1)]).sub(this.points[Math.max(0, i - 1)]).normalize();
      side.crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize(); up.crossVectors(side, tangent).normalize();
      for (let j = 0; j <= 5; j++) {
        const angle = j / 5 * Math.PI * 2, v = this.points[i].clone().addScaledVector(side, Math.cos(angle) * .008).addScaledVector(up, Math.sin(angle) * .008);
        p.setXYZ(i * 6 + j, v.x, v.y, v.z);
      }
    }
    p.needsUpdate = true; this.mesh.geometry.computeVertexNormals();
  }
}
