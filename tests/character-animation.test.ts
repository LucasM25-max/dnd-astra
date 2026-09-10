import { describe, it, expect } from 'vitest';
import { AnimationStateMachine, ONESHOT_MS } from '../src/character/AnimationStateMachine';
import { lookFromCharacter, weaponSetFor } from '../src/character/EquipmentManager';
import { defaultCharacter } from '../src/game/character';

describe('animation state machine', () => {
  it('dips the root during interact and recovers after', () => {
    const anim = new AnimationStateMachine();
    anim.playOneShot('interact', 1000);
    const mid = anim.update(1000 + ONESHOT_MS.interact / 2);
    expect(mid.dip).toBeLessThan(-0.1);
    const end = anim.update(1000 + ONESHOT_MS.interact + 50);
    expect(end.dip).toBe(0);
    expect(anim.activeShot).toBeNull();
  });
  it('glows gold during Second Wind', () => {
    const anim = new AnimationStateMachine();
    anim.playOneShot('second_wind', 500);
    expect(anim.update(500 + ONESHOT_MS.second_wind / 2).glow).toBeGreaterThan(0.5);
  });
  it('holds a seated pose between sit and stand', () => {
    const anim = new AnimationStateMachine();
    anim.playOneShot('long_rest_sit', 0);
    expect(anim.seated).toBe(true);
    expect(anim.update(ONESHOT_MS.long_rest_sit + 10).dip).toBeCloseTo(-0.34, 2);
    anim.playOneShot('stand_up', 2000);
    expect(anim.seated).toBe(false);
    expect(anim.update(2000 + ONESHOT_MS.stand_up + 10).dip).toBe(0);
  });
  it('tracks the weapon set', () => {
    const anim = new AnimationStateMachine();
    anim.setWeaponSet('dual');
    expect(anim.weaponSet).toBe('dual');
  });
});

describe('equipment looks', () => {
  it('derives the painted look from the hero record', () => {
    const c = defaultCharacter();
    const look = lookFromCharacter(c);
    expect(look.mainHand).toBe('longsword');
    expect(look.offHand).toBe('shield');
    expect(look.bow).toBe(true);
    expect(look.helm).toBe(true);
  });
  it('selects animation sub-graphs by loadout', () => {
    expect(weaponSetFor('longsword', 'shield')).toBe('sword_shield');
    expect(weaponSetFor('longsword', 'shortsword')).toBe('dual');
    expect(weaponSetFor('longbow', null)).toBe('bow');
  });
});
