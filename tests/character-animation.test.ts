import { describe, it, expect } from 'vitest';
import {
  AnimationStateMachine,
  ONESHOT_MS,
  type ClipPlayer,
} from '../src/character/AnimationStateMachine';
import { CLIP_DEFS, type ClipName } from '../src/character/skeletal/HeroClips';
import {
  loadoutFromCharacter,
  loadoutFromDraft,
  weaponSetFor,
} from '../src/character/EquipmentManager';
import { defaultCharacter, recommendedDraft } from '../src/game/character';

/** Recording ClipPlayer stand-in (no DOM, no GL, no timers). */
class FakePlayer implements ClipPlayer {
  loco: ClipName = 'idle';
  locoCalls: { name: ClipName; fade: number; rate: number }[] = [];
  shots: { name: ClipName; hold: boolean }[] = [];
  holdsReleased = 0;
  currentClip: ClipName = 'idle';
  isHeld = false;

  playLocomotion(name: ClipName, fade = 0.25, rate = 1): void {
    this.loco = name;
    this.locoCalls.push({ name, fade, rate });
    this.currentClip = name;
  }

  async playOneShot(name: ClipName, opts: { hold?: boolean; fade?: number } = {}): Promise<void> {
    this.shots.push({ name, hold: opts.hold ?? false });
    this.currentClip = name;
    this.isHeld = opts.hold ?? false;
  }

  releaseHold(): void {
    this.holdsReleased++;
    this.isHeld = false;
  }

  update(): void {}
}

const drive = () => {
  const player = new FakePlayer();
  return { player, anim: new AnimationStateMachine(player) };
};

describe('skeletal locomotion', () => {
  it('idles, walks, and runs by speed', () => {
    const { player, anim } = drive();
    anim.updateLocomotion({ speed: 0, sprint: false, seated: false });
    expect(player.loco).toBe('idle');
    anim.updateLocomotion({ speed: 2.2, sprint: false, seated: false });
    expect(player.loco).toBe('walk');
    anim.updateLocomotion({ speed: 4.7, sprint: true, seated: false });
    expect(player.loco).toBe('run');
  });

  it('scales the gait rate with speed', () => {
    const { player, anim } = drive();
    anim.updateLocomotion({ speed: 1.0, sprint: false, seated: false });
    const slow = player.locoCalls.at(-1)!;
    anim.updateLocomotion({ speed: 2.25, sprint: false, seated: false });
    const cruise = player.locoCalls.at(-1)!;
    expect(slow.rate).toBeLessThan(cruise.rate);
    expect(cruise.rate).toBeCloseTo(1, 2);
  });

  it('picks the idle stance from the weapon set', () => {
    const { player, anim } = drive();
    anim.setWeaponSet('dual');
    expect(anim.weaponSet).toBe('dual');
    anim.updateLocomotion({ speed: 0, sprint: false, seated: false });
    expect(player.loco).toBe('idle_dual');
    anim.setWeaponSet('bow');
    expect(player.loco).toBe('idle_bow');
  });

  it('sits and stands with the seat, holding the sit pose', async () => {
    const { player, anim } = drive();
    anim.updateLocomotion({ speed: 0, sprint: false, seated: true });
    expect(anim.seated).toBe(true);
    await Promise.resolve();
    expect(player.shots.at(-1)).toEqual({ name: 'long_rest_sit', hold: true });
    anim.updateLocomotion({ speed: 0, sprint: false, seated: false });
    expect(anim.seated).toBe(false);
    await Promise.resolve();
    expect(player.shots.at(-1)).toEqual({ name: 'stand_up', hold: false });
  });

  it('lets one-shots own the pose until they finish', async () => {
    const { player, anim } = drive();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    player.playOneShot = async (name: ClipName) => {
      player.shots.push({ name, hold: false });
      await gate;
    };
    const shot = anim.playOneShot('second_wind');
    anim.updateLocomotion({ speed: 4.7, sprint: true, seated: false });
    expect(player.loco).toBe('idle');
    expect(anim.activeShot).toBe('second_wind');
    release();
    await shot;
    expect(anim.activeShot).toBeNull();
    anim.updateLocomotion({ speed: 4.7, sprint: true, seated: false });
    expect(player.loco).toBe('run');
  });
});

describe('skeletal one-shots', () => {
  it('derives durations from the clip catalogue', () => {
    for (const [name, ms] of Object.entries(ONESHOT_MS)) {
      const clip = name === 'flourish' ? 'salute' : (name as ClipName);
      expect(ms).toBe(CLIP_DEFS[clip].duration * 1000);
    }
  });

  it('holds campfire sits and no-ops repeated sit/stand', async () => {
    const { player, anim } = drive();
    await anim.playOneShot('long_rest_sit');
    expect(anim.seated).toBe(true);
    expect(player.shots).toHaveLength(1);
    await anim.playOneShot('long_rest_sit');
    expect(player.shots).toHaveLength(1);
    await anim.playOneShot('stand_up');
    expect(anim.seated).toBe(false);
    await anim.playOneShot('stand_up');
    expect(player.shots).toHaveLength(2);
  });

  it('holds the interact kneel on request and releases it', async () => {
    const { player, anim } = drive();
    await anim.playOneShot('interact', { hold: true });
    expect(player.shots.at(-1)).toEqual({ name: 'interact', hold: true });
    anim.releaseHold();
    expect(player.holdsReleased).toBe(1);
  });

  it('rejects preview-only clips in gameplay but allows them in preview', async () => {
    const { anim } = drive();
    await expect(anim.playOneShot('flourish')).rejects.toThrow('preview-only');
    anim.allowPreview = true;
    await anim.playOneShot('flourish');
    expect(anim.activeShot).toBeNull();
  });
});

describe('equipment loadouts', () => {
  it('derives the socketed loadout from the hero record', () => {
    const loadout = loadoutFromCharacter(defaultCharacter());
    expect(loadout).toEqual({ preset: 'male_01', mainHand: 'longsword', offHand: 'shield' });
  });

  it('derives the socketed loadout from the draft, sanitising unknowns', () => {
    const draft = recommendedDraft();
    draft.mainHand = 'greataxe';
    draft.offHand = 'torch';
    const loadout = loadoutFromDraft(draft);
    expect(loadout.mainHand).toBe('longsword');
    expect(loadout.offHand).toBeNull();
  });

  it('selects animation sub-graphs by loadout', () => {
    expect(weaponSetFor('longsword', 'shield')).toBe('sword_shield');
    expect(weaponSetFor('longsword', 'shortsword')).toBe('dual');
    expect(weaponSetFor('longbow', null)).toBe('bow');
  });
});
