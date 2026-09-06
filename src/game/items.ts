// All prices are exact hundredths of a gold piece. No floating-point money.
// These are this consignment's fixed sale appraisals, not claims about SRD shop prices.
export const ITEMS = {
  flour: { name: 'Sack of flour', plural: 'sacks of flour', category: 'provisions', unitValue: 50, icon: 'wheat', description: 'A stout linen sack of finely milled flour, sewn shut against the dust of the road.' },
  pork: { name: 'Cask of salted pork', plural: 'casks of salted pork', category: 'provisions', unitValue: 200, icon: 'barrel', description: 'Pork preserved in salt and brine, packed into a coopered oak cask.' },
  ale: { name: 'Keg of strong ale', plural: 'kegs of strong ale', category: 'provisions', unitValue: 300, icon: 'beer', description: 'A tightly bunged keg of strong ale. A welcome provision after a day in the mines.' },
  shovel: { name: 'Shovel', plural: 'shovels', category: 'tools', unitValue: 200, icon: 'shovel', description: 'A broad iron spade on an ash handle, made for moving earth and rubble.' },
  pick: { name: 'Mining pick', plural: 'mining picks', category: 'tools', unitValue: 200, icon: 'pickaxe', description: 'A double-ended forged pick on a hardwood haft. Well balanced and ready for stone.' },
  crowbar: { name: 'Crowbar', plural: 'crowbars', category: 'tools', unitValue: 200, icon: 'wrench', description: 'A solid iron pry bar with a flattened, hooked end.' },
  lantern: { name: 'Field lantern', plural: 'field lanterns', category: 'equipment', unitValue: 60, icon: 'lamp', description: 'A simple, well-used iron-and-glass oil lantern. Stored with its wick unlit.' },
  oil: { name: 'Lantern oil', plural: 'flask measures of lantern oil', category: 'equipment', unitValue: 10, icon: 'droplet', description: 'One flask measure of lamp oil, drawn from the small supply barrel. The full barrel holds fifty measures.' },
} as const;
export type ItemId = keyof typeof ITEMS;
export type ItemCategory = typeof ITEMS[ItemId]['category'];
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export type Stock = Record<ItemId, number>;
export const emptyStock = (): Stock => Object.fromEntries(ITEM_IDS.map(id => [id, 0])) as Stock;
export const CONTAINERS = [
  { id: 'flour-a', name: 'Flour crate · I', kind: 'crate', subtitle: 'Dry provisions · six sewn sacks', stock: { flour: 6 } },
  { id: 'flour-b', name: 'Flour crate · II', kind: 'crate', subtitle: 'Dry provisions · six sewn sacks', stock: { flour: 6 } },
  { id: 'provisions', name: 'The provision rack', kind: 'rack', subtitle: 'Four casks of pork · two kegs of ale', stock: { pork: 4, ale: 2 } },
  { id: 'tools', name: 'The mining chest', kind: 'chest', subtitle: 'A dozen each · shovels, picks & crowbars', stock: { shovel: 12, pick: 12, crowbar: 12 } },
  { id: 'lanterns', name: 'The lantern case', kind: 'case', subtitle: 'Five field lanterns · carefully packed', stock: { lantern: 5 } },
  { id: 'oil', name: 'The oil barrel', kind: 'barrel', subtitle: 'Fifty flask measures · keep away from flame', stock: { oil: 50 } },
] as const;
export type ContainerId = typeof CONTAINERS[number]['id'];
export function initialCargo(): Record<ContainerId, Stock> {
  return Object.fromEntries(CONTAINERS.map(c => [c.id, { ...emptyStock(), ...c.stock }])) as Record<ContainerId, Stock>;
}
export const TOTAL_CARGO = CONTAINERS.reduce((stock, c) => {
  for (const [id, amount] of Object.entries(c.stock)) stock[id as ItemId] += amount;
  return stock;
}, emptyStock());
export const valueOf = (stock: Stock) => ITEM_IDS.reduce((total, id) => total + stock[id] * ITEMS[id].unitValue, 0);
export const countOf = (stock: Stock) => ITEM_IDS.reduce((n, id) => n + stock[id], 0);
export const INITIAL_CARGO_VALUE = valueOf(TOTAL_CARGO); // Exactly 10,000 hundredths = 100 gp.
export function formatGp(hundredths: number, suffix = true) {
  const amount = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, minimumFractionDigits: hundredths > 0 && hundredths < 100 ? 2 : 0 }).format(hundredths / 100);
  return `${amount}${suffix ? ' gp' : ''}`;
}
export function containerById(id: string) { return CONTAINERS.find(c => c.id === id); }
