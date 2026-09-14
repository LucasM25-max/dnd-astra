import * as THREE from 'three';
import type { WoodlandWorld } from '../engine/world';

/**
 * The hero's own health bar, floating above their head in the world.
 * A screen-projected DOM pill (same trick as FloatingText, but persistent):
 * gold-rimmed channel, ember-ruby fill, hit-point numbers, a strike-flash on
 * damage, and a slow pulse when badly hurt. Hidden in first person, during
 * the opening journey cinematic, under the camp menu, and in photo mode.
 */
export class HeroHealthIndicator {
  private el: HTMLElement;
  private fill: HTMLElement;
  private cur: HTMLElement;
  private max: HTMLElement;
  private name: HTMLElement;
  private raf = 0;
  private prevHp = -1;
  private lastSig = '';
  private flashTimer = 0;
  private anchor = new THREE.Vector3();
  private abort = new AbortController();

  constructor(private world: WoodlandWorld) {
    const host = document.getElementById('experience') ?? document.body;
    this.el = document.createElement('div');
    this.el.id = 'hero-health';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = '<span class="hh-name"></span>'
      + '<div class="hh-frame"><div class="hh-track"><div class="hh-fill"><span class="hh-sheen"></span></div><div class="hh-ticks" aria-hidden="true"></div></div>'
      + '<div class="hh-nums"><b class="hh-cur">–</b><span>/</span><span class="hh-max">–</span></div></div>';
    host.append(this.el);
    this.fill = this.el.querySelector<HTMLElement>('.hh-fill')!;
    this.cur = this.el.querySelector<HTMLElement>('.hh-cur')!;
    this.max = this.el.querySelector<HTMLElement>('.hh-max')!;
    this.name = this.el.querySelector<HTMLElement>('.hh-name')!;
  }

  /** Begin the per-frame projection loop (cheap: one matrix, one DOM write set). */
  start(): void {
    if (this.raf) return;
    const frame = (): void => {
      this.raf = requestAnimationFrame(frame);
      this.update();
    };
    this.raf = requestAnimationFrame(frame);
  }

  private visible(): boolean {
    const w = this.world;
    const body = document.body.dataset;
    if (!w.controller.started || w.controller.mode !== 'third' || w.controller.paused) return false;
    if (w.adventure.narrator.state.phase === 'journey') return false;
    return body.photo !== 'true' && body.camp !== 'true';
  }

  private update(): void {
    const show = this.visible();
    this.el.classList.toggle('visible', show);
    if (!show) return;
    const c = this.world.adventure.inventory.getCharacter();
    if (!c) { this.el.classList.remove('visible'); return; }

    // Anchor above the helm; a seated hero (wagon bench) rides lower.
    const grounded = this.world.controller.position;
    const headLift = this.world.controller.seated ? 1.28 : 2.05;
    this.anchor.set(grounded.x, grounded.y + headLift, grounded.z);
    this.anchor.project(this.world.camera);
    if (this.anchor.z > 1) { this.el.classList.remove('visible'); return; }
    const rect = this.world.renderer.domElement;
    const x = ((this.anchor.x + 1) / 2) * rect.clientWidth;
    const y = ((-this.anchor.y + 1) / 2) * rect.clientHeight;
    // Distance-aware shrink keeps the pill readable without shouting.
    const dist = this.world.camera.position.distanceTo(grounded);
    const scale = Math.max(0.72, Math.min(1.06, 4.2 / Math.max(2.4, dist)));
    this.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;

    const sig = `${c.hp.current}/${c.hp.max}/${c.name}`;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      const frac = c.hp.max > 0 ? Math.max(0, Math.min(1, c.hp.current / c.hp.max)) : 0;
      if (this.prevHp >= 0 && c.hp.current < this.prevHp) {
        this.el.classList.add('hit');
        window.clearTimeout(this.flashTimer);
        this.flashTimer = window.setTimeout(() => this.el.classList.remove('hit'), 520);
      }
      this.prevHp = c.hp.current;
      this.el.classList.toggle('low', frac > 0 && frac <= 0.25);
      this.el.classList.toggle('full', frac >= 1);
      this.fill.style.width = `${(frac * 100).toFixed(1)}%`;
      this.cur.textContent = String(c.hp.current);
      this.max.textContent = String(c.hp.max);
      this.name.textContent = c.name.toUpperCase();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.flashTimer);
    this.abort.abort();
    this.el.remove();
  }
}
