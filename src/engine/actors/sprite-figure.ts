import * as THREE from 'three';
import type { HumanoidPose } from './humanoid';

/**
 * Photoreal sprite figures — the "2D actors in a 3D world" layer.
 *
 * Each figure is a camera-facing card driven by an AI-painted sprite atlas:
 * 16 columns of viewing directions (22.5° apart) and one row per animation
 * frame. The card always turns to face the camera around the vertical axis
 * (a cylindrical billboard), and the column whose painted viewing angle best
 * matches the camera's bearing relative to the actor's facing is shown —
 * with a continuous rotational crossfade between neighbouring columns, so
 * orbiting the actor reads as smooth rotation rather than 16 discrete pops.
 *
 * Animation works the way classic 2D games do: rows of the atlas play as
 * frame sequences at a cadence scaled by the actor's real ground speed, and
 * frames crossfade briefly when a state changes. Figures are grounded to the
 * terrain, carry a soft contact shadow, respect scene fog, and can be tinted
 * per instance (the two horses, goblin skin variation) while sharing one
 * texture.
 *
 * Atlas column convention (matches scripts/prepare-sprite-sheets.mjs):
 *   column 0  — the actor seen from directly in front (it faces the viewer)
 *   column 4  — seen from the actor's right-hand side (nose pointing right)
 *   column 8  — seen from directly behind
 *   column 12 — seen from the actor's left-hand side (nose pointing left)
 *
 * See scripts/prepare-sprite-sheets.mjs for how the atlases are built from
 * the generated source sheets in assets-source/sprites/.
 */

export const SPRITE_DIRECTIONS = 16;
const DIRECTION_STEP = Math.PI * 2 / SPRITE_DIRECTIONS;

/** Command shape shared with the skinned Humanoid rig, so either body can sit behind the same callers. */
export interface SpriteFigureCommand {
  /** Metres per second along the actor's facing. */
  speed: number;
  pose: HumanoidPose;
  crouch: number;
  lookAt?: THREE.Vector3;
  actionPhase: number;
}

/** Any body the encounter renderer can drive — the skinned mesh or the sprite card. */
export interface FigureBody {
  readonly root: THREE.Group;
  readonly headHeight: number;
  update(dt: number, command: SpriteFigureCommand, camera?: THREE.Camera): void;
  place(x: number, z: number, yaw: number): void;
  dispose(): void;
}

export type SpriteAnimState = 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'down' | 'graze' | 'alert';

interface StateClip { rows: number[]; fps: number }
interface FigureDef {
  atlas: string;
  cellW: number;
  cellH: number;
  columns: number;
  rows: number;
  height: number;
  states: Partial<Record<SpriteAnimState, StateClip>>;
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = THREE.MathUtils.damp;

/** Shared soft blob shadow texture (lazily created, one per session). */
let shadowTexture: THREE.Texture | null = null;
function contactShadowTexture() {
  if (shadowTexture) return shadowTexture;
  if (typeof document === 'undefined') {
    // Node (unit tests): a plain 1x1 data texture stands in; nothing renders.
    shadowTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    return shadowTexture;
  }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(48, 48, 3, 48, 48, 46);
  g.addColorStop(0, 'rgba(10,14,8,.62)'); g.addColorStop(.55, 'rgba(10,14,8,.28)'); g.addColorStop(1, 'rgba(10,14,8,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 96, 96);
  shadowTexture = new THREE.CanvasTexture(canvas);
  return shadowTexture;
}

const spriteVertexShader = /* glsl */ `
  varying vec2 vUv;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const spriteFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec4 uRectA;
  uniform vec4 uRectB;
  uniform float uBlend;
  uniform vec3 uTint;
  uniform float uOpacity;
  uniform float uGroundShade;
  varying vec2 vUv;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec4 a = texture2D(uMap, uRectA.xy + vUv * uRectA.zw);
    vec4 b = texture2D(uMap, uRectB.xy + vUv * uRectB.zw);
    vec4 c = mix(a, b, uBlend);
    if (c.a < 0.5) discard;
    // A gentle darkening toward the feet grounds the card in the scene light.
    vec3 col = c.rgb * uTint * mix(1.0, uGroundShade, pow(vUv.y, 2.0));
    gl_FragColor = vec4(col, uOpacity);
    #include <fog_fragment>
  }
`;

export class SpriteFigure implements FigureBody {
  readonly root = new THREE.Group();
  readonly headHeight: number;
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private shadow: THREE.Mesh;
  private def: FigureDef;
  private tint: THREE.Color;
  private heightScale: number;

  private t = 0;
  private state: SpriteAnimState = 'idle';
  private animTime = 0;
  private animRow = 0;
  private rowCross = { from: 0, active: false, t: 0 };
  private direction = 0;              // continuous direction index around the 16 columns
  private blend = 0;
  private rectA = new THREE.Vector4();
  private rectB = new THREE.Vector4();
  private bobT = 0;
  private bobAmp = 0;
  private lunge = 0;
  private downBlend = 0;
  private opacity = 1;
  private worldWidth = 1;
  private lastCamera?: THREE.Camera;
  private worldPos = new THREE.Vector3();
  seated = false;
  /** Column rotation/mirroring correction for a sheet whose orbit disagrees with the engine's convention. */
  directionOffset = 0;

  constructor(def: FigureDef, texture: THREE.Texture, opts: { tint?: THREE.ColorRepresentation; heightScale?: number } = {}) {
    this.def = def;
    this.tint = new THREE.Color(opts.tint ?? '#ffffff');
    this.heightScale = opts.heightScale ?? 1;
    this.headHeight = def.height * .93;
    this.root.rotation.order = 'YXZ';
    this.root.name = 'sprite-figure';

    this.worldWidth = def.height * (def.cellW / def.cellH);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0, .5, 0); // anchor: bottom-centre on the ground
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uRectA: { value: new THREE.Vector4() },
        uRectB: { value: new THREE.Vector4() },
        uBlend: { value: 0 },
        uTint: { value: this.tint },
        uOpacity: { value: 1 },
        uGroundShade: { value: .74 },
        ...THREE.UniformsLib.fog,
      },
      vertexShader: spriteVertexShader,
      fragmentShader: spriteFragmentShader,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.scale.set(this.worldWidth, def.height * this.heightScale, 1);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: .62, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.set(this.worldWidth * 1.05, this.worldWidth * .72, 1);
    this.shadow.position.y = .02;
    this.root.add(this.shadow);
  }

  setTint(tint: THREE.ColorRepresentation) { this.tint.set(tint); }
  setSeated(seated: boolean) { this.seated = seated; }

  private clipFor(state: SpriteAnimState): StateClip | null {
    return this.def.states[state] ?? null;
  }

  private setRow(row: number, immediate = false) {
    row = THREE.MathUtils.clamp(row, 0, this.def.rows - 1);
    if (row === this.animRow && !immediate) return;
    if (immediate) { this.animRow = row; this.rowCross.active = false; return; }
    this.rowCross = { from: this.animRow, active: true, t: 0 };
    this.animRow = row;
  }

  /** UV rect of (row, column) in the atlas (flipY disabled: v grows downward in image space). */
  private rectOf(row: number, column: number, out: THREE.Vector4) {
    const d = this.def;
    out.set(column / d.columns, row / d.rows, 1 / d.columns, 1 / d.rows);
  }

  private selectState(speed: number, pose: HumanoidPose, actionPhase: number): SpriteAnimState {
    if (pose === 'down' || pose === 'dead') return this.clipFor('down') ? 'down' : 'idle';
    if (actionPhase > 0 && actionPhase < 1) {
      if (pose === 'attack' || pose === 'shoot' || pose === 'cast') return this.clipFor('attack') ? 'attack' : 'idle';
      if (pose === 'hurt') return this.clipFor('hurt') ? 'hurt' : 'idle';
    }
    if (speed > 2.9 && this.clipFor('run')) return 'run';
    if (speed > .06 && this.clipFor('walk')) return 'walk';
    return 'idle';
  }

  place(x: number, z: number, yaw: number) {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
  }

  /** Quadruped-flavoured state used by the animal skins (graze / alert fall back to idle art). */
  setAnimalState(state: 'idle' | 'walk' | 'graze' | 'alert') {
    this.state = this.clipFor(state) ? state : 'idle';
    this.animTime = 0;
  }

  update(dt: number, command: SpriteFigureCommand, camera?: THREE.Camera) {
    this.t += dt;
    const speed = Math.abs(command.speed);
    const wanted = this.selectState(speed, command.pose, command.actionPhase);
    if (wanted !== this.state) { this.state = wanted; this.animTime = 0; }

    // --- animation row: play the clip, snapping frames with a short crossfade
    const clip = this.clipFor(this.state);
    if (clip && clip.rows.length) {
      if (clip.fps > 0 && (speed > .03 || this.state === 'graze')) {
        // Cadence scales with ground speed so strides match actual travel.
        const fps = Math.max(1.3, clip.fps * THREE.MathUtils.clamp(speed / (this.state === 'run' ? 4.4 : 1.1), .55, 2.4));
        this.animTime += dt * fps;
      } else if (clip.fps > 0) {
        this.animTime += dt * clip.fps * .3; // a gentle idle shuffle
      }
      this.setRow(clip.rows[Math.floor(this.animTime) % clip.rows.length]);
    }
    if (this.rowCross.active) {
      this.rowCross.t += dt / .09;
      if (this.rowCross.t >= 1) this.rowCross.active = false;
    }

    // --- billboard: face the camera around the vertical axis only.
    // Works in world space, because the card may be parented under a rotating
    // group (the player's avatar) rather than sitting directly in the scene.
    const cam = camera ?? this.lastCamera;
    if (cam) {
      this.lastCamera = cam;
      this.root.updateWorldMatrix(true, false);
      this.root.getWorldPosition(this.worldPos);
      const e = this.root.matrixWorld.elements;
      const worldYaw = Math.atan2(e[8], e[10]);
      const bearing = Math.atan2(cam.position.x - this.worldPos.x, cam.position.z - this.worldPos.z);
      // Viewing angle: 0 = camera directly in front, +90° = camera at the
      // actor's right-hand side (column 4), 180° = behind (column 8).
      const rel = wrapPi(worldYaw - bearing + Math.PI);
      const target = rel / DIRECTION_STEP + this.directionOffset;
      this.direction += wrapPi((target - this.direction) * DIRECTION_STEP) / DIRECTION_STEP;
      // Snap away float noise at exact column boundaries (floor() must not jump a column).
      const near = Math.round(this.direction);
      if (Math.abs(this.direction - near) < 1e-4) this.direction = near;
      // The card itself faces the camera around the vertical axis only; the
      // parent chain (avatar) contributes worldYaw, hence the local difference.
      this.mesh.rotation.y = wrapPi(bearing - worldYaw);
    }

    // --- uniforms: rotational crossfade, or a row crossfade while the frame snapped
    const d = this.def;
    const dirA = ((Math.floor(this.direction) % d.columns) + d.columns) % d.columns;
    const dirB = (dirA + 1) % d.columns;
    if (this.rowCross.active) {
      const snapped = ((Math.round(this.direction) % d.columns) + d.columns) % d.columns;
      this.rectOf(this.rowCross.from, snapped, this.rectA);
      this.rectOf(this.animRow, snapped, this.rectB);
      this.blend = THREE.MathUtils.clamp(this.rowCross.t, 0, 1);
    } else {
      this.rectOf(this.animRow, dirA, this.rectA);
      this.rectOf(this.animRow, dirB, this.rectB);
      this.blend = THREE.MathUtils.clamp(this.direction - Math.floor(this.direction), 0, 1);
    }
    (this.material.uniforms.uRectA.value as THREE.Vector4).copy(this.rectA);
    (this.material.uniforms.uRectB.value as THREE.Vector4).copy(this.rectB);
    this.material.uniforms.uBlend.value = this.blend;

    // --- procedural life layered over the painted frames
    const walking = speed > .06 && (this.state === 'walk' || this.state === 'run');
    this.bobAmp = damp(this.bobAmp, walking ? 1 : 0, 8, dt);
    this.bobT += dt * (this.state === 'run' ? 9.4 : 6.2) * THREE.MathUtils.clamp(speed / 1.1, .5, 2.2);
    const bob = Math.abs(Math.sin(this.bobT)) * (this.state === 'run' ? .05 : .028) * this.bobAmp;
    const sway = Math.sin(this.bobT * .5) * .02 * this.bobAmp;

    // One-shot actions without authored art yet: a physical lunge/flinch sells the beat.
    const acting = command.actionPhase > 0 && command.actionPhase < 1 && !this.clipFor('attack') && !this.clipFor('hurt');
    if (acting) {
      const pulse = Math.sin(THREE.MathUtils.clamp(command.actionPhase, 0, 1) * Math.PI);
      this.lunge = damp(this.lunge, (command.pose === 'hurt' ? -.8 : 1) * pulse * .3, 20, dt);
      this.mesh.rotation.z = damp(this.mesh.rotation.z, (command.pose === 'hurt' ? .24 : -.1) * pulse, 18, dt);
    } else {
      this.lunge = damp(this.lunge, 0, 10, dt);
      this.mesh.rotation.z = damp(this.mesh.rotation.z, sway * .5, 8, dt);
    }

    const dying = command.pose === 'down' || command.pose === 'dead';
    this.downBlend = damp(this.downBlend, dying ? 1 : 0, dying ? 6 : 9, dt);
    const crouch = command.crouch * .16 + this.downBlend * .58;
    const scaleY = (1 - crouch) * (this.seated ? .82 : 1);
    this.mesh.position.set(0, bob, -this.lunge * (this.seated ? 0 : 1)); // actors face -Z in root space
    this.mesh.scale.y = d.height * this.heightScale * scaleY;
    this.opacity = damp(this.opacity, this.downBlend > .8 ? .85 : 1, 6, dt);
    this.material.uniforms.uOpacity.value = this.opacity;
    this.shadow.visible = this.opacity > .95 && this.downBlend < .5;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = .62 * (1 - this.downBlend) * (1 - this.bobAmp * .3);
    const shadowPulse = 1 + this.bobAmp * .07;
    this.shadow.scale.set(this.worldWidth * 1.05 * shadowPulse, this.worldWidth * .72 * shadowPulse, 1);
  }

  /** Introspection for visual QA and directionOffset tuning from the console. */
  debugState() {
    return {
      state: this.state, row: this.animRow, direction: this.direction,
      columns: this.def.columns, rows: this.def.rows, height: this.def.height,
      visible: this.mesh.visible && this.opacity > .9,
      directionOffset: this.directionOffset, worldPos: this.worldPos.toArray(),
    };
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
}

/**
 * Loads the sprite figure set from /sprites/manifest.json. Returns null when
 * the set has not been prepared — every caller then falls back to the fully
 * skinned 3D rigs, so the game remains playable without the sprite art.
 */
export class SpriteLibrary {
  private constructor(private entries: Map<string, { def: FigureDef; texture: THREE.Texture }>) {}

  static async load(renderer: THREE.WebGLRenderer): Promise<SpriteLibrary | null> {
    let manifest: { figures?: Record<string, FigureDef & { atlas: string }> };
    try {
      const response = await fetch('/sprites/manifest.json');
      if (!response.ok) return null;
      manifest = await response.json();
    } catch { return null; }
    if (!manifest.figures) return null;
    const loader = new THREE.TextureLoader();
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const entries = new Map<string, { def: FigureDef; texture: THREE.Texture }>();
    for (const [kind, def] of Object.entries(manifest.figures)) {
      try {
        const texture = await loader.loadAsync(`/sprites/${def.atlas}`);
        texture.flipY = false;               // rects address the atlas top-down
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        entries.set(kind, { def, texture });
      } catch { /* skip a missing figure; the 3D fallback covers it */ }
    }
    if (!entries.size) {
      entries.forEach(e => e.texture.dispose());
      return null;
    }
    return new SpriteLibrary(entries);
  }

  has(kind: string) { return this.entries.has(kind); }

  create(kind: string, opts: { tint?: THREE.ColorRepresentation; heightScale?: number } = {}): SpriteFigure | null {
    const entry = this.entries.get(kind);
    if (!entry) return null;
    return new SpriteFigure(entry.def, entry.texture, opts);
  }

  dispose() { this.entries.forEach(e => e.texture.dispose()); }
}
