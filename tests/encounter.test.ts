/**
 * The Cragmaw ambush, played out headlessly.
 *
 * The browser integration suite has to render a full 3D scene between turns,
 * which makes it far too slow to run a fight more than once. These tests drive
 * the encounter engine directly instead, so a hundred fights finish in
 * milliseconds and the turn machinery can be checked properly: that no
 * combatant ever acts twice in a row, that every fight reaches a conclusion,
 * and that the numbers the log reports are the numbers the rules produced.
 */
import { describe, expect, it } from 'vitest';
import { Encounter, distanceFeet, type LogEntry } from '../src/game/encounter';
import { AMBUSHERS } from '../src/game/ambush';
import { soloProfile, baselineOf, applySoloProfile } from '../src/game/solo-balance';
import { finalizeCharacter, withDefaultChoices, defaultDraft, type CharacterSheet } from '../src/game/character';
import type { Cover, Vec2 } from '../src/game/encounter';

/** The ambush, as the director builds it, minus anything that needs a world. */
function buildFight(seed: number, sheet?: CharacterSheet) {
  const character = sheet ?? finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Mira' }));
  const solo = soloProfile(character.level, 400, baselineOf(character));
  const encounter = new Encounter({
    id: 'cragmaw-ambush',
    seed,
    // Open ground: no cover, no blocked lines, everywhere standable. The
    // ambush site is a clearing, so this matches the real fight closely enough
    // to exercise the AI's closing-and-swinging behaviour.
    heightAt: () => 0,
    lineOfSight: () => true,
    coverBetween: (): Cover => 'none',
    passable: () => true,
    solo,
  });
  const hero = encounter.addCharacter(applySoloProfile(character, solo), { x: 9.7, z: 3.4 }, 0);
  for (const spawn of AMBUSHERS) {
    const goblin = encounter.addMonster(spawn.monsterId, spawn.id, spawn.hide);
    goblin.name = spawn.name;
    goblin.facing = Math.atan2(hero.position.x - spawn.hide.x, hero.position.z - spawn.hide.z);
  }
  // The director springs the trap exactly this way: the goblins are marked
  // surprised-free and step from their hide to their strike position the
  // moment initiative is rolled, while the traveller usually is not so lucky.
  encounter.markSurprised([hero.id]);
  encounter.start();
  for (const spawn of AMBUSHERS) {
    const goblin = encounter.byId(spawn.id);
    if (goblin) goblin.position = { ...spawn.strike };
  }
  return encounter;
}

interface Played {
  rounds: number;
  turns: number;
  outcome: 'victory' | 'defeat' | null;
  /** Ids in the order they took a turn, for turn-order checks. */
  order: string[];
}

/**
 * Play a fight to its conclusion with a simple honest policy: on the hero's
 * turn, walk to the nearest enemy and hit it until nothing is left to spend.
 */
function playOut(encounter: Encounter, maxTurns = 400): Played {
  const order: string[] = [];
  let turns = 0;
  while (!encounter.finished && turns < maxTurns) {
    const active = encounter.active;
    if (!active) break;
    order.push(active.id);
    turns++;

    if (active.side === 'party') {
      // Close on the nearest goblin, then swing.
      const foes = encounter.living('enemy');
      const near = foes.slice().sort((a, b) => encounter.gapFeet(active, a) - encounter.gapFeet(active, b))[0];
      if (near) {
        const gap = encounter.gapFeet(active, near);
        if (gap > 5) {
          const dir = { x: near.position.x - active.position.x, z: near.position.z - active.position.z };
          const len = Math.hypot(dir.x, dir.z) || 1;
          const step = Math.min(gap - 4, active.budget.movement - active.budget.movementUsed);
          if (step > 0.1) {
            encounter.perform({ type: 'move', to: { x: active.position.x + dir.x / len * step, z: active.position.z + dir.z / len * step } });
          }
        }
        const again = encounter.living('enemy').slice().sort((a, b) => encounter.gapFeet(active, a) - encounter.gapFeet(active, b))[0];
        if (again && encounter.gapFeet(active, again) <= 5) encounter.perform({ type: 'attack', targetId: again.id });
      }
      if (!encounter.finished) encounter.endTurn();
    } else {
      encounter.runEnemyTurn();
      // runEnemyTurn ends the turn itself; the loop simply continues.
    }
  }
  return { rounds: encounter.round, turns, outcome: encounter.outcome, order };
}

describe('the Cragmaw ambush resolves', () => {
  it('finishes every time, across a hundred seeds', () => {
    const outcomes: Record<string, number> = { victory: 0, defeat: 0, stalled: 0 };
    let slowest = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const fight = buildFight(seed);
      const played = playOut(fight);
      if (played.outcome) outcomes[played.outcome]++;
      else outcomes.stalled++;
      slowest = Math.max(slowest, played.rounds);
    }
    expect(outcomes.stalled, `fights that never finished: ${JSON.stringify(outcomes)}`).toBe(0);
    // A fistful of goblins against one first-level character should be a real
    // fight, not a formality and not an execution. Both outcomes must occur.
    expect(outcomes.victory).toBeGreaterThan(0);
    expect(slowest).toBeLessThan(60);

    // The point of the exercise: the printed ambush is four times over the
    // solo "deadly" threshold, so it has to land as a real fight rather than
    // an execution or a procession. These bands are the measured result of the
    // declared solo handicap; a change to the profile has to move them on
    // purpose, not by accident.
    expect(outcomes.victory, `win rate ${outcomes.victory}%`).toBeGreaterThan(30);
    expect(outcomes.victory, `win rate ${outcomes.victory}%`).toBeLessThan(70);
    // Recorded so a balance change shows up as a number, not a surprise.
    console.log(`  100 ambushes: ${outcomes.victory} victories, ${outcomes.defeat} defeats, slowest ${slowest} rounds`);
  });

  it('never lets a combatant act twice in a row', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const fight = buildFight(seed);
      const played = playOut(fight);
      for (let i = 1; i < played.order.length; i++) {
        const previous = played.order[i - 1], current = played.order[i];
        if (previous !== current) continue;
        // The only legitimate repeat is when nobody else is left standing.
        const others = fight.combatants.filter(c => c.id !== current && c.health.hp > 0 && !c.health.dead);
        if (others.length === 0) continue;
        throw new Error(`seed ${seed}: ${current} took turn ${i} and ${i + 1} while ${others.length} others were still standing`);
      }
    }
  });

  it('gives the hero a turn once the surprise round has passed', () => {
    const fight = buildFight(7);
    const played = playOut(fight);
    const heroId = fight.combatants.find(c => c.side === 'party')!.id;
    // Surprised on round one, so the hero must still act on a later round.
    expect(played.order.filter(id => id === heroId).length).toBeGreaterThan(0);
  });
});

describe('what the log reports is what the rules rolled', () => {
  const attacksOf = (log: LogEntry[]) => log.filter(e => e.kind === 'attack' && e.attack).map(e => e.attack!);

  it('keeps every d20 in range and the total consistent', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const fight = buildFight(seed);
      playOut(fight);
      for (const a of attacksOf(fight.log)) {
        expect(a.d20.length).toBeGreaterThan(0);
        for (const die of a.d20) {
          expect(die, `d20 out of range: ${die}`).toBeGreaterThanOrEqual(1);
          expect(die).toBeLessThanOrEqual(20);
        }
        expect(a.d20).toContain(a.kept);
        expect(a.total).toBe(a.kept + a.modifier);
      }
    }
  });

  it('only deals damage on a hit, and never less than one', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const fight = buildFight(seed);
      playOut(fight);
      for (const a of attacksOf(fight.log)) {
        if (!a.hit) {
          expect(a.damage, `a miss dealt ${a.damage}: ${a.weapon}`).toBe(0);
          continue;
        }
        expect(a.damage, `a hit dealt no damage: ${a.weapon}`).toBeGreaterThan(0);
        // Damage is the sum of the dice plus the bonus, floored at one.
        const rolled = a.damageDice.reduce((s, d) => s + d, 0) + a.damageBonus;
        expect(a.damage).toBe(Math.max(1, rolled));
        for (const die of a.damageDice) expect(die).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('marks a natural 20 as a critical hit and a natural 1 as a miss', () => {
    const fight = buildFight(3);
    playOut(fight);
    for (const a of attacksOf(fight.log)) {
      if (a.kept === 20) expect(a.critical).toBe(true);
      if (a.kept === 1) expect(a.hit).toBe(false);
    }
  });
});

describe('the luck of the solo hero', () => {
  it('is only charged when the reroll actually turns a miss into a hit', () => {
    let rerolls = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const fight = buildFight(seed);
      const hero = fight.combatants.find(c => c.side === 'party')!;
      const declared = buildFight(seed) && (soloProfile(1, 400, baselineOf(finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Mira' }))))).luck;
      playOut(fight);
      for (let i = 0; i < fight.log.length; i++) {
        if (!/refuses the miss/.test(fight.log[i].text)) continue;
        rerolls++;
        // The attack entry is unshifted ahead of the reroll notice, so the
        // swing that justified the spend is the entry immediately before it.
        const swung = fight.log[i - 1];
        expect(swung, 'a reroll notice with no attack before it').toBeDefined();
        expect(swung.kind).toBe('attack');
        expect(swung.attack?.hit, `luck was spent on a swing that still missed (seed ${seed})`).toBe(true);
        expect(swung.actorId).toBe(hero.id);
      }
      // Never more rerolls than the character sheet promised.
      const spent = fight.log.filter(e => /refuses the miss/.test(e.text) && e.actorId === hero.id).length;
      expect(spent, `seed ${seed} spent ${spent} rerolls of ${declared}`).toBeLessThanOrEqual(declared);
    }
    expect(rerolls, 'luck never fired in sixty fights — the test proves nothing').toBeGreaterThan(0);
  });
});

describe('movement respects the budget', () => {
  it('never lets anyone walk further than their speed in a turn', () => {
    const fight = buildFight(11);
    let lastId = '';
    let start: Vec2 | null = null;
    const origin = new Map<string, Vec2>();
    const spent = new Map<string, number>();
    for (const c of fight.combatants) origin.set(c.id, { ...c.position });

    while (!fight.finished && fight.round < 12) {
      const active = fight.active;
      if (!active) break;
      if (active.id !== lastId) {
        lastId = active.id;
        origin.set(active.id, { ...active.position });
        spent.set(active.id, 0);
      }
      const from = origin.get(active.id)!;
      if (active.side === 'party') {
        const foe = fight.living('enemy')[0];
        if (foe) {
          const dir = { x: foe.position.x - active.position.x, z: foe.position.z - active.position.z };
          const len = Math.hypot(dir.x, dir.z) || 1;
          fight.perform({ type: 'move', to: { x: active.position.x + dir.x / len * 40, z: active.position.z + dir.z / len * 40 } });
        }
        if (!fight.finished) fight.endTurn();
      } else {
        fight.runEnemyTurn();
      }
      const walked = distanceFeet(from, active.position);
      // A dash or a goblin's Nimble Escape can add a move, so allow one extra
      // speed's worth; anything beyond that is a budget leak.
      expect(walked).toBeLessThanOrEqual(active.speed * 2 + 1);
    }
  });
});
