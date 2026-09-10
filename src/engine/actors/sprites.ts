import * as THREE from 'three';

/**
 * Fake-3D sprite actors.
 *
 * Each character is painted as 16 direction variants (22.5° steps) of a small
 * animation set on an offscreen canvas atlas. At runtime a camera-facing
 * plane shows the variant whose direction matches the angle between the
 * camera and the actor's facing, so the actor reads as a 3D model that turns
 * and animates even though it is a flat image. All geometry is plain 2D math
 * (character space: x = right, y = up, z = facing), which keeps the painters
 * unit-testable without a DOM.
 */

export interface V3 { x: number; y: number; z: number }
export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const addV = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const subV = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scaleV = (a: V3, s: number): V3 => v3(a.x * s, a.y * s, a.z * s);
export const lerpV = (a: V3, b: V3, t: number): V3 => v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const normV = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v3(a.x / l, a.y / l, a.z / l); };

export function normalizeAngle(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Signed angle from the actor's facing to the direction toward the camera.
 * 0 → camera in front (face), ±π → behind, positive → camera on the actor's
 * left side, negative → on its right. Matches the world convention where
 * forward = (-sin yaw, 0, -cos yaw).
 */
export function viewAngle(yaw: number, x: number, z: number, camX: number, camZ: number): number {
  const dx = camX - x, dz = camZ - z;
  if (Math.hypot(dx, dz) < 1e-4) return 0;
  return normalizeAngle(Math.atan2(dx, dz) - Math.atan2(-Math.sin(yaw), -Math.cos(yaw)));
}

export function directionIndex(yaw: number, x: number, z: number, camX: number, camZ: number): number {
  return ((Math.round(viewAngle(yaw, x, z, camX, camZ) / (Math.PI / 8)) % 16) + 16) % 16;
}

/** Camera-relative angle at which atlas direction `dir` is painted. */
export const relForIndex = (dir: number) => normalizeAngle(dir * (Math.PI / 8));

/**
 * Projects character-space points to the billboard's canvas.
 * Character space: x = right, y = up, z = facing. The camera sits at `rel`
 * (see viewAngle), so toCam in character space is (-sin rel, 0, cos rel).
 */
export class View {
  readonly rel: number;
  readonly cosR: number;
  readonly sinR: number;
  /** Animation phase (radians) and wall-clock seconds for the current frame. */
  phase = 0;
  t = 0;
  /** Which action/frame is being painted (set by buildSheet for the painter). */
  action: string = 'idle';
  frame = 0;
  constructor(yaw: number, x: number, z: number, camX: number, camZ: number, public pxPerMeter: number) {
    this.rel = viewAngle(yaw, x, z, camX, camZ);
    this.cosR = Math.cos(this.rel); this.sinR = Math.sin(this.rel);
  }
  get facing() { return this.cosR; } // 1 = face on, -1 = back on
  /** Screen x in metres, measured from the actor's centre. */
  sx(p: V3) { return -(p.x * this.cosR + p.z * this.sinR); }
  /** Depth toward the camera in metres (bigger = nearer). */
  depth(p: V3) { return p.z * this.cosR - p.x * this.sinR; }
  /** Is `p` on the camera side of `centre`? (used for facial features, etc.) */
  near(p: V3, centre: V3) {
    return (p.z - centre.z) * this.cosR - (p.x - centre.x) * this.sinR > 0;
  }
  toScreen(p: V3, width: number, height: number, padBottom = 0): { x: number; y: number; depth: number; scale: number } {
    const scale = 1 + this.depth(p) * .06; // subtle near/far size
    return {
      x: width / 2 + this.sx(p) * this.pxPerMeter * scale,
      y: height - padBottom - p.y * this.pxPerMeter * scale,
      depth: this.depth(p), scale,
    };
  }
}

/** A painter item: drawn after everything with smaller depth. */
export interface DrawItem { depth: number; draw: () => void }
export function sortItems(items: DrawItem[]) { items.sort((a, b) => a.depth - b.depth); }

// ---------------------------------------------------------------------------
// Canvas drawing helpers (require a 2D context; called only in the browser)
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

export function shade(color: string, amount: number): string {
  let r = 0, g = 0, b = 0;
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
  }
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amount * 255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Thick round-capped limb stroke with a dark outline + vertical shading. */
export function limb(ctx: Ctx, a: V3, b: V3, r: number, color: string, view: View, width: number, height: number, padBottom = 0) {
  const A = view.toScreen(a, width, height, padBottom), B = view.toScreen(b, width, height, padBottom);
  const mid = view.depth(scaleV(addV(a, b), .5));
  const w = Math.max(1.4, 2 * r * view.pxPerMeter * (1 + mid * .06));
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(color, -.34); ctx.lineWidth = w + 2.6;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  const g = ctx.createLinearGradient(A.x, Math.min(A.y, B.y), B.x, Math.max(A.y, B.y));
  g.addColorStop(0, shade(color, .10)); g.addColorStop(.55, color); g.addColorStop(1, shade(color, -.13));
  ctx.strokeStyle = g; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  return view.depth(scaleV(addV(a, b), .5));
}

/** Filled smooth closed polygon through 3D points (body masses). */
export function mass(ctx: Ctx, points: V3[], color: string, view: View, width: number, height: number, padBottom = 0, extra?: (path: Path2D) => void) {
  const pts = points.map(p => view.toScreen(p, width, height, padBottom));
  const path = new Path2D();
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  path.moveTo((pts[pts.length - 1].x + pts[0].x) / 2, (pts[pts.length - 1].y + pts[0].y) / 2);
  for (let i = 0; i < pts.length; i++) {
    const m = mid(pts[i], pts[(i + 1) % pts.length]);
    path.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  path.closePath();
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = shade(color, -.36); ctx.lineWidth = 3; ctx.stroke(path);
  const yMin = Math.min(...pts.map(p => p.y)), yMax = Math.max(...pts.map(p => p.y));
  const g = ctx.createLinearGradient(0, yMin, 0, yMax);
  g.addColorStop(0, shade(color, .13)); g.addColorStop(.5, color); g.addColorStop(1, shade(color, -.16));
  ctx.fillStyle = g; ctx.fill(path);
  if (extra) extra(path);
  ctx.restore();
  return view.depth(points[0]);
}

/** Simple filled blob (heads, hands, pommels…). */
export function blob(ctx: Ctx, p: V3, rx: number, ry: number, color: string, view: View, width: number, height: number, padBottom = 0) {
  const s = view.toScreen(p, width, height, padBottom);
  const r = Math.max(1.2, rx * view.pxPerMeter * s.scale);
  ctx.save();
  ctx.translate(s.x, s.y); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(-r * .35, -r * .45, r * .2, 0, 0, r * 1.35);
  g.addColorStop(0, shade(color, .16)); g.addColorStop(.65, color); g.addColorStop(1, shade(color, -.18));
  ctx.fillStyle = g; ctx.strokeStyle = shade(color, -.32); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
  ctx.restore();
  return s.depth;
}

let mailPatternCache: CanvasPattern | null = null;
export function mailPattern(ctx: Ctx): CanvasPattern | null {
  if (mailPatternCache) return mailPatternCache;
  const c = document.createElement('canvas'); c.width = c.height = 14;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(42,47,56,.5)'; g.lineWidth = 1.1;
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    g.beginPath(); g.arc(col * 5 + (row % 2) * 2.5, row * 5, 2.3, Math.PI * .1, Math.PI * .9, true); g.stroke();
  }
  mailPatternCache = ctx.createPattern(c, 'repeat');
  return mailPatternCache;
}

let coatPatternCache: CanvasPattern | null = null;
export function coatPattern(ctx: Ctx): CanvasPattern | null {
  if (coatPatternCache) return coatPatternCache;
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const g = c.getContext('2d')!;
  const rng = (n: number) => { const s = Math.sin(n * 127.1) * 43758.545; return s - Math.floor(s); };
  for (let i = 0; i < 90; i++) {
    const a = rng(i) * .15;
    g.fillStyle = i % 2 ? `rgba(255,250,235,${a})` : `rgba(28,20,12,${a + .03})`;
    g.beginPath(); g.ellipse(rng(i + 40) * 48, rng(i + 80) * 48, 1.5 + rng(i + 120) * 3.4, 1 + rng(i + 160) * 2.2, rng(i) * 3, 0, Math.PI * 2); g.fill();
  }
  coatPatternCache = ctx.createPattern(c, 'repeat');
  return coatPatternCache;
}

// ---------------------------------------------------------------------------
// Sheets and the runtime billboard actor
// ---------------------------------------------------------------------------

export interface SheetAction { name: string; frames: number; offset: number }
export interface SpriteSheet {
  canvas: HTMLCanvasElement; cols: number; rows: number; tileW: number; tileH: number;
  pxPerMeter: number; worldW: number; worldH: number; bottomPad: number;
  actions: SheetAction[];
  tile(actionIndex: number, frame: number, dir: number): { col: number; row: number };
}

export interface SheetSpec {
  tileW: number; tileH: number; pxPerMeter: number; worldH: number; bottomPad: number;
  actions: { name: string; frames: number }[];
  /** 2 → sixteen directions packed as two groups of 8 (keeps the atlas under the 4096 texture limit). */
  directionGroups?: 1 | 2;
  paint: (ctx: Ctx, view: View) => void;
}

export function buildSheet(spec: SheetSpec): SpriteSheet {
  const groups = spec.directionGroups ?? 1;
  const totalFrames = spec.actions.reduce((n, a) => n + a.frames, 0);
  const offsets: number[] = []; let off = 0;
  for (const a of spec.actions) { offsets.push(off); off += a.frames; }
  const cols = groups === 2 ? 8 : 16;
  const rows = totalFrames * groups;
  const canvas = document.createElement('canvas');
  canvas.width = cols * spec.tileW; canvas.height = rows * spec.tileH;
  const ctx = canvas.getContext('2d')!;
  const camR = 12;
  for (let dir = 0; dir < 16; dir++) {
    const rel = relForIndex(dir);
    // Actor at the origin with yaw 0 (forward = -Z world); camera placed at `rel`.
    const camX = -Math.sin(rel) * camR, camZ = -Math.cos(rel) * camR;
    const rowOffset = (d: number) => (groups === 2 && d >= 8 ? totalFrames : 0);
    for (let ai = 0; ai < spec.actions.length; ai++) {
      const action = spec.actions[ai];
      for (let f = 0; f < action.frames; f++) {
        const c = dir % cols, r = rowOffset(dir) + offsets[ai] + f;
        ctx.save();
        ctx.translate(c * spec.tileW, r * spec.tileH);
        const view = new View(0, 0, 0, camX, camZ, spec.pxPerMeter);
        view.phase = action.frames > 1 ? f / action.frames * Math.PI * 2 : 0;
        view.t = action.frames > 1 ? (f / action.frames) * 1.05 : 0;
        view.action = action.name;
        view.frame = f;
        spec.paint(ctx, view);
        ctx.restore();
      }
    }
  }
  return {
    canvas, cols, rows, tileW: spec.tileW, tileH: spec.tileH, pxPerMeter: spec.pxPerMeter,
    worldW: spec.worldH * spec.tileW / spec.tileH, worldH: spec.worldH, bottomPad: spec.bottomPad,
    actions: spec.actions.map((a, i) => ({ name: a.name, frames: a.frames, offset: offsets[i] })),
    tile(actionIndex, frame, dir) {
      const rowOffset = groups === 2 && dir >= 8 ? totalFrames : 0;
      return { col: dir % cols, row: rowOffset + offsets[actionIndex] + frame };
    },
  };
}

export interface ActorState {
  dt: number; speed: number;
  sprint?: boolean; seated?: boolean; sniff?: boolean; paused?: boolean;
}

/** A camera-facing 16-direction billboard with a soft ground shadow. */
export class SpriteActor {
  readonly root = new THREE.Group();
  readonly plane: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  protected material: THREE.ShaderMaterial;
  protected sheet: SpriteSheet;
  protected gait = 0;
  protected clock = 0;
  protected actionName = 'idle';
  protected frame = 0;
  protected gaitHz: number;
  protected sprintHz: number;
  protected bobAmp: number;
  readonly anchors = new Map<string, THREE.Object3D>();
  private worldPos = new THREE.Vector3();
  private worldQuat = new THREE.Quaternion();
  private tmpVec = new THREE.Vector3();

  constructor(sheet: SpriteSheet, private readonly camera: THREE.Camera, opts: { name?: string; shadowRadius?: number; gaitHz?: number; sprintHz?: number; bobAmp?: number }) {
    this.sheet = sheet; this.camera = camera;
    this.root.name = opts.name ?? 'Sprite actor';
    this.gaitHz = opts.gaitHz ?? 1; this.sprintHz = opts.sprintHz ?? 1.35; this.bobAmp = opts.bobAmp ?? .03;
    const texture = new THREE.CanvasTexture(sheet.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    this.material = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uAtlas: { value: texture }, uTile: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2(1, 1) } },
      ]),
      vertexShader: `
        uniform vec2 uTile, uSize;
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          // uTile/uSize are in tile units; the canvas is flipped, so row 0 sits at v = 1.
          vUv = vec2((uTile.x + uv.x) * uSize.x, (${sheet.rows}.0 - uTile.y - 1.0 + uv.y) * uSize.y);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(uAtlas, vUv);
          if (c.a < .42) discard;
          gl_FragColor = c;
          #include <fog_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(sheet.worldW, sheet.worldH);
    geo.translate(0, sheet.worldH / 2, 0); // feet at the origin
    this.plane = new THREE.Mesh(geo, this.material);
    this.plane.frustumCulled = false;
    this.root.add(this.plane);
    const sc = document.createElement('canvas'); sc.width = sc.height = 128;
    const sg = sc.getContext('2d')!;
    const rg = sg.createRadialGradient(64, 64, 4, 64, 64, 62);
    rg.addColorStop(0, 'rgba(10,14,9,.55)'); rg.addColorStop(.45, 'rgba(10,14,9,.26)'); rg.addColorStop(1, 'rgba(10,14,9,0)');
    sg.fillStyle = rg; sg.fillRect(0, 0, 128, 128);
    const radius = opts.shadowRadius ?? .9;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, opacity: .8, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = .015; this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
  }
  anchor(name: string, local: V3): THREE.Object3D {
    const o = new THREE.Object3D(); o.position.set(local.x, local.y, local.z); this.root.add(o);
    this.anchors.set(name, o); return o;
  }
  anchorPosition(name: string, target: THREE.Vector3): THREE.Vector3 {
    const a = this.anchors.get(name);
    return a ? a.getWorldPosition(target) : target.set(0, 0, 0);
  }
  /** Reposition an existing anchor (character space = root local space). */
  setAnchor(name: string, p: V3) { this.anchors.get(name)?.position.set(p.x, p.y, p.z); }
  /** The actor's world yaw (works even nested under a tilted wagon). */
  worldYaw(): number {
    this.root.getWorldQuaternion(this.worldQuat);
    this.tmpVec.set(0, 0, -1).applyQuaternion(this.worldQuat);
    return Math.atan2(-this.tmpVec.x, -this.tmpVec.z);
  }
  /** Height of the root above the ground; keeps the shadow blob on the floor while airborne. */
  shadowDrop = 0;
  protected frameOverride: number | undefined;
  /** Choose the animation for this frame (subclasses override for species/actors). */
  protected pickAction(_state: ActorState, _sheet: SpriteSheet): SheetAction {
    const name = _state.seated ? 'seated' : _state.speed > .18 ? (_state.sprint ? 'sprint' : 'walk') : 'idle';
    return _sheet.actions.find(a => a.name === name) ?? _sheet.actions[0];
  }
  /** Advance animation and pick the right atlas tile. `state.speed` is m/s. */
  update(state: ActorState) {
    const camera = this.camera, { dt, speed, paused } = state;
    const sheet = this.sheet;
    this.actionName = this.pickAction(state, sheet).name;
    if (!paused) {
      this.clock += dt;
      const hz = this.actionName === 'sprint' ? this.sprintHz : this.gaitHz;
      this.gait = (this.gait + speed * hz * dt * Math.PI * 2) % (Math.PI * 2);
    }
    const act = sheet.actions.find(a => a.name === this.actionName) ?? sheet.actions[0];
    const gaitFrame = Math.floor(this.gait / (Math.PI * 2) * act.frames) % act.frames;
    const idleFrame = act.frames > 1 ? Math.floor(this.clock * .4) % act.frames : 0;
    this.frame = this.frameOverride ?? (act.name === 'idle' ? idleFrame : gaitFrame);
    this.root.getWorldPosition(this.worldPos);
    const { col, row } = sheet.tile(sheet.actions.indexOf(act), this.frame, directionIndex(
      this.worldYaw(), this.worldPos.x, this.worldPos.z, camera.position.x, camera.position.z,
    ));
    const u = this.material.uniforms;
    (u.uTile.value as THREE.Vector2).set(col, row);
    (u.uSize.value as THREE.Vector2).set(1 / sheet.cols, 1 / sheet.rows);
    this.applyPose(state);
    this.plane.quaternion.copy(camera.quaternion);
    this.shadow.position.y = .015 - Math.max(0, this.shadowDrop);
    this.shadow.visible = !state.seated;
  }
  /** Hook: bob the plane and refresh anchors for the current pose. */
  protected applyPose(_state: ActorState) {
    this.plane.position.y = this.bob();
  }
  protected bob(): number {
    if (this.actionName === 'walk') return Math.abs(Math.sin(this.gait)) * this.bobAmp;
    if (this.actionName === 'sprint') return Math.abs(Math.sin(this.gait)) * this.bobAmp * 1.6;
    if (this.actionName === 'seated') return 0;
    return Math.sin(this.clock * 1.6) * .006;
  }
  dispose() {
    this.material.dispose();
    (this.material.uniforms.uAtlas.value as THREE.Texture).dispose();
    (this.plane.geometry as THREE.BufferGeometry).dispose();
    (this.shadow.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.shadow.material as THREE.Material).dispose();
    (this.shadow.geometry as THREE.BufferGeometry).dispose();
  }
}

/** Add the actor to a parent group, feet at `position`, facing `yaw`. */
export function placeActor(actor: SpriteActor, parent: THREE.Object3D, position: THREE.Vector3, yaw: number) {
  actor.root.position.copy(position); actor.root.rotation.y = yaw;
  parent.add(actor.root);
}
