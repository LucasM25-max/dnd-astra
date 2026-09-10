import { describe, it, expect } from 'vitest';
import { CONTAINERS, ITEM_IDS, TOTAL_CARGO, INITIAL_CARGO_VALUE, emptyStock, initialCargo, valueOf, formatGp } from '../src/game/items';
import { InventoryStore, SAVE_KEY, newJourney, validateSave } from '../src/game/save';
const storage = () => {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
};
const unlocked = () => { const store = new InventoryStore(storage()); store.setArrived(); for (const c of CONTAINERS) store.open(c.id); return store; };
describe('the 100 gp consignment', () => {
  it('contains every requested item in the correct quantities', () => {
    expect(TOTAL_CARGO).toEqual({ flour: 12, pork: 4, ale: 2, shovel: 12, pick: 12, crowbar: 12, lantern: 5, oil: 50 });
    expect(INITIAL_CARGO_VALUE).toBe(10000);
    expect(Object.values(initialCargo()).reduce((sum, stock) => sum + valueOf(stock), 0)).toBe(10000);
  });
  it('shows fractions as decimal gold pieces and starts with no coins', () => {
    expect(formatGp(10)).toBe('0.10 gp'); expect(formatGp(60)).toBe('0.60 gp'); expect(formatGp(150)).toBe('1.5 gp'); expect(formatGp(10000)).toBe('100 gp');
    expect(new InventoryStore().gold).toBe(0);
  });
  it('locks cargo until control is handed back and the container is opened', () => {
    const store = new InventoryStore();
    expect(store.open('flour-a')).toBe(false); expect(store.take('flour-a', 'flour', 1)).toBe(false);
    store.setArrived(); expect(store.take('flour-a', 'flour', 1)).toBe(false);
    store.open('flour-a'); expect(store.take('flour-a', 'flour', 1)).toBe(true);
  });
  it('moves individual quantities without minting gold or changing total value', () => {
    const store = unlocked(); expect(store.take('flour-a', 'flour', 2)).toBe(true);
    expect(store.inventory.flour).toBe(2); expect(store.stock('flour-a').flour).toBe(4);
    expect(store.inventoryValue).toBe(100); expect(store.cargoValue).toBe(9900); expect(store.gold).toBe(0);
  });
  it('rejects negative, zero, fractional, NaN, and excessive quantities', () => {
    const store = unlocked();
    for (const amount of [-1, 0, .5, NaN, Infinity, 7]) expect(store.take('flour-a', 'flour', amount)).toBe(false);
    expect(store.inventory).toEqual(emptyStock());
  });
  it('can empty every container exactly once, conserving all items and 100 gp', () => {
    const store = unlocked();
    for (const c of CONTAINERS) { store.takeAll(c.id); expect(store.takeAll(c.id)).toEqual(emptyStock()); }
    expect(store.inventory).toEqual(TOTAL_CARGO); expect(store.inventoryValue).toBe(10000); expect(store.cargoValue).toBe(0); expect(store.gold).toBe(0);
  });
  it('persists partial looting, open lids, and positions together across reloads', () => {
    const disk = storage(), a = new InventoryStore(disk); a.setArrived(); a.open('oil'); a.take('oil', 'oil', 7);
    a.savePosition({ x: -1.85, z: 2.5, yaw: -1.2 }, { x: -2, z: 4, yaw: 0 }, false);
    const b = new InventoryStore(disk); expect(b.inventory.oil).toBe(7); expect(b.stock('oil').oil).toBe(43); expect(b.isOpen('oil')).toBe(true);
    expect(b.snapshot().mounted).toBe(false); expect(b.snapshot().player?.x).toBe(-2); expect(b.gold).toBe(0);
    expect(b.cargoValue + b.inventoryValue).toBe(10000);
  });
  it('preserves a recovery copy of invalid saved data', () => {
    const disk = storage(); disk.setItem(SAVE_KEY, 'not valid json'); const store = new InventoryStore(disk);
    expect(store.recoveredInvalidSave).toBe(true); expect(disk.getItem(`${SAVE_KEY}-recovery`)).toBe('not valid json');
    expect(store.cargoValue).toBe(10000);
  });
  it('rejects saved duplication, missing cargo, altered coins, and non-finite positions', () => {
    const save = newJourney(); expect(validateSave(save)).toBe(true);
    for (const id of ITEM_IDS) { const tampered = structuredClone(save); tampered.inventory[id] = 1; expect(validateSave(tampered)).toBe(false); }
    const coins = structuredClone(save); coins.gold = 10000; expect(validateSave(coins)).toBe(false);
    const coordinates = structuredClone(save); coordinates.player = { x: NaN, z: 0, yaw: 0 }; expect(validateSave(coordinates)).toBe(false);
  });
  it('continues in memory when browser storage is unavailable', () => {
    const store = new InventoryStore({ getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Quota'); } });
    store.setArrived(); store.open('lanterns'); expect(store.take('lanterns', 'lantern', 5)).toBe(true);
    expect(store.persistenceAvailable).toBe(false); expect(store.inventoryValue).toBe(300);
  });
});
describe('closeable containers', () => {
  it('closes an opened container, blocks further takes, and persists the closed lid', () => {
    const disk = storage();
    const a = new InventoryStore(disk); a.setArrived();
    a.open('flour-a'); expect(a.isOpen('flour-a')).toBe(true);
    expect(a.take('flour-a', 'flour', 1)).toBe(true);
    expect(a.close('flour-a')).toBe(true);
    expect(a.isOpen('flour-a')).toBe(false);
    expect(a.take('flour-a', 'flour', 1)).toBe(false);
    expect(a.close('flour-a')).toBe(false); // already closed is a no-op
    a.open('flour-a');
    const b = new InventoryStore(disk);
    expect(b.isOpen('flour-a')).toBe(true);
    expect(b.inventory.flour).toBe(1);
    expect(b.cargoValue + b.inventoryValue).toBe(10000);
  });
  it('still conserves all cargo when every container is opened, closed, then emptied', () => {
    const store = unlocked();
    for (const c of CONTAINERS) { store.close(c.id); expect(store.isOpen(c.id)).toBe(false); store.open(c.id); }
    for (const c of CONTAINERS) { store.takeAll(c.id); expect(store.takeAll(c.id)).toEqual(emptyStock()); }
    expect(store.inventory).toEqual(TOTAL_CARGO); expect(store.gold).toBe(0);
  });
});
