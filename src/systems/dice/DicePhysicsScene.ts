import * as THREE from 'three';
import type { DieMesh } from './DieMeshFactory';
import { cryptoRandomFloat } from './DiceResultResolver';
import { advanceDie, armedSpot, cappedToss, ceilingAt, keepInView, trayBounds, type DiceBounds } from './DiceContainment';

/**
 * Lightweight dice physics (no external engine): a single die approximated as a
 * sphere bouncing on an invisible glass plane between two invisible walls.
 * At most 3 bodies by construction (die + floor + walls). Created per roll,
 * disposed after. The leather tray is a visual-only floor dressing — it never
 * joins the simulation.
 */
export interface TossParams { velocity: THREE.Vector3; angular: THREE.Vector3 }

const GRAVITY = -12.5;
const RESTITUTION = 0.42;
/** Spec correction window: the last stretch of flight eases onto the face. */
const GUIDE_WINDOW_S = 0.3;
const TRAY_URL = '/textures/dice/dice_tray.webp';
/** Leather tray dressing, in world units — the die may only roam on the leather. */
const TRAY_WIDTH = 8;
const TRAY_DEPTH = 8 * (768 / 1408);
/** How much of the tray width the die may use (the rim stays clear). */
const TRAY_USAGE = 0.78;

/** The rectangle of usable leather — shared with the containment tests. */
export function diceTrayLimit(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const insetX = (TRAY_WIDTH / 2) * TRAY_USAGE;
  const insetZ = (TRAY_DEPTH / 2) * TRAY_USAGE;
  return { minX: -insetX, maxX: insetX, minZ: -insetZ, maxZ: insetZ };
}

/** Session-cached tray texture (shared across rolls, never disposed per-roll). */
let trayPromise: Promise<THREE.Texture | null> | null = null;

function preloadTray(): Promise<THREE.Texture | null> {
  if (!trayPromise) {
    trayPromise = new THREE.TextureLoader()
      .loadAsync(TRAY_URL)
      .then(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        return texture;
      })
      .catch(() => null); // Glass-plane fallback stays in place.
  }
  return trayPromise;
}

/**
 * How well the tray walls did their job. `rescues` counts frames where the die
 * still needed the per-frame projection guard to stay in shot — the analytic
 * bounds are supposed to make that zero, and a non-zero count means the framing
 * assumption (square canvas, die inside the tray) has been broken somewhere.
 */
export const diceContainmentStats = { wallHits: 0, rescues: 0 };

export class DicePhysicsScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private running = false;
  private disposed = false;
  private elapsed = 0;
  private velocity = new THREE.Vector3();
  private angular = new THREE.Vector3();
  private mesh: DieMesh | null = null;
  private target: THREE.Quaternion | null = null;
  private guideBegin = 1.15;
  private quietTime = 0;
  private settled = false;
  private settleResolve: (() => void) | null = null;
  private settleTimer = 0;
  /** Visible rectangle on the tray for this die's size. */
  /** How far the resting die's body extends below its centre: the frame test
   never has to look under the leather. */
  private belowTray = 0;

  private measureTray(mesh: DieMesh): DiceBounds {
    return trayBounds(this.camera, {
      floorY: 0,
      // An icosahedral d20 rests a shade under its circumradius; the frame test
      // and the floor bounce both key off this.
      restY: mesh.radius * 0.72,
      radius: mesh.radius,
      margin: 0.05,
      limit: diceTrayLimit(),
    });
  }

  onBounce: (strength: number) => void = () => {};
  private bounced = false;
  /**
   * Walls derived from the camera, not hardcoded: the die is confined to what
   * the player can actually see, inset by its own radius. Recomputed whenever a
   * die is armed, because the radius comes from the mesh.
   */
  private bounds: DiceBounds | null = null;

  constructor(host: HTMLElement, size: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(size, size);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'dice-canvas';
    host.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 30);
    this.camera.position.set(0, 3.4, 4.8);
    this.camera.lookAt(0, 0.35, 0);

    const key = new THREE.DirectionalLight('#fff2d8', 2.6);
    key.position.set(2.5, 5, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight('#cfd8e6', '#3a2f1e', 1.1));
    const rim = new THREE.DirectionalLight('#d0b781', 0.9);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);

    // Invisible glass plane: catches a soft shadow, renders nothing else.
    // Sits a hair below the tray so the tray occludes it when art loads.
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    glass.rotation.x = -Math.PI / 2;
    glass.position.y = -0.01;
    glass.receiveShadow = true;
    glass.name = 'dice-glass';
    this.scene.add(glass);

    // Leather tray floor (async; the loop repaints when it arrives).
    void preloadTray().then(texture => {
      if (!texture || this.disposed) return;
      const tray = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 8 * (768 / 1408)),
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0 }),
      );
      tray.rotation.x = -Math.PI / 2;
      tray.receiveShadow = true;
      tray.name = 'dice-tray';
      this.scene.add(tray);
    });
  }

  /** Hold the die in the tray, in view, waiting for the player to roll. */
  arm(mesh: DieMesh): void {
    this.mesh = mesh;
    this.bounds = this.measureTray(mesh);
    this.belowTray = mesh.radius * 0.28;
    mesh.group.position.copy(armedSpot(this.bounds, cryptoRandomFloat));
    mesh.group.rotation.set(cryptoRandomFloat() * 3, cryptoRandomFloat() * 3, cryptoRandomFloat() * 3);
    this.scene.add(mesh.group);
    this.velocity.set(0, 0, 0);
    this.angular.set(0, 0, 0);
    this.elapsed = 0;
    this.quietTime = 0;
    this.settled = false;
    this.bounced = false;
    this.target = null;
    this.running = true;
    this.clock.start();
    this.loop();
  }

  /** The player pressed Roll: throw the armed die, inside the visible tray. */
  toss(toss: TossParams): void {
    if (!this.mesh) return;
    const room = this.bounds
      ? Math.max(0.4, ceilingAt(this.camera, this.mesh.group.position, this.bounds, this.belowTray) - this.bounds.restY)
      : undefined;
    const v = this.bounds ? cappedToss(toss.velocity, this.bounds, GRAVITY, room) : toss.velocity;
    this.velocity.copy(v);
    this.angular.copy(toss.angular);
    // A little lift so the die is clearly thrown rather than nudged.
    this.velocity.y = Math.max(this.velocity.y, 2.2);
    this.elapsed = 0;
    this.settled = false;
    this.bounced = false;
    this.running = true;
    this.clock.start();
    this.loop();
  }

  /** The die is already at rest in the tray (armed phase). */
  get resting(): boolean {
    return this.running && this.velocity.lengthSq() < 0.02 && this.mesh !== null
      && this.mesh.group.position.y <= (this.bounds?.restY ?? 0) + 0.05;
  }

  guideTo(target: THREE.Quaternion, beginAt = 1.15): void {
    this.target = target.clone();
    this.guideBegin = beginAt;
  }

  /** Static presentation for reduced motion: die placed at rest, one frame. */
  async presentStatic(mesh: DieMesh, resting: THREE.Quaternion, trayWaitMs = 700): Promise<void> {
    this.mesh = mesh;
    this.bounds = this.measureTray(mesh);
    this.belowTray = mesh.radius * 0.28;
    mesh.group.position.set(0, this.bounds.restY, (this.bounds.minZ + this.bounds.maxZ) / 2);
    mesh.group.quaternion.copy(resting);
    this.scene.add(mesh.group);
    // Best-effort: let the tray arrive so the still isn't floating on glass.
    await Promise.race([
      preloadTray().catch(() => null),
      new Promise(resolve => { window.setTimeout(resolve, trayWaitMs); }),
    ]);
    if (!this.disposed) this.freeze();
  }

  untilSettled(timeoutMs: number): Promise<void> {
    if (this.settled) return Promise.resolve();
    return new Promise(resolve => {
      this.settleResolve = resolve;
      this.settleTimer = window.setTimeout(() => this.finish(), timeoutMs);
    });
  }

  private finish(): void {
    if (this.settled) return;
    this.settled = true;

    if (this.mesh) {
      const p = this.mesh.group.position;
      if (this.bounds) {
        p.x = THREE.MathUtils.clamp(p.x, this.bounds.minX, this.bounds.maxX);
        p.z = THREE.MathUtils.clamp(p.z, this.bounds.minZ, this.bounds.maxZ);
      }
      // Land exactly: pre-determined face up, resting contact on the tray.
      // (The timeout fallback can fire mid-flight — never freeze mid-air.)
      if (this.target) this.mesh.group.quaternion.copy(this.target);
      this.mesh.group.position.y = this.mesh.radius * 0.72;
      this.velocity.set(0, 0, 0);
      this.angular.set(0, 0, 0);
    }
    window.clearTimeout(this.settleTimer);
    this.settleResolve?.();
    this.settleResolve = null;
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    this.elapsed += dt;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private step(dt: number): void {
    const mesh = this.mesh;
    if (!mesh || this.settled) return;
    const pos = mesh.group.position;

    // Guidance phase: free tumble until guideBegin, then a smoothstep easing
    // over the final window so the die breathes onto the pre-determined face.
    if (this.target && this.elapsed > this.guideBegin) {
      const t = Math.min(1, (this.elapsed - this.guideBegin) / GUIDE_WINDOW_S);
      const ease = t * t * (3 - 2 * t);
      mesh.group.quaternion.slerp(this.target, Math.min(1, dt * (1.6 + ease * 13)));
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * (1.4 + ease * 6.5)));
      this.angular.multiplyScalar(Math.max(0, 1 - dt * (2.0 + ease * 9)));
    }

    // Gravity, the tray floor, and the view-derived walls all live in
    // `advanceDie` so the containment can be replayed in tests.
    if (this.bounds) {
      const step = advanceDie(
        { pos, vel: this.velocity }, dt,
        { gravity: GRAVITY, restitution: RESTITUTION, bounds: this.bounds, camera: this.camera, below: this.belowTray },
      );
      if (step.ceiling) diceContainmentStats.wallHits++;
      if (step.impact > 0 || step.landed) {
        this.angular.multiplyScalar(step.impact > 0 ? 0.82 : 0.6);
        if (step.impact > 0.9) {
          this.onBounce(Math.min(1, step.impact / 6));
          this.bounced = true;
        } else if (!this.bounced) {
          this.onBounce(0.25);
          this.bounced = true;
        }
      }
      if (step.wall) {
        diceContainmentStats.wallHits++;
        this.angular.multiplyScalar(0.9);
        if (!this.bounced) { this.onBounce(0.2); this.bounced = true; }
      }
    }

    // Tumble.
    const speed = this.angular.length();
    if (speed > 0.001) {
      const delta = new THREE.Quaternion().setFromAxisAngle(
        this.angular.clone().normalize(), speed * dt,
      );
      mesh.group.quaternion.multiply(delta);
    }

    // Settle detection: slow + guided + quiet + near the tray. The floor gate
    // matters: a high bounce is briefly slow at its apex, and without it the die
    // could freeze mid-air instead of landing on the leather.
    const guided = this.target !== null && this.elapsed > this.guideBegin + GUIDE_WINDOW_S;
    const nearFloor = pos.y < (this.bounds?.restY ?? mesh.radius * 0.72) * 1.9;
    if (guided && nearFloor && this.velocity.length() < 0.35 && speed < 1.6) {
      this.quietTime += dt;
      if (this.quietTime > 0.2) this.finish();
    } else {
      this.quietTime = 0;
    }

    if (this.bounds && keepInView(pos, this.velocity, this.camera, this.bounds)) {
      diceContainmentStats.rescues++;
      this.quietTime = 0;
    }
  }

  /** Keep rendering behind the result readout (frozen die, subtle light). */
  freeze(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.settleTimer);
    this.settleResolve = null;
    // The die belongs to the caller (disposeDieMesh) — detach without touching.
    if (this.mesh) {
      this.scene.remove(this.mesh.group);
      this.mesh = null;
    }
    this.scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        // Material dispose releases the program; shared tray texture survives
        // (three.js never disposes textures via material.dispose()).
        (obj.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
