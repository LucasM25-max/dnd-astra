import { createIcons, ArrowRight, ArrowUp, ArrowUpRight, Camera, Check, ChevronRight, CircleHelp, Cloud, Compass, Download, Expand, Eye, Footprints, Headphones, Leaf, Maximize, Moon, Mouse, PersonStanding, Play, RotateCcw, SlidersHorizontal, Sun, Volume2, VolumeX, X, Backpack, Coins, Package, PackageOpen, Wheat, Cylinder, Beer, Shovel, Pickaxe, Wrench, Lamp, Droplet, BookOpen, Search, Pause, SkipForward, LogOut, LogIn, UserRoundPen } from 'lucide';
import { ForestAudio } from '../engine/audio';
import { isFormControl, type CameraMode } from '../engine/controller';
import { WoodlandWorld, type Atmosphere, type Quality, type WorldState } from '../engine/world';
import { Cartography, paintCompass } from './cartography';
import { CombatHud } from './combat-hud';
import { AdventureInterface, type AdventureDialog } from './adventure-interface';
import { ABILITIES, ABILITY_NAMES, availableSkillChoices, BACKGROUNDS, CLASSES, defaultDraft, finalizeCharacter, PERSONALITIES, PRONOUNS, SPECIES, type CharacterDraft } from '../game/character';
import type { Ability } from '../game/rules';
import { CHARACTER_STORAGE_KEY } from '../game/character';

type DialogKind = 'settings' | 'map' | 'help' | 'pause' | 'inspect' | 'character' | 'combat' | AdventureDialog;
interface Preferences { quality: Quality; atmosphere: Atmosphere; volume: number; sensitivity: number; invertY: boolean }
const iconSet = { UserRoundPen, Barrel: Cylinder, ArrowRight, ArrowUp, ArrowUpRight, Camera, Check, ChevronRight, CircleHelp, Cloud, Compass, Download, Expand, Eye, Footprints, Headphones, Leaf, Maximize, Moon, Mouse, PersonStanding, Play, RotateCcw, SlidersHorizontal, Sun, Volume2, VolumeX, X, Backpack, Coins, Package, PackageOpen, Wheat, Cylinder, Beer, Shovel, Pickaxe, Wrench, Lamp, Droplet, BookOpen, Search, Pause, SkipForward, LogOut, LogIn };
export const refreshIcons = () => createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.5 } });
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const atmosphereNames = { golden: ['GOLDEN HOUR', 'A quiet afternoon', 'sun'], overcast: ['OVERCAST', 'Mist among the trees', 'cloud'], blue: ['BLUE HOUR', 'The woodland at dusk', 'moon'] };

export class WorldInterface {
  private audio = new ForestAudio();
  private map = new Cartography();
  private dialog: DialogKind | null = null;
  private photo = false;
  private state: WorldState;
  private config: Preferences = { quality: 'high', atmosphere: 'golden', volume: .4, sensitivity: 1, invertY: false };
  private toastTimer = 0;
  private discoveryTimer = 0;
  private lastMapFrame = 0;
  private lastHeadingLabel = '';
  private abort = new AbortController();
  private adventureUI: AdventureInterface;
  private characterDraft: CharacterDraft = defaultDraft();
  private combatHud: CombatHud;
  constructor(private world: WoodlandWorld) {
    this.state = world.getState();
    this.loadPreferences(); this.applyPreferences();
    this.adventureUI = new AdventureInterface(world, { open: (kind, nonBlocking) => this.openDialog(kind, nonBlocking), close: () => this.closeDialog(), current: () => this.dialog, toast: message => this.toast(message), icons: refreshIcons });
    // The combat HUD lives over the canvas and never blocks the world.
    this.combatHud = new CombatHud(document.body, world);
    this.combatHud.onFinish = () => {
      world.adventure.finishCombat();
      const trail = world.adventure.readTrail();
      if (trail) this.toast(trail.text);
    };
    world.adventure.onCombatLog = entries => this.combatHud.appendLog(entries);
    world.adventure.onCombatPhase = phase => {
      if (phase === 'sprung') this.toast('Ambush! Goblins on both sides of the road.');
    };
    // Aim in the world: the pointer drives targeting every frame it moves.
    world.renderer.domElement.addEventListener('pointermove', e => {
      const rect = world.renderer.domElement.getBoundingClientRect();
      world.adventure.combatPointer(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    }, { signal: this.abort.signal });

    this.bind(); refreshIcons();
    world.controller.onStart = () => this.start();
    world.controller.onUnlock = () => { if (!this.dialog) this.openDialog('pause'); };
    world.controller.onPointerFallback = () => this.toast('Drag to look around. WASD to follow the trail.');
    world.onUpdate = state => this.update(state);
    world.onDiscovery = name => this.discover(name);
    world.onNotice = message => this.toast(message);
    world.onControlHandoff = () => { this.adventureUI.update(world.getState()); this.toast('You have the reins. Press R to step down and inspect the cargo.'); };
    this.update(this.state);
  }
  private bind() {
    const opts = { signal: this.abort.signal };
    const click = (selector: string, fn: () => void) => $(selector).addEventListener('click', fn, opts);
    click('#enter-world', () => { this.start(); this.world.controller.capturePointer(); });
    click('#character-create', () => { this.characterDraft = defaultDraft(); this.openDialog('character'); });
    click('#map-toggle', () => this.openDialog('map'));
    click('#settings-toggle', () => this.openDialog('settings'));
    click('#time-toggle', () => this.openDialog('settings'));
    click('#help-toggle', () => this.openDialog('help'));
    document.addEventListener('combat-open', () => this.openDialog('combat'), opts);
    click('#photo-toggle', () => this.togglePhoto()); click('#exit-photo', () => this.togglePhoto());
    click('#capture-photo', () => { void this.capture(); });
    click('#sound-toggle', () => { void this.toggleAudio(); });
    click('#fullscreen-toggle', () => { void this.fullscreen(); });
    click('#inspect-prompt', () => this.adventureUI.interact());
    $('#inspect-prompt').addEventListener('inspect-horses', () => this.openDialog('inspect'), opts);
    click('#touch-jump', () => { if (!this.world.controller.started) this.start(); if (this.world.adventure.mounted) this.adventureUI.toggleMounted(); else this.world.controller.jump(); });
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.view as CameraMode), opts));
    $('#dialog-backdrop').addEventListener('click', e => { if (e.target === e.currentTarget) this.closeDialog(); }, opts);
    $('#dialog').addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'close') this.closeDialog();
      if (action === 'resume') { this.closeDialog(); this.start(); this.world.controller.capturePointer(); }
      if (action === 'settings') this.openDialog('settings');
      if (action === 'help') this.openDialog('help');
      if (action === 'reset') { this.world.adventure.returnToWagon(); this.closeDialog(); this.toast('Back at the wagon. Your cargo and inventory are unchanged.'); }
      if (action === 'character-cancel') { this.closeDialog(); }
      if (action === 'character-create') this.createCharacter();
      if (action === 'audio') void this.toggleAudio();
      if (button.dataset.quality) {
        this.config.quality = button.dataset.quality as Quality; this.world.setQuality(this.config.quality);
        this.updateSelected('[data-quality]', 'quality', this.config.quality); this.savePreferences();
      }
      if (button.dataset.atmosphere) {
        this.config.atmosphere = button.dataset.atmosphere as Atmosphere; this.world.setAtmosphere(this.config.atmosphere);
        this.updateSelected('[data-atmosphere]', 'atmosphere', this.config.atmosphere); this.updateTime(); this.savePreferences();
      }
    }, opts);
    $('#dialog').addEventListener('change', e => {
      if (this.dialog !== 'character') return;
      const input = e.target as HTMLInputElement;
      if (input.dataset.character === 'background') this.characterDraft.background = input.value as CharacterDraft['background'];
      if (input.dataset.character === 'species') this.characterDraft.species = input.value as CharacterDraft['species'];
      if (input.dataset.character === 'class') this.characterDraft.classId = input.value as CharacterDraft['classId'];
      if (input.dataset.character === 'pronouns') this.characterDraft.pronouns = input.value;
      if (input.dataset.character === 'personality') this.characterDraft.personality = input.value;
      if (input.dataset.character === 'background' || input.dataset.character === 'species') {
        $('#dialog').innerHTML = this.dialogHTML('character'); refreshIcons();
      }
    }, opts);
    $('#dialog').addEventListener('input', e => {
      const input = e.target as HTMLInputElement;
      if (this.dialog === 'character') {
        const field = input.dataset.character;
        if (field === 'name') this.characterDraft.name = input.value;
        if (field === 'pronouns') this.characterDraft.pronouns = input.value;
        if (field === 'species') this.characterDraft.species = input.value as CharacterDraft['species'];
        if (field === 'class') this.characterDraft.classId = input.value as CharacterDraft['classId'];
        if (field === 'background') this.characterDraft.background = input.value as CharacterDraft['background'];
        if (field === 'personality') this.characterDraft.personality = input.value;
        if (field === 'skill') this.characterDraft.skillChoices = [input.value as CharacterDraft['skillChoices'][number]];
        if (field?.startsWith('ability-')) this.characterDraft.abilities[field.slice(8) as Ability] = Math.max(3, Math.min(20, Number(input.value) || 3));
        return;
      }
      if (!input.dataset.setting) return;
      if (input.dataset.setting === 'volume') { this.config.volume = Number(input.value) / 100; this.audio.setVolume(this.config.volume); this.world.adventure.animalAudio.setVolume(this.config.volume); $('#volume-value').textContent = `${input.value}%`; }
      if (input.dataset.setting === 'sensitivity') { this.config.sensitivity = Number(input.value); this.world.controller.sensitivity = this.config.sensitivity; $('#sensitivity-value').textContent = `${this.config.sensitivity.toFixed(1)}×`; }
      if (input.dataset.setting === 'invert') { this.config.invertY = input.checked; this.world.controller.invertY = input.checked; }
      this.savePreferences();
    }, opts);
    document.addEventListener('keydown', e => {
      if (e.code === 'Escape') {
        if (document.pointerLockElement) return;
        e.preventDefault();
        if (this.dialog) this.closeDialog();
        else if (this.photo) this.togglePhoto();
        else if (this.world.controller.started) this.openDialog('pause');
        return;
      }
      if (this.dialog) {
        if (e.code === 'Tab') this.trapFocus(e);
        if (e.code === 'KeyM' && this.dialog === 'map' && !isFormControl(e.target)) this.closeDialog();
        return;
      }
      if (isFormControl(e.target) || e.repeat) return;
      if (e.code === 'KeyV') { e.preventDefault(); this.setMode(this.world.controller.mode === 'first' ? 'third' : 'first'); }
      if (e.code === 'KeyM') { e.preventDefault(); this.openDialog('map'); }
      if (e.code === 'KeyH') { e.preventDefault(); this.openDialog('help'); }
      if (e.code === 'KeyP') { e.preventDefault(); this.togglePhoto(); }
    }, opts);
    document.addEventListener('fullscreenchange', () => {
      const label = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
      $('#fullscreen-toggle').setAttribute('aria-label', label); $('#fullscreen-toggle').title = label;
    }, opts);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.world.controller.started && !this.dialog) this.openDialog('pause');
    }, opts);
    const joystick = $('#joystick'), knob = $('#joystick-knob');
    let joystickPointer: number | null = null;
    const moveJoystick = (e: PointerEvent) => {
      const rect = joystick.getBoundingClientRect();
      let x = (e.clientX - rect.left - rect.width / 2) / 29, y = (e.clientY - rect.top - rect.height / 2) / 29;
      const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; }
      this.world.controller.touchMove.x = x; this.world.controller.touchMove.y = -y;
      knob.style.transform = `translate(${x * 23}px, ${y * 23}px)`;
    };
    joystick.addEventListener('pointerdown', e => {
      e.preventDefault(); if (!this.world.controller.started) this.start();
      joystickPointer = e.pointerId; joystick.setPointerCapture(e.pointerId); moveJoystick(e);
    }, opts);
    joystick.addEventListener('pointermove', e => { if (e.pointerId === joystickPointer) moveJoystick(e); }, opts);
    const releaseJoystick = () => { joystickPointer = null; this.world.controller.touchMove.x = this.world.controller.touchMove.y = 0; knob.style.transform = ''; };
    joystick.addEventListener('pointerup', releaseJoystick, opts); joystick.addEventListener('pointercancel', releaseJoystick, opts); joystick.addEventListener('lostpointercapture', releaseJoystick, opts);
  }
  start() {
    if (!this.world.controller.started) {
      this.world.beginAdventure(); document.body.dataset.playing = 'true';
      this.adventureUI.update(this.world.getState());
      if (this.config.quality === 'high' && this.state.fps < 20) this.toast('For a smoother journey, try Balanced in world settings.');
    }
    this.world.renderer.domElement.focus({ preventScroll: true });
  }
  setMode(mode: CameraMode) {
    if (this.world.adventure.narrator.state.phase === 'journey') return;
    this.world.setMode(mode); document.body.dataset.view = mode;
    this.updateSelected('[data-view]', 'view', mode);
    if (this.world.controller.started) this.world.renderer.domElement.focus({ preventScroll: true });
  }
  private updateSelected(selector: string, key: string, value: string) {
    document.querySelectorAll<HTMLButtonElement>(selector).forEach(b => { const selected = b.dataset[key] === value; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); });
  }
  private update(state: WorldState) {
    this.state = state;
    paintCompass($('#compass-canvas') as HTMLCanvasElement, state.yaw);
    const compassLabel = `Compass heading ${Math.round(((-state.yaw * 180 / Math.PI) % 360 + 360) % 360)} degrees`;
    if (compassLabel !== this.lastHeadingLabel) { $('#compass-canvas').setAttribute('aria-label', compassLabel); this.lastHeadingLabel = compassLabel; }
    if (performance.now() - this.lastMapFrame > 140) {
      this.lastMapFrame = performance.now();
      this.map.render($('#minimap-canvas') as HTMLCanvasElement, state);
      const largeMap = document.querySelector<HTMLCanvasElement>('#world-map-canvas');
      if (this.dialog === 'map' && largeMap) this.map.render(largeMap, state, true);
    }
    this.adventureUI.update(state);
    if (this.dialog === 'cargo' && !this.world.adventure.canReach(this.adventureUI.activeCargo)) this.closeDialog();
    document.body.dataset.locked = String(!!document.pointerLockElement);
    $('#region-name').textContent = state.landmark === 'cragmaw' ? 'Cragmaw Trail' : state.landmark === 'ambush' ? 'The Ambush Clearing' : 'Triboar Trail';
    const saveNote = $('#welcome-save-note');
    if (state.story.phase === 'title' && state.character) saveNote.textContent = `${state.character.name.toUpperCase()} · ${SPECIES[state.character.species].name.toUpperCase()} ${CLASSES[state.character.classId].name.toUpperCase()} · READY TO BEGIN`;
    this.combatHud.render(state.combat);
    this.audio.update(state.distanceWalked, state.moving, state.grounded);
    this.world.adventure.animalAudio.setListener(state.x, 0, state.z);
  }
  private updateTime() {
    const [name, detail, glyph] = atmosphereNames[this.config.atmosphere];
    $('#time-label').textContent = name; $('#time-detail').textContent = detail;
    const button = $('#time-toggle'); button.querySelector('svg')?.remove(); button.insertAdjacentHTML('afterbegin', icon(glyph)); refreshIcons();
  }
  openDialog(kind: DialogKind, nonBlocking = false) {
    this.dialog = kind;
    if (!nonBlocking) { $('.hud').inert = true; this.world.setPaused(true); this.audio.setPaused(true); this.world.adventure.animalAudio.setPaused(true); }
    const backdrop = $('#dialog-backdrop'), dialog = $('#dialog');
    dialog.dataset.kind = kind; backdrop.dataset.mode = kind === 'cargo' ? 'side' : 'center'; dialog.innerHTML = this.dialogHTML(kind); backdrop.hidden = false;
    document.body.dataset.modal = nonBlocking ? 'false' : 'true';
    refreshIcons();
    if (kind === 'map') {
      const mapCanvas = dialog.querySelector<HTMLCanvasElement>('#world-map-canvas');
      requestAnimationFrame(() => { if (this.dialog === 'map' && mapCanvas?.isConnected) this.map.render(mapCanvas, this.world.getState(), true); });
    }
    requestAnimationFrame(() => { if (this.dialog === kind) (dialog.querySelector<HTMLElement>('[data-action="close"]') ?? dialog).focus(); });
  }
  closeDialog() {
    if (this.dialog === 'combat' && this.world.adventure.combat && !this.world.adventure.combat.finished) return;
    if (this.dialog === 'cargo' && document.pointerLockElement === this.world.renderer.domElement) this.world.controller.capturePointer();
    this.dialog = null; $('.hud').inert = false; $('#dialog-backdrop').hidden = true; document.body.dataset.modal = 'false';
    this.world.setPaused(false); this.audio.setPaused(false); this.world.adventure.animalAudio.setPaused(false);
    this.world.renderer.domElement.focus({ preventScroll: true });
  }
  private createCharacter() {
    try {
      const sheet = finalizeCharacter(this.characterDraft);
      localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(sheet));
      // A finalized character is the start of a new campaign, never a mutation
      // of an existing wagon. Keep preferences and the character, discard only
      // the chapter save, then boot the normal title flow again.
      localStorage.removeItem('astra-journey-v1');
      this.closeDialog();
      location.reload();
    } catch (error) {
      this.toast(error instanceof Error ? error.message : 'Complete the character choices first.');
    }
  }
  private dialogHTML(kind: DialogKind) {
    if (['inventory', 'cargo', 'manifest', 'journal'].includes(kind)) return this.adventureUI.dialogHTML(kind as AdventureDialog);
    const close = `<button class="icon-button dialog-close" data-action="close" aria-label="Close dialog">${icon('x')}</button>`;
    if (kind === 'character') {
      const d = this.characterDraft;
      const select = (field: string, options: string, label: string) => `<label class="character-field"><span>${label}</span><select data-character="${field}">${options}</select></label>`;
      const species = Object.values(SPECIES).map(o => `<option value="${o.id}" ${d.species === o.id ? 'selected' : ''}>${o.name} — ${o.summary}</option>`).join('');
      const classes = Object.values(CLASSES).map(o => `<option value="${o.id}" ${d.classId === o.id ? 'selected' : ''}>${o.name} — ${o.summary}</option>`).join('');
      const backgrounds = Object.values(BACKGROUNDS).map(o => `<option value="${o.id}" ${d.background === o.id ? 'selected' : ''}>${o.name} — ${o.summary}</option>`).join('');
      const personalities = PERSONALITIES.map(o => `<option value="${o.id}" ${d.personality === o.id ? 'selected' : ''}>${o.name} — ${o.text}</option>`).join('');
      const skills = availableSkillChoices(d).map(skill => `<option value="${skill}" ${d.skillChoices[0] === skill ? 'selected' : ''}>${skill.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</option>`).join('');
      const abilities = ABILITIES.map(a => `<label class="ability-field"><span>${ABILITY_NAMES[a]}</span><input type="number" min="3" max="20" data-character="ability-${a}" value="${d.abilities[a]}" aria-label="${ABILITY_NAMES[a]} score"><small>${d.abilities[a] >= 3 ? (d.abilities[a] - 10 >= 0 ? '+' : '') + Math.floor((d.abilities[a] - 10) / 2) : ''}</small></label>`).join('');
      return `${close}<div class="character-creator"><div class="dialog-eyebrow">A NEW STORY BEGINS WITH YOU</div><h2 id="dialog-title">Make your adventurer.</h2><p class="dialog-description">Choose a legal first-level character. You can change any choice before you begin; the rules engine derives the rest.</p><div class="character-grid"><label class="character-field full"><span>Name</span><input data-character="name" maxlength="32" placeholder="Your name" value="${escapeHtml(d.name)}" autocomplete="off"></label>${select('pronouns', PRONOUNS.map(p => `<option ${d.pronouns === p ? 'selected' : ''}>${p}</option>`).join(''), 'Pronouns')}${select('species', species, 'Species')}${select('class', classes, 'Class')}${select('background', backgrounds, 'Background')}${select('personality', personalities, 'Personality')}${select('skill', skills, 'Bonus skill')}</div><div class="character-section"><div class="character-section-heading"><strong>Ability scores</strong><span>Standard array · legal and ready to play</span></div><div class="ability-grid">${abilities}</div></div><div class="character-preview"><div><strong>${SPECIES[d.species].name} ${CLASSES[d.classId].name}</strong><span>${SPECIES[d.species].details} ${CLASSES[d.classId].details}</span></div><div><b>${CLASSES[d.classId].features.join(' · ')}</b><span>${BACKGROUNDS[d.background].skills.map(s => s[0].toUpperCase() + s.slice(1)).join(' · ')} proficiency · ${CLASSES[d.classId].hitDie} hit die</span><span>Equipment: ${CLASSES[d.classId].id === 'fighter' ? 'Longsword and shield' : 'Spellbook and quarterstaff'}</span></div></div><div class="character-footer"><button data-action="character-cancel">Not yet</button><button class="primary-action" data-action="character-create">Create character ${icon('arrow-right')}</button></div><div class="dialog-footnote">Creating a character starts a new game and clears the current chapter save. Your character remains available on this device.</div></div>`;
    }
    if (kind === 'settings') return `${close}<div class="dialog-eyebrow">THE FINER DETAILS</div><h2 id="dialog-title">Your world, your way.</h2><p class="dialog-description">Settle into the atmosphere that feels like you.</p>
      <div class="setting-section"><div class="setting-heading"><label>Visual quality</label><span>REAL-TIME RENDERING</span></div><div class="setting-segment">${(['performance', 'balanced', 'high'] as Quality[]).map(q => `<button data-quality="${q}" class="${this.config.quality === q ? 'selected' : ''}" aria-pressed="${this.config.quality === q}">${q === 'performance' ? 'Performance' : q === 'balanced' ? 'Balanced' : 'High fidelity'}</button>`).join('')}</div><small class="setting-note">High fidelity adds denser foliage, environment lighting, finer shadows, and cinematic bloom.</small></div>
      <div class="setting-section"><div class="setting-heading"><label>Time & atmosphere</label></div><div class="atmosphere-options">${(['golden', 'overcast', 'blue'] as Atmosphere[]).map(a => `<button data-atmosphere="${a}" class="${this.config.atmosphere === a ? 'selected' : ''}" aria-pressed="${this.config.atmosphere === a}">${icon(atmosphereNames[a][2])}<span>${a === 'golden' ? 'Golden hour' : a === 'overcast' ? 'Overcast' : 'Blue hour'}</span></button>`).join('')}</div></div>
      <div class="setting-section"><div class="setting-heading"><label>Forest ambience</label><button class="switch ${this.audio.enabled ? 'on' : ''}" role="switch" aria-checked="${this.audio.enabled}" aria-label="Forest ambience" data-action="audio"><span></span></button></div><div class="range-row"><label for="volume">Volume</label><input id="volume" aria-label="Ambience volume" data-setting="volume" type="range" min="0" max="100" value="${Math.round(this.config.volume * 100)}"><output id="volume-value">${Math.round(this.config.volume * 100)}%</output></div></div>
      <div class="setting-section narrator-setting"><div class="setting-heading"><label>Narrator voice</label><button class="switch ${this.world.adventure.narrator.state.voiceEnabled ? 'on' : ''}" role="switch" aria-checked="${this.world.adventure.narrator.state.voiceEnabled}" aria-label="Narrator voice" data-action="narrator-voice"><span></span></button></div><small class="setting-note">The narrated opening is included locally. No API key is needed to play.</small></div><div class="setting-section last"><div class="setting-heading"><label for="sensitivity">Look sensitivity</label><output id="sensitivity-value">${this.config.sensitivity.toFixed(1)}×</output></div><input id="sensitivity" data-setting="sensitivity" type="range" min="0.3" max="2.2" step="0.1" value="${this.config.sensitivity}"><label class="checkbox-label"><input data-setting="invert" type="checkbox" ${this.config.invertY ? 'checked' : ''}>Invert vertical look</label></div><div class="dialog-footnote">${icon('check')} Preferences are saved on this device.</div>`;
    if (kind === 'map') return `${close}<div class="dialog-eyebrow">A SMALL CORNER OF THE FORGOTTEN REALMS</div><h2 id="dialog-title">The Triboar Trail</h2><p class="dialog-description">Every path begins with a little curiosity.</p><div class="world-map-frame"><canvas id="world-map-canvas" aria-label="Map of the east-west Triboar Trail and the northern Cragmaw trail, showing your position"></canvas></div><div class="map-legend"><span><b class="player-legend">▲</b> You are here</span><span><b>◇</b> Ambush clearing</span><span class="map-footnote">NORTH IS UP · NO GRID</span></div><div class="dialog-footnote map-instruction">${icon('compass')} Follow the narrow northern trail toward Cragmaw Hideout.</div>`;
    if (kind === 'help') return `${close}<div class="dialog-eyebrow">A FEW WAYS TO FIND YOUR FEET</div><h2 id="dialog-title">Take the scenic route.</h2><p class="dialog-description">Keep the reins, or step down and take a closer look.</p><div class="help-grid">${[
      ['W A S D', 'Walk / guide the wagon', 'W/S guide, A/D steer at the reins.'], ['SHIFT', 'Sprint on foot', 'Hold while walking.'], ['SPACE', 'Jump / wagon brake', 'Pauses narration during the cutscene.'], ['MOUSE', 'Look around', 'Click to capture, or click and drag.'], ['V', 'Change perspective', 'First person or third person.'], ['SCROLL', 'Camera distance', 'Zoom in or out in third person.'], ['M', 'World map', 'Find your place in the woodland.'], ['P', 'Photo mode', 'Hide the interface. Keep the moment.'], ['E', 'Open / inspect', 'Open nearby cargo or examine the clearing.'], ['R', 'Board / dismount', 'Step down to reach the cargo.'], ['I', 'Inventory', 'Currency, quantities, and gp values.'], ['N', 'Story journal', 'The Narrator’s complete text.'], ['C', 'Practice encounter', 'Open the rules-backed ambush encounter.'], ['ESC', 'Pause / release mouse', 'Take a breath. The world will wait.'],
    ].map(([key, label, note]) => `<div class="help-row"><kbd>${key}</kbd><div><strong>${label}</strong><span>${note}</span></div></div>`).join('')}</div><div class="dialog-footnote">${icon('leaf')} The bean is a placeholder. The adventure is just beginning.</div>`;
    if (kind === 'pause') return `${close}<div class="pause-emblem">${icon('leaf')}</div><div class="dialog-eyebrow">THE ROAD CAN WAIT</div><h2 id="dialog-title">A moment of quiet.</h2><p class="dialog-description">Your little corner of the world will be right here.</p><div class="pause-actions"><button class="primary-action" data-action="resume">${icon('play')} Back to the woodland ${icon('arrow-right')}</button><button data-action="settings">${icon('sliders-horizontal')} World settings ${icon('chevron-right')}</button><button data-action="help">${icon('compass')} A guide to exploring ${icon('chevron-right')}</button><button data-action="reset" ${this.world.adventure.inventory.arrived ? '' : 'disabled'}>${icon('rotate-ccw')} Return to the wagon</button></div><div class="dialog-footnote">TRIBOAR TRAIL · THE SWORD COAST</div>`;
    return `${close}<div class="dialog-eyebrow">A STORY LEFT BEHIND</div><h2 id="dialog-title">An uneasy silence.</h2><div class="inspect-divider">◇</div><p class="inspect-copy">Two living horses wander between the ransacked belongings, lowering their heads to sniff at the emptied saddlebags. Neither appears injured. Black-fletched arrows lie in the dust nearby.</p><p class="inspect-copy">To the north, a narrow trail disappears between the trees. Bent grass and disturbed earth suggest someone passed this way.</p><div class="inspect-note">${icon('leaf')} The horses are alive. There are no enemies or combat in this chapter yet.</div><button class="primary-action" data-action="close">Leave it to the forest ${icon('arrow-right')}</button>`;
  }
  private trapFocus(e: KeyboardEvent) {
    const focusable = [...$('#dialog').querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  private togglePhoto() {
    this.photo = !this.photo; document.body.dataset.photo = String(this.photo);
    if (this.photo && document.pointerLockElement) { this.world.controller.setPaused(true); document.exitPointerLock(); setTimeout(() => { if (!this.dialog) this.world.controller.setPaused(false); }, 30); }
    if (!this.photo) this.world.renderer.domElement.focus({ preventScroll: true });
  }
  private async capture() {
    try { await this.world.screenshot(); this.toast('A little piece of the woodland, saved.'); } catch { this.toast('This browser could not save the photograph. Please try again.'); }
  }
  private async toggleAudio() {
    try {
      await this.audio.toggle();
      await this.world.adventure.animalAudio.setEnabled(this.audio.enabled);
      const button = $('#sound-toggle'); button.innerHTML = icon(this.audio.enabled ? 'volume-2' : 'volume-x');
      button.setAttribute('aria-label', this.audio.enabled ? 'Mute forest ambience' : 'Enable forest ambience'); button.title = this.audio.enabled ? 'Mute forest ambience' : 'Enable forest ambience';
      document.querySelectorAll<HTMLElement>('[data-action="audio"]').forEach(b => { b.classList.toggle('on', this.audio.enabled); b.setAttribute('aria-checked', String(this.audio.enabled)); }); refreshIcons();
    } catch { this.toast('Audio is unavailable in this browser. The woodland is still yours to explore.'); }
  }
  private async fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { this.toast('Use the preview’s expand control to open a larger window.'); }
  }
  toast(message: string) { clearTimeout(this.toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible'); this.toastTimer = window.setTimeout(() => $('#toast').classList.remove('visible'), 4200); }
  private discover(name: string) { clearTimeout(this.discoveryTimer); $('#discovery-name').textContent = name; $('#discovery').classList.add('visible'); this.discoveryTimer = window.setTimeout(() => $('#discovery').classList.remove('visible'), 4800); }
  private loadPreferences() {
    try {
      const p = JSON.parse(localStorage.getItem('astra-preferences-v1') ?? '{}');
      if (['performance', 'balanced', 'high'].includes(p.quality)) this.config.quality = p.quality;
      if (['golden', 'overcast', 'blue'].includes(p.atmosphere)) this.config.atmosphere = p.atmosphere;
      if (typeof p.volume === 'number' && Number.isFinite(p.volume)) this.config.volume = Math.max(0, Math.min(1, p.volume));
      if (typeof p.sensitivity === 'number' && Number.isFinite(p.sensitivity)) this.config.sensitivity = Math.max(.3, Math.min(2.2, p.sensitivity));
      if (typeof p.invertY === 'boolean') this.config.invertY = p.invertY;
    } catch { /* Storage may be blocked in private/embedded browsing. */ }
  }
  private savePreferences() { try { localStorage.setItem('astra-preferences-v1', JSON.stringify(this.config)); } catch { /* Settings still work for this session. */ } }
  private applyPreferences() { this.world.setQuality(this.config.quality); this.world.setAtmosphere(this.config.atmosphere); this.world.controller.sensitivity = this.config.sensitivity; this.world.controller.invertY = this.config.invertY; this.audio.setVolume(this.config.volume); this.world.adventure.animalAudio.setVolume(this.config.volume); this.updateTime(); }
  dispose() { this.abort.abort(); this.adventureUI.dispose(); this.audio.dispose(); this.world.adventure.animalAudio.dispose(); clearTimeout(this.toastTimer); clearTimeout(this.discoveryTimer); }
}
