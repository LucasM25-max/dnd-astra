import * as THREE from 'three';
import type { DieMesh } from './DieMeshFactory';
import { cryptoRandomFloat } from './DiceResultResolver';

/**
 * Lightweight dice physics (no external engine): a single die approximated as a
 * sphere bouncing on an invisible glass plane between two invisible walls.
 * At most 3 bodies by construction. Created per roll, disposed after.
 */
export interface TossParams { velocity: THREE.Vector3; angular: THREE.Vector3 }

const GRAVITY = -12.5;
const RESTITUTION = 0.42;
const WALL_X = 2.1;

export class DicePhysicsScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private running = false;
  private elapsed = 0;
  private velocity = new THREE.Vector3();
  private angular = new THREE.Vector3();
  private mesh: DieMesh | null = null;
  private target: THREE.Quaternion | null = null;
  private guideBegin = 1.2;
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
    const rim = new THREE.DirectionalLight('#c9a84c', 0.9);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);

    // Invisible glass plane: catches a soft shadow, renders nothing else.
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    glass.rotation.x = -Math.PI / 2;
    glass.receiveShadow = true;
    this.scene.add(glass);
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

  guideTo(target: THREE.Quaternion, beginAt = 1.2): void {
    this.target = target.clone();
    this.guideBegin = beginAt;
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
    if (this.target && this.mesh) this.mesh.group.quaternion.copy(this.target);
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

    // Guidance phase: ease toward the pre-determined face while motion decays.
    if (this.target && this.elapsed > this.guideBegin) {
      const t = Math.min(1, (this.elapsed - this.guideBegin) / 0.45);
      mesh.group.quaternion.slerp(this.target, Math.min(1, dt * (2 + t * 9)));
      this.velocity.multiplyScalar(1 - dt * (2.2 + t * 4));
      this.angular.multiplyScalar(1 - dt * (3 + t * 6));
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

    // Settle detection: slow + guided + quiet.
    const guided = this.target !== null && this.elapsed > this.guideBegin + 0.35;
    if (guided && this.velocity.length() < 0.3 && speed < 1.4) {
      this.quietTime += dt;
      if (this.quietTime > 0.22) this.finish();
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
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.settleTimer);
    this.settleResolve = null;
    this.scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
