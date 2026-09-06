import type { WoodlandWorld, WorldState } from '../engine/world';
import { isFormControl } from '../engine/controller';
import { CONTAINERS, ITEMS, ITEM_IDS, countOf, formatGp, valueOf, type ContainerId, type ItemId } from '../game/items';
import { NARRATION } from '../game/narrator';

export type AdventureDialog = 'inventory' | 'cargo' | 'manifest' | 'journal';
interface Hooks {
  open: (kind: AdventureDialog) => void; close: () => void; current: () => string | null;
  toast: (message: string) => void; icons: () => void;
}
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const close = `<button class="icon-button dialog-close" data-action="close" aria-label="Close dialog">${icon('x')}</button>`;
const categories = { all: 'All items', provisions: 'Provisions', tools: 'Tools', equipment: 'Equipment' };

export class AdventureInterface {
  activeCargo: ContainerId = 'flour-a';
  private selected: ItemId | null = null;
  private filter: keyof typeof categories = 'all';
  private search = '';
  private quantities = Object.fromEntries(ITEM_IDS.map(id => [id, 1])) as Record<ItemId, number>;
  private lastLine = -2;
  private lastPaused: boolean | null = null;
  private lastVoice: boolean | null = null;
  private lastRevision = -1;
  private lastPhase = '';
  private lastMounted: boolean | null = null;
  private abort = new AbortController();
  constructor(private world: WoodlandWorld, private hooks: Hooks) {
    const opts = { signal: this.abort.signal };
    const click = (selector: string, fn: () => void) => $(selector).addEventListener('click', fn, opts);
    click('#inventory-toggle', () => hooks.open('inventory'));
    click('#journal-toggle', () => hooks.open('journal'));
    click('#journey-skip', () => world.adventure.narrator.skipJourney());
    click('#mount-toggle', () => this.toggleMounted());
    click('#narrator-pause', () => world.adventure.narrator.togglePause());
    click('#narrator-next', () => world.adventure.narrator.next());
    click('#narrator-repeat', () => world.adventure.narrator.restartLine());
    click('#narrator-voice', () => this.toggleVoice());
    click('#narrator-journal', () => hooks.open('journal'));
    world.adventure.narrator.onChange = () => this.update(world.getState());
    $('#dialog').addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'inventory') hooks.open('inventory');
      if (action === 'manifest') hooks.open('manifest');
      if (action === 'journal') hooks.open('journal');
      if (action === 'narrator-voice') this.toggleVoice();
      if (action === 'dismount') { hooks.close(); this.toggleMounted(); }
      if (button.dataset.openContainer) this.openCargo(button.dataset.openContainer as ContainerId);
      if (button.dataset.category && button.dataset.category in categories) { this.filter = button.dataset.category as keyof typeof categories; this.renderContents(); }
      if (button.dataset.selectItem && ITEM_IDS.includes(button.dataset.selectItem as ItemId)) { this.selected = button.dataset.selectItem as ItemId; this.renderContents(); }
      if (button.dataset.qtyItem) {
        const id = button.dataset.qtyItem as ItemId;
        if (!ITEM_IDS.includes(id)) return;
        this.quantities[id] = Math.max(1, Math.min(this.world.adventure.inventory.stock(this.activeCargo)[id], this.quantities[id] + Number(button.dataset.delta)));
        this.renderContents();
      }
      if (button.dataset.takeItem) this.take(button.dataset.takeItem as ItemId);
      if (action === 'take-all') {
        const moved = world.adventure.takeAll(this.activeCargo), count = countOf(moved);
        if (count) hooks.toast(`${count} cargo items added to your inventory · ${formatGp(valueOf(moved))} in goods`);
        this.renderContents(); this.update(world.getState());
      }
    }, opts);
    $('#dialog').addEventListener('input', e => {
      const input = e.target as HTMLInputElement;
      if (input.id === 'inventory-search') {
        this.search = input.value; this.renderInventoryList(); return;
      }
      if (input.dataset.lootQuantity) {
        const id = input.dataset.lootQuantity as ItemId;
        this.quantities[id] = Math.max(1, Math.min(world.adventure.inventory.stock(this.activeCargo)[id], Math.floor(input.valueAsNumber) || 1));
        input.value = String(this.quantities[id]);
      }
    }, opts);
    document.addEventListener('keydown', e => {
      if (e.repeat || isFormControl(e.target) || ((e.code === 'Space' || e.code === 'Enter') && e.target instanceof HTMLButtonElement)) return;
      const current = hooks.current();
      if (e.code === 'KeyI') { e.preventDefault(); current === 'inventory' ? hooks.close() : hooks.open('inventory'); return; }
      if (e.code === 'KeyN') { e.preventDefault(); current === 'journal' ? hooks.close() : hooks.open('journal'); return; }
      if (current) return;
      if (e.code === 'KeyR') { e.preventDefault(); this.toggleMounted(); }
      if (e.code === 'KeyE') { e.preventDefault(); this.interact(); }
      if (world.adventure.narrator.state.phase === 'journey') {
        if (e.code === 'Space') { e.preventDefault(); world.adventure.narrator.togglePause(); }
        if (e.code === 'Enter') { e.preventDefault(); world.adventure.narrator.next(); }
      }
    }, opts);
    const saved = world.adventure.inventory;
    if (saved.arrived) { $('#enter-world span').textContent = 'Continue your journey'; $('#welcome-save-note').textContent = 'YOUR CARGO & INVENTORY ARE SAVED ON THIS DEVICE'; }
    if (saved.recoveredInvalidSave) hooks.toast('The saved journey could not be read. A recovery copy was kept; this chapter will start fresh.');
    this.update(world.getState());
  }
  toggleMounted() {
    if (this.world.adventure.toggleMounted()) { this.update(this.world.getState()); this.world.renderer.domElement.focus({ preventScroll: true }); }
  }
  interact() {
    const interaction = this.world.adventure.interaction();
    if (!interaction) return;
    if (interaction.kind === 'manifest') this.hooks.open('manifest');
    else if (interaction.kind === 'cargo') this.openCargo(interaction.id as ContainerId);
    else { $('#inspect-prompt').dispatchEvent(new CustomEvent('inspect-horses')); }
  }
  openCargo(id: ContainerId) {
    if (!CONTAINERS.some(c => c.id === id)) return;
    if (!this.world.adventure.openCargo(id)) {
      this.hooks.toast(this.world.adventure.mounted ? 'Press R to step down, then walk beside the cargo you want to open.' : 'Move closer to that container, then press E to open it.'); return;
    }
    this.activeCargo = id; this.quantities = Object.fromEntries(ITEM_IDS.map(item => [item, 1])) as Record<ItemId, number>;
    this.hooks.open('cargo');
  }
  private take(id: ItemId) {
    if (!ITEM_IDS.includes(id)) return;
    const quantity = this.quantities[id];
    if (this.world.adventure.take(this.activeCargo, id, quantity)) {
      this.hooks.toast(`Added ${quantity} ${quantity === 1 ? ITEMS[id].name.toLowerCase() : ITEMS[id].plural} · ${formatGp(quantity * ITEMS[id].unitValue)} in goods`);
      this.quantities[id] = Math.min(quantity, Math.max(1, this.world.adventure.inventory.stock(this.activeCargo)[id]));
      this.renderContents(); this.update(this.world.getState());
    }
  }
  private toggleVoice() {
    const narrator = this.world.adventure.narrator, state = narrator.state;
    narrator.setVoiceEnabled(state.fallback ? true : !state.voiceEnabled); this.update(this.world.getState());
    document.querySelectorAll('[data-action="narrator-voice"]').forEach(el => { el.setAttribute('aria-checked', String(narrator.state.voiceEnabled)); el.classList.toggle('on', narrator.state.voiceEnabled); });
  }
  update(state: WorldState) {
    const story = state.story, store = this.world.adventure.inventory;
    document.body.dataset.story = story.phase; document.body.dataset.mounted = String(state.mounted); document.body.dataset.narrating = String(story.active);
    $('#journey-skip').hidden = story.phase !== 'journey';
    $('#mount-toggle').hidden = !state.started || story.phase === 'journey';
    $('#mount-toggle').setAttribute('aria-label', state.mounted ? 'Dismount the wagon' : 'Board the wagon');
    $('#mount-label').textContent = state.mounted ? 'Step down' : 'Take the reins';
    if (this.lastMounted !== state.mounted) {
      this.lastMounted = state.mounted; $('#touch-jump').innerHTML = icon(state.mounted ? 'log-out' : 'arrow-up');
      $('#touch-jump').setAttribute('aria-label', state.mounted ? 'Dismount the wagon' : 'Jump'); this.hooks.icons();
    }
    $('#travel-mode').textContent = state.mounted ? 'AT THE REINS' : 'THE WANDERER';
    $('#travel-flavour').textContent = state.mounted ? 'A promise to keep.' : 'Make your own way.';
    $('#inventory-count').textContent = String(countOf(store.inventory));
    $('#hud-gold').textContent = formatGp(store.gold);
    $('#live-mode').textContent = story.phase === 'journey' ? 'THE OPENING CHAPTER' : state.mounted ? 'ON THE ROAD' : 'EXPLORATION';
    const prompt = $('#inspect-prompt');
    prompt.hidden = !state.interaction || !state.started || !!this.hooks.current() || document.body.dataset.photo === 'true' || story.phase === 'journey';
    $('#inspect-label').textContent = state.interaction?.label ?? 'Inspect';
    if (this.lastLine !== story.index) {
      this.lastLine = story.index;
      $('#narrator-text').textContent = story.text;
      $('#narrator-page').textContent = story.index < 4 ? `${Math.max(1, story.index + 1)} / 4` : `${story.index - 3} / 2`;
      $('#narrator-chapter').textContent = story.index < 4 ? 'A DELIVERY FOR GUNDREN' : 'THE AMBUSH CLEARING';
      $('#narrator-heading').textContent = story.heading;
    }
    $('#narrator-progress').style.width = `${story.progress * 100}%`;
    $('#narrator-progress-track').setAttribute('aria-valuenow', String(Math.round(story.progress * 100)));
    $('#narrator-audio-status').textContent = story.fallback ? 'SUBTITLES ONLY · RETRY VOICE' : story.paused ? 'A MOMENT OF PAUSE' : story.voiceEnabled ? 'THE STORY UNFOLDS' : 'VOICE MUTED';
    if (this.lastPaused !== story.paused) { this.lastPaused = story.paused; $('#narrator-pause').innerHTML = icon(story.paused ? 'play' : 'pause'); $('#narrator-pause').setAttribute('aria-label', story.paused ? 'Resume narration' : 'Pause narration'); this.hooks.icons(); }
    if (this.lastVoice !== story.voiceEnabled) { this.lastVoice = story.voiceEnabled; $('#narrator-voice').innerHTML = icon(story.voiceEnabled ? 'volume-2' : 'volume-x'); $('#narrator-voice').setAttribute('aria-label', story.voiceEnabled ? 'Mute Narrator' : 'Enable Narrator'); this.hooks.icons(); }
    if (this.lastPhase !== story.phase) {
      this.lastPhase = story.phase;
      document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => { b.disabled = story.phase === 'journey'; });
    }
    if (this.lastRevision !== store.revision) {
      this.lastRevision = store.revision;
      // Transfers render immediately in their click handler; frame updates refresh currency/status too.
      const purse = document.querySelector('#purse-gold'); if (purse) purse.textContent = formatGp(store.gold, false);
    }
  }
  dialogHTML(kind: AdventureDialog) {
    if (kind === 'inventory') return `${close}<div class="dialog-eyebrow">THE WANDERER’S BELONGINGS</div><h2 id="dialog-title">Your inventory.</h2><p class="dialog-description">A place for the things you carry, and the stories they keep.</p>${this.purse()}<div class="inventory-layout"><div class="inventory-main"><label class="inventory-search">${icon('search')}<input id="inventory-search" placeholder="Find an item…" aria-label="Search inventory" value="${escape(this.search)}"></label><div class="inventory-filters" role="group" aria-label="Filter inventory">${Object.entries(categories).map(([id, label]) => `<button data-category="${id}" class="${this.filter === id ? 'selected' : ''}" aria-pressed="${this.filter === id}">${label}</button>`).join('')}</div><div id="inventory-list">${this.inventoryList()}</div></div><aside id="item-detail" class="item-detail">${this.itemDetail()}</aside></div><div class="inventory-foot"><span>${icon('check')} ${this.world.adventure.inventory.persistenceAvailable ? 'Saved on this device' : 'Session only · device storage unavailable'}</span><button data-action="manifest">View wagon manifest ${icon('arrow-up-right')}</button></div>`;
    if (kind === 'cargo') return this.cargoHTML();
    if (kind === 'manifest') return this.manifestHTML();
    return `${close}<div class="dialog-eyebrow">CHAPTER I · THE TRIBOAR TRAIL</div><h2 id="dialog-title">The road so far.</h2><p class="dialog-description">The Narrator’s words, kept here whenever you need them.</p><div class="journal-scroll"><div class="journal-heading">${icon('book-open')} A delivery for Gundren</div><p>${escape(NARRATION.slice(0, 3).map(l => l.text).join(' '))}</p><p>${escape(NARRATION[3].text)}</p><div class="journal-divider">◇</div><div class="journal-heading">${icon('footprints')} The ambush clearing</div><p>${escape(NARRATION.slice(4).map(l => l.text).join(' '))}</p></div><div class="journal-contract"><span>THE AGREEMENT</span><p><strong>10 gp</strong> on safe delivery to Barthen’s Provisions.<br><small>This payment has not been earned or added to your purse.</small></p></div><div class="dialog-footnote">${icon('volume-2')} The narrated text is presented verbatim, in readable pages.</div>`;
  }
  private purse() {
    const store = this.world.adventure.inventory;
    return `<section class="purse-panel" aria-label="Currency in gold pieces"><div class="purse-symbol">${icon('coins')}</div><div class="purse-amount"><span>CURRENCY</span><strong><b id="purse-gold">${formatGp(store.gold, false)}</b> <small>gp</small></strong></div><div class="purse-divider"></div><div class="goods-value"><strong>${formatGp(store.inventoryValue)}</strong><span>VALUE OF CARRIED GOODS</span><small>Goods are not coins.</small></div></section>`;
  }
  private inventoryList() {
    const stock = this.world.adventure.inventory.inventory;
    const rows = ITEM_IDS.filter(id => stock[id] > 0 && (this.filter === 'all' || ITEMS[id].category === this.filter) && ITEMS[id].name.toLowerCase().includes(this.search.toLowerCase()));
    if (!rows.length) return `<div class="inventory-empty">${icon('backpack')}<h3>${countOf(stock) ? 'Nothing on this page.' : 'Room for a journey.'}</h3><p>${countOf(stock) ? 'Try a different search or category.' : 'Step down from the wagon and open its cargo with <kbd>E</kbd> to collect supplies.'}</p></div>`;
    return `<div class="inventory-columns"><span>ITEM</span><span>QTY</span><span>VALUE</span></div>${rows.map(id => `<button class="inventory-row ${this.selected === id ? 'selected' : ''}" data-select-item="${id}" aria-pressed="${this.selected === id}"><span class="item-icon ${ITEMS[id].category}">${icon(ITEMS[id].icon)}</span><span class="item-name"><strong>${ITEMS[id].name}</strong><small>${ITEMS[id].category === 'equipment' ? 'Equipment' : ITEMS[id].category === 'tools' ? 'Mining equipment' : 'Provisions'}</small></span><span class="item-quantity">${stock[id]}</span><span class="item-price"><strong>${formatGp(stock[id] * ITEMS[id].unitValue)}</strong><small>${formatGp(ITEMS[id].unitValue)} each</small></span></button>`).join('')}`;
  }
  private itemDetail() {
    const stock = this.world.adventure.inventory.inventory;
    const id = this.selected && stock[this.selected] ? this.selected : ITEM_IDS.find(item => stock[item] > 0);
    if (!id) return `<div class="detail-emblem">${icon('package-open')}</div><span class="detail-overline">GUNDREN’S CONSIGNMENT</span><h3>One hundred<br>gold pieces.</h3><p>The wagon carries a full load for Phandalin. Each item has a fixed sale value for future trading.</p><div class="detail-rule"></div><small>Moving cargo into your pack does not add gold to your purse.</small>`;
    return `<div class="detail-emblem">${icon(ITEMS[id].icon)}</div><span class="detail-overline">${ITEMS[id].category.toUpperCase()}</span><h3>${ITEMS[id].name}</h3><p>${ITEMS[id].description}</p><dl class="item-facts"><div><dt>Quantity</dt><dd>${stock[id]}</dd></div><div><dt>Value per item</dt><dd>${formatGp(ITEMS[id].unitValue)}</dd></div><div><dt>Stack value</dt><dd>${formatGp(stock[id] * ITEMS[id].unitValue)}</dd></div></dl><small>Fixed sale value. Shops and selling arrive in a later chapter.</small>`;
  }
  private cargoHTML() {
    const definition = CONTAINERS.find(c => c.id === this.activeCargo)!, store = this.world.adventure.inventory, stock = store.stock(this.activeCargo);
    const ids = ITEM_IDS.filter(id => id in definition.stock);
    return `${close}<div class="dialog-eyebrow">GUNDREN’S CONSIGNMENT</div><h2 id="dialog-title">${definition.name}</h2><p class="dialog-description">${definition.subtitle}</p><div class="cargo-summary"><span>${icon('package-open')} ${countOf(stock) ? 'OPEN · READY TO UNLOAD' : 'EMPTY · ALL ITEMS COLLECTED'}</span><strong>${formatGp(valueOf(stock))}</strong></div><div class="loot-list">${ids.map(id => {
      const amount = Math.min(this.quantities[id], Math.max(1, stock[id]));
      return `<div class="loot-row ${stock[id] === 0 ? 'depleted' : ''}"><div class="loot-item-header"><span class="item-icon ${ITEMS[id].category}">${icon(ITEMS[id].icon)}</span><div><strong>${ITEMS[id].name}</strong><span>${stock[id]} available · ${formatGp(ITEMS[id].unitValue)} each</span></div></div><p>${ITEMS[id].description}</p><div class="loot-actions"><div class="quantity-control"><button data-qty-item="${id}" data-delta="-1" aria-label="Take fewer ${ITEMS[id].plural}" ${!stock[id] ? 'disabled' : ''}>−</button><input type="number" inputmode="numeric" min="1" max="${Math.max(1, stock[id])}" value="${amount}" data-loot-quantity="${id}" aria-label="Quantity of ${ITEMS[id].plural} to take" ${!stock[id] ? 'disabled' : ''}><button data-qty-item="${id}" data-delta="1" aria-label="Take more ${ITEMS[id].plural}" ${!stock[id] ? 'disabled' : ''}>+</button></div><button class="take-button" data-take-item="${id}" ${!stock[id] ? 'disabled' : ''}>${stock[id] ? 'Take' : 'Collected'} ${icon(stock[id] ? 'arrow-right' : 'check')}</button></div></div>`;
    }).join('')}</div><button class="primary-action cargo-take-all" data-action="take-all" ${!countOf(stock) ? 'disabled' : ''}>${icon('backpack')} ${countOf(stock) ? 'Take everything in this container' : 'This container is empty'} ${icon('arrow-right')}</button><div class="cargo-pack-status"><span>Your pack</span><strong>${countOf(store.inventory)} items · ${formatGp(store.inventoryValue)}</strong></div><div class="cargo-bottom-actions"><button data-action="inventory">${icon('backpack')} Open inventory <kbd>I</kbd></button><button data-action="manifest">Cargo manifest ${icon('arrow-up-right')}</button></div><p class="cargo-value-note">Taking supplies adds goods to your inventory, not gold to your purse.</p>`;
  }
  private manifestHTML() {
    const store = this.world.adventure.inventory;
    return `${close}<div class="dialog-eyebrow">NEVERWINTER → PHANDALIN</div><h2 id="dialog-title">A wagon full of promise.</h2><p class="dialog-description">Provisions and mining supplies, bound for Barthen’s trading post.</p><div class="manifest-total"><div><span>REMAINING ON THE WAGON</span><strong>${formatGp(store.cargoValue)}</strong></div><div><span>IN YOUR INVENTORY</span><strong>${formatGp(store.inventoryValue)}</strong></div><div class="consignment-original"><span>ORIGINAL APPRAISAL</span><strong>100 gp</strong></div></div><div class="manifest-grid">${CONTAINERS.map(c => {
      const stock = store.stock(c.id), canReach = this.world.adventure.canReach(c.id);
      return `<button class="manifest-card ${canReach ? 'reachable' : ''}" data-open-container="${c.id}"><div class="manifest-card-top">${icon(c.kind === 'barrel' ? 'barrel' : c.kind === 'rack' ? 'package' : 'package-open')}<span>${countOf(stock) === 0 ? 'EMPTY' : store.isOpen(c.id) ? 'OPEN' : c.kind === 'rack' ? 'STOWED' : 'SEALED'}</span></div><h3>${c.name}</h3><p>${c.subtitle}</p><div class="manifest-card-bottom"><strong>${formatGp(valueOf(stock))}</strong><small>${canReach ? 'Open container' : 'Move closer'}</small>${icon('arrow-up-right')}</div></button>`;
    }).join('')}</div>${this.world.adventure.mounted ? `<button class="primary-action" data-action="dismount" ${!store.arrived ? 'disabled' : ''}>${icon('log-out')} ${store.arrived ? 'Step down to inspect the cargo' : 'Cargo is accessible after the opening journey'} ${icon('arrow-right')}</button>` : `<div class="dialog-footnote">${icon('footprints')} Walk alongside a container and press E to open it.</div>`}<div class="manifest-note">Cargo values are fixed sale appraisals. The wagon and oxen are not part of the 100 gp inventory.</div>`;
  }
  private renderInventoryList() { const list = document.querySelector('#inventory-list'); if (list) { list.innerHTML = this.inventoryList(); this.hooks.icons(); } }
  private renderContents() {
    const kind = this.hooks.current(); if (!['cargo', 'inventory', 'manifest'].includes(kind ?? '')) return;
    const dialog = $('#dialog'), scroll = dialog.scrollTop;
    dialog.innerHTML = this.dialogHTML(kind as AdventureDialog); dialog.scrollTop = scroll; this.hooks.icons();
  }
  dispose() { this.abort.abort(); }
}
