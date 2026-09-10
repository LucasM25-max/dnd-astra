import * as THREE from 'three';
import type { DieType } from './DiceResultResolver';

/**
 * Ivory-and-gold dice: procedural PBR-style materials plus per-face gold numerals.
 * Faces are extracted from each solid (coplanar triangles merged), so the
 * physics die can be guided to land any pre-determined value face-up.
 */
export interface DieFace { value: number; normal: THREE.Vector3; center: THREE.Vector3 }
export interface DieMesh { group: THREE.Group; radius: number; faces: DieFace[] }

const IVORY = '#f0e7d3';
const GOLD_NUMERAL = '#8a6d2f';
const EDGE = '#7a6430';

function numeralTexture(text: string, size: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.font = `700 ${Math.floor(size * 0.52)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size * 0.03);
  ctx.strokeStyle = 'rgba(60,45,15,0.85)';
  ctx.strokeText(text, size / 2, size / 2 + size * 0.02);
  ctx.fillStyle = GOLD_NUMERAL;
  ctx.fillText(text, size / 2, size / 2 + size * 0.02);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

interface Tri { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }

function trianglesOf(geometry: THREE.BufferGeometry): Tri[] {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = nonIndexed.getAttribute('position');
  const tris: Tri[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    tris.push({
      a: new THREE.Vector3().fromBufferAttribute(pos, i),
      b: new THREE.Vector3().fromBufferAttribute(pos, i + 1),
      c: new THREE.Vector3().fromBufferAttribute(pos, i + 2),
    });
  }
  if (nonIndexed !== geometry) nonIndexed.dispose();
  return tris;
}

function triNormal(t: Tri): THREE.Vector3 {
  const ab = t.b.clone().sub(t.a);
  const ac = t.c.clone().sub(t.a);
  return ab.cross(ac).normalize();
}

function triCentroid(t: Tri): THREE.Vector3 {
  return t.a.clone().add(t.b).add(t.c).multiplyScalar(1 / 3);
}

/** Merge coplanar triangles into polygonal faces; assign values 1..N deterministically. */
function extractFaces(geometry: THREE.BufferGeometry, sides: number): DieFace[] {
  const groups = new Map<string, { normal: THREE.Vector3; centers: THREE.Vector3[]; count: number }>();
  for (const t of trianglesOf(geometry)) {
    const n = triNormal(t);
    const key = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`;
    const g = groups.get(key);
    if (g) {
      g.normal.add(n);
      g.centers.push(triCentroid(t));
      g.count++;
    } else {
      groups.set(key, { normal: n.clone(), centers: [triCentroid(t)], count: 1 });
    }
  }
  const merged = [...groups.values()].map(g => ({
    normal: g.normal.normalize(),
    center: g.centers.reduce((acc, c) => acc.add(c), new THREE.Vector3()).multiplyScalar(1 / g.centers.length),
  }));
  // Deterministic value assignment: top faces first, then around.
  merged.sort((p, q) => q.center.y - p.center.y || Math.atan2(p.center.z, p.center.x) - Math.atan2(q.center.z, q.center.x));
  if (merged.length !== sides) {
    // Fallback: keep first N groups (should not happen for the chosen solids).
    while (merged.length < sides) merged.push({ normal: new THREE.Vector3(0, 1, 0), center: new THREE.Vector3(0, 0.5, 0) });
  }
  return merged.slice(0, sides).map((f, i) => ({ value: i + 1, normal: f.normal, center: f.center }));
}

/** Pentagonal trapezohedron (d10): explicit kite faces, values 1..10 labelled 1..9,0. */
function buildD10(radius: number): { geometry: THREE.BufferGeometry; faces: DieFace[] } {
  const apex = radius;
  const ringR = radius * 0.82;
  const ringY = radius * 0.32;
  const upper: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];
  for (let k = 0; k < 5; k++) {
    const au = (Math.PI / 2) + (k * Math.PI * 2) / 5;
    const al = au + Math.PI / 5;
    upper.push(new THREE.Vector3(Math.cos(au) * ringR, ringY, -Math.sin(au) * ringR));
    lower.push(new THREE.Vector3(Math.cos(al) * ringR, -ringY, -Math.sin(al) * ringR));
  }
  const top = new THREE.Vector3(0, apex, 0);
  const bottom = new THREE.Vector3(0, -apex, 0);
  const quads: THREE.Vector3[][] = [];
  for (let k = 0; k < 5; k++) {
    quads.push([top, upper[k], lower[k], upper[(k + 1) % 5]]);
    quads.push([bottom, lower[k], upper[(k + 1) % 5], lower[(k + 1) % 5]]);
  }
  const positions: number[] = [];
  const faces: DieFace[] = quads.map((q, i) => {
    const n = q[1].clone().sub(q[0]).cross(q[2].clone().sub(q[0])).normalize();
    if (n.dot(q[0]) < 0) n.negate();
    const center = q.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / 4);
    for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) positions.push(v.x, v.y, v.z);
    return { value: i + 1, normal: n, center };
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return { geometry, faces };
}

/** Display label for a face value (d10 shows 0 for 10, like physical dice). */
export function faceLabel(die: DieType, value: number): string {
  if (die === 10) return String(value % 10);
  if (die === 20 && (value === 6 || value === 9)) return `${value}.`;
  return String(value);
}

export function createDieMesh(die: DieType): DieMesh {
  const radius = die === 20 ? 0.62 : die === 12 ? 0.6 : die === 10 ? 0.62 : die === 8 ? 0.6 : die === 6 ? 0.52 : 0.58;
  let geometry: THREE.BufferGeometry;
  let faces: DieFace[];
  if (die === 20) {
    geometry = new THREE.IcosahedronGeometry(radius, 0);
    faces = extractFaces(geometry, 20);
  } else if (die === 12) {
    geometry = new THREE.DodecahedronGeometry(radius, 0);
    faces = extractFaces(geometry, 12);
  } else if (die === 10) {
    const built = buildD10(radius);
    geometry = built.geometry;
    faces = built.faces;
  } else if (die === 8) {
    geometry = new THREE.OctahedronGeometry(radius, 0);
    faces = extractFaces(geometry, 8);
  } else if (die === 6) {
    geometry = new THREE.BoxGeometry(radius * 1.5, radius * 1.5, radius * 1.5, 1, 1, 1);
    faces = extractFaces(geometry, 6);
  } else {
    geometry = new THREE.TetrahedronGeometry(radius * 1.35, 0);
    faces = extractFaces(geometry, 4);
  }

  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: IVORY, roughness: 0.38, metalness: 0.12, flatShading: true,
  });
  const body = new THREE.Mesh(geometry, material);
  body.castShadow = true;
  group.add(body);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 12),
    new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.55 }),
  );
  group.add(edges);

  // Gold numerals floating just above each face.
  const numeralSize = die === 20 ? 0.34 : die === 6 ? 0.5 : 0.4;
  for (const face of faces) {
    const texture = numeralTexture(faceLabel(die, face.value), 128);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(numeralSize, numeralSize),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    plane.position.copy(face.center).addScaledVector(face.normal, 0.012);
    plane.lookAt(face.center.clone().addScaledVector(face.normal, 2));
    group.add(plane);
  }
  return { group, radius, faces };
}

/** Quaternion that puts `value`'s face on top, with a random spin around Y. */
export function getFaceUpQuaternion(mesh: DieMesh, value: number, spin01: number): THREE.Quaternion {
  const face = mesh.faces.find(f => f.value === value) ?? mesh.faces[0];
  const toUp = new THREE.Quaternion().setFromUnitVectors(face.normal.clone().normalize(), new THREE.Vector3(0, 1, 0));
  const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin01 * Math.PI * 2);
  return spin.multiply(toUp);
}

/** Which face currently points most upward (used to verify guidance in tests). */
export function topFaceValue(mesh: DieMesh, quaternion: THREE.Quaternion): number {
  const up = new THREE.Vector3(0, 1, 0);
  let best = mesh.faces[0];
  let bestDot = -Infinity;
  for (const face of mesh.faces) {
    const world = face.normal.clone().applyQuaternion(quaternion);
    const d = world.dot(up);
    if (d > bestDot) { bestDot = d; best = face; }
  }
  return best.value;
}

export function disposeDieMesh(mesh: DieMesh): void {
  mesh.group.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const material = obj.material as THREE.Material | THREE.Material[];
      for (const m of Array.isArray(material) ? material : [material]) {
        const withMap = m as THREE.MeshBasicMaterial;
        if (withMap.map) withMap.map.dispose();
        m.dispose();
      }
    }
    if (obj instanceof THREE.LineSegments) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });
}
