import * as THREE from 'three';

/**
 * Rest time-lapse: soft fade, clock/moon-phase chrome that slides across the
 * screen, and a painted sky sphere (night → dawn) crossfaded behind the camp
 * while the game clock sweeps through the night.
 */
export class SkyboxManager {
  private fadeEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private moonEl: HTMLElement | null = null;
  private nightSky: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private dawnSky: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private lapseRaf = 0;
  private lapseTarget = { night: 0, dawn: 0 };

  constructor(private scene?: THREE.Scene) {
    if (scene) this.buildLapseSpheres(scene);
  }

  // --- Lapse sky spheres (painted dusk/night/dawn art) ---

  private buildLapseSpheres(scene: THREE.Scene): void {
    const make = (url: string): Promise<THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null> => new Promise(resolve => {
      new THREE.TextureLoader().load(
        url,
        texture => {
          texture.colorSpace = THREE.SRGBColorSpace;
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(205, 32, 24),
            new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, transparent: true, opacity: 0, fog: false, depthWrite: false }),
          );
          mesh.renderOrder = -4;
          mesh.visible = false;
          mesh.name = 'rest-lapse-sky';
          scene.add(mesh);
          resolve(mesh);
        },
        undefined,
        () => resolve(null), // Missing art: the procedural sky still carries the night.
      );
    });
    void Promise.all([make('/images/skies/sky_night.webp'), make('/images/skies/sky_dawn.webp')]).then(([night, dawn]) => {
      this.nightSky = night;
      this.dawnSky = dawn;
    });
  }

  private setLapseOpacity(night: number, dawn: number): void {
    if (this.nightSky) {
      this.nightSky.material.opacity = night;
      this.nightSky.visible = night > 0.004;
    }
    if (this.dawnSky) {
      this.dawnSky.material.opacity = dawn;
      this.dawnSky.visible = dawn > 0.004;
    }
  }

  private lapseTo(night: number, dawn: number, ms: number): void {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.cancelAnimationFrame(this.lapseRaf);
    if (reduced || ms <= 0) {
      this.lapseTarget = { night, dawn };
      this.setLapseOpacity(night, dawn);
      return;
    }
    const from = {
      night: this.nightSky ? this.nightSky.material.opacity : 0,
      dawn: this.dawnSky ? this.dawnSky.material.opacity : 0,
    };
    this.lapseTarget = { night, dawn };
    const start = performance.now();
    const frame = (now: number): void => {
      const t = Math.min(1, (now - start) / ms);
      const e = t * t * (3 - 2 * t);
      this.setLapseOpacity(from.night + (this.lapseTarget.night - from.night) * e, from.dawn + (this.lapseTarget.dawn - from.dawn) * e);
      if (t < 1) this.lapseRaf = requestAnimationFrame(frame);
    };
    this.lapseRaf = requestAnimationFrame(frame);
  }

  /** Night falls: the painted starfield fades in over the camp. */
  lapseStart(): void { this.lapseTo(0.94, 0, 1500); }
  /** The long sweep toward morning: night art gives way to warm dawn. */
  lapseDawn(): void { this.lapseTo(0.28, 0.94, 2400); }
  /** Dawn is here: hand the sky back to the live, procedural world. */
  lapseEnd(): void { this.lapseTo(0, 0, 950); }

  // --- Fade + clock chrome ---

  private ensure(): void {
    if (this.fadeEl && this.clockEl && this.moonEl) return;
    const host = document.getElementById('experience') ?? document.body;
    if (!this.fadeEl) {
      this.fadeEl = document.createElement('div');
      this.fadeEl.id = 'rest-fade';
      host.append(this.fadeEl);
    }
    if (!this.clockEl) {
      this.clockEl = document.createElement('div');
      this.clockEl.id = 'rest-clock';
      this.clockEl.innerHTML = '<span class="rest-moon">☾</span><span id="rest-clock-label"></span>';
      host.append(this.clockEl);
    }
    if (!this.moonEl) {
      this.moonEl = document.createElement('div');
      this.moonEl.id = 'rest-lapse-moon';
      this.moonEl.setAttribute('aria-hidden', 'true');
      host.append(this.moonEl);
    }
  }

  private slideMoon(t: number): void {
    const moon = this.moonEl;
    if (!moon) return;
    const x = 12 + 74 * t;
    const y = 16 - Math.sin(t * Math.PI) * 9;
    moon.style.left = `${x}%`;
    moon.style.top = `${y}%`;
    moon.style.opacity = String(0.85 * (t < 0.08 ? t / 0.08 : t > 0.92 ? (1 - t) / 0.08 : 1));
  }

  fadeToBlack(black: boolean, ms: number): Promise<void> {
    this.ensure();
    const el = this.fadeEl!;
    el.style.transitionDuration = `${ms}ms`;
    el.classList.toggle('black', black);
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => {
      window.setTimeout(resolve, ms + 30);
    });
  }

  showClock(label: string): void {
    this.ensure();
    this.clockEl!.querySelector('#rest-clock-label')!.textContent = label;
    this.clockEl!.classList.add('visible');
  }

  hideClock(): void {
    this.clockEl?.classList.remove('visible');
    if (this.moonEl) this.moonEl.style.opacity = '0';
  }

  /**
   * Tween the game clock across midnight if needed; the moon-phase graphic
   * slides across the screen in step with the sweep.
   */
  sweepClock(fromMin: number, toMin: number, ms: number, setMinute: (min: number) => void): Promise<void> {
    this.ensure();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || ms <= 0) {
      setMinute(toMin);
      return Promise.resolve();
    }
    let delta = toMin - fromMin;
    if (delta <= 0) delta += 1440;
    return new Promise(resolve => {
      const start = performance.now();
      const frame = (now: number): void => {
        const t = Math.min(1, (now - start) / ms);
        setMinute((fromMin + delta * t) % 1440);
        this.slideMoon(t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  dispose(): void {
    window.cancelAnimationFrame(this.lapseRaf);
    for (const mesh of [this.nightSky, this.dawnSky]) {
      if (!mesh) continue;
      this.scene?.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
    this.nightSky = null;
    this.dawnSky = null;
    this.fadeEl?.remove();
    this.clockEl?.remove();
    this.moonEl?.remove();
    this.fadeEl = null;
    this.clockEl = null;
    this.moonEl = null;
  }
}
