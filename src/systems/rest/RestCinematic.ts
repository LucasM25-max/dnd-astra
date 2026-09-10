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

  constructor(
    private camera: THREE.PerspectiveCamera,
    private controller: PlayerController,
    private narratorCamera: NarratorCamera,
    private sky: SkyboxManager,
    private getMinute: () => number,
    private setMinute: (min: number) => void,
  ) {}

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
    await this.narratorCamera.dollyTo(wide, REST_CONFIG.cinematicMs.dollyOut);
    this.startOrbit();
    this.sky.showClock('Night falls…');
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
    return this.sky.sweepClock(this.getMinute(), 360, 2200, this.setMinute);
  }

  async end(): Promise<void> {
    this.stopOrbit();
    this.sky.showClock('☀ 6:00 am');
    await this.sky.fadeToBlack(true, REST_CONFIG.cinematicMs.fadeMs);
    await this.narratorCamera.restore(10);
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
