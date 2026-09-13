import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_ONLY_CLIPS } from '../src/character/skeletal/HeroClips';
import { AnimationStateMachine as ASM, ONESHOT_CLIP } from '../src/character/AnimationStateMachine';
import { IDLE_FOR_WEAPON_SET } from '../src/character/skeletal/SkeletalHero';
import { gearFromCharacter, gearFromDraft, weaponSetFor } from '../src/character/EquipmentManager';
import { defaultCharacter, newDraft } from '../src/game/character';
import type { SkeletalHero } from '../src/character/skeletal/SkeletalHero';

/**
 * The state machine is tested against a duck-typed hero: no WebGL is needed
 * for the timing, seating, and locomotion decisions.
 */
function fakeHero() {
  const hero = {
    playOneShot: vi.fn(() => Promise.resolve()),
    playLocomotion: vi.fn(),
    update: vi.fn(),
    releaseShot: vi.fn(),
    setSidearmStowed: vi.fn(),
    shotProgress: () => null,
  };
  return hero as unknown as SkeletalHero;
}

/** A one-shot whose promise we resolve by hand. */
function pendingHero() {
  let resolveShot: () => void = () => {};
  const hero = fakeHero();
  hero.playOneShot = vi.fn(() => new Promise<void>(r => { resolveShot = r; }));
  return { hero, resolve: () => resolveShot() };
}

describe('skeletal animation state machine', () => {
  it('tracks the active one-shot and clears it when the clip elapses', async () => {
    const anim = new ASM(fakeHero());
    const done = anim.playOneShot('interact');
    expect(anim.activeShot).toBe('interact');
    await done;
    expect(anim.activeShot).toBeNull();
  });

  it('maps gameplay names to their authored clips, flourish included', () => {
    const { hero } = pendingHero();
    const anim = new ASM(hero);
    void anim.playOneShot('flourish');
    expect(hero.playOneShot).toHaveBeenCalledWith('salute', { hold: false });
    void anim.playOneShot('second_wind');
    expect(hero.playOneShot).toHaveBeenLastCalledWith('second_wind', { hold: false });
  });

  it('keeps held sits clamped until released', async () => {
    const { hero, resolve } = pendingHero();
    const anim = new ASM(hero);
    const done = anim.playOneShot('long_rest_sit');
    expect(anim.seated).toBe(true);
    resolve();
    await done;
    expect(anim.activeShot).toBe('long_rest_sit'); // still held
    anim.releaseHold();
    expect(anim.activeShot).toBeNull();
    expect(hero.releaseShot).toHaveBeenCalled();
  });

  it('sits when seated, and stands once the held sit is released', async () => {
    const { hero, resolve } = pendingHero();
    const anim = new ASM(hero);
    anim.updateLocomotion(0.016, 0, false, true, 'ground');
    expect(hero.playOneShot).toHaveBeenCalledWith('long_rest_sit', expect.objectContaining({ hold: true }));
    expect(anim.seated).toBe(true);
    expect(hero.setSidearmStowed).toHaveBeenCalledWith(false);
    resolve();
    await Promise.resolve();
    // The held sit keeps reporting; the seat release + hold release stand the hero up.
    anim.releaseHold();
    anim.updateLocomotion(0.016, 0, false, false, 'ground');
    expect(hero.playOneShot).toHaveBeenLastCalledWith('stand_up', expect.objectContaining({ hold: false }));
    expect(anim.seated).toBe(false);
  });

  it('steps the hero mixer every frame, even while held', () => {
    const { hero } = pendingHero();
    const anim = new ASM(hero);
    anim.updateLocomotion(0.016, 0, false, false, 'ground');
    anim.updateLocomotion(0.016, 0, false, false, 'ground');
    expect(hero.update).toHaveBeenCalledTimes(2);
  });

  it('selects the idle stance for the equipped weapon set', () => {
    const { hero } = pendingHero();
    const anim = new ASM(hero);
    anim.setWeaponSet('dual');
    expect(anim.weaponSet).toBe('dual');
    expect(hero.playLocomotion).toHaveBeenCalledWith(IDLE_FOR_WEAPON_SET.dual, 0.2);
    anim.setWeaponSet('bow');
    expect(hero.playLocomotion).toHaveBeenLastCalledWith(IDLE_FOR_WEAPON_SET.bow, 0.2);
  });

  it('blends locomotion by speed: idle, walk, run (sprint lowers the run threshold)', () => {
    const { hero } = pendingHero();
    const anim = new ASM(hero);
    const loco = () => vi.mocked(hero.playLocomotion).mock.calls.at(-1)?.[0];
    anim.updateLocomotion(0.016, 2.5, false, false, 'ground');
    expect(loco()).toBe('walk');
    anim.updateLocomotion(0.016, 4.2, false, false, 'ground');
    expect(loco()).toBe('run');
    anim.updateLocomotion(0.016, 2.0, true, false, 'ground');
    expect(loco()).toBe('run');
    anim.updateLocomotion(0.016, 0.1, false, false, 'ground');
    expect(loco()).toBe(IDLE_FOR_WEAPON_SET.sword_shield);
  });

  it('glows gold across the Second Wind one-shot', () => {
    const { hero } = pendingHero();
    const anim = new ASM(hero);
    expect(anim.secondWindGlow()).toBe(0);
    void anim.playOneShot('second_wind');
    hero.shotProgress = () => 0.25;
    expect(anim.secondWindGlow()).toBeCloseTo(0.7071, 3);
    hero.shotProgress = () => 0.5;
    expect(anim.secondWindGlow()).toBeCloseTo(1, 3);
  });

  it('only exposes gameplay-safe clips to the state machine (combat stays preview-only)', () => {
    for (const clip of Object.values(ONESHOT_CLIP)) {
      expect(PREVIEW_ONLY_CLIPS.has(clip), `${clip} must be playable in gameplay`).toBe(false);
    }
    for (const name of ['attack_slash_1h', 'hit_react', 'death'] as const) {
      expect(PREVIEW_ONLY_CLIPS.has(name), `${name} must stay preview-only`).toBe(true);
    }
  });
});

describe('equipment looks', () => {
  it('derives the skeletal gear from the hero record', () => {
    const gear = gearFromCharacter(defaultCharacter());
    expect(gear.preset).toBe('male_01');
    expect(gear.mainHand).toBe('longsword');
    expect(gear.offHand).toBe('shield');
  });
  it('normalises draft choices to rig-legal weapons', () => {
    const d = newDraft();
    d.mainHand = 'battleaxe'; d.offHand = 'shortsword'; d.portrait = 'female_02';
    expect(gearFromDraft(d)).toEqual({ preset: 'female_02', mainHand: 'battleaxe', offHand: 'shortsword' });
    d.offHand = null;
    expect(gearFromDraft(d).offHand).toBeNull();
  });
  it('selects animation sub-graphs by loadout', () => {
    expect(weaponSetFor('longsword', 'shield')).toBe('sword_shield');
    expect(weaponSetFor('longsword', 'shortsword')).toBe('dual');
    expect(weaponSetFor('battleaxe', 'shield')).toBe('sword_shield');
    expect(weaponSetFor('warhammer', null)).toBe('sword_shield');
  });
});
