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
 * Every die face carries its number in a single texture atlas, so a whole die
 * is one draw call no matter how many faces it has, and a d20 reads as a d20.
 */

interface DieStyle { bg: string; fg: string; edge: string }
const FATE_STYLE: DieStyle = { bg: '#7e2020', fg: '#f3d992', edge: '#4d1010' };
const BONE_STYLE: DieStyle = { bg: '#e8dcc0', fg: '#33241a', edge: '#bda87e' };

const CELL = 128;   // atlas cell size in pixels

/**
 * Paint one atlas containing every face of one polyhedron.
 *
 * Faces sit in a grid; each cell is a rounded plate with the numeral centred.
 * A one-pixel gutter is left around every cell so mip-filtering cannot pull a
 * neighbour's numeral into this face.
 */
function faceAtlas(values: number[], sides: number): { texture: THREE.Texture; columns: number; rows: number } {
  const style = sides === 20 ? FATE_STYLE : BONE_STYLE;
  const columns = Math.min(5, values.length);
  const rows = Math.ceil(values.length / columns);
  // Headless (unit tests, SSR): a flat texture keeps the numbers out of the
  // way while leaving the geometry and physics fully testable.
  if (typeof document === 'undefined') {
    return { texture: new THREE.Texture(), columns, rows };
  }
  const canvas = document.createElement('canvas');
  canvas.width = columns * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < values.length; i++) {
    const cx = (i % columns) * CELL, cy = Math.floor(i / columns) * CELL;
    const gradient = ctx.createRadialGradient(cx + CELL / 2, cy + CELL * 0.45, CELL * 0.08, cx + CELL / 2, cy + CELL / 2, CELL * 0.7);
    gradient.addColorStop(0, style.bg);
    gradient.addColorStop(1, style.edge);
    ctx.fillStyle = gradient;
    ctx.fillRect(cx, cy, CELL, CELL);

    // A dark rim so the face reads as a facet rather than a flat square.
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 4;
    ctx.strokeRect(cx + 2, cy + 2, CELL - 4, CELL - 4);

    ctx.fillStyle = style.fg;
    const text = String(values[i]);
    ctx.font = `bold ${text.length > 1 ? 58 : 68}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx + CELL / 2, cy + CELL * 0.55);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, columns, rows };
}

interface DieFace {
  value: number;
  normal: THREE.Vector3;
  /** In-face "up" — the direction of increasing v. Used to stand the numeral up. */
  up: THREE.Vector3;
}

interface Polyhedron {
  geometry: THREE.BufferGeometry;
  faces: DieFace[];
  /** Distance from the centre to the middle of a face: the resting height. */
  inradius: number;
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

/**
 * Assign face values. A real die is not numbered arbitrarily: on a d20 the two
 * faces opposite each other always sum to 21, and the same pairing rule holds
 * for every other shape. Honouring it is what makes a settled die look like a
 * die rather than a random number generator.
 */
function assignValues(normals: THREE.Vector3[]): number[] {
  const count = normals.length;
  // Pair each face with the one most nearly opposite it.
  const pairOf = new Array<number>(count).fill(-1);
  for (let i = 0; i < count; i++) {
    if (pairOf[i] !== -1) continue;
    let best = -1, bestDot = -0.7;
    for (let j = i + 1; j < count; j++) {
      if (pairOf[j] !== -1) continue;
      const d = normals[i].dot(normals[j]);
      if (d < bestDot) { bestDot = d; best = j; }
    }
    if (best >= 0) { pairOf[i] = best; pairOf[best] = i; } else pairOf[i] = i;
  }
  // Deal the numbers out in pairs, so a low number always sits opposite its
  // complement. A tetrahedron has no opposite faces, so it is simply dealt in
  // order — there is no pairing rule to honour on a d4.
  const values = new Array<number>(count).fill(0);
  const taken = new Set<number>();
  let low = 1;
  for (let i = 0; i < count; i++) {
    if (values[i]) continue;
    while (taken.has(low)) low++;
    values[i] = low; taken.add(low);
    const j = pairOf[i];
    if (j !== i) { const high = count + 1 - low; values[j] = high; taken.add(high); }
    low++;
  }
  return values;
}

/**
 * Build a numbered polyhedron. Triangles are clustered into flat faces by
 * normal; each face is unfolded into its own cell of one atlas texture, so a
 * die is a single mesh with a single material.
 */
function numberedPolyhedron(sides: number): Polyhedron & { material: THREE.MeshStandardMaterial } {
  let source: THREE.BufferGeometry;
  switch (sides) {
    case 4: source = new THREE.TetrahedronGeometry(1); break;
    case 6: source = new THREE.BoxGeometry(1.18, 1.18, 1.18); break;
    case 8: source = new THREE.OctahedronGeometry(1.05); break;
    case 10: source = trapezohedron(); break;
    case 12: source = new THREE.DodecahedronGeometry(1); break;
    default: source = new THREE.IcosahedronGeometry(1.02); break;
  }
  // PolyhedronGeometry and our trapezohedron are already non-indexed; only the
  // box needs flattening. Never dispose a geometry we are about to keep using.
  const g = source.index ? source.toNonIndexed() : source;
  if (g !== source) source.dispose();

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
    normal.copy(ab.subVectors(b, a).cross(ac.subVectors(c, a)));
    if (normal.lengthSq() < 1e-12) continue;      // a sliver triangle: skip it
    normal.normalize();
    let cluster = clusters.find(cl => cl.normal.dot(normal) > 0.999);
    if (!cluster) { cluster = { normal: normal.clone(), triangles: [] }; clusters.push(cluster); }
    cluster.triangles.push(t);
  }

  const values = assignValues(clusters.map(cl => cl.normal));
  const { texture, columns, rows } = faceAtlas(values, sides);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.42, metalness: 0.05 });

  const faces: DieFace[] = [];
  const uv = new Float32Array(position.count * 2);
  const u = new THREE.Vector3(), v = new THREE.Vector3(), point = new THREE.Vector3();
  let inradius = Infinity;

  clusters.forEach((cluster, faceIndex) => {
    // A tangent basis in the face plane, from the first triangle's edge.
    a.fromBufferAttribute(position, cluster.triangles[0] * 3);
    b.fromBufferAttribute(position, cluster.triangles[0] * 3 + 1);
    u.subVectors(b, a).normalize();
    v.crossVectors(cluster.normal, u).normalize();

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
    const spanU = Math.max(1e-5, maxU - minU), spanV = Math.max(1e-5, maxV - minV);
    cluster.triangles.forEach((t, k) => {
      for (let corner = 0; corner < 3; corner++) {
        const [pu, pv] = projected[k * 3 + corner];
        const fu = (pu - minU) / spanU, fv = (pv - minV) / spanV;
        // Into this face's atlas cell, inset by a gutter so mips stay clean.
        // Canvas textures are flipped, so v runs bottom-up: (1 - fv) puts the
        // top of the numeral at the top of the cell — i.e. along `face.up`.
        const cellX = faceIndex % columns, cellY = Math.floor(faceIndex / columns);
        uv[t * 6 + corner * 2] = (cellX + 0.03 + fu * 0.94) / columns;
        uv[t * 6 + corner * 2 + 1] = 1 - (cellY + 0.03 + (1 - fv) * 0.94) / rows;
      }
    });
    faces.push({ value: values[faceIndex], normal: cluster.normal.clone(), up: v.clone() });

    // Distance from the centre to this face plane: the height a die rests at.
    a.fromBufferAttribute(position, cluster.triangles[0] * 3);
    inradius = Math.min(inradius, Math.abs(cluster.normal.dot(a)));
  });

  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  if (!Number.isFinite(inradius) || inradius <= 0) inradius = 0.8;

  return { geometry: g, faces, inradius, material };
}

interface TumblingDie {
  group: THREE.Group;
  faces: DieFace[];
  /** Metres from the die centre to a face, after scaling. */
  inradius: number;
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
  /** The d20 result the engine kept. Omit it for a damage-only roll. */
  d20?: number;
  /** Every d20 rolled — advantage shows two dice hitting the ground. */
  d20Pool?: number[];
  /** Damage dice, if the attack landed. */
  damage?: { dice: number[]; sides: number; bonus: number };
  critical?: boolean;
  /** Where the dice land (on the ground). */
  anchor: THREE.Vector3;
  /** Keep whatever is already on the tray and add to it (a damage follow-up). */
  keep?: boolean;
}

const SCALE = 0.135;   // oversized on purpose: the fate die must read at combat range

export class DiceTray {
  readonly group = new THREE.Group();
  private dice: TumblingDie[] = [];
  private cache = new Map<number, Polyhedron & { material: THREE.MeshStandardMaterial }>();
  private listeners: (() => void)[] = [];
  /** Direction the settled numerals should face, so they read upright. */
  private viewDirection = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene) {
    this.group.name = 'DiceTray';
    scene.add(this.group);
  }

  /** Build and compile every die's program up front, staged inside the live
      scene so the cached programs match its exact lights, then remove them. */
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

  /** Which way the camera looks, so settled numerals stand up to the viewer. */
  setViewDirection(direction: THREE.Vector3) {
    const flat = new THREE.Vector3(direction.x, 0, direction.z);
    if (flat.lengthSq() > 1e-6) this.viewDirection.copy(flat).normalize();
  }

  /** Roll the dice for one attack. `onSettled` fires once the faces read true. */
  roll(request: DiceRollRequest, onSettled?: () => void) {
    if (!request.keep) this.clear();
    const specs: { sides: number; value: number }[] = [];
    if (!request.keep) {
      // A damage-only roll throws no fate die: the one already on the tray is
      // the one the player is reading.
      const pool = request.d20Pool?.length ? request.d20Pool : request.d20 === undefined ? [] : [request.d20];
      for (const value of pool) specs.push({ sides: 20, value });
    }
    if (request.damage && request.damage.dice.length) {
      for (const face of request.damage.dice) specs.push({ sides: request.damage.sides, value: face });
    }
    if (!specs.length) {
      // Nothing to throw: honour the callback immediately rather than hang.
      if (onSettled) onSettled();
      return;
    }
    // Lay the dice out on a ring so they do not land on top of one another.
    const spread = specs.length === 1 ? 0 : 0.17 + specs.length * 0.035;
    specs.forEach((spec, i) => {
      const die = this.spawnDie(spec.sides, spec.value);
      const angle = (i / specs.length) * Math.PI * 2 + Math.random() * 0.9;
      const distance = specs.length === 1 ? 0 : spread * (0.8 + Math.random() * 0.4);
      die.group.position.set(
        request.anchor.x + Math.cos(angle) * distance,
        request.anchor.y + 1.15 + Math.random() * 0.35,
        request.anchor.z + Math.sin(angle) * distance,
      );
      die.group.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
      die.velocity.set(Math.cos(angle) * (0.3 + Math.random() * 0.45), -1.5 - Math.random(), Math.sin(angle) * (0.3 + Math.random() * 0.45));
      die.angular.set(Math.random() * 15 - 7.5, Math.random() * 15 - 7.5, Math.random() * 15 - 7.5);
      die.rest = request.anchor.y;
      this.dice.push(die);
    });
    if (onSettled) this.listeners.push(onSettled);
  }

  private spawnDie(sides: number, value: number): TumblingDie {
    let cached = this.cache.get(sides);
    if (!cached) {
      cached = numberedPolyhedron(sides);
      this.cache.set(sides, cached);
    }
    const mesh = new THREE.Mesh(cached.geometry, cached.material);
    mesh.castShadow = true;
    mesh.scale.setScalar(SCALE);
    const group = new THREE.Group();
    group.add(mesh);
    this.group.add(group);
    return {
      group, faces: cached.faces, inradius: cached.inradius * SCALE, value,
      velocity: new THREE.Vector3(), angular: new THREE.Vector3(),
      rest: 0, settled: false, settling: false, settleT: 0, pulse: 0, targetQuaternion: null,
    };
  }

  get settled() { return this.dice.length > 0 && this.dice.every(die => die.settled); }
  get count() { return this.dice.length; }

  update(dt: number) {
    // Physics advances in fixed substeps, so a slow frame stretches nothing:
    // the dice fall in wall-clock time however rarely the renderer ticks.
    const steps = Math.min(6, Math.max(1, Math.ceil(dt / (1 / 60))));
    const h = dt / steps;
    let allSettled = this.dice.length > 0;
    for (const die of this.dice) {
      if (!die.settled && !die.settling) {
        for (let i = 0; i < steps && !die.settling; i++) this.stepPhysics(die, h);
      }
      if (die.settling && !die.settled) {
        die.settleT += dt;
        if (die.targetQuaternion) die.group.quaternion.slerp(die.targetQuaternion, Math.min(1, dt * 11));
        if (die.settleT > 0.45) { die.settled = true; die.pulse = 1.2; }
      } else if (die.settled && die.pulse > 0) {
        // A soft settling bounce on the spot.
        die.pulse -= dt;
        die.group.position.y = die.rest + die.inradius + Math.max(0, Math.sin((1.2 - die.pulse) * 9)) * 0.012 * Math.max(0, die.pulse);
      }
      if (!die.settled) allSettled = false;
    }
    if (allSettled && this.listeners.length) {
      const listeners = this.listeners;
      this.listeners = [];
      for (const fn of listeners) fn();
    }
  }

  /** One fixed physics step for a tumbling die. */
  private stepPhysics(die: TumblingDie, h: number) {
    die.velocity.y -= 9.8 * h;
    die.group.position.addScaledVector(die.velocity, h);
    die.group.rotateX(die.angular.x * h);
    die.group.rotateY(die.angular.y * h);
    die.group.rotateZ(die.angular.z * h);
    if (die.group.position.y - die.inradius <= die.rest && die.velocity.y < 0) {
      die.group.position.y = die.rest + die.inradius;
      die.velocity.y *= -0.34;
      die.velocity.x *= 0.62;
      die.velocity.z *= 0.62;
      die.angular.multiplyScalar(0.55);
      if (Math.abs(die.velocity.y) < 0.75) {
        die.velocity.set(0, 0, 0);
        die.angular.set(0, 0, 0);
        die.targetQuaternion = this.restingOrientation(die);
        die.settling = true;
      }
    }
  }

  /**
   * The orientation that puts the rolled face flat-up, with its numeral
   * standing upright to the camera.
   */
  private restingOrientation(die: TumblingDie): THREE.Quaternion {
    const face = die.faces.find(f => f.value === die.value) ?? die.faces[0];
    const worldFace = face.normal.clone().applyQuaternion(die.group.quaternion).normalize();
    const align = new THREE.Quaternion().setFromUnitVectors(worldFace, new THREE.Vector3(0, 1, 0));
    const base = align.multiply(die.group.quaternion).normalize();

    // Stand the numeral up: rotate about the world up-axis until the face's
    // own "up" points toward the viewer.
    const faceUp = face.up.clone().applyQuaternion(base);
    const flat = new THREE.Vector3(faceUp.x, 0, faceUp.z);
    let yaw = 0;
    if (flat.lengthSq() > 1e-6) {
      flat.normalize();
      // The viewer looks along `viewDirection`; the numeral should lean back
      // toward them, so its up-vector points opposite the view direction.
      const want = this.viewDirection.clone().negate();
      yaw = Math.atan2(flat.x, flat.z) - Math.atan2(want.x, want.z);
      yaw = -yaw;
    }
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(base).normalize();
  }

  clear() {
    this.listeners = [];
    for (const die of this.dice) {
      this.group.remove(die.group);
      die.group.clear();
    }
    this.dice = [];
  }

  dispose() {
    this.clear();
    this.cache.forEach(({ geometry, material }) => {
      material.map?.dispose();
      material.dispose();
      geometry.dispose();
    });
    this.cache.clear();
  }
}
