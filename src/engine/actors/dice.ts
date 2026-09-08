import * as THREE from 'three';

/**
 * Physical, on-screen dice.
 *
 * When the hero swings, the actual d20 — the number the rules engine kept —
 * tumbles across the ground in front of the camera, bounces, settles with the
 * rolled face pointing skyward, and pulses. Damage dice follow. The physics is
 * a light custom integrator: real gravity, a restituted ground bounce, and a
 * final orientation snap so the settled face is always honest to the roll.
 *
 * Every die face carries its number as a canvas texture, mapped per face, so
 * a d20 reads as a d20 and a d10 as a d10.
 */

interface DieStyle { bg: string; fg: string; edge: string }
const FATE_STYLE: DieStyle = { bg: '#7e2020', fg: '#f3d992', edge: '#4d1010' };
const BONE_STYLE: DieStyle = { bg: '#e8dcc0', fg: '#33241a', edge: '#bda87e' };

function faceTexture(value: number, sides: number): THREE.CanvasTexture {
  const style = sides === 20 ? FATE_STYLE : BONE_STYLE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 58, 20, 64, 64, 88);
  gradient.addColorStop(0, style.bg);
  gradient.addColorStop(1, style.edge);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = style.fg;
  ctx.font = `bold ${value >= 10 ? 58 : 68}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

interface DieFace { value: number; normal: THREE.Vector3 }

interface Polyhedron { geometry: THREE.BufferGeometry; faces: DieFace[]; radius: number }

/**
 * Build a numbered polyhedron. Triangles are clustered into flat faces by
 * normal, each face gets one numbered material, and UVs unfold every face
 * into its texture square so the numeral appears once per face.
 */
function numberedPolyhedron(sides: number): Polyhedron {
  let source: THREE.BufferGeometry;
  switch (sides) {
    case 4: source = new THREE.TetrahedronGeometry(1); break;
    case 6: source = new THREE.BoxGeometry(1.18, 1.18, 1.18); break;
    case 8: source = new THREE.OctahedronGeometry(1.05); break;
    case 10: source = trapezohedron(); break;
    case 12: source = new THREE.DodecahedronGeometry(1); break;
    default: source = new THREE.IcosahedronGeometry(1.02); break;
  }
  const g = source.index ? source.toNonIndexed() : source;
  source.dispose();
  const position = g.getAttribute('position');
  const triangleCount = position.count / 3;

  // Cluster triangles into flat faces by normal direction.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  const clusters: { normal: THREE.Vector3; triangles: number[] }[] = [];
  for (let t = 0; t < triangleCount; t++) {
    a.fromBufferAttribute(position, t * 3);
    b.fromBufferAttribute(position, t * 3 + 1);
    c.fromBufferAttribute(position, t * 3 + 2);
    normal.copy(ab.subVectors(b, a).cross(ac.subVectors(c, a))).normalize();
    const key = `${normal.x.toFixed(2)},${normal.y.toFixed(2)},${normal.z.toFixed(2)}`;
    let cluster = clusters.find(cl => {
      const cn = cl.normal;
      return `${cn.x.toFixed(2)},${cn.y.toFixed(2)},${cn.z.toFixed(2)}` === key;
    });
    if (!cluster) { cluster = { normal: normal.clone(), triangles: [] }; clusters.push(cluster); }
    cluster.triangles.push(t);
  }

  const materials: THREE.Material[] = [];
  const faces: DieFace[] = [];
  const uv = new Float32Array(position.count * 2);
  const u = new THREE.Vector3(), v = new THREE.Vector3(), point = new THREE.Vector3();

  clusters.forEach((cluster, faceIndex) => {
    materials.push(new THREE.MeshStandardMaterial({
      map: faceTexture(faceIndex + 1, sides), roughness: 0.42, metalness: 0.05,
    }));
    faces.push({ value: faceIndex + 1, normal: cluster.normal.clone().normalize() });

    // A tangent basis in the face plane, from the first triangle's edge.
    a.fromBufferAttribute(position, cluster.triangles[0] * 3);
    b.fromBufferAttribute(position, cluster.triangles[0] * 3 + 1);
    u.subVectors(b, a).normalize();
    v.crossVectors(cluster.normal, u);

    // Project the face's vertices to 2D, then normalize into [0,1]².
    const projected = cluster.triangles.flatMap(t => [0, 1, 2].map(k => {
      point.fromBufferAttribute(position, t * 3 + k);
      return [point.dot(u), point.dot(v)] as [number, number];
    }));
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [pu, pv] of projected) {
      minU = Math.min(minU, pu); maxU = Math.max(maxU, pu);
      minV = Math.min(minV, pv); maxV = Math.max(maxV, pv);
    }
    cluster.triangles.forEach((t, k) => {
      for (let corner = 0; corner < 3; corner++) {
        const [pu, pv] = projected[k * 3 + corner];
        uv[t * 6 + corner * 2] = (pu - minU) / Math.max(1e-5, maxU - minU);
        uv[t * 6 + corner * 2 + 1] = (pv - minV) / Math.max(1e-5, maxV - minV);
      }
    });
  });

  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  // One group per face so each face carries its own numbered material.
  // Groups are index ranges into the triangle list, sorted by triangle index.
  const triFace: number[] = [];
  clusters.forEach((cluster, faceIndex) => cluster.triangles.forEach(t => { triFace[t] = faceIndex; }));
  g.clearGroups();
  let index = 0;
  while (index < triangleCount) {
    const faceIndex = triFace[index];
    let run = 1;
    while (index + run < triangleCount && triFace[index + run] === faceIndex) run++;
    g.addGroup(index * 3, run * 3, faceIndex);
    index += run;
  }
  g.computeBoundingSphere();
  g.userData.materials = materials;
  return { geometry: g, faces, radius: sides === 6 ? 0.62 : 1.02 };
}

/** A pentagonal trapezohedron: the classic d10 silhouette. */
function trapezohedron(): THREE.BufferGeometry {
  const positions: number[] = [];
  const apexTop = new THREE.Vector3(0, 1.25, 0), apexBottom = new THREE.Vector3(0, -1.25, 0);
  const ringTop: THREE.Vector3[] = [], ringBottom: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const aTop = (i / 5) * Math.PI * 2, aBottom = aTop + Math.PI / 5;
    ringTop.push(new THREE.Vector3(Math.cos(aTop) * 0.72, 0.32, Math.sin(aTop) * 0.72));
    ringBottom.push(new THREE.Vector3(Math.cos(aBottom) * 0.72, -0.32, Math.sin(aBottom) * 0.72));
  }
  const push = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
    // Outward winding: flip any triangle whose normal dives toward the axis.
    const n = q.clone().sub(p).cross(r.clone().sub(p));
    const outward = p.clone().add(q).add(r).divideScalar(3);
    if (n.dot(outward) < 0) positions.push(p.x, p.y, p.z, r.x, r.y, r.z, q.x, q.y, q.z);
    else positions.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  };
  for (let i = 0; i < 5; i++) {
    const i2 = (i + 1) % 5;
    push(apexTop, ringTop[i], ringBottom[i]);
    push(apexTop, ringBottom[i], ringTop[i2]);
    push(apexBottom, ringBottom[i2], ringTop[i2]);
    push(apexBottom, ringTop[i2], ringBottom[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

interface TumblingDie {
  group: THREE.Group;
  faces: DieFace[];
  radius: number;
  value: number;
  velocity: THREE.Vector3;
  angular: THREE.Vector3;
  rest: number;
  settled: boolean;
  settling: boolean;
  settleT: number;
  pulse: number;
  targetQuaternion: THREE.Quaternion | null;
}

export interface DiceRollRequest {
  /** The d20 result the engine kept. */
  d20: number;
  /** Every d20 rolled — advantage shows two dice hitting the ground. */
  d20Pool?: number[];
  /** Damage dice, if the attack landed. */
  damage?: { dice: number[]; sides: number; bonus: number };
  critical?: boolean;
  /** Where the dice land (on the ground). */
  anchor: THREE.Vector3;
}

export class DiceTray {
  readonly group = new THREE.Group();
  private dice: TumblingDie[] = [];
  private cache = new Map<number, Polyhedron & { materials: THREE.Material[] }>();
  private listeners: (() => void)[] = [];

  constructor(scene: THREE.Scene) {
    this.group.name = 'DiceTray';
    scene.add(this.group);
  }

  /** Build and compile every die's programs up front — staged inside the live
      scene so the cached programs match its exact lights — then remove them. */
  precompile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const warm = new THREE.Group();
    warm.position.set(0, -50, 0);
    for (const sides of [20, 12, 10, 8, 6, 4]) {
      const die = this.spawnDie(sides, Math.min(1, sides));
      this.group.remove(die.group);
      warm.add(die.group);
    }
    scene.add(warm);
    renderer.compile(scene, camera);
    scene.remove(warm);
    warm.clear();
    this.clear();
  }

  /** Roll the dice for one attack. `onSettled` fires once the faces read true. */
  roll(request: DiceRollRequest, onSettled?: () => void) {
    this.clear();
    const pool = request.d20Pool?.length ? request.d20Pool : [request.d20];
    const specs: { sides: number; value: number }[] = pool.map(value => ({ sides: 20, value }));
    if (request.damage && request.damage.dice.length) {
      for (const face of request.damage.dice) specs.push({ sides: request.damage.sides, value: face });
    }
    specs.forEach((spec, i) => {
      const die = this.spawnDie(spec.sides, spec.value);
      const angle = (i / specs.length) * Math.PI * 2 + Math.random() * 0.9;
      const distance = specs.length === 1 ? 0 : 0.16 + Math.random() * 0.3;
      die.group.position.set(
        request.anchor.x + Math.cos(angle) * distance,
        request.anchor.y + 1.15 + Math.random() * 0.35,
        request.anchor.z + Math.sin(angle) * distance,
      );
      die.group.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
      die.velocity.set(Math.cos(angle) * (0.3 + Math.random() * 0.45), -1.5 - Math.random(), Math.sin(angle) * (0.3 + Math.random() * 0.45));
      die.angular.set(Math.random() * 15 - 7.5, Math.random() * 15 - 7.5, Math.random() * 15 - 7.5);
      die.rest = request.anchor.y;
    });
    if (onSettled) this.listeners.push(onSettled);
  }

  private spawnDie(sides: number, value: number): TumblingDie {
    let cached = this.cache.get(sides);
    if (!cached) {
      const poly = numberedPolyhedron(sides);
      cached = { ...poly, materials: poly.geometry.userData.materials as THREE.Material[] };
      this.cache.set(sides, cached);
    }
    const mesh = new THREE.Mesh(cached.geometry, cached.materials);
    mesh.castShadow = true;
    // Oversized on purpose: the fate die must read at combat-camera distance.
    mesh.scale.setScalar(0.135);
    const group = new THREE.Group();
    group.add(mesh);
    this.group.add(group);
    return {
      group, faces: cached.faces, radius: cached.radius * 0.135, value,
      velocity: new THREE.Vector3(), angular: new THREE.Vector3(),
      rest: 0, settled: false, settling: false, settleT: 0, pulse: 0, targetQuaternion: null,
    };
  }

  get settled() { return this.dice.length > 0 && this.dice.every(die => die.settled); }

  update(dt: number) {
    // Physics advances in fixed substeps, so a slow frame stretches nothing:
    // the dice fall in wall-clock time however rarely the renderer ticks.
    const steps = Math.min(6, Math.max(1, Math.ceil(dt / (1 / 60))));
    const h = dt / steps;
    for (const die of this.dice) {
      if (!die.settled && !die.settling) for (let i = 0; i < steps; i++) this.stepPhysics(die, h);
      if (die.settling && !die.settled) {
        die.settleT += dt;
        if (die.targetQuaternion) die.group.quaternion.slerp(die.targetQuaternion, Math.min(1, dt * 11));
        if (die.settleT > 0.45) { die.settled = true; die.pulse = 1.2; }
      } else if (die.settled && die.pulse > 0) {
        // A soft settling bounce on the spot.
        die.pulse -= dt;
        die.group.position.y = die.rest + die.radius * 0.7 + Math.max(0, Math.sin((1.2 - die.pulse) * 9)) * 0.012 * Math.max(0, die.pulse);
      }
    }
    if (this.dice.length && this.dice.every(die => die.settled) && this.listeners.length) {
      const listeners = this.listeners;
      this.listeners = [];
      listeners.forEach(fn => fn());
    }
  }

  /** One fixed physics step for a tumbling die. */
  private stepPhysics(die: TumblingDie, h: number) {
    die.velocity.y -= 9.8 * h;
    die.group.position.addScaledVector(die.velocity, h);
    die.group.rotateX(die.angular.x * h);
    die.group.rotateY(die.angular.y * h);
    die.group.rotateZ(die.angular.z * h);
    if (die.group.position.y - die.radius * 0.7 <= die.rest && die.velocity.y < 0) {
      die.group.position.y = die.rest + die.radius * 0.7;
      die.velocity.y *= -0.34;
      die.velocity.x *= 0.62;
      die.velocity.z *= 0.62;
      die.angular.multiplyScalar(0.55);
      if (Math.abs(die.velocity.y) < 0.75) {
        die.velocity.set(0, 0, 0);
        die.angular.set(0, 0, 0);
        // Snap the rolled face skyward so the settled die reads true.
        const face = die.faces.find(f => f.value === die.value) ?? die.faces[0];
        const worldFace = face.normal.clone().applyQuaternion(die.group.quaternion).normalize();
        const align = new THREE.Quaternion().setFromUnitVectors(worldFace, new THREE.Vector3(0, 1, 0));
        const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
        die.targetQuaternion = yaw.multiply(align.multiply(die.group.quaternion));
        die.settling = true;
      }
    }
  }

  clear() {
    this.listeners = [];
    for (const die of this.dice) this.group.remove(die.group);
    this.dice = [];
  }

  dispose() {
    this.clear();
    this.cache.forEach(({ geometry, materials }) => {
      materials.forEach(material => {
        const map = (material as THREE.MeshStandardMaterial).map;
        map?.dispose();
        material.dispose();
      });
      geometry.dispose();
    });
    this.cache.clear();
  }
}
