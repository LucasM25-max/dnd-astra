/**
 * Dev-only model lab. Renders a creature in isolation and prints it as ASCII
 * luminance art so the geometry can be inspected without a screenshot.
 *
 * Query string:
 *   ?model=goblin|hero|horse|ox|dice&view=side|front|back|top|three&pose=idle|walk|attack|dead
 *   &value=20&sides=20   (dice only)
 */
import * as THREE from 'three';
import { Humanoid } from '../src/engine/actors/humanoid';
import { LivingAnimal } from '../src/engine/actors/animals';
import { DiceTray } from '../src/engine/actors/dice';
import type { CombatMaterials } from '../src/engine/actors/combat-materials';
import type { AdventureMaterials } from '../src/engine/actors/materials';

const params = new URLSearchParams(location.search);
const model = params.get('model') ?? 'goblin';
const view = params.get('view') ?? 'three';
const pose = params.get('pose') ?? 'idle';

/** Character cell aspect (width / height) of the terminal font the art is read in. */
const CHAR_ASPECT = 0.55;
const COLS = 104;
const SAMPLE = 6;
const PIX = COLS * SAMPLE;

const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = PIX; canvas.height = PIX;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(PIX, PIX, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

/** Plain materials: the lab inspects form, not texturing. */
function labMaterials(): CombatMaterials {
  const skin = new THREE.MeshStandardMaterial({ color: '#9aa46e', vertexColors: true, roughness: 0.9, side: THREE.FrontSide });
  const human = new THREE.MeshStandardMaterial({ color: '#e0b090', vertexColors: true, roughness: 0.7, side: THREE.FrontSide });
  const cloth = new THREE.MeshStandardMaterial({ color: '#8a7654', roughness: 1, side: THREE.DoubleSide });
  const leather = new THREE.MeshStandardMaterial({ color: '#8c7458', roughness: 0.8 });
  const chainmail = new THREE.MeshStandardMaterial({ color: '#9aa0a4', metalness: 1, roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b9bfc4', metalness: 1, roughness: 0.34 });
  const bronze = new THREE.MeshStandardMaterial({ color: '#9d7a3f', metalness: 1, roughness: 0.46 });
  const caveRock = new THREE.MeshStandardMaterial({ color: '#8d8b85', roughness: 0.94 });
  const parchment = new THREE.MeshStandardMaterial({ color: '#d8cba8', roughness: 0.9, side: THREE.DoubleSide });
  const eye = new THREE.MeshPhysicalMaterial({ color: '#1a1206', roughness: 0.08, clearcoat: 1 });
  const woodShaft = new THREE.MeshStandardMaterial({ color: '#7a6242', roughness: 0.86 });
  const fletching = new THREE.MeshStandardMaterial({ color: '#1f2420', roughness: 1, side: THREE.DoubleSide });
  const bowstring = new THREE.MeshBasicMaterial({ color: '#d8d2bc' });
  const blood = new THREE.MeshStandardMaterial({ color: '#4a0f0c', roughness: 0.35 });
  return { creatureSkin: skin, humanSkin: human, creatureCloth: cloth, leather, chainmail, steel, bronze, caveRock, parchment, eye, woodShaft, fletching, bowstring, blood, textures: [] };
}

function labAdventureMaterials(): AdventureMaterials {
  const wood = new THREE.MeshStandardMaterial({ color: '#c6b48e', roughness: 0.86 });
  const woodDark = new THREE.MeshStandardMaterial({ color: '#8e7854', roughness: 0.86 });
  const woodEnd = new THREE.MeshStandardMaterial({ color: '#aa9470', roughness: 0.95 });
  const iron = new THREE.MeshStandardMaterial({ color: '#4c4e45', metalness: 0.82, roughness: 0.68 });
  const brass = new THREE.MeshStandardMaterial({ color: '#a38748', metalness: 0.77, roughness: 0.52 });
  const leather = new THREE.MeshStandardMaterial({ color: '#443322', roughness: 0.84 });
  const cloth = new THREE.MeshStandardMaterial({ color: '#d1c1a0', roughness: 1 });
  const rope = new THREE.MeshStandardMaterial({ color: '#847256', roughness: 1 });
  const tarp = new THREE.MeshStandardMaterial({ color: '#607059', roughness: 1, side: THREE.DoubleSide });
  const hoof = new THREE.MeshStandardMaterial({ color: '#302b23', roughness: 0.73 });
  const eye = new THREE.MeshPhysicalMaterial({ color: '#140f0a', roughness: 0.12, clearcoat: 0.8 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#c1bf9e', transparent: true, opacity: 0.33, side: THREE.DoubleSide });
  const horn = new THREE.MeshStandardMaterial({ color: '#d0c4a0', roughness: 0.65, vertexColors: true });
  const oil = new THREE.MeshStandardMaterial({ color: '#302c18', roughness: 0.23 });
  const blank = new THREE.Texture();
  return {
    wood, woodDark, woodEnd, iron, brass, leather, cloth, rope, tarp,
    coat: blank, coatNormal: blank, oxCoat: blank, oxCoatNormal: blank,
    horseCoat: blank, horseCoatNormal: blank, hoof, eye, glass, horn, oil, textures: [],
  };
}

const scene = new THREE.Scene();
const subject = new THREE.Group();
scene.add(subject);

const mats = labMaterials();
const advMats = labAdventureMaterials();
let target: THREE.Object3D | null = null;
let updater: ((dt: number) => void) | null = null;
let diceTray: DiceTray | null = null;

if (model === 'goblin') {
  const g = new Humanoid({
    height: 1.15, build: 'stocky', earLength: 0.20, noseLength: 0.055,
    species: 'goblin', classId: null,
  }, mats, '#8fa063', '#7a6642', 3, 1);
  subject.add(g.root); target = g.root;
  updater = dt => g.update(dt, { speed: pose === 'walk' ? 1.4 : 0, pose: pose as never, crouch: 0, actionPhase: pose === 'attack' ? 0.62 : 0 });
} else if (model === 'hero') {
  const g = new Humanoid({
    height: 1.78, build: 'lean', earLength: 0.055, noseLength: 0.062,
    species: 'human', classId: 'fighter', hair: '#3a2a18',
  }, mats, '#e0b090', '#5b6b8c', 1337, 1);
  subject.add(g.root); target = g.root;
  updater = dt => g.update(dt, { speed: pose === 'walk' ? 1.4 : 0, pose: pose as never, crouch: 0, actionPhase: pose === 'attack' ? 0.62 : 0 });
} else if (model === 'horse' || model === 'ox') {
  const a = new LivingAnimal(model, model === 'ox' ? '#9d8a6c' : '#a0704a', advMats, 1, 1);
  subject.add(a.root); target = a.root;
  updater = dt => a.update(dt, { speed: pose === 'walk' ? 1.1 : 0, head: { pitch: 0, yaw: 0 }, alert: 0, strain: 0 });
} else if (model === 'dice') {
  const wanted = Number(params.get('value') ?? '20');
  const sides = Number(params.get('sides') ?? '20');
  diceTray = new DiceTray(subject);
  diceTray.setViewDirection(new THREE.Vector3(0, 0, 1));
  diceTray.roll({
    d20: sides === 20 ? wanted : undefined,
    d20Pool: sides === 20 ? [wanted] : undefined,
    damage: sides === 20 ? undefined : { dice: [wanted], sides, bonus: 0 },
    anchor: new THREE.Vector3(0, 0, 0),
  });
  for (let i = 0; i < 900 && !diceTray.settled; i++) diceTray.update(1 / 60);
  target = diceTray.group;
}

// Lights: one key, one fill, one rim. Flat enough to read form, not mood.
// They are re-aimed for every view so the camera is never staring at the
// unlit side of the model.
const key = new THREE.DirectionalLight(0xffffff, 2.6); scene.add(key);
const fill = new THREE.DirectionalLight(0xaecfff, 0.9); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffd9a0, 1.2); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2a2418, 0.7));

function aimLights(camera: THREE.Camera, centrePoint: THREE.Vector3, radius: number) {
  const dir = new THREE.Vector3().subVectors(centrePoint, camera.position).normalize();
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  const at = (light: THREE.DirectionalLight, f: number, r: number, u: number) => {
    light.position.copy(centrePoint).addScaledVector(dir, -f * radius).addScaledVector(right, r * radius).addScaledVector(up, u * radius);
    light.target.position.copy(centrePoint);
    light.target.updateMatrixWorld();
  };
  at(key, 2.4, -1.6, 1.9);
  at(fill, 1.6, 2.2, 0.2);
  at(rim, -2.6, 1.0, 1.4);
}

// Warm the animation so the pose is not the rest pose.
if (updater) for (let i = 0; i < 120; i++) updater(1 / 60);

// `clay` replaces every material with a neutral grey so form is legible
// regardless of how dark the creature's own colours are.
if (params.get('clay')) {
  const clay = new THREE.MeshStandardMaterial({ color: '#d6d0c4', roughness: 0.88, metalness: 0, side: THREE.FrontSide });
  (target ?? subject).traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = clay;
  });
}

const box = new THREE.Box3().setFromObject(target ?? subject);
const size = box.getSize(new THREE.Vector3());
const centre = box.getCenter(new THREE.Vector3());
// `focus` frames a band of the body (0 = feet, 1 = crown) and `zoom` tightens
// the frame, so a face can be inspected without photographing the whole body.
const zoom = Number(params.get('zoom') ?? '1');
const focus = params.get('focus') === null ? 0.5 : Number(params.get('focus'));
centre.y = box.min.y + size.y * focus;

const RAMP = ' .:-=+*%@';
function asciiFromRender(side: THREE.Side, camera: THREE.Camera) {
  const restore: { mat: THREE.Material; side: THREE.Side }[] = [];
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.material) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of list) { restore.push({ mat, side: mat.side }); (mat as THREE.Material).side = side; mat.needsUpdate = true; }
    }
  });
  aimLights(camera, centre, Math.max(size.x, size.y, size.z));
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(PIX * PIX * 4);
  gl.readPixels(0, 0, PIX, PIX, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const rows = Math.round(COLS * CHAR_ASPECT);
  const out: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < COLS; x++) {
      let sum = 0, cover = 0;
      for (let sy = 0; sy < SAMPLE; sy++) for (let sx = 0; sx < SAMPLE; sx++) {
        // Map the output cell grid across the whole rendered canvas.
        // readPixels is bottom-up, so row 0 of the art is the last canvas row.
        const px = Math.min(PIX - 1, Math.floor((x + sx / SAMPLE) / COLS * PIX));
        const py = Math.min(PIX - 1, Math.floor((rows - y - sy / SAMPLE) / rows * PIX));
        const i = (py * PIX + px) * 4;
        const a = pixels[i + 3] / 255;
        sum += (pixels[i] * 0.35 + pixels[i + 1] * 0.45 + pixels[i + 2] * 0.2) * a;
        cover += a;
      }
      const lum = sum / (SAMPLE * SAMPLE);
      const cov = cover / (SAMPLE * SAMPLE);
      if (cov < 0.25) { line += ' '; continue; }
      // Normalise into the ramp so a dark material still shows its form.
      const t = Math.min(1, Math.max(0, (lum / 255 - 0.02) / 0.55));
      line += RAMP[Math.min(RAMP.length - 1, Math.max(1, Math.round(t * (RAMP.length - 1))))];
    }
    out.push(line.replace(/\s+$/, ''));
  }
  for (const r of restore) { r.mat.side = r.side; r.mat.needsUpdate = true; }
  return out.join('\n');
}

function orthographic(azimuth: number, elevation: number): THREE.OrthographicCamera {
  const half = Math.max(size.x, size.y, size.z) * 0.56 / Math.max(0.2, zoom);
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, -50, 100);
  const r = 8, ce = Math.cos(elevation), se = Math.sin(elevation);
  cam.position.set(centre.x + Math.sin(azimuth) * ce * r, centre.y + se * r, centre.z + Math.cos(azimuth) * ce * r);
  cam.up.set(0, 1, 0);
  if (elevation > 1.4) cam.up.set(0, 0, -1);
  cam.lookAt(centre);
  cam.updateProjectionMatrix();
  return cam;
}

const VIEW_TABLE: Record<string, { name: string; azimuth: number; elevation: number }> = {
  front: { name: 'FRONT (creature faces camera)', azimuth: Math.PI, elevation: 0 },
  side: { name: 'SIDE (left)', azimuth: Math.PI * 0.5, elevation: 0 },
  back: { name: 'BACK', azimuth: 0, elevation: 0 },
  top: { name: 'TOP (looking down)', azimuth: 0, elevation: Math.PI / 2 },
};
const views = view === 'three'
  ? [VIEW_TABLE.front, VIEW_TABLE.side, VIEW_TABLE.back]
  : [VIEW_TABLE[view] ?? VIEW_TABLE.side];

const report: string[] = [];
report.push(`model=${model} view=${view} pose=${pose}`);
report.push(`bbox size  x=${size.x.toFixed(3)} y=${size.y.toFixed(3)} z=${size.z.toFixed(3)}`);
report.push(`bbox min   x=${box.min.x.toFixed(3)} y=${box.min.y.toFixed(3)} z=${box.min.z.toFixed(3)}`);
report.push(`bbox max   x=${box.max.x.toFixed(3)} y=${box.max.y.toFixed(3)} z=${box.max.z.toFixed(3)}`);
if (diceTray) report.push(`dice settled=${diceTray.settled} count=${diceTray.count}`);

// Geometry audit: winding consistency and degenerate triangles per mesh.
const audit: string[] = [];
(target ?? subject).traverse(o => {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || !mesh.geometry) return;
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  let degenerate = 0, nan = 0, outOfRange = 0, inward = 0, outward = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  const nrm = g.getAttribute('normal');
  const vertexCount = pos.count;
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3;
    const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) { outOfRange++; continue; }
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    if ([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].some(v => !Number.isFinite(v))) { nan++; continue; }
    ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
    if (n.length() < 1e-9) { degenerate++; continue; }
    if (nrm) {
      const sn = new THREE.Vector3(nrm.getX(ia), nrm.getY(ia), nrm.getZ(ia));
      if (sn.lengthSq() > 1e-6) { if (sn.dot(n) < 0) inward++; else outward++; }
    }
  }
  const flags = [degenerate && `degenerate=${degenerate}`, nan && `nan=${nan}`, outOfRange && `OUT_OF_RANGE=${outOfRange}`,
    nrm && `windingMismatch=${inward}/${inward + outward}`].filter(Boolean).join(' ');
  const gb = mesh.geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position'));
  if (mesh.isSkinnedMesh) report.push(`  RAW GEOMETRY BOX y[${gb.min.y.toFixed(2)},${gb.max.y.toFixed(2)}] z[${gb.min.z.toFixed(2)},${gb.max.z.toFixed(2)}] x[${gb.min.x.toFixed(2)},${gb.max.x.toFixed(2)}]`);
  const mb = new THREE.Box3().setFromObject(mesh);
  const bb = `y[${mb.min.y.toFixed(2)},${mb.max.y.toFixed(2)}] z[${mb.min.z.toFixed(2)},${mb.max.z.toFixed(2)}]`;
  audit.push(`  ${(mesh.name || mesh.type).slice(0, 30).padEnd(30)} tris=${String(triCount).padStart(5)}  ${bb.padEnd(30)}  ${flags}`);
});
report.push('geometry audit:');
report.push(...audit);

for (const v of views) {
  const cam = orthographic(v.azimuth, v.elevation);
  report.push('');
  report.push(`===== ${v.name} =====`);
  report.push(asciiFromRender(THREE.FrontSide, cam));
  if (model !== 'dice') {
    report.push(`----- ${v.name} : back faces only (should be blank; marks = inverted/holes) -----`);
    report.push(asciiFromRender(THREE.BackSide, cam));
  }
}

// ---------------------------------------------------------------------------
// Definitive winding check. A shader paints front faces white and back faces
// black; with DoubleSide on, a correctly wound closed surface reads white and
// an inside-out one reads black. This is absolute, where comparing the winding
// against the stored normal only ever detects *inconsistency*.
function facingAudit(): string[] {
  const shader = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'void main(){ gl_FragColor = gl_FrontFacing ? vec4(1.0) : vec4(1.0, 0.0, 0.0, 1.0); }',
  });
  const meshes: THREE.Mesh[] = [];
  (target ?? subject).traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const keep = meshes.map(m => ({ mesh: m, material: m.material }));
  for (const m of meshes) m.material = shader;
  const view0 = views[0];
  const cam = orthographic(view0.azimuth, view0.elevation);

  /** Fraction of this render's covered pixels that came from back faces. */
  const measure = () => {
    renderer.render(scene, cam);
    const gl = renderer.getContext();
    const pixels = new Uint8Array(PIX * PIX * 4);
    gl.readPixels(0, 0, PIX, PIX, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let covered = 0, flipped = 0;
    for (let i = 0; i < PIX * PIX; i++) {
      if (pixels[i * 4 + 3] < 200) continue;
      covered++;
      if (pixels[i * 4 + 1] < 100) flipped++;
    }
    return { covered, pct: covered ? (flipped / covered) * 100 : 0 };
  };
  const line = (label: string, r: { covered: number; pct: number }) =>
    `  ${label.padEnd(34)} inside-out ${r.pct.toFixed(1).padStart(5)}% of ${String(r.covered).padStart(6)}px ${r.pct > 8 ? '*** INVERTED ***' : ''}`;

  const lines: string[] = [];
  for (const m of meshes) m.visible = true;
  lines.push(line('WHOLE MODEL', measure()));

  // Then one mesh at a time, and — where the merged geometry carries per-part
  // triangle ranges — one authored part at a time, to name the culprit.
  for (const only of meshes) {
    for (const m of meshes) m.visible = m === only;
    const r = measure();
    if (r.covered === 0) continue;
    lines.push(line((only.name || only.type).slice(0, 34), r));
    const ranges = only.geometry.userData?.partRanges as [number, number, number][] | undefined;
    if (!ranges) continue;
    const saved = only.geometry.drawRange;
    for (const [start, count, bone] of ranges) {
      only.geometry.setDrawRange(start, count);
      const pr = measure();
      if (pr.covered === 0) continue;
      lines.push(line(`   part ${String(start).padStart(5)}+${String(count).padStart(4)} bone ${String(bone).padStart(2)}`, r));
      lines[lines.length - 1] = `   part ${String(start).padStart(5)}+${String(count).padStart(4)} bone ${String(bone).padStart(2)}    inside-out ${pr.pct.toFixed(1).padStart(5)}% of ${String(pr.covered).padStart(6)}px ${pr.pct > 8 ? '*** INVERTED ***' : ''}`;
    }
    only.geometry.setDrawRange(saved.start, saved.count);
  }
  for (const m of meshes) m.visible = true;
  for (const k of keep) k.mesh.material = k.material;
  return lines;
}

/**
 * Objective silhouette profile. For a stack of horizontal scanlines this
 * reports how many separate spans the model covers and how wide each is, in
 * metres. That is far easier to check than ASCII art: a head should be one
 * span, legs two, and a stray floating ear shows up as an extra one.
 */
function profileReport(cam: THREE.Camera): string[] {
  renderer.render(scene, cam);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(PIX * PIX * 4);
  gl.readPixels(0, 0, PIX, PIX, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const px = new THREE.Vector3(), span = new THREE.Vector3();
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const lines: string[] = [`  ${'world y'.padStart(7)}  ${'spans'.padStart(5)}  span extents in metres [x0..x1]`];
  const imageRows = Math.round(COLS * CHAR_ASPECT);
  for (let r = 0; r < imageRows; r += 2) {
    // pixels are bottom-up; row 0 of the ASCII is the top of the image
    const py = PIX - 1 - Math.round(r / (imageRows - 1) * (PIX - 1));
    const spans: [number, number][] = [];
    for (let x = 0; x < PIX; x++) {
      if (pixels[(py * PIX + x) * 4 + 3] < 200) continue;
      const last = spans[spans.length - 1];
      if (last && last[1] === x - 1) last[1] = x; else spans.push([x, x]);
    }
    if (!spans.length) continue;
    // readPixels is bottom-up, so a high `py` is the top of the image: NDC y
    // runs from -1 at py = 0 to +1 at py = PIX - 1.
    px.set(0, (py + 0.5) / PIX * 2 - 1, 0).unproject(cam);
    // Measure along the camera's own right axis so the numbers read the same
    // from any view, rather than as world x.
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const origin = centre.dot(right);
    const along = (v: THREE.Vector3) => v.dot(right) - origin;
    const widths = spans.map(([a, b]) => {
      const wa = new THREE.Vector3((a + 0.5) / PIX * 2 - 1, 0, 0).unproject(cam);
      const wb = new THREE.Vector3((b + 0.5) / PIX * 2 - 1, 0, 0).unproject(cam);
      const w = span.subVectors(wb, wa).length();
      return `[${along(wa).toFixed(2)}..${along(wb).toFixed(2)}] ${w.toFixed(2)}`;
    });
    lines.push(`  ${px.y.toFixed(2).padStart(7)}  ${String(spans.length).padStart(5)}  ${widths.join(' ')}`);
  }
  return lines;
}
report.push('');
report.push('silhouette profile (spans per scanline, widths in metres):');
report.push(...profileReport(orthographic(views[0].azimuth, views[0].elevation)));
report.push(...facingAudit());

const out = document.createElement('pre');
out.id = 'lab-output';
out.textContent = report.join('\n');
document.body.appendChild(out);
(window as unknown as { __lab: string }).__lab = report.join('\n');
