import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { portraitDef, type PortraitPreset } from '../../game/character';
import {
  IDLE_FOR_WEAPON_SET, SkeletalHero, weaponSetForLoadout,
} from '../../character/skeletal/SkeletalHero';
import type { WeaponId } from '../../character/skeletal/HeroWeapons';
import type { ClipName } from '../../character/skeletal/HeroClips';

/** Paint-only flourish actions (no hit detection, damage, or AI — pure presentation). */
export type CreationFlourish = 'attack' | 'hit' | 'down' | 'salute' | 'bow';

export interface CreationPreviewOptions {
  preset?: PortraitPreset;
  mainHand?: WeaponId;
  offHand?: WeaponId | null;
}

const MAIN_HANDS: ReadonlySet<string> = new Set(['longsword', 'battleaxe', 'warhammer']);
const OFF_HANDS: ReadonlySet<string> = new Set(['shield', 'shortsword']);

const asMainHand = (id: string): WeaponId => (MAIN_HANDS.has(id) ? (id as WeaponId) : 'longsword');
const asOffHand = (id: string | null): WeaponId | null =>
  id !== null && OFF_HANDS.has(id) ? (id as WeaponId) : null;

/**
 * Live skeletal hero viewport for character creation: the same SkeletalHero
 * the game plays, on a pedestal under woodland 3-point light, with a slow
 * turntable plus weapon-aware flourish one-shots. The world renderer rests
 * behind creation's opaque backdrop, so this owns the only live GL context
 * while the screen is open.
 */
export class CreationPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private hero: SkeletalHero | null = null;
  private raf = 0;
  private last = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly turntable: boolean;
  private flourishing = false;
  private attackAlt = 0;
  private downHeld = false;
  private mainHand: WeaponId;
  private offHand: WeaponId | null;

  constructor(private canvas: HTMLCanvasElement, opts: CreationPreviewOptions = {}) {
    this.mainHand = opts.mainHand ?? 'longsword';
    this.offHand = opts.offHand ?? 'shield';
    this.turntable = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    // Three-quarter view off the sword side; the arch column is portrait-ish,
    // so frame chest-to-boots and let the helm crown the frame.
    this.camera.position.set(-0.85, 1.42, 3.05);
    this.camera.lookAt(0, 0.96, 0);
    try {
      this.boot(opts.preset ?? portraitDef('male_01'));
    } catch {
      // WebGL unavailable: leave the painted arch backdrop in place. The
      // world needs hardware GL too, so creation cannot proceed regardless.
      this.renderer = null;
      this.hero = null;
      this.canvas.style.display = 'none';
    }
  }

  private boot(preset: PortraitPreset): void {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    // Image-based light so plate/mail/blade read as metal (kept dim for mood).
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    // Pedestal + brass trim, matching the preview dais.
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.7, 0.12, 40),
      new THREE.MeshStandardMaterial({ color: '#2c362c', roughness: 0.85 }),
    );
    pedestal.position.y = -0.06;
    pedestal.receiveShadow = true;
    this.scene.add(pedestal);
    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.018, 10, 48),
      new THREE.MeshStandardMaterial({ color: '#8a6f3c', roughness: 0.4, metalness: 0.8 }),
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = -0.012;
    this.scene.add(trim);

    // Woodland 3-point light.
    this.scene.add(new THREE.HemisphereLight('#cdd8c0', '#1a2418', 0.55));
    const key = new THREE.DirectionalLight('#ffe8c4', 2.0);
    key.position.set(2.2, 3.4, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1.5;
    key.shadow.camera.right = 1.5;
    key.shadow.camera.top = 2.5;
    key.shadow.camera.bottom = -0.5;
    key.shadow.camera.far = 10;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#9ab8ff', 1.1);
    rim.position.set(-2.4, 2.2, -2.2);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight('#ffd9b0', 0.5);
    fill.position.set(-1.2, 1.0, 2.8);
    this.scene.add(fill);

    this.hero = new SkeletalHero({
      canvasFactory: (w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      },
      preset,
      equipment: { mainHand: this.mainHand, offHand: this.offHand },
    });
    this.hero.root.traverse(o => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.scene.add(this.hero.root);
    this.applyIdle(0);

    const parent = this.canvas.parentElement ?? this.canvas;
    const resize = (): void => {
      const w = parent.clientWidth || 1;
      const h = parent.clientHeight || 1;
      renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(parent);
  }

  /** Swap the portrait sculpt (instant re-dress). */
  setPortrait(preset: PortraitPreset): void {
    this.releaseFall();
    this.hero?.setPortrait(preset);
  }

  /** Swap wielded steel (instant re-dress + matching stance). */
  setEquipment(mainHand: string, offHand: string | null): void {
    this.releaseFall();
    this.mainHand = asMainHand(mainHand);
    this.offHand = asOffHand(offHand);
    this.hero?.setEquipment(this.mainHand, this.offHand);
    this.applyIdle(0.2);
  }

  /**
   * Paint-only flourish one-shot. Attack is weapon-aware (slash/thrust
   * alternate for blades, the overhead chop for axe and hammer, the scissor
   * cut for dual steel); the fall holds its final pose until anything else
   * happens so the pedestal reads as a memorial, not a pratfall.
   */
  flourish(kind: CreationFlourish): void {
    const hero = this.hero;
    if (!hero || this.flourishing) return;
    this.releaseFall();
    let clip: ClipName;
    let hold = false;
    switch (kind) {
      case 'attack':
        clip = this.attackClip();
        break;
      case 'hit':
        clip = 'hit_react';
        break;
      case 'down':
        clip = 'death';
        hold = true;
        break;
      case 'salute':
        clip = 'salute';
        break;
      case 'bow':
        clip = 'bow_draw';
        break;
    }
    this.flourishing = true;
    if (hold) this.downHeld = true;
    void hero.playOneShot(clip, { hold }).finally(() => {
      this.flourishing = false;
    });
  }

  private attackClip(): ClipName {
    if (this.offHand === 'shortsword') return 'dual_strike';
    if (this.mainHand === 'battleaxe' || this.mainHand === 'warhammer') return 'slash_2h';
    this.attackAlt = (this.attackAlt + 1) % 2;
    return this.attackAlt === 0 ? 'attack_slash_1h' : 'thrust_1h';
  }

  private applyIdle(fade: number): void {
    const set = weaponSetForLoadout(this.mainHand, this.offHand);
    this.hero?.playLocomotion(IDLE_FOR_WEAPON_SET[set], fade);
  }

  private releaseFall(): void {
    if (this.downHeld) {
      this.downHeld = false;
      this.hero?.releaseShot(0.3);
    }
  }

  start(): void {
    if (!this.renderer || !this.hero || this.raf) return;
    this.last = performance.now();
    const frame = (now: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.hero?.update(dt);
      if (this.turntable && !this.flourishing) {
        this.hero!.root.rotation.y += dt * (this.downHeld ? 0.25 : 0.45);
      }
      this.renderer?.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.hero?.dispose();
    this.hero = null;
    this.scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const mm = m as THREE.MeshStandardMaterial;
          mm.map?.dispose();
          m.dispose();
        }
      }
    });
    this.scene.environment?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}
