import * as THREE from 'three';
import type { PlayerController } from '../../engine/controller';
import type { NarratorCamera } from '../narration/NarratorCamera';
import type { SkyboxManager } from '../../world/SkyboxManager';
import { REST_CONFIG } from './RestResolver';

/**
 * Rest cinematic: wide dolly → slow campfire orbit → clock sweep dusk→night→dawn.
 * Phased API so the ambush branch can interrupt at midnight and resume.
 */
export class RestCinematic {
  private orbitRaf = 0;
  private orbiting = false;
  private orbitAngle = 0;
  private firePos = new THREE.Vector3();

  private fogBackup = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private controller: PlayerController,
    private narratorCamera: NarratorCamera,
    private sky: SkyboxManager,
    private getMinute: () => number,
    private setMinute: (min: number) => void,
    private getFogDensity?: () => number,
    private setFogDensity?: (d: number) => void,
    private setNightFactor?: (f: number) => void,
  ) {}

  /** Ease the world's lighting between day (0) and night (1). */
  private async tweenNight(factor: number, ms: number): Promise<void> {
    if (!this.setNightFactor) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || ms <= 0) { this.setNightFactor(factor); return; }
    return new Promise<void>(resolve => {
      const start = performance.now();
      const frame = (now: number): void => {
        const t = Math.min(1, (now - start) / ms);
        this.setNightFactor!(factor * (t * t * (3 - 2 * t)));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /**
   * Static wide shot of the whole campsite, held behind the camp menu.
   * The gameplay camera is saved once, so begin()/end() nest cleanly inside it.
   */
  async wideShot(firePos: THREE.Vector3): Promise<void> {
    this.firePos.copy(firePos);
    await this.narratorCamera.dollyTo({
      position: firePos.clone().add(new THREE.Vector3(6.5, 4.2, 7.5)),
      lookAt: firePos.clone().add(new THREE.Vector3(0, 0.9, 0)),
    }, REST_CONFIG.cinematicMs.dollyOut);
    this.narratorCamera.hold();
  }

  /** Release the camp wide shot back to the gameplay camera. */
  async releaseWide(): Promise<void> {
    await this.narratorCamera.restore(600);
  }

  /** Wide shot of the campsite + orbit start + time overlay. */
  async begin(firePos: THREE.Vector3): Promise<void> {
    this.firePos.copy(firePos);
    const wide = {
      position: firePos.clone().add(new THREE.Vector3(4.5, 3.4, 5.5)),
      lookAt: firePos.clone().add(new THREE.Vector3(0, 0.8, 0)),
    };
    // Thin the fog so the painted night sky can be read through the trees,
    // and let the light fall to firelight levels in step with the sky.
    if (this.getFogDensity && this.setFogDensity) {
      this.fogBackup = this.getFogDensity();
      this.setFogDensity(this.fogBackup * 0.16);
    }
    void this.tweenNight(1, 1800);
    await this.narratorCamera.dollyTo(wide, REST_CONFIG.cinematicMs.dollyOut);
    this.startOrbit();
    this.sky.showClock('Night falls…');
    this.sky.lapseStart(); // Painted starfield fades in as night falls.
  }

  sweepToNight(): Promise<void> {
    return this.sky.sweepClock(this.getMinute(), 1410, 2200, this.setMinute);
  }

  holdNight(): Promise<void> {
    this.sky.showClock('☾ Deep night');
    return new Promise(resolve => {
      window.setTimeout(resolve, REST_CONFIG.cinematicMs.nightHold);
    });
  }

  sweepToDawn(): Promise<void> {
    this.sky.showClock('Dawn approaches…');
    this.sky.lapseDawn(); // Painted sky crossfades from starfield to warm dawn.
    return this.sky.sweepClock(this.getMinute(), 360, 2200, this.setMinute);
  }

  async end(): Promise<void> {
    this.stopOrbit();
    this.setFogDensity?.(this.fogBackup); // The fade covers the fog restoring.
    this.sky.showClock('☀ 6:00 am');
    await this.sky.fadeToBlack(true, REST_CONFIG.cinematicMs.fadeMs);
    await Promise.all([
      this.narratorCamera.restore(10),
      this.tweenNight(0, 900), // Dawn light returns with the fade.
    ]);
    // Hand the sky back to the live, procedural world as the fade lifts.
    this.sky.lapseEnd();
    await this.sky.fadeToBlack(false, REST_CONFIG.cinematicMs.fadeMs);
    this.sky.hideClock();
  }

  private startOrbit(): void {
    if (this.orbiting) return;
    this.orbiting = true;
    this.narratorCamera.hold();
    this.controller.cameraOverride = true;
    this.orbitAngle = Math.atan2(
      this.camera.position.x - this.firePos.x,
      this.camera.position.z - this.firePos.z,
    );
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const radius = 7.2;
    const frame = (): void => {
      if (!this.orbiting) return;
      if (!reduced) this.orbitAngle += 0.0035;
      this.camera.position.set(
        this.firePos.x + Math.sin(this.orbitAngle) * radius,
        this.firePos.y + 3.2,
        this.firePos.z + Math.cos(this.orbitAngle) * radius,
      );
      this.camera.lookAt(this.firePos.x, this.firePos.y + 0.9, this.firePos.z);
      this.orbitRaf = requestAnimationFrame(frame);
    };
    frame();
  }

  private stopOrbit(): void {
    this.orbiting = false;
    cancelAnimationFrame(this.orbitRaf);
  }
}
