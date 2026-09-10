import { describe, it, expect } from 'vitest';
import { defaultCharacter } from '../src/game/character';
import { InventoryStore, newJourney, validateSave } from '../src/game/save';

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
};

describe('save v2', () => {
  it('starts new journeys without a hero and nothing inspected', () => {
    const journey = newJourney();
    expect(journey.version).toBe(2);
    expect(journey.character).toBeNull();
    expect(journey.inspected).toEqual([]);
    expect(validateSave(journey)).toBe(true);
  });
  it('persists the hero record across reloads', () => {
    const storage = memoryStorage();
    const store = new InventoryStore(storage);
    const hero = defaultCharacter();
    hero.hp.current = 5;
    store.saveCharacter(hero);
    const reloaded = new InventoryStore(storage);
    expect(reloaded.getCharacter()?.hp.current).toBe(5);
    expect(reloaded.getCharacter()?.name).toBe(hero.name);
  });
  it('tracks inspected world items without bumping the revision note', () => {
    const store = new InventoryStore(memoryStorage());
    expect(store.isInspected('ransacked_belongings')).toBe(false);
    store.markInspected('ransacked_belongings');
    expect(store.isInspected('ransacked_belongings')).toBe(true);
  });
  it('migrates legacy v1 saves to v2', () => {
    const storage = memoryStorage();
    const legacy = { ...newJourney(), version: 1 };
    delete (legacy as Record<string, unknown>).character;
    delete (legacy as Record<string, unknown>).inspected;
    storage.setItem('astra-journey-v1', JSON.stringify(legacy));
    const store = new InventoryStore(storage);
    expect(store.recoveredInvalidSave).toBe(false);
    expect(store.snapshot().version).toBe(2);
    expect(store.getCharacter()).toBeNull();
  });
  it('rejects saves with an invalid hero record', () => {
    const journey = newJourney();
    journey.character = { ...defaultCharacter(), name: '' };
    expect(validateSave(journey)).toBe(false);
  });
});
