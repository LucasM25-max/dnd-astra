/** Rest time-lapse chrome: clock sweep, soft fade, moon-phase time overlay. */
export class SkyboxManager {
  private fadeEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;

  private ensure(): void {
    if (this.fadeEl && this.clockEl) return;
    const host = document.getElementById('experience') ?? document.body;
    this.fadeEl = document.createElement('div');
    this.fadeEl.id = 'rest-fade';
    host.append(this.fadeEl);
    this.clockEl = document.createElement('div');
    this.clockEl.id = 'rest-clock';
    this.clockEl.innerHTML = '<span class="rest-moon">☾</span><span id="rest-clock-label"></span>';
    host.append(this.clockEl);
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
  }

  /** Tween the game clock across midnight if needed. */
  sweepClock(fromMin: number, toMin: number, ms: number, setMinute: (min: number) => void): Promise<void> {
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
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  dispose(): void {
    this.fadeEl?.remove();
    this.clockEl?.remove();
    this.fadeEl = null;
    this.clockEl = null;
  }
}
