import { describe, expect, it } from 'vitest';
import { AMBUSHERS } from '../src/game/ambush';
import { encounterDifficulty } from '../src/game/bestiary';
import { defaultDraft, finalizeCharacter, withDefaultChoices, type ClassId } from '../src/game/character';
import { Encounter } from '../src/game/encounter';
import { applySoloProfile, baselineOf, soloProfile } from '../src/game/solo-balance';

const CLASSES: ClassId[] = ['fighter', 'wizard', 'rogue', 'cleric', 'ranger'];
const ambushXp = () => encounterDifficulty(AMBUSHERS.map(a => a.monsterId), 1, 1);

/** A scripted "average competent player": close, attack, heal when hurt. */
function playAmbush(classId: ClassId, seed: number, useSolo: boolean) {
  const sheet = finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Sim', classId }));
  const solo = soloProfile(1, ambushXp().adjusted, baselineOf(sheet));
  const hero = useSolo ? applySoloProfile(sheet, solo) : sheet;
  const e = new Encounter({ id: 'sim', seed, solo: useSolo ? solo : undefined });
  const h = e.addCharacter(hero, { x: 9.7, z: 3.2 });
  for (const a of AMBUSHERS) e.addMonster(a.monsterId, a.id, a.strike);
  e.start();

  let guard = 0;
  while (!e.finished && guard++ < 400) {
    if (e.isPlayerTurn) {
      const target = e.combatants
        .filter(c => c.side === 'enemy' && c.health.hp > 0 && !c.health.dead)
        .sort((a, b) => e.gapFeet(h, a) - e.gapFeet(h, b))[0];
      if (target) {
        if (h.health.hp < h.health.maxHp * 0.35 && h.budget.bonusAction) e.perform({ type: 'secondWind' });
        if (e.gapFeet(h, target) > 5) {
          const dx = target.position.x - h.position.x, dz = target.position.z - h.position.z;
          const d = Math.hypot(dx, dz) || 1;
          e.perform({ type: 'move', to: { x: target.position.x - dx / d * 1.2, z: target.position.z - dz / d * 1.2 } });
        }
        e.perform({ type: 'attack', targetId: target.id });
      }
      e.endTurn();
    } else if (e.active?.side === 'enemy') e.runEnemyTurn();
    else e.endTurn();
  }
  return { won: e.outcome === 'victory', rounds: e.round, finished: e.finished };
}

const winRate = (classId: ClassId, useSolo: boolean, trials = 120) => {
  let wins = 0;
  for (let t = 0; t < trials; t++) if (playAmbush(classId, t * 7919 + 13, useSolo).won) wins++;
  return wins / trials;
};

describe('solo balance', () => {
  it('confirms the printed encounter is unwinnable for a lone level-1 character', () => {
    // Four goblins is 200 XP raw, 400 adjusted; solo deadly at level 1 is 100.
    const { adjusted, tier } = ambushXp();
    expect(adjusted).toBe(400);
    expect(tier).toBe('deadly');
    // Without help, every class loses almost always. This is the bug the
    // balance layer exists to fix, so it is pinned here.
    for (const classId of CLASSES) expect(winRate(classId, false, 60)).toBeLessThan(0.2);
  });

  it('makes the ambush winnable but genuinely losable for every class', () => {
    for (const classId of CLASSES) {
      const rate = winRate(classId, true);
      expect(rate, `${classId} win rate ${rate}`).toBeGreaterThan(0.6);
      expect(rate, `${classId} win rate ${rate}`).toBeLessThan(0.95);
    }
  });

  it('keeps the classes within a fair band of each other', () => {
    const rates = CLASSES.map(c => winRate(c, true));
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(0.3);
  });

  it('always terminates rather than stalling', () => {
    for (const classId of CLASSES) {
      const run = playAmbush(classId, 4242, true);
      expect(run.finished).toBe(true);
      expect(run.rounds).toBeLessThan(40);
    }
  });

  it('scales the handicap down as the character grows', () => {
    const sheet = finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Sim' }));
    const early = soloProfile(1, 400, baselineOf(sheet));
    const later = soloProfile(6, 400, baselineOf({ ...sheet, level: 6, maxHp: 45 }));
    expect(later.bonusHp).toBeLessThan(early.bonusHp);
    expect(later.focusFireCap).toBeGreaterThanOrEqual(early.focusFireCap);
  });

  it('never writes the loaned hit points back onto the character sheet', () => {
    const sheet = finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Sim' }));
    const solo = soloProfile(1, 400, baselineOf(sheet));
    const buffed = applySoloProfile(sheet, solo);
    expect(buffed.maxHp).toBe(sheet.maxHp + solo.bonusHp);
    expect(sheet.maxHp).toBe(finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Sim' })).maxHp);
  });
});

describe('routing an enemy out of the fight', () => {
  it('ends the encounter when the last enemy flees instead of dying', () => {
    // Regression: the director used to mark the fleeing goblin dead by hand,
    // which never re-checked the win condition and left combat running with no
    // living enemies — an infinite "your turn" loop.
    const sheet = finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Sim' }));
    const e = new Encounter({ id: 'flee', seed: 99 });
    e.addCharacter(sheet, { x: 0, z: 0 });
    for (const a of AMBUSHERS) e.addMonster(a.monsterId, a.id, a.strike);
    e.start();

    const enemies = e.combatants.filter(c => c.side === 'enemy');
    for (const c of enemies.slice(0, 3)) c.health = { ...c.health, hp: 0, dead: true };
    expect(e.finished).toBe(false);

    const entries = e.withdraw(enemies[3].id, 'It runs.');
    expect(e.finished).toBe(true);
    expect(e.outcome).toBe('victory');
    expect(e.awardedXp).toBeGreaterThan(0);
    expect(entries.some(x => x.kind === 'victory')).toBe(true);
    // The one that ran is out of the fight, but it is not a corpse.
    expect(enemies[3].withdrawn).toBe(true);
  });

  it('is idempotent and safe to call twice', () => {
    const sheet = finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Sim' }));
    const e = new Encounter({ id: 'flee2', seed: 7 });
    e.addCharacter(sheet, { x: 0, z: 0 });
    const g = e.addMonster('goblin', 'g1', { x: 2, z: 0 });
    e.start();
    e.withdraw(g.id, 'It runs.');
    expect(e.withdraw(g.id, 'It runs again.')).toEqual([]);
  });
});
