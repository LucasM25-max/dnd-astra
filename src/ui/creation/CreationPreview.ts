import { paintFighterPreview, DEFAULT_LOOK, type FighterLook } from '../../engine/actors/fighter';

/**
 * Live hero preview for character creation, painted on a 2D canvas with the
 * same painter the sprite atlas uses: a slow turntable plus paint-only
 * flourish actions (attack / hit / down). Deliberately not WebGL — a second
 * GL context fights the world's renderer on software GL and low-end GPUs.
 * No hit detection, damage, or AI — pure presentation.
 */
export class CreationPreview {
  private look: FighterLook;
  private dir = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flourishKind: 'attack' | 'hit' | 'down' | null = null;
  private flourishFrame = 0;
  private flourishUntil = 0;
  private readonly turntable: boolean;

  constructor(private canvas: HTMLCanvasElement, look: FighterLook = DEFAULT_LOOK) {
    this.look = look;
    this.turntable = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.paint();
  }

  /** Swap equipment/portrait visuals (instant 2D repaint). */
  setLook(look: FighterLook): void {
    this.look = look;
    this.paint();
  }

  /** Paint-only flourish that auto-clears back to idle after `ms`. */
  flourish(kind: 'attack' | 'hit' | 'down', ms = 1600): void {
    this.flourishKind = kind;
    this.flourishFrame = 0;
    this.flourishUntil = performance.now() + ms;
    this.paint();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 140);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.flourishKind = null;
  }

  private tick(): void {
    if (this.flourishKind) {
      if (performance.now() >= this.flourishUntil) this.flourishKind = null;
      else this.flourishFrame++;
    } else if (this.turntable) {
      this.dir = (this.dir + 1) % 16;
    } else {
      return;
    }
    this.paint();
  }

  private paint(): void {
    const frames = this.flourishKind === 'attack' ? 4 : this.flourishKind === 'hit' ? 2 : 1;
    if (this.flourishKind) {
      paintFighterPreview(this.canvas, this.look, this.dir, this.flourishKind, this.flourishFrame % frames, frames);
    } else {
      paintFighterPreview(this.canvas, this.look, this.dir);
    }
  }
}
