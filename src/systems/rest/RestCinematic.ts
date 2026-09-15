import * as THREE from 'three';
import type { PlayerController } from '../../engine/controller';
import type { NarratorCamera } from '../narration/NarratorCamera';
import type { SkyboxManager } from '../../world/SkyboxManager';
import { REST_CONFIG } from './RestResolver';

/**
 * Rest cinematic: wide dolly → slow campfire orbit that lifts into a full
 * look-up at the night sky → clock sweep dusk→night→dawn.
 * Phased API so the ambush branch can interrupt at midnight and resume.
 */
export class RestCinematic {
  private orbitRaf = 0;
  private orbiting = false;
  private orbitAngle = 0;
  private firePos = new THREE.Vector3();
  /** 0 = framing the campfire, 1 = tilted up to the open sky. */
  private tilt = 0;

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
    this.tilt = 0;
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
    void this.tweenNight(1, 2600);
    await this.narratorCamera.dollyTo(wide, REST_CONFIG.cinematicMs.dollyOut);
    this.startOrbit();
    this.sky.showClock('Night falls…');
    this.sky.lapseStart(); // Painted starfield fades in as night falls.
  }

  /**
   * Dusk → deep night. The clock sweep is long, and the lens rises toward the
   * open sky *while* it runs, so the falling night is watched from the first
   * star to the full starfield instead of being skipped over.
   */
  sweepToNight(): Promise<void> {
    const ms = REST_CONFIG.cinematicMs.sweepNightMs;
    void this.tweenTilt(0.55, ms * 0.85);
    return this.sky.sweepClock(this.getMinute(), 1410, ms, this.setMinute);
  }

  /**
   * Deep night: hold the orbit, rise up over the fire, and pan the lens to
   * the open sky above the clearing (the painted starfield reads at its best
   * from there), then return to the fire before dawn sweeps in.
   */
  async holdNight(): Promise<void> {
    this.sky.showClock('☾ Deep night');
    const hold = REST_CONFIG.cinematicMs.nightHold;
    await this.tweenTilt(1, hold * 0.42);      // slow look-up into the stars
    await this.wait(hold * 0.3);               // hold on the open sky
    this.sky.showClock('☾ Deep night · the stars turn slowly');
    await this.wait(hold * 0.28);
    // Ease down only partway: the sky stays framed for the dawn sweep.
    await this.tweenTilt(0.62, hold * 0.3);
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => { window.setTimeout(resolve, Math.max(120, ms)); });
  }

  /** Ease the orbit's vertical framing between campfire (0) and sky (1). */
  private tweenTilt(to: number, ms: number): Promise<void> {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = this.tilt;
    if (reduced || ms <= 0) { this.tilt = to; return Promise.resolve(); }
    return new Promise(resolve => {
      const start = performance.now();
      const frame = (now: number): void => {
        const t = Math.min(1, (now - start) / ms);
        this.tilt = from + (to - from) * (t * t * (3 - 2 * t));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /**
   * Night → dawn. The painted starfield gives way to warm dawn over the whole
   * sweep while the lens stays raised on the sky, then settles partway back
   * toward the fire as the first light lands.
   */
  sweepToDawn(): Promise<void> {
    this.sky.showClock('Dawn approaches…');
    this.sky.lapseDawn(); // Painted sky crossfades from starfield to warm dawn.
    const ms = REST_CONFIG.cinematicMs.sweepDawnMs;
    void this.tweenTilt(0.9, ms * 0.45).then(() => this.tweenTilt(0.5, ms * 0.5));
    return this.sky.sweepClock(this.getMinute(), 360, ms, this.setMinute);
  }

  async end(): Promise<void> {
    this.sky.showClock('☀ 6:00 am');
    await this.sky.fadeToBlack(true, REST_CONFIG.cinematicMs.fadeMs);
    // Behind the black, the lens settles from the sky back down to the fire.
    await this.tweenTilt(0, 1100);
    this.stopOrbit();
    this.setFogDensity?.(this.fogBackup); // The fade covers the fog restoring.
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
    const tmp = new THREE.Vector3();
    const frame = (): void => {
      if (!this.orbiting) return;
      if (!reduced) this.orbitAngle += 0.0016;
      const tilt = this.tilt;
      // Tilted up: draw close beside the fire and lift above the smoke, so
      // the clearing opens into a full bowl of sky (no trees cut the stars).
      const radius = 7.2 - 4.3 * tilt;
      const height = 3.2 + 2.6 * tilt;
      this.camera.position.set(
        this.firePos.x + Math.sin(this.orbitAngle) * radius,
        this.firePos.y + height,
        this.firePos.z + Math.cos(this.orbitAngle) * radius,
      );
      // Look point rises from the fire's heart up past the zenith as tilt grows.
      tmp.set(this.firePos.x, this.firePos.y + 0.9, this.firePos.z);
      tmp.y += tilt * tilt * 16;
      tmp.x += Math.sin(this.orbitAngle + 2.4) * tilt * 2.2;
      tmp.z += Math.cos(this.orbitAngle + 2.4) * tilt * 2.2;
      this.camera.lookAt(tmp);
      this.orbitRaf = requestAnimationFrame(frame);
    };
    frame();
  }

  private stopOrbit(): void {
    this.orbiting = false;
    cancelAnimationFrame(this.orbitRaf);
  }
}
