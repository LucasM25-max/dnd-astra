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
import { buildScabbard, buildWeapon, type WeaponId, type WeaponMats } from './HeroWeapons';
import { buildClips, CLIP_DEFS, type ClipName } from './HeroClips';

/**
 * The assembled skeletal hero: one SkinnedMesh body (smooth joints, per-part
 * textures), rigid armour parented to bones, weapons on named bone sockets,
 * and a mixer playing the procedural clip catalogue.
 *
 * The rig is authored facing +Z, but the avatar world convention is
 * `rotation.y = yaw` where forward travel is (−sin θ, −cos θ) — a model
 * facing −Z. So the whole assembly rotates π about Y at build (before
 * binding, so skinning, armour attaches, sockets, and clip pose space all
 * stay consistent) and the hero faces the way it walks, sits, and looks.
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

/**
 * Per-item socket frames. `socket` names the fixed anchor on the body;
 * local pos/rot orient the item in that anchor (bind space, radians).
 * Tuned against screenshots. The longsword's guard rotation presents the
 * blade forward over the fist instead of laying it along the forearm.
 */
interface ItemFrame { socket: SocketName; pos: [number, number, number]; rot: [number, number, number] }

const WIELD_FRAMES: Record<WeaponId, ItemFrame> = {
  longsword: { socket: 'mainhand', pos: [0, 0, 0], rot: [0.42, 0, -0.1] },
  battleaxe: { socket: 'mainhand', pos: [0, 0, 0], rot: [0.32, 0, -0.08] },
  warhammer: { socket: 'mainhand', pos: [0, 0, 0], rot: [0.32, 0, -0.08] },
  shortsword: { socket: 'offhand', pos: [0, 0, 0], rot: [0.36, 0, 0.1] },
  shield: { socket: 'offhand', pos: [0.045, -0.005, 0], rot: [0, Math.PI / 2, 0] },
  longbow: { socket: 'back', pos: [0.15, 0.14, -0.17], rot: [-0.1, -0.1, 0.72] },
  quiver: { socket: 'quiver', pos: [-0.17, 0.05, -0.13], rot: [-0.3, 0, 0.15] },
};

/**
 * Where each item rides while exploring (not in combat). The scabbard and
 * sheath hang from the belt bone so they sway with the torso like the mail
 * does; heavy axes and hammers sling across the back on the opposite
 * diagonal to the bow. Items without a stow route just stay put.
 */
type StowRoute = 'scabbard' | 'daggerSheath' | 'backCarry' | null;
const STOW_ROUTES: Record<WeaponId, StowRoute> = {
  longsword: 'scabbard',
  shortsword: 'daggerSheath',
  battleaxe: 'backCarry',
  warhammer: 'backCarry',
  shield: null,
  longbow: null,
  quiver: null,
};

const SOCKET_BONES: Record<SocketName, BoneName> = {
  mainhand: 'HandR',
  offhand: 'HandL',
  back: 'Chest',
  hip: 'Hips',
  quiver: 'Hips',
};

/** Fixed fist frames — the reins and glove anchors read these positions. */
const FIST_FRAME: [number, number, number] = [0, -0.05, 0.008];

export const IDLE_FOR_WEAPON_SET: Record<WeaponSet, ClipName> = {
  sword_shield: 'idle',
  two_hand: 'idle',
  dual: 'idle_dual',
  bow: 'idle_bow',
  unarmed: 'idle_bow',
};

/** Standing guard while steel is in hand (drawn state overrides the idle). */
export const DRAWN_IDLE: ClipName = 'idle_drawn';

/** Bone-local frames for the back-carried long weapons (Chest bone space). */
const BACK_CARRY_FRAME = { pos: [-0.02, 0.13, -0.235] as [number, number, number], rot: [0.05, 0, -0.6] as [number, number, number], item: [0, 0.4, 0] as [number, number, number] };

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
  private bowWeapon: THREE.Object3D | null = null;
  private bowDrawn = false;
  private bowGrip: THREE.Object3D | null = null;
  /** False while steel is in hand (combat); true = riding its stow mount. */
  private stowed = true;
  /** wield/stow anchor pairs per equipped weapon (rebuilt on setEquipment). */
  private mounts = new Map<THREE.Object3D, { wield: THREE.Object3D; stow: THREE.Object3D | null }>();
  private sheathRig: { scabbard?: THREE.Object3D; dagger?: THREE.Object3D; backCarry?: THREE.Object3D; extra: THREE.Object3D[] } | null = null;

  constructor(opts: SkeletalHeroOptions) {
    this.root.name = 'SkeletalHero';
    this.preset = opts.preset ?? portraitDef('male_01');
    const factory = opts.canvasFactory;

    // Rig + skinned body. The assembly is squared to the avatar convention
    // (hero faces −Z, see class doc) before any bone-relative attachment so
    // bind matrices, armour attaches, and socket chains all bake the flip.
    this.root.rotation.y = Math.PI;
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
    // 512 sheets on the close-read armour (mail, plate, leather, blade):
    // the third-person camera sits 2.5–7 m out and the mail rings used to
    // turn to mush past a few metres.
    const mailTex = canvasTexture(factory, 512, 512, ctx => paintMail(ctx, 512, 512));
    const plateTex = canvasTexture(factory, 512, 512, ctx => paintPlate(ctx, 512, 512));
    const leatherTex = canvasTexture(factory, 512, 512, ctx => paintLeather(ctx, 512, 512));
    const bladeTex = canvasTexture(factory, 256, 512, ctx => paintBlade(ctx, 256, 512));
    const woodTex = canvasTexture(factory, 256, 256, ctx => paintWood(ctx, 256, 256));
    const bowTex = canvasTexture(factory, 256, 256, ctx => paintWood(ctx, 256, 256, '#7a4e28', 43));
    const shieldTex = canvasTexture(factory, 512, 512, ctx => paintShieldFace(ctx, 512, 512));
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

    // Bone sockets. The fist frames are fixed (reins and glove anchors read
    // them); weapon orientation lives in the per-item mount anchors below.
    for (const [name, bone] of Object.entries(SOCKET_BONES) as [SocketName, BoneName][]) {
      const socket = new THREE.Object3D();
      socket.name = `socket_${name}`;
      if (name === 'mainhand' || name === 'offhand') socket.position.set(...FIST_FRAME);
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
    this.mounts.clear();
    this.clearSheathRig();
    // Sheaths first: the scabbard rides on the belt bone so its mouth frame
    // exists before the blade docks into it.
    this.buildSheathRig(mainHand, offHand);
    this.equipItem(mainHand);
    if (offHand) this.equipItem(offHand);
    this.weaponSet = weaponSetForLoadout(mainHand, offHand);
    const idle = IDLE_FOR_WEAPON_SET[this.weaponSet];
    if (!this.oneShot) this.playLocomotion(idle);
  }

  /** Build the scabbard / dagger sheath / back sling this loadout stows to. */
  private buildSheathRig(mainHand: WeaponId, offHand: WeaponId | null): void {
    const rig: NonNullable<typeof this.sheathRig> = { extra: [] };
    const chest = this.rig.bones.Chest;
    // The waist kit (belt, scabbards) rides the Hips bone so it tracks the
    // pelvis; the back sling rides the chest. Hips bind (0, 0.98, 0.02),
    // chest bind (0, 1.32, 0) — the offsets below are the same bind
    // positions expressed in Hips bone space.
    const hips = this.rig.bones.Hips;
    if (mainHand === 'longsword') {
      const { object, mouth } = buildScabbard(this.weaponMats, { length: 0.95, width: 0.075 });
      object.name = 'swordScabbard';
      object.position.set(0.262, 0.09, 0);
      object.rotation.set(0.34, 0, 0.13); // hilt forward, mouth out past the skirt
      hips.add(object);
      rig.scabbard = mouth;
      rig.extra.push(object);
    }
    if (offHand === 'shortsword') {
      const { object, mouth } = buildScabbard(this.weaponMats, { length: 0.5, width: 0.058 });
      object.name = 'daggerSheath';
      object.position.set(-0.252, 0.082, 0.03);
      object.rotation.set(0.38, 0, -0.2);
      hips.add(object);
      rig.dagger = mouth;
      rig.extra.push(object);
    }
    if (mainHand === 'battleaxe' || mainHand === 'warhammer') {
      const sling = new THREE.Object3D();
      sling.name = 'backCarry';
      sling.position.set(...BACK_CARRY_FRAME.pos);
      sling.rotation.set(...BACK_CARRY_FRAME.rot);
      chest.add(sling);
      rig.backCarry = sling;
      rig.extra.push(sling);
    }
    this.sheathRig = rig;
  }

  private clearSheathRig(): void {
    if (!this.sheathRig) return;
    for (const o of this.sheathRig.extra) o.parent?.remove(o);
    this.sheathRig = null;
  }

  private equipItem(id: WeaponId): THREE.Object3D {
    const def = WIELD_FRAMES[id];
    const weapon = buildWeapon(id, this.weaponMats);
    weapon.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const wield = new THREE.Object3D();
    wield.name = `${id}_wield`;
    wield.position.set(...def.pos);
    wield.rotation.set(...def.rot);
    // The longbow's carry frame is its wield frame (it lives on the back
    // either way); the draw pose swaps it through setBowDrawn.
    const wieldParent = this.sockets[def.socket];
    wieldParent.add(wield);
    let stow: THREE.Object3D | null = null;
    const route = STOW_ROUTES[id];
    if (route === 'scabbard' && this.sheathRig?.scabbard) {
      stow = new THREE.Object3D();
      stow.position.set(0, 0.115, 0.01);
      stow.rotation.set(Math.PI, 0, 0); // blade down into the throat, hilt proud
      this.sheathRig.scabbard.add(stow);
    } else if (route === 'daggerSheath' && this.sheathRig?.dagger) {
      stow = new THREE.Object3D();
      stow.position.set(0, 0.07, 0.01);
      stow.rotation.set(Math.PI, 0, 0);
      this.sheathRig.dagger.add(stow);
    } else if (route === 'backCarry' && this.sheathRig?.backCarry) {
      stow = new THREE.Object3D();
      stow.position.set(...BACK_CARRY_FRAME.item);
      this.sheathRig.backCarry.add(stow);
    }
    (stow ?? wield).add(weapon);
    this.mounts.set(weapon, { wield, stow });
    if (id !== 'longbow' && id !== 'quiver') this.equipped.push(weapon);
    return weapon;
  }

  /** True while every stowable item rides its sheath (exploration state). */
  get itemsStowed(): boolean {
    return this.stowed;
  }

  /**
   * Stow or draw the equipped steel. Exploration keeps the longsword in its
   * scabbard (nothing runs along the forearm); combat takes it in hand with
   * the guard rotation. Swap is instant — callers bracket it with the
   * draw / sheathe clips.
   */
  setStowed(stowed: boolean): void {
    if (stowed === this.stowed) return;
    this.stowed = stowed;
    for (const [item, mounts] of this.mounts) {
      const frame = stowed && mounts.stow ? mounts.stow : mounts.wield;
      frame.add(item);
    }
  }

  /**
   * Preview-only prop swap for the archery flourish: the longbow leaves the
   * back for a dedicated left-fist grip (limbs vertical, string to the
   * archer). Restored automatically when the shot ends or is interrupted.
   */
  setBowDrawn(drawn: boolean): void {
    if (drawn === this.bowDrawn || !this.bowWeapon) return;
    this.bowDrawn = drawn;
    if (drawn) {
      if (!this.bowGrip) {
        this.bowGrip = new THREE.Object3D();
        this.bowGrip.name = 'socket_bow_grip';
        this.rig.bones.HandL.add(this.bowGrip);
      }
      this.bowGrip.position.set(0, -0.05, 0.008);
      this.bowGrip.rotation.set(-Math.PI / 2, 0, 0);
      this.bowGrip.add(this.bowWeapon);
    } else {
      this.mounts.get(this.bowWeapon)?.wield.add(this.bowWeapon);
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
      // Pieces are authored in absolute bind-space coordinates (the same
      // space the skinned body uses), so parent them to the bone with a
      // pure bind-relative offset — no rotation, no world-matrix baking.
      // (three's Object3D.attach() preserves the object's current world
      // transform; these pieces are unattached, so it would bake in the
      // inverse of the bone's world matrix — including the root's π flip —
      // and render every group piece backwards and crossed to the
      // opposite limb.)
      piece.object.updateMatrix();
      const bind = this.rig.bindPos[piece.bone];
      piece.object.matrix.premultiply(new THREE.Matrix4().makeTranslation(-bind.x, -bind.y, -bind.z));
      piece.object.matrix.decompose(piece.object.position, piece.object.quaternion, piece.object.scale);
      this.rig.bones[piece.bone].add(piece.object);
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
