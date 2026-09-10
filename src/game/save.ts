import { validateCharacter, type PlayerCharacter } from './character';
import { CONTAINERS, ITEM_IDS, TOTAL_CARGO, emptyStock, initialCargo, valueOf, type ContainerId, type ItemId, type Stock } from './items';
export const SAVE_KEY = 'astra-journey-v1';
export interface PositionSave { x: number; z: number; yaw: number }
export interface TimeSave { month: number; day: number; minuteOfDay: number }
export interface JourneySave {
  version: 1 | 2; revision: number; gold: number; inventory: Stock; cargo: Record<ContainerId, Stock>;
  opened: ContainerId[]; arrived: boolean; mounted: boolean; wagon: PositionSave | null; player: PositionSave | null;
  time?: TimeSave | null; character: PlayerCharacter | null; inspected: string[];
}
export function newJourney(): JourneySave {
  return { version: 2, revision: 0, gold: 0, inventory: emptyStock(), cargo: initialCargo(), opened: [], arrived: false, mounted: true, wagon: null, player: null, time: null, character: null, inspected: [] };
}
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
function validPosition(v: unknown): v is PositionSave | null {
  return v === null || (isObject(v) && ['x', 'z', 'yaw'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k])) && Math.abs(Number(v.x)) <= 80 && Math.abs(Number(v.z)) <= 80 && Math.abs(Number(v.yaw)) < 1e6);
}
function validTime(v: unknown): v is TimeSave | null {
  if (v === null) return true;
  if (!isObject(v)) return false;
  const month = Number(v.month), day = Number(v.day), minuteOfDay = Number(v.minuteOfDay);
  return Number.isInteger(month) && month >= 0 && month < 12 && Number.isInteger(day) && day >= 1 && day <= 30 && Number.isInteger(minuteOfDay) && minuteOfDay >= 0 && minuteOfDay < 1440;
}
export function validateSave(v: unknown): v is JourneySave {
  if (!isObject(v) || (v.version !== 1 && v.version !== 2) || !integer(v.revision) || !integer(v.gold) || Number(v.gold) > 1e9 || typeof v.arrived !== 'boolean' || typeof v.mounted !== 'boolean') return false;
  if (!isObject(v.inventory) || !isObject(v.cargo) || !Array.isArray(v.opened) || !validPosition(v.wagon) || !validPosition(v.player)) return false;
  if ('time' in v && !validTime(v.time)) return false;
  if ('character' in v && v.character !== null && !validateCharacter(v.character)) return false;
  if ('inspected' in v && (!Array.isArray(v.inspected) || !v.inspected.every(s => typeof s === 'string' && s.length < 64))) return false;
  if (!v.opened.every(id => CONTAINERS.some(c => c.id === id)) || new Set(v.opened).size !== v.opened.length) return false;
  for (const id of ITEM_IDS) {
    if (!integer(v.inventory[id])) return false;
    let total = Number(v.inventory[id]);
    for (const c of CONTAINERS) {
      const stock = v.cargo[c.id];
      if (!isObject(stock) || !integer(stock[id]) || Number(stock[id]) > initialCargo()[c.id][id]) return false;
      total += Number(stock[id]);
    }
    if (total !== TOTAL_CARGO[id]) return false;
  }
  // There is no implemented payout or shop yet; consignment value never becomes coins.
  if (v.gold !== 0) return false;
  return true;
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export class InventoryStore {
  private data: JourneySave;
  persistenceAvailable = true;
  recoveredInvalidSave = false;
  onChange = () => {};
  constructor(private storage?: StorageLike) {
    this.data = newJourney(); this.persistenceAvailable = !!storage;
    try {
      const text = storage?.getItem(SAVE_KEY);
      if (text) {
        let candidate: unknown;
        try { candidate = JSON.parse(text); } catch { candidate = null; }
        if (validateSave(candidate)) {
          this.data = candidate;
          if (this.data.version === 1) {
            // Migrate legacy saves: no hero yet, nothing inspected.
            this.data.version = 2;
            this.data.character = null;
            this.data.inspected = [];
          }
          if (!this.data.inspected) this.data.inspected = [];
          if (this.data.character === undefined) this.data.character = null;
        }
        else { this.recoveredInvalidSave = true; storage?.setItem(`${SAVE_KEY}-recovery`, text); }
      }
    } catch { this.persistenceAvailable = false; }
  }
  snapshot(): JourneySave { return structuredClone(this.data); }
  get inventory() { return { ...this.data.inventory }; }
  get revision() { return this.data.revision; }
  get gold() { return this.data.gold; }
  get arrived() { return this.data.arrived; }
  stock(container: ContainerId): Stock { return { ...this.data.cargo[container] }; }
  isOpen(container: ContainerId) { return this.data.opened.includes(container); }
  get inventoryValue() { return valueOf(this.data.inventory); }
  get cargoValue() { return CONTAINERS.reduce((n, c) => n + valueOf(this.data.cargo[c.id]), 0); }
  /** Live hero record (mutate then call saveCharacter). Null until forged. */
  getCharacter(): PlayerCharacter | null { return this.data.character; }
  saveCharacter(c: PlayerCharacter) { this.data.character = structuredClone(c); this.persist(); }
  isInspected(id: string) { return this.data.inspected.includes(id); }
  markInspected(id: string) {
    if (this.data.inspected.includes(id)) return;
    this.data.inspected.push(id); this.persist(false);
  }
  open(container: ContainerId) {
    if (!CONTAINERS.some(c => c.id === container) || !this.data.arrived) return false;
    if (!this.isOpen(container)) { this.data.opened.push(container); this.persist(); }
    return true;
  }
  close(container: ContainerId) {
    if (!CONTAINERS.some(c => c.id === container) || !this.isOpen(container)) return false;
    this.data.opened = this.data.opened.filter(id => id !== container); this.persist();
    return true;
  }
  take(container: ContainerId, item: ItemId, amount: number) {
    if (!this.data.arrived || !this.isOpen(container) || !ITEM_IDS.includes(item) || !Number.isSafeInteger(amount) || amount <= 0) return false;
    const source = this.data.cargo[container];
    if (!source || source[item] < amount) return false;
    source[item] -= amount; this.data.inventory[item] += amount; this.persist(); return true;
  }
  takeAll(container: ContainerId): Stock {
    const moved = emptyStock();
    if (!this.data.arrived || !this.isOpen(container)) return moved;
    const source = this.data.cargo[container];
    if (!source) return moved;
    for (const id of ITEM_IDS) { moved[id] = source[id]; this.data.inventory[id] += source[id]; source[id] = 0; }
    this.persist(); return moved;
  }
  setArrived() { if (!this.data.arrived) { this.data.arrived = true; this.persist(); } }
  savePosition(wagon: PositionSave, player: PositionSave, mounted: boolean) {
    if (!this.data.arrived || !validPosition(wagon) || !validPosition(player)) return;
    this.data.wagon = { ...wagon }; this.data.player = { ...player }; this.data.mounted = mounted; this.persist(false);
  }
  saveTime(t: TimeSave) {
    if (!this.data.arrived || !validTime(t)) return;
    this.data.time = { ...t }; this.persist(false);
  }
  private persist(notify = true) {
    this.data.revision++;
    try { this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch { this.persistenceAvailable = false; }
    if (notify) this.onChange();
  }
}
