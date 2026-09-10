import * as THREE from 'three';
import type { PlayerController } from '../../engine/controller';
import type { CollisionField } from '../../engine/landscape';

export interface CameraFocus { position: THREE.Vector3; lookAt: THREE.Vector3 }

/** Cinematic dolly: ease to a focus and back, reusing the controller's camera override. */
export class NarratorCamera {
  private savedPos = new THREE.Vector3();
  private savedLook = new THREE.Vector3();
  private saved = false;
  private cancelled = false;

  constructor(
    private controller: PlayerController,
    private camera: THREE.PerspectiveCamera,
    private collision: CollisionField,
  ) {}

  cancel(): void {
    this.cancelled = true;
  }

  private tween(durationMs: number, apply: (t: number) => void): Promise<void> {
    this.cancelled = false;
    return new Promise(resolve => {
      const start = performance.now();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || durationMs <= 0) {
        apply(1);
        resolve();
        return;
      }
      const frame = (now: number): void => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / durationMs);
        const eased = t * t * (3 - 2 * t);
        apply(eased);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async dollyTo(focus: CameraFocus, durationMs = 800): Promise<void> {
    if (!this.saved) {
      this.savedPos.copy(this.camera.position);
      // Approximate current look target from the controller's orbit state.
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.savedLook.copy(this.camera.position).addScaledVector(dir, 6);
      this.saved = true;
    }
    this.controller.cameraOverride = true;
    const fromPos = this.camera.position.clone();
    const toPos = focus.position.clone();
    // Keep the lens out of trunks and terrain.
    if (this.collision.cameraBlocked(toPos.x, toPos.y, toPos.z)) toPos.y += 1.6;
    const fromLook = this.savedLook.clone();
    const toLook = focus.lookAt.clone();
    const current = new THREE.Vector3();
    await this.tween(durationMs, t => {
      current.copy(fromPos).lerp(toPos, t);
      this.camera.position.copy(current);
      this.camera.lookAt(fromLook.clone().lerp(toLook, t));
    });
  }

  /** Hold the current cinematic framing (used during orbits driven elsewhere). */
  hold(): void {
    this.controller.cameraOverride = true;
  }

  async restore(durationMs = 800): Promise<void> {
    if (!this.saved) {
      this.controller.cameraOverride = false;
      return;
    }
    const fromPos = this.camera.position.clone();
    const toPos = this.savedPos.clone();
    const fromDir = new THREE.Vector3();
    this.camera.getWorldDirection(fromDir);
    const fromLook = this.camera.position.clone().addScaledVector(fromDir, 6);
    const toLook = this.savedLook.clone();
    await this.tween(durationMs, t => {
      this.camera.position.copy(fromPos.clone().lerp(toPos, t));
      this.camera.lookAt(fromLook.clone().lerp(toLook, t));
    });
    this.saved = false;
    this.controller.cameraOverride = false;
  }
}
