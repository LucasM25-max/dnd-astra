import * as THREE from 'three';
import type { DieMesh } from './DieMeshFactory';
import { cryptoRandomFloat } from './DiceResultResolver';

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
const WALL_X = 2.1;
/** Spec correction window: the last stretch of flight eases onto the face. */
const GUIDE_WINDOW_S = 0.3;
const TRAY_URL = '/textures/dice/dice_tray.webp';

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
  onBounce: (strength: number) => void = () => {};
  private bounced = false;

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

  spawn(mesh: DieMesh, toss: TossParams): void {
    this.mesh = mesh;
    mesh.group.position.set(-1.7, 2.7, 0.6);
    mesh.group.rotation.set(cryptoRandomFloat() * 3, cryptoRandomFloat() * 3, cryptoRandomFloat() * 3);
    this.scene.add(mesh.group);
    this.velocity.copy(toss.velocity);
    this.angular.copy(toss.angular);
    this.running = true;
    this.clock.start();
    this.loop();
  }

  guideTo(target: THREE.Quaternion, beginAt = 1.15): void {
    this.target = target.clone();
    this.guideBegin = beginAt;
  }

  /** Static presentation for reduced motion: die placed at rest, one frame. */
  async presentStatic(mesh: DieMesh, resting: THREE.Quaternion, trayWaitMs = 700): Promise<void> {
    this.mesh = mesh;
    mesh.group.position.set(0, mesh.radius * 0.72, 0.3);
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

    this.velocity.y += GRAVITY * dt;
    pos.addScaledVector(this.velocity, dt);

    // Glass plane bounce.
    const rest = mesh.radius * 0.72;
    if (pos.y < rest) {
      pos.y = rest;
      if (this.velocity.y < 0) {
        const impact = Math.abs(this.velocity.y);
        this.velocity.y *= -RESTITUTION;
        this.velocity.x *= 0.88;
        this.velocity.z *= 0.88;
        this.angular.multiplyScalar(0.82);
        if (impact > 0.9) {
          this.onBounce(Math.min(1, impact / 6));
          this.bounced = true;
        } else if (!this.bounced) {
          this.onBounce(0.25);
          this.bounced = true;
        }
        if (Math.abs(this.velocity.y) < 0.35) this.velocity.y = 0;
      }
    }
    // Invisible walls.
    if (Math.abs(pos.x) > WALL_X) {
      pos.x = Math.sign(pos.x) * WALL_X;
      this.velocity.x *= -0.55;
    }
    if (pos.z < -1.4) { pos.z = -1.4; this.velocity.z *= -0.55; }
    if (pos.z > 2.2) { pos.z = 2.2; this.velocity.z *= -0.55; }

    // Tumble.
    const speed = this.angular.length();
    if (speed > 0.001) {
      const delta = new THREE.Quaternion().setFromAxisAngle(
        this.angular.clone().normalize(), speed * dt,
      );
      mesh.group.quaternion.multiply(delta);
    }

    // Settle detection: slow + guided + quiet + near the tray. The floor
    // gate matters: a high bounce is briefly slow at its apex, and without it
    // the die could freeze mid-air instead of landing on the tray.
    const guided = this.target !== null && this.elapsed > this.guideBegin + GUIDE_WINDOW_S;
    const nearFloor = pos.y < rest * 1.9;
    if (guided && nearFloor && this.velocity.length() < 0.35 && speed < 1.6) {
      this.quietTime += dt;
      if (this.quietTime > 0.2) this.finish();
    } else {
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
