import * as THREE from 'three';
import { portraitDef, type PortraitPreset } from '../../game/character';
import type { WeaponSet } from '../CharacterModel';
import type { SocketName } from '../SocketManager';
import { buildRig, type BoneName, type HeroRig } from './HeroRig';
import { BODY_MATERIAL_SLOTS, buildBodyGeometry } from './BodyParts';
import {
  createBodyMaterials,
  paintBlade,
  paintFaceSphere,
  paintHair,
  paintLeather,
  paintMail,
  paintPlate,
  paintShieldFace,
  paintSkin,
  paintWood,
  type CanvasFactory,
} from './HeroTextures';
import {
  buildBelt,
  buildBoot,
  buildCoif,
  buildGauntlet,
  buildGreave,
  buildHair,
  buildHelmet,
  buildMailShirt,
  buildPauldron,
  type ArmourMats,
  type ArmourPiece,
} from './HeroArmour';
import { buildWeapon, type WeaponId, type WeaponMats } from './HeroWeapons';
import { buildClips, CLIP_DEFS, type ClipName } from './HeroClips';

/**
 * The assembled skeletal hero: one SkinnedMesh body (smooth joints, per-part
 * textures), rigid armour parented to bones, weapons on named bone sockets,
 * and a mixer playing the procedural clip catalogue.
 *
 * DOM-free except for the injected canvas factory (tests pass a stub).
 */

export interface HeroEquipment {
  mainHand: WeaponId;
  offHand: WeaponId | null;
}

export interface SkeletalHeroOptions {
  canvasFactory: CanvasFactory;
  preset?: PortraitPreset;
  equipment?: HeroEquipment;
}

/** Per-item socket frames (bind space, radians). Tuned against screenshots. */
const ITEM_SOCKETS: Record<WeaponId, { socket: SocketName; pos: [number, number, number]; rot: [number, number, number] }> = {
  longsword: { socket: 'mainhand', pos: [0, -0.05, 0.008], rot: [0, 0, 0] },
  battleaxe: { socket: 'mainhand', pos: [0, -0.05, 0.008], rot: [0, 0, 0] },
  warhammer: { socket: 'mainhand', pos: [0, -0.05, 0.008], rot: [0, 0, 0] },
  shortsword: { socket: 'offhand', pos: [0, -0.05, 0.008], rot: [0, 0, 0] },
  shield: { socket: 'offhand', pos: [0.045, -0.055, 0.008], rot: [0, Math.PI / 2, 0] },
  longbow: { socket: 'back', pos: [0.15, 0.14, -0.17], rot: [-0.1, -0.1, 0.72] },
  quiver: { socket: 'quiver', pos: [-0.17, 0.05, -0.13], rot: [-0.3, 0, 0.15] },
};

const SOCKET_BONES: Record<SocketName, BoneName> = {
  mainhand: 'HandR',
  offhand: 'HandL',
  back: 'Chest',
  hip: 'Hips',
  quiver: 'Hips',
};

export const IDLE_FOR_WEAPON_SET: Record<WeaponSet, ClipName> = {
  sword_shield: 'idle',
  two_hand: 'idle',
  dual: 'idle_dual',
  bow: 'idle_bow',
  unarmed: 'idle_bow',
};

export function weaponSetForLoadout(mainHand: WeaponId, offHand: WeaponId | null): WeaponSet {
  if (offHand === 'shortsword') return 'dual';
  if (offHand === 'shield') return 'sword_shield';
  if (mainHand === 'longbow') return 'bow';
  return 'sword_shield';
}

function canvasTexture(
  factory: CanvasFactory,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = factory(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  paint(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export class SkeletalHero {
  readonly root = new THREE.Group();
  readonly rig: HeroRig;
  readonly clips: Map<ClipName, THREE.AnimationClip>;
  readonly sockets = {} as Record<SocketName, THREE.Object3D>;
  weaponSet: WeaponSet = 'sword_shield';

  private mixer: THREE.AnimationMixer;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private loco: ClipName = 'idle';
  private oneShot: ClipName | null = null;
  private oneShotTimer = 0;
  private shotHold = false;
  private body: THREE.SkinnedMesh;
  private bodyMats: THREE.MeshStandardMaterial[];
  private armourMats: ArmourMats;
  private weaponMats: WeaponMats;
  private portraitPieces: THREE.Object3D[] = [];
  private equipped: THREE.Object3D[] = [];
  private preset: PortraitPreset;
  private triangles = 0;
  private mainHandId: WeaponId = 'longsword';
  private mainWeapon: THREE.Object3D | null = null;
  private bowWeapon: THREE.Object3D | null = null;
  private sidearmStowed = false;
  private bowDrawn = false;
  private bowGrip: THREE.Object3D | null = null;

  constructor(opts: SkeletalHeroOptions) {
    this.root.name = 'SkeletalHero';
    this.preset = opts.preset ?? portraitDef('male_01');
    const factory = opts.canvasFactory;

    // Rig + skinned body.
    this.rig = buildRig();
    this.root.add(this.rig.group);
    const body = buildBodyGeometry(this.rig);
    this.triangles += body.triangles;
    this.bodyMats = createBodyMaterials(factory, this.preset);
    this.body = new THREE.SkinnedMesh(body.geometry, this.bodyMats);
    this.body.name = 'hero_body';
    this.body.frustumCulled = false; // verts bend outside the bind-space bounds
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.root.add(this.body);
    this.root.updateMatrixWorld(true);
    this.body.bind(this.rig.skeleton);
    this.body.normalizeSkinWeights();

    // Shared armour / weapon materials.
    const mailTex = canvasTexture(factory, 256, 256, ctx => paintMail(ctx, 256, 256));
    const plateTex = canvasTexture(factory, 256, 256, ctx => paintPlate(ctx, 256, 256));
    const leatherTex = canvasTexture(factory, 256, 256, ctx => paintLeather(ctx, 256, 256));
    const bladeTex = canvasTexture(factory, 128, 256, ctx => paintBlade(ctx, 128, 256));
    const woodTex = canvasTexture(factory, 128, 128, ctx => paintWood(ctx, 128, 128));
    const bowTex = canvasTexture(factory, 128, 128, ctx => paintWood(ctx, 128, 128, '#7a4e28', 43));
    const shieldTex = canvasTexture(factory, 256, 256, ctx => paintShieldFace(ctx, 256, 256));
    const hairTex = canvasTexture(factory, 128, 128, ctx => paintHair(ctx, 128, 128, this.preset.hairColor));
    const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial(o);
    this.armourMats = {
      mail: std({ map: mailTex, roughness: 0.55, metalness: 0.75, bumpMap: mailTex, bumpScale: 0.5 }),
      plate: std({ map: plateTex, roughness: 0.36, metalness: 0.88 }),
      leather: std({ map: leatherTex, roughness: 0.82, metalness: 0 }),
      brass: std({ color: '#9a7434', roughness: 0.42, metalness: 0.9 }),
      hair: std({ map: hairTex, roughness: 0.92, metalness: 0 }),
    };
    this.weaponMats = {
      blade: std({ map: bladeTex, roughness: 0.28, metalness: 0.95 }),
      steelDark: std({ color: '#4a4e55', roughness: 0.45, metalness: 0.9 }),
      wood: std({ map: woodTex, roughness: 0.7, metalness: 0 }),
      bowWood: std({ map: bowTex, roughness: 0.55, metalness: 0 }),
      leather: this.armourMats.leather,
      brass: this.armourMats.brass,
      iron: std({ color: '#3c3f45', roughness: 0.5, metalness: 0.85 }),
      string: std({ color: '#c9bfa8', roughness: 0.9, metalness: 0 }),
      fletch: std({ color: '#8a2f28', roughness: 0.85, metalness: 0 }),
      shieldFace: std({ map: shieldTex, roughness: 0.65, metalness: 0.05 }),
    };

    // Fixed Fighter kit.
    this.attachArmour(buildMailShirt(this.armourMats));
    this.attachArmour([buildPauldron(this.armourMats, -1), buildPauldron(this.armourMats, 1)]);
    this.attachArmour([buildGauntlet(this.armourMats, -1), buildGauntlet(this.armourMats, 1)]);
    this.attachArmour([buildBelt(this.armourMats)]);
    this.attachArmour([buildGreave(this.armourMats, -1), buildGreave(this.armourMats, 1)]);
    this.attachArmour([buildBoot(this.armourMats, -1), buildBoot(this.armourMats, 1)]);
    this.applyPortraitPieces();

    // Bone sockets.
    for (const [name, bone] of Object.entries(SOCKET_BONES) as [SocketName, BoneName][]) {
      const socket = new THREE.Object3D();
      socket.name = `socket_${name}`;
      this.rig.bones[bone].add(socket);
      this.sockets[name] = socket;
    }
    // The bow + quiver ride along on every loadout (fixed Fighter kit).
    this.bowWeapon = this.equipItem('longbow');
    this.equipItem('quiver');

    // Clips + mixer.
    this.clips = buildClips(this.rig);
    this.mixer = new THREE.AnimationMixer(this.rig.group);
    for (const [name, clip] of this.clips) {
      const action = this.mixer.clipAction(clip);
      if (CLIP_DEFS[name].loop) action.setLoop(THREE.LoopRepeat, Infinity);
      else action.setLoop(THREE.LoopOnce, 1);
      this.actions.set(name, action);
    }

    const eq = opts.equipment ?? { mainHand: 'longsword' as WeaponId, offHand: 'shield' as WeaponId };
    this.setEquipment(eq.mainHand, eq.offHand);
    this.playLocomotion(this.loco, 0);
  }

  get triangleCount(): number {
    return this.triangles;
  }

  get currentClip(): ClipName {
    return this.oneShot ?? this.loco;
  }

  /** Elapsed fraction (0..1) of the active one-shot, or null when idle. */
  shotProgress(): number | null {
    if (!this.oneShot) return null;
    const duration = CLIP_DEFS[this.oneShot].duration;
    if (duration <= 0) return 1;
    return Math.min(1, Math.max(0, 1 - this.oneShotTimer / duration));
  }

  /** Release a held one-shot (sit/interact poses) back to locomotion. */
  releaseShot(fade = 0.25): void {
    this.stopShot(fade);
  }

  // --- Appearance ---

  setPortrait(preset: PortraitPreset): void {
    const portraitChanged = preset.id !== this.preset.id;
    this.preset = preset;
    if (!portraitChanged) return;
    // Repaint the skin- and hair-bearing textures for the new tone/face/mane.
    const skinMat = this.bodyMats[BODY_MATERIAL_SLOTS.indexOf('skin')];
    const headMat = this.bodyMats[BODY_MATERIAL_SLOTS.indexOf('head')];
    const hairMat = this.armourMats.hair as THREE.MeshStandardMaterial;
    repaintCanvasTexture(skinMat.map as THREE.CanvasTexture, (ctx, w, h) => paintSkin(ctx, w, h, preset.skin, 7));
    repaintCanvasTexture(headMat.map as THREE.CanvasTexture, (ctx, w, h) => paintFaceSphere(ctx, w, h, preset));
    repaintCanvasTexture(hairMat.map as THREE.CanvasTexture, (ctx, w, h) => paintHair(ctx, w, h, preset.hairColor));
    this.applyPortraitPieces();
  }

  private applyPortraitPieces(): void {
    for (const p of this.portraitPieces) p.parent?.remove(p);
    this.portraitPieces = [];
    if (this.preset.helm) {
      this.attachArmour([buildHelmet(this.armourMats), buildCoif(this.armourMats)], true);
    } else {
      this.attachArmour([buildHair(this.armourMats, this.preset.hairStyle)], true);
    }
  }

  setEquipment(mainHand: WeaponId, offHand: WeaponId | null): void {
    for (const o of this.equipped) o.parent?.remove(o);
    this.equipped = [];
    this.sidearmStowed = false;
    this.mainHandId = mainHand;
    this.mainWeapon = this.equipItem(mainHand);
    if (offHand) this.equipItem(offHand);
    this.weaponSet = weaponSetForLoadout(mainHand, offHand);
    const idle = IDLE_FOR_WEAPON_SET[this.weaponSet];
    if (!this.oneShot) this.playLocomotion(idle);
  }

  private equipItem(id: WeaponId): THREE.Object3D {
    const def = ITEM_SOCKETS[id];
    const socket = this.sockets[def.socket];
    socket.position.set(...def.pos);
    socket.rotation.set(...def.rot);
    const weapon = buildWeapon(id, this.weaponMats);
    weapon.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    socket.add(weapon);
    if (id !== 'longbow' && id !== 'quiver') this.equipped.push(weapon);
    return weapon;
  }

  /**
   * Stow the main-hand sidearm at the left hip (blade down) or draw it back
   * to the fist. The wagon seat stows on sit and draws on stand; the motion
   * masks the swap, so no dedicated transition clip is needed.
   */
  setSidearmStowed(stowed: boolean): void {
    if (stowed === this.sidearmStowed || !this.mainWeapon) return;
    this.sidearmStowed = stowed;
    if (stowed) {
      const hip = this.sockets.hip;
      hip.position.set(0.2, -0.05, 0.02);
      hip.rotation.set(Math.PI, 0, 0);
      hip.add(this.mainWeapon);
    } else {
      const def = ITEM_SOCKETS[this.mainHandId];
      const socket = this.sockets[def.socket];
      socket.position.set(...def.pos);
      socket.rotation.set(...def.rot);
      socket.add(this.mainWeapon);
    }
  }

  /**
   * Preview-only prop swap for the archery flourish: the longbow leaves the
   * back for a dedicated left-fist grip (limbs vertical, string to the
   * archer) while the sidearm stows. Restored automatically when the shot
   * ends or is interrupted.
   */
  setBowDrawn(drawn: boolean): void {
    if (drawn === this.bowDrawn || !this.bowWeapon) return;
    this.bowDrawn = drawn;
    if (drawn) {
      this.setSidearmStowed(true);
      if (!this.bowGrip) {
        this.bowGrip = new THREE.Object3D();
        this.bowGrip.name = 'socket_bow_grip';
        this.rig.bones.HandL.add(this.bowGrip);
      }
      this.bowGrip.position.set(0, -0.05, 0.008);
      this.bowGrip.rotation.set(-Math.PI / 2, 0, 0);
      this.bowGrip.add(this.bowWeapon);
    } else {
      const def = ITEM_SOCKETS.longbow;
      const socket = this.sockets[def.socket];
      socket.position.set(...def.pos);
      socket.rotation.set(...def.rot);
      socket.add(this.bowWeapon);
      this.setSidearmStowed(false);
    }
  }

  private attachArmour(pieces: ArmourPiece[], portrait = false): void {
    for (const piece of pieces) {
      piece.object.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          const geo = o.geometry as THREE.BufferGeometry;
          const idx = geo.getIndex();
          this.triangles += Math.round((idx ? idx.count : geo.getAttribute('position').count) / 3);
        }
      });
      this.rig.bones[piece.bone].attach(piece.object);
      if (portrait) this.portraitPieces.push(piece.object);
    }
  }

  anchorPosition(name: SocketName, target: THREE.Vector3): THREE.Vector3 {
    return this.sockets[name].getWorldPosition(target);
  }

  // --- Animation ---

  /** Blend the locomotion layer (idle/walk/run weights sum to 1). */
  playLocomotion(name: ClipName, fade = 0.25): void {
    if (!CLIP_DEFS[name].loop) throw new Error(`locomotion clip must loop: ${name}`);
    this.loco = name;
    for (const [n, action] of this.actions) {
      if (!CLIP_DEFS[n].loop) continue;
      if (n === name) {
        action.enabled = true;
        action.setEffectiveWeight(1);
        if (!action.isRunning()) action.play();
        if (fade > 0) action.fadeIn(fade);
      } else {
        if (fade > 0 && action.isRunning()) action.fadeOut(fade);
        else action.stop();
      }
    }
  }

  /**
   * Play a one-shot over locomotion; resolves when it finishes. `hold`
   * clamps the last frame (sit/interact poses) until the next call.
   */
  playOneShot(name: ClipName, opts: { hold?: boolean; fade?: number } = {}): Promise<void> {
    const def = CLIP_DEFS[name];
    if (def.loop) throw new Error(`one-shot clip must not loop: ${name}`);
    const fade = opts.fade ?? 0.18;
    this.stopShot(0);
    if (name === 'bow_draw') this.setBowDrawn(true);
    this.oneShot = name;
    this.shotHold = opts.hold ?? false;
    const action = this.actions.get(name)!;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = this.shotHold;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.fadeIn(fade);
    action.play();
    // Duck the locomotion layer under the shot.
    const locoAction = this.actions.get(this.loco)!;
    locoAction.fadeOut(fade);
    this.oneShotTimer = def.duration;
    return new Promise(resolve => {
      const check = (): void => {
        if (this.oneShot !== name) {
          resolve();
          return;
        }
        if (this.oneShotTimer <= 0 && !this.shotHold) {
          this.stopShot(fade);
          resolve();
          return;
        }
        if (this.oneShotTimer <= 0 && this.shotHold) {
          resolve();
          return;
        }
        window.setTimeout(check, 50);
      };
      check();
    });
  }

  /** Freeze the mixer at an exact clip time (deterministic pose screenshots). */
  freezeAt(name: ClipName, time: number): void {
    this.stopShot(0);
    if (name === 'bow_draw') this.setBowDrawn(true);
    for (const [, action] of this.actions) action.stop();
    this.loco = CLIP_DEFS[name].loop ? name : 'idle';
    const action = this.actions.get(name)!;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    this.mixer.setTime(0);
    this.mixer.update(time);
    this.rig.group.updateMatrixWorld(true);
    this.rig.skeleton.update();
  }

  update(dt: number): void {
    if (this.oneShot) {
      this.oneShotTimer -= dt;
      if (this.oneShotTimer <= 0 && !this.shotHold) this.stopShot(0.25);
    }
    this.mixer.update(dt);
    this.rig.skeleton.update();
  }

  private stopShot(fade: number): void {
    if (this.bowDrawn) this.setBowDrawn(false);
    if (this.oneShot) {
      const action = this.actions.get(this.oneShot)!;
      if (fade > 0) action.fadeOut(fade);
      else action.stop();
      this.oneShot = null;
    }
    const locoAction = this.actions.get(this.loco)!;
    if (!locoAction.isRunning()) locoAction.play();
    locoAction.enabled = true;
    locoAction.setEffectiveWeight(1);
    if (fade > 0) locoAction.fadeIn(fade);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.SkinnedMesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats as THREE.MeshStandardMaterial[]) {
          for (const tex of [mat.map, mat.bumpMap]) {
            if (tex) tex.dispose();
          }
          mat.dispose();
        }
      }
    });
  }
}

/** Repaint a live canvas texture in place (portrait skin-tone swaps). */
function repaintCanvasTexture(
  tex: THREE.CanvasTexture,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): void {
  const canvas = tex.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  paint(ctx, canvas.width, canvas.height);
  tex.needsUpdate = true;
}
