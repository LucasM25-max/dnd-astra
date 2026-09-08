import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom, smoothstep, terrainHeight } from '../landscape';
import { smoothNormals } from './geometry';
import type { AdventureMaterials } from './materials';

/**
 * Living quadrupeds (draft oxen + wild horses), sculpted procedurally from
 * lofted cross-sections: a real torso, an articulated neck/head, four
 * two-bone legs solved per foot against the terrain, and layered idle life.
 * Faces -Z, up is +Y, metres.
 */
type Species = 'ox' | 'horse';

export interface AnimalCommand {
  speed: number;                 // m/s along facing (signed; reverse allowed)
  head: { pitch: number; yaw: number };  // target head pose, radians (pitch + = nose down)
  alert: number;                 // 0..1 startled
  strain: number;                // 0..1 (oxen: pulling/braking effort)
}
export const NEUTRAL_HEAD = { pitch: 0, yaw: 0 };

type SpeciesShape = {
  shoulder: number; knee: number; hock: number; frontZ: number; rearZ: number; stance: number;
  neckBase: THREE.Vector3; headBase: THREE.Vector3; tailBase: THREE.Vector3;
  torso: [number, number, number, number][];   // z, back, belly, halfWidth
  torsoPoles: [THREE.Vector3, THREE.Vector3];
  neck: [number, number, number, number][];    // y, z, halfWidth, halfHeight
  head: [number, number, number, number][];    // y, z, halfWidth, halfHeight
  chinPole: THREE.Vector3;
};
const SHAPES: Record<Species, SpeciesShape> = {
  horse: {
    shoulder: .95, knee: .50, hock: .46, frontZ: -.52, rearZ: .66, stance: .15,
    neckBase: new THREE.Vector3(0, 1.02, -.64), headBase: new THREE.Vector3(0, .43, -.51), tailBase: new THREE.Vector3(0, 1.26, .84),
    torso: [[-.82, 1.10, .66, .27], [-.52, 1.31, .66, .28], [-.18, 1.34, .60, .26], [.16, 1.33, .57, .24], [.50, 1.36, .62, .26], [.82, 1.44, .72, .27], [.94, 1.36, .78, .17]],
    torsoPoles: [new THREE.Vector3(0, 1.12, -.95), new THREE.Vector3(0, 1.30, 1.06)],
    neck: [[1.00, -.62, .165, .175], [1.20, -.80, .140, .150], [1.36, -1.00, .115, .125], [1.45, -1.15, .100, .110]],
    head: [[1.43, -1.15, .105, .115], [1.44, -1.27, .090, .100], [1.37, -1.41, .068, .084], [1.29, -1.53, .062, .064], [1.22, -1.58, .056, .050]],
    chinPole: new THREE.Vector3(0, 1.21, -1.63),
  },
  ox: {
    shoulder: .98, knee: .52, hock: .48, frontZ: -.48, rearZ: .68, stance: .19,
    neckBase: new THREE.Vector3(0, .94, -.58), headBase: new THREE.Vector3(0, .35, -.48), tailBase: new THREE.Vector3(0, 1.14, .82),
    torso: [[-.80, 1.02, .62, .33], [-.50, 1.20, .64, .35], [-.22, 1.17, .58, .33], [.14, 1.12, .55, .30], [.48, 1.18, .60, .31], [.80, 1.25, .68, .32], [.92, 1.17, .74, .20]],
    torsoPoles: [new THREE.Vector3(0, 1.00, -.93), new THREE.Vector3(0, 1.12, 1.04)],
    neck: [[.92, -.56, .210, .215], [1.10, -.76, .170, .175], [1.24, -.94, .140, .145], [1.29, -1.06, .125, .130]],
    head: [[1.27, -1.06, .140, .150], [1.26, -1.22, .115, .125], [1.18, -1.36, .092, .100], [1.10, -1.45, .088, .078], [1.03, -1.49, .075, .055]],
    chinPole: new THREE.Vector3(0, 1.01, -1.54),
  },
};

interface Part { geometry: THREE.BufferGeometry; boneA: number; boneB: number; blend: (v: THREE.Vector3) => number; min: number; max: number }
const BONE = { body: 0, neck: 1, head: 2, tail: 3, leg: (i: number, j: number) => 4 + i * 3 + j };

/** Vertical elliptical sections stacked along Z -> torso / neck / head. */
function loftSections(stations: THREE.Vector3[], widths: number[], heights: number[], sides: number, poles: [THREE.Vector3 | null, THREE.Vector3 | null]) {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
  const ring = (center: THREE.Vector3, w: number, h: number, col: number, u: number) => {
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      positions.push(center.x + Math.cos(a) * w, center.y + Math.sin(a) * h, center.z);
      colors.push(col, col, col); uvs.push(u, j / sides);
    }
  };
  const rings: number = stations.length;
  const start = poles[0] ? 1 : 0;
  const endOffset = start + rings * sides;
  // The poles are emitted first so the index arithmetic below stays simple:
  // index 0 is the start pole, the rings follow from `start`, and the end pole
  // lands exactly on `endOffset`. Emitting them last shifted every ring by one
  // and ran the final quad off the end of the vertex buffer.
  if (poles[0]) { positions.push(poles[0]!.x, poles[0]!.y, poles[0]!.z); colors.push(.88, .88, .88); uvs.push(0, 0); }
  for (let i = 0; i < rings; i++) {
    const c = stations[i], hash = Math.sin(c.y * 311.7 + c.z * 74.7) * 43758.5453; const c0 = .86 + (c.y - .5) * .045 + (hash - Math.floor(hash) - .5) * .035, shade = Math.max(0, Math.min(1, c0));
    ring(c, widths[i], heights[i], Math.max(0, Math.min(1, shade)), i / Math.max(1, rings - 1));
  }
  if (poles[1]) { positions.push(poles[1]!.x, poles[1]!.y, poles[1]!.z); colors.push(.84, .84, .84); uvs.push(1, 0); }
  // The torso is authored tail-to-head (increasing z) but the neck and head run
  // the other way, out along -Z. Winding is only "outward" relative to the
  // direction the rings travel, so a backwards stack has to be wound backwards.
  const flip = rings > 1 && stations[rings - 1].z < stations[0].z;
  // A quad's corners are listed around its perimeter, so the two triangles are
  // (a,b,c) and (a,c,d). Repeating b instead of a — (c,b,d) — reverses the
  // second triangle and turns half of every animal inside out.
  const quad = (a: number, b: number, c: number, d: number) => {
    if (flip) indices.push(a, c, b, a, d, c); else indices.push(a, b, c, a, c, d);
  };
  const tri = (a: number, b: number, c: number) => { indices.push(a, b, c); };
  for (let i = 0; i < rings - 1; i++) {
    const r0 = start + i * sides, r1 = start + (i + 1) * sides;
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      quad(r0 + j, r0 + j2, r1 + j2, r1 + j);
    }
  }
  // The start pole faces back along the stack (-Z unflipped, +Z flipped); the
  // end pole sits past the last ring — which begins at endOffset - sides —
  // and faces the opposite way.
  if (poles[0]) for (let j = 0; j < sides; j++) {
    if (flip) tri(0, start + j, start + (j + 1) % sides);
    else tri(0, start + (j + 1) % sides, start + j);
  }
  if (poles[1]) for (let j = 0; j < sides; j++) {
    if (flip) tri(endOffset, endOffset - sides + (j + 1) % sides, endOffset - sides + j);
    else tri(endOffset, endOffset - sides + j, endOffset - sides + (j + 1) % sides);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  return g;
}
/** Horizontal elliptical rings stacked along Y -> legs / hooves / tail. */
function loftColumn(rings: { y: number; dx: number; dz: number; hx: number; hz: number; col: number }[], sides: number, capTop: boolean, capBottom: boolean) {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
  const order: { y: number; dx: number; dz: number; hx: number; hz: number; col: number }[] = [...rings].sort((a, b) => b.y - a.y);
  if (capTop) { const m = order[0]; positions.push(m.dx, m.y + .004, m.dz); colors.push(m.col, m.col, m.col); uvs.push(0, 0); }
  for (let i = 0; i < order.length; i++) {
    const m = order[i];
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      positions.push(m.dx + Math.cos(a) * m.hx, m.y, m.dz + Math.sin(a) * m.hz);
      const c = m.col * (0.97 + .03 * Math.cos(a)); colors.push(c, c, c); uvs.push(i / Math.max(1, order.length - 1), j / sides);
    }
  }
  let bottomPole = -1;
  if (capBottom) { const m = order[order.length - 1]; bottomPole = positions.length / 3; positions.push(m.dx, m.y - .004, m.dz); colors.push(m.col, m.col, m.col); uvs.push(1, 0); }
  const topPole = capTop ? 0 : -1;
  const quad = (a: number, b: number, c: number, d: number) => { indices.push(a, b, c, a, c, d); };
  const tri = (a: number, b: number, c: number) => { indices.push(a, b, c); };
  for (let i = 0; i < order.length - 1; i++) {
    const r0 = (capTop ? 1 : 0) + i * sides, r1 = (capTop ? 1 : 0) + (i + 1) * sides;
    for (let j = 0; j < sides; j++) { const j2 = (j + 1) % sides; quad(r0 + j, r0 + j2, r1 + j2, r1 + j); }
  }
  // Rings are stored top-down, so the top cap faces up and the bottom cap down.
  if (topPole >= 0) for (let j = 0; j < sides; j++) tri(topPole, (capTop ? 1 : 0) + (j + 1) % sides, (capTop ? 1 : 0) + j);
  if (bottomPole >= 0) { const r0 = (capTop ? 1 : 0) + (order.length - 1) * sides; for (let j = 0; j < sides; j++) tri(bottomPole, r0 + j, r0 + (j + 1) % sides); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  return g;
}
function latheBlob(profile: [number, number][], segments: number) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments);
  const positions = g.getAttribute('position'), colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) { const c = .3; colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = c; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.count * 2), 2));
  return g;
}
const shadeAttr = (g: THREE.BufferGeometry, value: number) => {
  const n = g.getAttribute('position').count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = value; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  return g;
};

/** Catmull-Rom resample of an authored 4-column profile into a smooth curve. */
function resampleRows(rows: number[][], samples: number): number[][] {
  const cA = new THREE.CatmullRomCurve3(rows.map(r => new THREE.Vector3(r[0], r[1], 0)));
  const cB = new THREE.CatmullRomCurve3(rows.map(r => new THREE.Vector3(r[2], r[3], 0)));
  const out: number[][] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / Math.max(1, samples - 1), a = cA.getPoint(t), b = cB.getPoint(t);
    out.push([a.x, a.y, b.x, b.y]);
  }
  return out;
}

/** Build the full rest-pose body with skin indices/weights for the 16-bone rig. */
function buildBody(species: Species, detail: number): THREE.BufferGeometry {
  const S = SHAPES[species];
  const sides = Math.max(8, Math.round(22 * detail)), legSides = Math.max(6, Math.round(14 * detail));
  const ox = species === 'ox', wide = ox ? 1.16 : 1;
  const parts: Part[] = [];
  // Torso: resampled sections -> a smooth barrel with haunch and shoulder mass.
  const torsoRows = resampleRows(S.torso, Math.max(10, Math.round(16 * detail)));
  const stations = torsoRows.map(([z, back, belly]) => new THREE.Vector3(0, (back + belly) / 2, z));
  // Each resampled row is [z, back, belly, halfWidth]. Destructuring it without
  // the leading `z` turns the torso's half-height into (z - back) / 2: a
  // negative number three times too large, which built every animal's barrel
  // upside down and nearly two metres tall.
  const widths = torsoRows.map(([, , , hw]) => hw * wide), heights = torsoRows.map(([, back, belly]) => (back - belly) / 2);
  const torso = loftSections(stations, widths, heights, sides, S.torsoPoles);
  parts.push({ geometry: torso, boneA: BONE.body, boneB: BONE.neck, min: -1.0, max: -0.4, blend: v => smoothstep(-.58, -.92, v.z) * smoothstep(.95, 1.28, v.y) });
  // Neck.
  const neckStations = S.neck.map(([y, z]) => new THREE.Vector3(0, y, z));
  parts.push({ geometry: loftSections(neckStations, S.neck.map(([, , w]) => w), S.neck.map(([, , , h]) => h), sides, [null, null]), boneA: BONE.neck, boneB: BONE.body, min: .9, max: 1.4, blend: v => smoothstep(1.05, 1.34, v.y) });
  // Head.
  const headStations = S.head.map(([y, z]) => new THREE.Vector3(0, y, z));
  const head = loftSections(headStations, S.head.map(([, , w]) => w * (ox ? 1.04 : 1)), S.head.map(([, , , h]) => h), sides, [null, S.chinPole]);
  parts.push({ geometry: head, boneA: BONE.head, boneB: BONE.neck, min: 1.0, max: 1.6, blend: v => smoothstep(1.05, 1.30, v.y) * smoothstep(-1.00, -1.14, v.z) });
  // Tail.
  const tailRings = ox
    ? [{ y: 1.16, dx: 0, dz: .84, hx: .045, hz: .055, col: .42 }, { y: .95, dx: 0, dz: .90, hx: .030, hz: .034, col: .38 }, { y: .72, dx: 0, dz: .96, hx: .022, hz: .024, col: .34 }, { y: .50, dx: 0, dz: 1.00, hx: .016, hz: .017, col: .30 }]
    : [{ y: 1.30, dx: 0, dz: .86, hx: .040, hz: .048, col: .45 }, { y: 1.02, dx: 0, dz: .93, hx: .026, hz: .030, col: .40 }, { y: .74, dx: 0, dz: .99, hx: .019, hz: .021, col: .35 }, { y: .50, dx: 0, dz: 1.03, hx: .014, hz: .015, col: .30 }];
  parts.push({ geometry: loftColumn(tailRings, legSides, true, false), boneA: BONE.tail, boneB: BONE.body, min: .5, max: 1.4, blend: v => 1 - smoothstep(.9, 1.25, v.y) });
  const tuft = latheBlob([[.002, 0], [.052, .02], [.062, .09], [.048, .16], [.02, .2], [.002, .21]], Math.max(6, Math.round(10 * detail)));
  tuft.rotateX(Math.PI); tuft.translate(0, .47, ox ? 1.00 : 1.03); shadeAttr(tuft, .28);
  parts.push({ geometry: tuft, boneA: BONE.tail, boneB: BONE.tail, min: 0, max: 1, blend: () => 1 });
  // Legs: two bones + hoof per leg.
  for (let leg = 0; leg < 4; leg++) {
    const front = leg < 2, side = leg % 2 === 0 ? -1 : 1;
    const cx = side * S.stance, cz = front ? S.frontZ : S.rearZ;
    const sh = S.shoulder, knee = front ? S.knee : S.hock, ankle = .14;
    const lw = ox ? 1.16 : 1;
    const upperRings = front
      ? [{ y: sh + .02, dx: cx, dz: cz, hx: .13 * lw, hz: .115 * lw, col: .80 }, { y: sh * .82, dx: cx, dz: cz - .01, hx: .105 * lw, hz: .095 * lw, col: .76 }, { y: (sh + knee) / 2, dx: cx, dz: cz - .025, hx: .082 * lw, hz: .08 * lw, col: .72 }, { y: knee, dx: cx, dz: cz - .04, hx: .068 * lw, hz: .066 * lw, col: .68 }]
      : [{ y: sh + .02, dx: cx, dz: cz, hx: .135 * lw, hz: .12 * lw, col: .80 }, { y: sh * .80, dx: cx, dz: cz + .015, hx: .118 * lw, hz: .10 * lw, col: .76 }, { y: (sh + knee) / 2 + .02, dx: cx, dz: cz + .045, hx: .09 * lw, hz: .078 * lw, col: .70 }, { y: knee, dx: cx, dz: cz + .075, hx: .066 * lw, hz: .06 * lw, col: .66 }];
    const lowerRings = front
      ? [{ y: knee, dx: cx, dz: cz - .04, hx: .060 * lw, hz: .060 * lw, col: .55 }, { y: (knee + ankle) / 2, dx: cx, dz: cz - .035, hx: .045 * lw, hz: .046 * lw, col: .42 }, { y: ankle, dx: cx, dz: cz - .03, hx: .038 * lw, hz: .04 * lw, col: .34 }]
      : [{ y: knee, dx: cx, dz: cz + .075, hx: .058 * lw, hz: .054 * lw, col: .55 }, { y: (knee + ankle) / 2, dx: cx, dz: cz + .06, hx: .044 * lw, hz: .044 * lw, col: .42 }, { y: ankle, dx: cx, dz: cz + .05, hx: .036 * lw, hz: .038 * lw, col: .34 }];
    const upper = loftColumn(upperRings, legSides, true, false);
    parts.push({ geometry: upper, boneA: BONE.leg(leg, 0), boneB: BONE.body, min: knee, max: sh + .02, blend: v => 1 - smoothstep(sh - .14, sh - .02, v.y) });
    const lower = loftColumn(lowerRings, legSides, true, false);
    parts.push({ geometry: lower, boneA: BONE.leg(leg, 1), boneB: BONE.leg(leg, 0), min: ankle, max: knee, blend: v => 1 - smoothstep(knee - .16, knee - .04, v.y) });
    const hoof = latheBlob([[.004, 0], [.052, .004], [.058, .035], [.054, .09], [.045, .145]], Math.max(6, Math.round(12 * detail)));
    hoof.scale(lw, 1, 1.18 * lw); hoof.translate(cx, 0, cz + (front ? -.03 : .05)); shadeAttr(hoof, .13);
    parts.push({ geometry: hoof, boneA: BONE.leg(leg, 2), boneB: BONE.leg(leg, 1), min: 0, max: .16, blend: v => 1 - smoothstep(.05, .15, v.y) });
  }
  // Merge, then convert part tags into skin indices/weights.
  for (const p of parts) {
    if (!p.geometry.getAttribute('normal')) p.geometry.computeVertexNormals();
    p.geometry.setAttribute('part', new THREE.Uint8BufferAttribute(new Uint8Array(p.geometry.getAttribute('position').count).fill(parts.indexOf(p)), 1));
  }
  const merged = mergeGeometries(parts.map(p => p.geometry), false)!;
  parts.forEach(p => p.geometry.dispose());
  const pos = merged.getAttribute('position'), partAttr = merged.getAttribute('part') as THREE.BufferAttribute;
  const indices = new Uint16Array(pos.count * 4), weights = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const part = parts[partAttr.getX(i)], v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const w = part.blend(v);
    indices[i * 4] = w > .5 ? part.boneA : part.boneB; indices[i * 4 + 1] = w > .5 ? part.boneB : part.boneA;
    weights[i * 4] = w; weights[i * 4 + 1] = 1 - w;
  }
  merged.deleteAttribute('part');
  merged.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4));
  merged.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
  smoothNormals(merged);
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
}

export class LivingAnimal {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly head = new THREE.Bone();
  readonly bit = new THREE.Object3D();
  readonly species: Species;
  onFootfall?: (leg: number, x: number, z: number, strength: number) => void;
  private body = new THREE.Bone();
  private neck = new THREE.Bone();
  private tail = new THREE.Bone();
  readonly legs: { upper: THREE.Bone; lower: THREE.Bone; foot: THREE.Bone; front: boolean; phase: number; lane: number;
    state: 'stance' | 'swing'; planted: THREE.Vector3; next: THREE.Vector3; prevTheta: number }[] = [];
  private earL!: THREE.Mesh; private earR!: THREE.Mesh;
  private lidL!: THREE.Mesh; private lidR!: THREE.Mesh;
  private nostrilL!: THREE.Mesh; private nostrilR!: THREE.Mesh;
  private jaw?: THREE.Group;
  private t: number;
  private gait = 0;
  private moving = 0;
  private gaitBlend = 0;
  private lastDir = 1;
  private nextBlink = 2; private blinkT = -1;
  private nextEarFlick = 3; private earFlickT = -1;
  private nextTailFlick = 9; private tailFlickT = -1;
  private rng: () => number;
  private hipCache = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private hoofCache = new THREE.Vector3();
  private readonly L1f: number; private readonly L2f: number; private readonly L1r: number; private readonly L2r: number;
  private static readonly FOOT = .144; // foot-bone height above the hoof's ground contact point

  constructor(species: Species, color: string, mat: AdventureMaterials, seed = 0, detail = 1) {
    this.species = species; this.t = seed * 2.19; this.gait = seed * 1.37; this.rng = seededRandom(9000 + seed * 137);
    const S = SHAPES[species];
    this.L1f = S.shoulder - .02 - S.knee; this.L2f = S.knee - .14; this.L1r = S.shoulder - .02 - S.hock; this.L2r = S.hock - .14;
    // Each species wears its own photographed coat — brindle ox hide, chestnut
    // horse bay — with the tint only shifting within the breed, so the fur
    // reads as fur rather than painted plastic under changing light.
    const material = new THREE.MeshStandardMaterial({
      map: species === 'ox' ? mat.oxCoat : mat.horseCoat,
      normalMap: species === 'ox' ? mat.oxCoatNormal : mat.horseCoatNormal,
      normalScale: new THREE.Vector2(.28, .28),
      color,
      vertexColors: true,
      roughness: species === 'ox' ? .9 : .82,
    });
    this.body.name = 'torso'; this.neck.name = 'neck'; this.head.name = 'head'; this.tail.name = 'tail';
    this.neck.position.copy(S.neckBase); this.head.position.copy(S.headBase); this.tail.position.copy(S.tailBase);
    this.body.add(this.neck, this.tail); this.neck.add(this.head);
    const bones: THREE.Bone[] = [this.body, this.neck, this.head, this.tail];
    for (let i = 0; i < 4; i++) {
      const front = i < 2, side = i % 2 === 0 ? -1 : 1;
      const upper = new THREE.Bone(), lower = new THREE.Bone(), foot = new THREE.Bone();
      upper.name = `leg-${i}-upper`; lower.name = `leg-${i}-lower`; foot.name = `leg-${i}-hoof`;
      upper.position.set(side * S.stance, S.shoulder - .02, front ? S.frontZ : S.rearZ);
      const knee = front ? S.knee : S.hock;
      lower.position.set(0, -(S.shoulder - .02 - knee), front ? -.04 : .075); foot.position.set(0, -(knee - .14), front ? .01 : -.02);
      upper.add(lower); lower.add(foot); this.body.add(upper); bones.push(upper, lower, foot);
      this.legs.push({ upper, lower, foot, front, phase: [Math.PI * 1.5, Math.PI, Math.PI * .5, 0][i], lane: side, state: 'stance',
        planted: new THREE.Vector3(), next: new THREE.Vector3(), prevTheta: 0 });
    }
    const geometry = buildBody(species, detail);
    this.mesh = new THREE.SkinnedMesh(geometry, material); this.mesh.add(this.body);
    this.mesh.bind(new THREE.Skeleton(bones)); this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.root.add(this.mesh);
    this.root.rotation.order = 'YXZ';
    this.root.name = species === 'ox' ? 'Yoked draught ox · lofted body, per-foot terrain IK' : 'Living horse · trot gait, behaviour AI';
    this.addDetails(mat, S);
    // Plant the feet on the ground in the initial pose.
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < 4; i++) this.legs[i].upper.getWorldPosition(this.hipCache[i]);
    for (let i = 0; i < 4; i++) {
      const leg = this.legs[i];
      leg.planted.set(this.hipCache[i].x, 0, this.hipCache[i].z + (i % 2 === 0 ? -.28 : .28));
      leg.planted.y = terrainHeight(leg.planted.x, leg.planted.z) + LivingAnimal.FOOT;
      leg.next.copy(leg.planted); leg.prevTheta = (this.gait + leg.phase) % (Math.PI * 2);
    }
  }
  private addDetails(mat: AdventureMaterials, S: SpeciesShape) {
    const ox = this.species === 'ox';
    const coat = (this.mesh.material as THREE.MeshStandardMaterial).clone(); coat.vertexColors = false;
    const dark = coat.clone(); dark.color.multiplyScalar(.45);
    const eyeY = ox ? -.01 : -.01, eyeZ = ox ? -.05 : -.06, eyeX = ox ? .105 : .078;
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.02, 12, 10), mat.eye);
      eye.scale.set(.67, .8, 1); eye.position.set(side * eyeX, eyeY, eyeZ); this.head.add(eye);
      const lid = new THREE.Mesh(new THREE.TorusGeometry(.022, .0038, 5, 14, Math.PI * 1.25), dark);
      lid.rotation.set(0, Math.PI / 2, -.15); lid.position.copy(eye.position).add(new THREE.Vector3(side * .002, .004, 0)); this.head.add(lid);
      if (side < 0) this.lidL = lid; else this.lidR = lid;
    }
    // Ears: real, articulated, flickable.
    const earGeo = new THREE.LatheGeometry([[.002, .17], [.016, .15], [.030, .10], [.034, .045], [.02, .01], [.002, .002]].map(([r, y]) => new THREE.Vector2(ox ? r * 1.7 : r, y * (ox ? .88 : 1))), 10);
    shadeAttr(earGeo, ox ? .5 : .4);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, ox ? dark : coat);
      ear.castShadow = true;
      ear.position.set(side * (ox ? .085 : .055), ox ? .13 : .11, ox ? -.05 : -.02);
      ear.rotation.set(ox ? .5 : .12, 0, side * (ox ? .5 : .3));
      this.head.add(ear);
      if (side < 0) this.earL = ear; else this.earR = ear;
    }
    // Muzzle + nostrils + jaw.
    const muzzleMat = new THREE.MeshStandardMaterial({ color: ox ? '#5e5141' : '#625143', roughness: .66, normalMap: mat.coatNormal, normalScale: new THREE.Vector2(.16, .16) });
    const muzz = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), muzzleMat);
    const mz = ox ? { x: 0, y: -.19, z: -.39 } : { x: 0, y: -.17, z: -.37 };
    muzz.scale.set(ox ? .10 : .068, ox ? .062 : .05, ox ? .085 : .06);
    muzz.position.set(mz.x, mz.y, mz.z); this.head.add(muzz);
    for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(.013, 10, 8), mat.hoof);
      nostril.scale.set(.55, 1, 1.3); nostril.position.set(mz.x + side * (ox ? .062 : .04), mz.y + .02, mz.z - .055); nostril.rotation.y = side * -.3; this.head.add(nostril);
      if (side < 0) this.nostrilL = nostril; else this.nostrilR = nostril;
    }
    if (ox) {
      // Lower jaw that actually chews.
      this.jaw = new THREE.Group(); this.jaw.position.set(0, -.10, -.16);
      const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), muzzleMat);
      jawMesh.scale.set(.085, .045, .16); jawMesh.position.set(0, -.035, -.20); this.jaw.add(jawMesh);
      this.head.add(this.jaw);
      // Leather halter with cheek rings that the yoke pole works against.
      const tube = (pts: THREE.Vector3[], r: number) => {
        const curve = new THREE.CatmullRomCurve3(pts);
        return new THREE.Mesh(new THREE.TubeGeometry(curve, 16, r, 6, false), mat.leather);
      };
      for (const side of [-1, 1]) {
        const cheek = tube([new THREE.Vector3(side * .125, .06, -.10), new THREE.Vector3(side * .115, -.06, -.24), new THREE.Vector3(side * .095, -.15, -.33)], .011);
        this.head.add(cheek);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.032, .0048, 6, 14), mat.iron);
        ring.rotation.y = Math.PI / 2; ring.position.set(side * .098, -.13, -.30); this.head.add(ring);
      }
      const noseband = tube([new THREE.Vector3(-.075, -.17, -.40), new THREE.Vector3(-.045, -.145, -.465), new THREE.Vector3(.045, -.145, -.465), new THREE.Vector3(.075, -.17, -.40)], .012);
      this.head.add(noseband);
      const throat = tube([new THREE.Vector3(-.07, .02, -.30), new THREE.Vector3(0, -.04, -.34), new THREE.Vector3(.07, .02, -.30)], .01);
      this.head.add(throat);
    }
    // Horns (ox) or forelock (horse).
    if (ox) for (const side of [-1, 1]) {
      const horn = hornGeometry(side);
      const mesh = new THREE.Mesh(horn, mat.horn); mesh.position.set(side * .075, .16, -.10); mesh.castShadow = true; this.head.add(mesh);
    } else {
      const forelock = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), dark);
      forelock.scale.set(.045, .05, .06); forelock.position.set(0, .09, -.12); this.head.add(forelock);
      // Mane: a row of cards standing along the crest of the neck.
      //
      // These are built in the *neck bone's* space, because that is where they
      // live. Written in model coordinates they floated a metre above the
      // animal — the neck bone already sits at the base of the neck, so the
      // offsets were being applied twice.
      const maneMat = dark.clone(); maneMat.side = THREE.DoubleSide;
      const crest = S.neck.map(([y, z, , hh]) =>
        new THREE.Vector3(0, y - S.neckBase.y + hh * 0.72, z - S.neckBase.z));
      // A last card rides the poll, so it belongs to the head bone.
      const poll = crest[crest.length - 1].clone().add(new THREE.Vector3(0, .05, -.10)).sub(S.headBase);
      const cardGeometry = new THREE.PlaneGeometry(.105, .30).rotateY(Math.PI / 2);
      for (let i = 0; i < crest.length; i++) {
        const card = new THREE.Mesh(cardGeometry, maneMat);
        card.castShadow = true;
        const p = crest[i], next = crest[Math.min(crest.length - 1, i + 1)];
        card.position.copy(p);
        card.rotation.set(-(next.y - p.y) / (next.z - p.z + .001) * .32 - .30, 0, (i % 2 ? .06 : -.06));
        this.neck.add(card);
        card.translateY(.10);
      }
      const pollCard = new THREE.Mesh(new THREE.PlaneGeometry(.095, .26).rotateY(Math.PI / 2), maneMat);
      pollCard.castShadow = true;
      pollCard.position.copy(poll);
      pollCard.rotation.set(-1.05, 0, .05);
      this.head.add(pollCard);
      pollCard.translateY(.08);
    }
    this.bit.position.set(0, ox ? -.16 : -.15, ox ? -.36 : -.34); this.head.add(this.bit);
  }
  bitPosition(target = new THREE.Vector3()) { this.root.updateMatrixWorld(true); return this.bit.getWorldPosition(target); }
  /**
   * Advance the animation. `cmd.speed` is the animal's own ground speed; the
   * gait phase is derived from actual travel so feet stay honest on slopes.
   */
  update(dt: number, cmd: AnimalCommand) {
    dt = Math.max(0, Math.min(.1, dt));
    this.t += dt;
    const speed = cmd.speed, speedFactor = THREE.MathUtils.clamp(Math.abs(speed) / 1.15, 0, 1);
    const wantTrot = this.species === 'horse' && Math.abs(speed) > .8;
    this.gaitBlend = THREE.MathUtils.damp(this.gaitBlend, wantTrot ? 1 : 0, 3.2, dt);
    const trot = this.gaitBlend > .5;
    const stride = this.species === 'ox' ? .95 : THREE.MathUtils.lerp(.80, 1.18, this.gaitBlend);
    const lift = this.species === 'ox' ? .09 : THREE.MathUtils.lerp(.11, .17, this.gaitBlend);
    this.moving = THREE.MathUtils.damp(this.moving, Math.abs(speed) > .03 ? 1 : 0, 5, dt);
    if (Math.abs(speed) > .01) this.lastDir = speed > 0 ? 1 : -1;
    this.gait += speed * dt * (Math.PI * 2 / stride);
    const beat = (trot ? 2 : 4) * this.gait;
    // Body vertical + coupled roll/pitch (hip drop on reach, shoulder lift).
    const bob = Math.sin(beat) * .016 * speedFactor * (trot ? 1 : .55);
    this.body.position.y = bob + Math.sin(this.t * 1.7) * .005;
    this.body.rotation.x = Math.cos(beat) * .035 * speedFactor * (trot ? 1 : .4) + cmd.strain * .12;
    this.body.rotation.z = Math.sin(beat + Math.PI / 2) * .028 * speedFactor + Math.sin(this.t * .4) * .008;
    // Breathing (ribcage), faster when alert.
    const breath = Math.sin(this.t * (1.8 + cmd.alert * 1.6));
    this.body.scale.set(1 + breath * .008, 1 + breath * .005, 1 + breath * .014);
    // Body follows the ground plane (wagon-style), so the legs stay honest on banks.
    const yaw = this.root.rotation.y, pos = this.root.position;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const gd = .38;
    const pitchT = Math.atan2(terrainHeight(pos.x + fx * gd, pos.z + fz * gd) - terrainHeight(pos.x - fx * gd, pos.z - fz * gd), 2 * gd);
    const rollT = Math.atan2(terrainHeight(pos.x + rx * gd, pos.z + rz * gd) - terrainHeight(pos.x - rx * gd, pos.z - rz * gd), 2 * gd);
    this.root.rotation.x = THREE.MathUtils.damp(this.root.rotation.x, pitchT * .94, 8, dt);
    this.root.rotation.z = THREE.MathUtils.damp(this.root.rotation.z, rollT * .94, 8, dt);
    // Per-foot: world-space two-bone IK against the terrain.
    this.root.updateMatrixWorld(true);
    const dir = this.lastDir;
    for (let i = 0; i < 4; i++) {
      const leg = this.legs[i];
      leg.upper.getWorldPosition(this.hipCache[i]);
      const hip = this.hipCache[i];
      // Teleport snap (load/save/cinematic): a planted point far from the hip is stale.
      if (Math.hypot(leg.planted.x - hip.x, leg.planted.z - hip.z) > .8 || Math.hypot(leg.next.x - hip.x, leg.next.z - hip.z) > .8) {
        leg.state = 'stance';
        leg.planted.set(hip.x, 0, hip.z); leg.next.copy(leg.planted);
      }
      const offset = THREE.MathUtils.lerp(leg.phase, [Math.PI * 1.5, 0, Math.PI, Math.PI * .5][i], 0) // walk pattern base
        , trotOffset = [0, Math.PI, Math.PI, 0][i];
      const theta = ((this.gait + THREE.MathUtils.lerp(offset, trotOffset, this.species === 'ox' ? 0 : this.gaitBlend)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const inStance = theta < Math.PI;
      if (leg.state === 'stance' && !inStance) {
        leg.state = 'swing';
        leg.next.set(hip.x + fx * (stride / 2) * dir, 0, hip.z + fz * (stride / 2) * dir);
        leg.next.y = terrainHeight(leg.next.x, leg.next.z) + LivingAnimal.FOOT;
      } else if (leg.state === 'swing' && inStance) {
        leg.state = 'stance';
        this.hoofCache.set(leg.next.x, 0, leg.next.z);
        leg.planted.copy(this.hoofCache);
        leg.planted.y = terrainHeight(leg.planted.x, leg.planted.z) + LivingAnimal.FOOT;
        this.onFootfall?.(i, leg.planted.x, leg.planted.z, trot ? 1 : .8);
      }
      let target: THREE.Vector3;
      if (leg.state === 'stance') {
        target = this.hoofCache.copy(leg.planted);
        target.y = terrainHeight(leg.planted.x, leg.planted.z) + LivingAnimal.FOOT;
      } else {
        const u = THREE.MathUtils.clamp((theta - Math.PI) / Math.PI, 0, 1);
        const s = u * u * (3 - 2 * u);
        this.hoofCache.copy(leg.planted).lerp(leg.next, s);
        this.hoofCache.y = terrainHeight(this.hoofCache.x, this.hoofCache.z) + LivingAnimal.FOOT + lift * Math.pow(Math.sin(Math.PI * u), .85);
        target = this.hoofCache;
      }
      // A stopped animal settles its feet straight down instead of freezing mid-arch.
      if (Math.abs(speed) < .03) {
        target.x += (hip.x - target.x) * (1 - Math.exp(-7 * dt));
        target.z += (hip.z - target.z) * (1 - Math.exp(-7 * dt));
        target.y = terrainHeight(target.x, target.z) + LivingAnimal.FOOT;
      }
      const v = new THREE.Vector3().copy(target).sub(hip);
      const alpha = Math.atan2(-v.z, -v.y);
      const L1 = leg.front ? this.L1f : this.L1r, L2 = leg.front ? this.L2f : this.L2r;
      const d = THREE.MathUtils.clamp(Math.hypot(v.y, v.z), Math.abs(L1 - L2) + .03, L1 + L2 - .015);
      const beta = Math.acos(THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
      const delta = (Math.PI - beta) / 2;
      const fold = leg.front ? -1 : 1; // carpus folds forward, hock folds back
      const upperA = alpha + fold * delta;
      leg.upper.rotation.x = upperA;
      leg.lower.rotation.x = -2 * fold * delta;
      // Hoof follows the local ground slope.
      const gy = terrainHeight(target.x + fx * .09, target.z + fz * .09) - terrainHeight(target.x - fx * .09, target.z - fz * .09);
      const slope = Math.atan(gy / .18) * .9;
      leg.foot.rotation.x = THREE.MathUtils.clamp(slope - (upperA + leg.lower.rotation.x) * .55, -.9, .9);
    }
    // Neck + head: one articulated unit toward the behaviour target, with a
    // gait-synced nod and strain dip.
    const nod = Math.cos(beat) * .03 * speedFactor;
    const neckTarget = cmd.head.pitch * .58 + nod + cmd.strain * .22;
    const headTarget = cmd.head.pitch * .42 + nod * .5 - cmd.alert * .30;
    const rate = 7;
    this.neck.rotation.x = THREE.MathUtils.damp(this.neck.rotation.x, THREE.MathUtils.clamp(neckTarget, -1.1, 1.2), rate, dt);
    this.neck.rotation.y = THREE.MathUtils.damp(this.neck.rotation.y, cmd.head.yaw * .5, rate, dt);
    this.head.rotation.x = THREE.MathUtils.damp(this.head.rotation.x, THREE.MathUtils.clamp(headTarget, -.9, 1.2), rate, dt);
    this.head.rotation.y = THREE.MathUtils.damp(this.head.rotation.y, cmd.head.yaw * .5, rate, dt);
    this.head.rotation.z = THREE.MathUtils.damp(this.head.rotation.z, cmd.head.yaw * .12, rate, dt);
    // Tail: idle sway, gait counter-swing, raised when alert, fly-off flicks.
    const flicking = this.t - this.tailFlickT < .9;
    if (flicking) { const a = (this.t - this.tailFlickT) / .9; this.tail.rotation.x = Math.sin(a * Math.PI * 3) * .5 * (1 - a); }
    else this.tail.rotation.x = THREE.MathUtils.damp(this.tail.rotation.x, -.15 + cmd.alert * .55 + Math.sin(this.t * .9) * .10, 5, dt);
    this.tail.rotation.y = Math.sin(this.t * 1.3) * .16 + Math.sin(this.gait) * .12 * speedFactor;
    // Ears: track the head, flare back when alert, random flicks.
    const flicking2 = this.t - this.earFlickT < .22;
    const earBase = THREE.MathUtils.clamp(-this.head.rotation.y * .8 - this.head.rotation.x * .2, -.4, .4);
    const earFlick = flicking2 ? Math.sin((this.t - this.earFlickT) / .22 * Math.PI) * (this.rng() > .5 ? .5 : -.5) : 0;
    this.earL.rotation.y = earBase;
    this.earL.rotation.z = .3 - cmd.alert * .25 + (earFlick > 0 ? earFlick : 0);
    this.earR.rotation.y = earBase;
    this.earR.rotation.z = -.3 + cmd.alert * .25 + (earFlick < 0 ? -earFlick : 0);
    this.earL.rotation.x = .12 - cmd.alert * .15; this.earR.rotation.x = .12 - cmd.alert * .15;
    // Blink.
    if (this.blinkT < 0 && this.t > this.nextBlink) { this.blinkT = this.t; this.nextBlink = this.t + 2.2 + this.rng() * 4.5; }
    const blinking = this.blinkT >= 0 && this.t - this.blinkT < .13;
    const lid = blinking ? 1 - (this.t - this.blinkT) / .13 : 0;
    this.lidL.scale.y = 1 + lid * 1.6; this.lidR.scale.y = 1 + lid * 1.6;
    this.lidL.rotation.x = lid * .9; this.lidR.rotation.x = lid * .9;
    // Nostrils flare with the breath; ox jaw chews.
    const flare = 1 + Math.max(0, breath) * .18;
    this.nostrilL.scale.set(.55 * flare, flare, 1.3); this.nostrilR.scale.set(.55 * flare, flare, 1.3);
    if (this.jaw) {
      const chewing = cmd.head.pitch > .45 ? Math.max(0, Math.sin(this.t * 2.4)) : Math.max(0, Math.sin(this.t * .9)) * (this.rng() > .995 ? 1 : 0) * .3;
      this.jaw.rotation.x = THREE.MathUtils.damp(this.jaw.rotation.x, chewing * .16, 10, dt);
    }
    // Schedulers.
    if (this.t > this.nextEarFlick) { this.earFlickT = this.t; this.nextEarFlick = this.t + 1.6 + this.rng() * 5.5; }
    if (this.t > this.nextTailFlick) { this.tailFlickT = this.t; this.nextTailFlick = this.t + 7 + this.rng() * 14; }
    this.root.updateMatrixWorld(true);
  }
}
function hornGeometry(side: number) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * .06, 0, .02), new THREE.Vector3(side * .16, .02, .03),
    new THREE.Vector3(side * .26, .10, .02), new THREE.Vector3(side * .30, .22, -.02), new THREE.Vector3(side * .24, .30, -.09),
  ]);
  const rings = 20, sides = 9, frames = curve.computeFrenetFrames(rings, false), positions: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, center = curve.getPoint(t), radius = .030 * (1 - t) ** .7 + .0015;
    const color = new THREE.Color('#f1dfb0').lerp(new THREE.Color('#4a4234'), smoothstep(.5, 1, t));
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2, v = center.clone().addScaledVector(frames.normals[i], Math.cos(a) * radius).addScaledVector(frames.binormals[i], Math.sin(a) * radius);
      positions.push(v.x, v.y, v.z); colors.push(color.r, color.g, color.b); uv.push(j / sides, t);
      if (i < rings && j < sides) { const n = i * (sides + 1) + j; indices.push(n, n + sides + 1, n + 1, n + 1, n + sides + 1, n + sides + 2); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
export class AnimalFactory {
  private geometries = new Map<Species, THREE.BufferGeometry>();
  private constructor(readonly materials: AdventureMaterials, private detail: number) {}
  static async load(materials: AdventureMaterials, detail = 1) { return new AnimalFactory(materials, detail); }
  create(species: Species, color: string, seed = 0) { return new LivingAnimal(species, color, this.materials, seed, this.detail); }
  dispose() { this.geometries.forEach(g => g.dispose()); this.geometries.clear(); }
}
