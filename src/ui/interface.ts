import { createIcons, ArrowRight, ArrowUp, ArrowUpRight, Camera, Check, ChevronRight, CircleHelp, Cloud, CloudLightning, CloudRain, Compass, Download, Expand, Eye, Footprints, Headphones, Leaf, Maximize, Moon, Mouse, PersonStanding, Play, RotateCcw, SlidersHorizontal, Snowflake, Sun, Volume2, VolumeX, Wind, X, Backpack, Coins, Package, PackageOpen, Wheat, Cylinder, Beer, Shovel, Pickaxe, Wrench, Lamp, Droplet, BookOpen, Search, Pause, SkipForward, LogOut, LogIn } from 'lucide';
import { ForestAudio } from '../engine/audio';
import { isFormControl, type CameraMode } from '../engine/controller';
import { WoodlandWorld, type Quality, type WorldState } from '../engine/world';
import { Cartography, paintCompass } from './cartography';
import { AdventureInterface, type AdventureDialog } from './adventure-interface';
import { DramaticScore } from '../game/music';
import { MONTH_LENGTH, MONTHS, SEASONS, WEATHER_IDS, WEATHER_LINES, holidayOf, nextHoliday, type WeatherId } from '../game/time';

type DialogKind = 'settings' | 'map' | 'help' | 'pause' | 'inspect' | AdventureDialog;
interface Preferences {
  quality: Quality; volume: number; sensitivity: number; invertY: boolean;
  musicVolume: number; musicEnabled: boolean; weatherOverride: WeatherId | 'auto';
}
const iconSet = { Barrel: Cylinder, ArrowRight, ArrowUp, ArrowUpRight, Camera, Check, ChevronRight, CircleHelp, Cloud, CloudLightning, CloudRain, Compass, Download, Expand, Eye, Footprints, Headphones, Leaf, Maximize, Moon, Mouse, PersonStanding, Play, RotateCcw, SlidersHorizontal, Snowflake, Sun, Volume2, VolumeX, Wind, X, Backpack, Coins, Package, PackageOpen, Wheat, Cylinder, Beer, Shovel, Pickaxe, Wrench, Lamp, Droplet, BookOpen, Search, Pause, SkipForward, LogOut, LogIn };
export const refreshIcons = () => createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.5 } });
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const weatherIcons: Record<WeatherId, string> = { sun: 'sun', overcast: 'cloud', rain: 'cloud-rain', storm: 'cloud-lightning', snow: 'snowflake', wind: 'wind' };
const weatherLabels: Record<WeatherId | 'auto', string> = { auto: 'Seasonal', sun: 'Sun', overcast: 'Overcast', rain: 'Rain', storm: 'Storm', snow: 'Snow', wind: 'Wind' };

export class WorldInterface {
  private audio = new ForestAudio();
  private music = new DramaticScore();
  private map = new Cartography();
  private dialog: DialogKind | null = null;
  private photo = false;
  private state: WorldState;
  private config: Preferences = { quality: 'high', volume: .4, sensitivity: 1, invertY: false, musicVolume: .5, musicEnabled: true, weatherOverride: 'auto' };
  private lastChip = '';
  private lastWeatherAudio = 0;
  private lastCalendar = '';
  private toastTimer = 0;
  private discoveryTimer = 0;
  private lastMapFrame = 0;
  private lastHeadingLabel = '';
  private abort = new AbortController();
  private adventureUI: AdventureInterface;
  constructor(private world: WoodlandWorld) {
    this.state = world.getState();
    this.loadPreferences(); this.applyPreferences();
    this.adventureUI = new AdventureInterface(world, { open: kind => this.openDialog(kind), close: () => this.closeDialog(), current: () => this.dialog, toast: message => this.toast(message), icons: refreshIcons });
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
    click('#map-toggle', () => this.openDialog('map'));
    click('#settings-toggle', () => this.openDialog('settings'));
    click('#time-toggle', () => this.openDialog('settings'));
    click('#help-toggle', () => this.openDialog('help'));
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
      if (action === 'audio') void this.toggleAudio();
      if (button.dataset.quality) {
        this.config.quality = button.dataset.quality as Quality; this.world.setQuality(this.config.quality);
        this.updateSelected('[data-quality]', 'quality', this.config.quality); this.savePreferences();
      }
      if (button.dataset.weather) {
        this.config.weatherOverride = button.dataset.weather as WeatherId | 'auto'; this.world.setWeatherOverride(this.config.weatherOverride);
        this.updateSelected('[data-weather]', 'weather', this.config.weatherOverride); this.savePreferences();
      }
      if (action === 'music') this.toggleMusic();
      if (action === 'long-rest') { const line = this.world.longRest(); if (line) { this.closeDialog(); this.toast(line); } }
    }, opts);
    $('#dialog').addEventListener('input', e => {
      const input = e.target as HTMLInputElement;
      if (!input.dataset.setting) return;
      if (input.dataset.setting === 'volume') { this.config.volume = Number(input.value) / 100; this.audio.setVolume(this.config.volume); $('#volume-value').textContent = `${input.value}%`; }
      if (input.dataset.setting === 'sensitivity') { this.config.sensitivity = Number(input.value); this.world.controller.sensitivity = this.config.sensitivity; $('#sensitivity-value').textContent = `${this.config.sensitivity.toFixed(1)}×`; }
      if (input.dataset.setting === 'invert') { this.config.invertY = input.checked; this.world.controller.invertY = input.checked; }
      if (input.dataset.setting === 'timeOfDay') { this.world.setTimeOfDay(Number(input.value)); $('#time-value').textContent = this.world.getState().time.time; }
      if (input.dataset.setting === 'musicVolume') { this.config.musicVolume = Number(input.value) / 100; this.music.setVolume(this.config.musicVolume); $('#music-value').textContent = `${input.value}%`; }
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
      this.music.begin();
      this.adventureUI.update(this.world.getState());
      if (this.config.quality === 'high' && this.state.fps < 20) this.toast('For a smoother journey, try Balanced in world settings.');
    }
    this.world.renderer.domElement.focus({ preventScroll: true });
  }
  private toggleMusic() {
    this.config.musicEnabled = !this.config.musicEnabled;
    this.music.begin();
    this.music.setEnabled(this.config.musicEnabled);
    document.querySelectorAll<HTMLElement>('[data-action="music"]').forEach(b => { b.classList.toggle('on', this.config.musicEnabled); b.setAttribute('aria-checked', String(this.config.musicEnabled)); });
    this.savePreferences();
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
    document.body.dataset.locked = String(!!document.pointerLockElement);
    $('#region-name').textContent = state.landmark === 'cragmaw' ? 'Cragmaw Trail' : state.landmark === 'ambush' ? 'The Ambush Clearing' : 'Triboar Trail';
    this.audio.update(state.distanceWalked, state.moving, state.grounded);
    this.updateChip(state);
    if (performance.now() - this.lastWeatherAudio > 250) {
      this.lastWeatherAudio = performance.now();
      this.audio.setWeatherLevels(state.weather.rain, state.weather.storm, state.weather.wind);
      this.music.setWeather(state.weather.storm > .3, state.weather.wind);
      if (this.dialog === 'map') this.updateCalendar(state);
    }
  }
  /** The little corner chip: real date, real weather, real icon. */
  private updateChip(state: WorldState) {
    const t = state.time, w = state.weather;
    const label = `${t.date} · ${t.time}`;
    if (label !== this.lastChip) {
      this.lastChip = label;
      $('#time-label').textContent = label;
    }
    const detail = `${WEATHER_LINES[w.current]} — ${SEASONS[t.season]}`;
    const button = $('#time-toggle');
    if (detail !== button.title) {
      button.title = detail;
      $('#time-detail').textContent = detail;
    }
    // The icon follows both the weather and the light — clear nights show the moon.
    const iconName = w.daylight < .2 && w.current === 'sun' ? 'moon' : weatherIcons[w.current];
    const current = button.querySelector('svg');
    if (!current || !current.classList.contains(`lucide-${iconName}`)) {
      current?.remove(); button.insertAdjacentHTML('afterbegin', icon(iconName)); refreshIcons();
    }
  }
  /** The Calendar of Harptos strip in the map dialog — refreshed while it is open. */
  private updateCalendar(state: WorldState) {
    const t = state.time, month = MONTHS[t.month], key = `${t.month}-${t.day}`;
    if (key === this.lastCalendar) return;
    this.lastCalendar = key;
    const strip = document.querySelector<HTMLElement>('#calendar-strip');
    if (!strip) return;
    const today = holidayOf(t.month, t.day), next = nextHoliday(t.month, t.day);
    const cells: string[] = [];
    for (let d = 1; d <= MONTH_LENGTH; d++) {
      const h = holidayOf(t.month, d);
      cells.push(`<span class="cal-day${d === t.day ? ' today' : ''}${h ? ' ' + h.tone : ''}"${h ? ` title="${h.name}"` : ''}>${d}</span>`);
    }
    strip.innerHTML = `<div class="cal-month"><b>${month.name}</b><span>${month.epithet}</span></div><div class="cal-days">${cells.join('')}</div><small class="cal-note">${today ? `<b>${today.name}</b> falls today.` : next ? `Next: ${next.holiday.name}, in ${next.inDays} day${next.inDays === 1 ? '' : 's'}.` : `The ${t.day}${t.day === 1 ? 'st' : t.day === 2 ? 'nd' : t.day === 3 ? 'rd' : 'th'} day of ${month.name}.`}</small>`;
  }
  openDialog(kind: DialogKind) {
    this.dialog = kind; $('.hud').inert = true; this.world.setPaused(true); this.audio.setPaused(true); this.music.setPaused(true);
    const backdrop = $('#dialog-backdrop'), dialog = $('#dialog');
    dialog.dataset.kind = kind; backdrop.dataset.mode = kind === 'cargo' ? 'side' : 'center'; dialog.innerHTML = this.dialogHTML(kind); backdrop.hidden = false; document.body.dataset.modal = 'true';
    refreshIcons();
    if (kind === 'map') {
      const mapCanvas = dialog.querySelector<HTMLCanvasElement>('#world-map-canvas');
      this.updateCalendar(this.world.getState());
      requestAnimationFrame(() => { if (this.dialog === 'map' && mapCanvas?.isConnected) this.map.render(mapCanvas, this.world.getState(), true); });
    }
    requestAnimationFrame(() => { if (this.dialog === kind) (dialog.querySelector<HTMLElement>('[data-action="close"]') ?? dialog).focus(); });
  }
  closeDialog() {
    this.dialog = null; $('.hud').inert = false; $('#dialog-backdrop').hidden = true; document.body.dataset.modal = 'false';
    this.world.setPaused(false); this.audio.setPaused(false); this.music.setPaused(false);
    this.world.renderer.domElement.focus({ preventScroll: true });
  }
  private dialogHTML(kind: DialogKind) {
    if (['inventory', 'cargo', 'journal'].includes(kind)) return this.adventureUI.dialogHTML(kind as AdventureDialog);
    const close = `<button class="icon-button dialog-close" data-action="close" aria-label="Close dialog">${icon('x')}</button>`;
    if (kind === 'settings') return `${close}<div class="dialog-eyebrow">THE FINER DETAILS</div><h2 id="dialog-title">Your world, your way.</h2><p class="dialog-description">Settle into the atmosphere that feels like you.</p>
      <div class="setting-section"><div class="setting-heading"><label>Visual quality</label><span>REAL-TIME RENDERING</span></div><div class="setting-segment">${(['performance', 'balanced', 'high'] as Quality[]).map(q => `<button data-quality="${q}" class="${this.config.quality === q ? 'selected' : ''}" aria-pressed="${this.config.quality === q}">${q === 'performance' ? 'Performance' : q === 'balanced' ? 'Balanced' : 'High fidelity'}</button>`).join('')}</div><small class="setting-note">High fidelity adds denser foliage, environment lighting, finer shadows, and cinematic bloom.</small></div>
      <div class="setting-section"><div class="setting-heading"><label for="time-slider">Time of day</label><output id="time-value">${this.state.time.time}</output></div><input id="time-slider" data-setting="timeOfDay" type="range" min="0" max="1439" step="15" value="${this.state.time.minuteOfDay}" aria-label="Time of day"><small class="setting-note">${this.state.time.date} · The day turns on its own — about two real hours per game day.</small></div>
      <div class="setting-section"><div class="setting-heading"><label>Weather</label></div><div class="atmosphere-options weather-options">${(['auto', ...WEATHER_IDS] as (WeatherId | 'auto')[]).map(w => `<button data-weather="${w}" class="${this.config.weatherOverride === w ? 'selected' : ''}" aria-pressed="${this.config.weatherOverride === w}">${icon(w === 'auto' ? 'sliders-horizontal' : weatherIcons[w])}<span>${weatherLabels[w]}</span></button>`).join('')}</div><small class="setting-note">Seasonal by default — the Calendar of Harptos decides what the sky brings.</small></div>
      <div class="setting-section"><div class="setting-heading"><label>Forest ambience</label><button class="switch ${this.audio.enabled ? 'on' : ''}" role="switch" aria-checked="${this.audio.enabled}" aria-label="Forest ambience" data-action="audio"><span></span></button></div><div class="range-row"><label for="volume">Volume</label><input id="volume" aria-label="Ambience volume" data-setting="volume" type="range" min="0" max="100" value="${Math.round(this.config.volume * 100)}"><output id="volume-value">${Math.round(this.config.volume * 100)}%</output></div></div>
      <div class="setting-section"><div class="setting-heading"><label>Journey music</label><button class="switch ${this.config.musicEnabled ? 'on' : ''}" role="switch" aria-checked="${this.config.musicEnabled}" aria-label="Journey music" data-action="music"><span></span></button></div><div class="range-row"><label for="music-volume">Music volume</label><input id="music-volume" aria-label="Music volume" data-setting="musicVolume" type="range" min="0" max="100" value="${Math.round(this.config.musicVolume * 100)}"><output id="music-value">${Math.round(this.config.musicVolume * 100)}%</output></div><small class="setting-note">A low score that follows the skies — storms gather, and so do the strings.</small></div>
      <div class="setting-section narrator-setting"><div class="setting-heading"><label>Narrator voice</label><button class="switch ${this.world.adventure.narrator.state.voiceEnabled ? 'on' : ''}" role="switch" aria-checked="${this.world.adventure.narrator.state.voiceEnabled}" aria-label="Narrator voice" data-action="narrator-voice"><span></span></button></div><small class="setting-note">The narrated opening is included locally. No API key is needed to play.</small></div><div class="setting-section last"><div class="setting-heading"><label for="sensitivity">Look sensitivity</label><output id="sensitivity-value">${this.config.sensitivity.toFixed(1)}×</output></div><input id="sensitivity" data-setting="sensitivity" type="range" min="0.3" max="2.2" step="0.1" value="${this.config.sensitivity}"><label class="checkbox-label"><input data-setting="invert" type="checkbox" ${this.config.invertY ? 'checked' : ''}>Invert vertical look</label></div><div class="dialog-footnote">${icon('check')} Preferences are saved on this device.</div>`;
    if (kind === 'map') return `${close}<div class="dialog-eyebrow">A SMALL CORNER OF THE FORGOTTEN REALMS</div><h2 id="dialog-title">The Triboar Trail</h2><p class="dialog-description">Every path begins with a little curiosity.</p><div class="world-map-frame"><canvas id="world-map-canvas" aria-label="Map of the east-west Triboar Trail and the northern Cragmaw trail, showing your position"></canvas></div><div class="map-legend"><span><b class="player-legend">▲</b> You are here</span><span><b>◇</b> Ambush clearing</span><span class="map-footnote">NORTH IS UP · NO GRID</span></div><div id="calendar-strip" class="calendar-strip"></div><div class="dialog-footnote map-instruction">${icon('compass')} Follow the narrow northern trail toward Cragmaw Hideout.</div>`;
    if (kind === 'help') return `${close}<div class="dialog-eyebrow">A FEW WAYS TO FIND YOUR FEET</div><h2 id="dialog-title">Take the scenic route.</h2><p class="dialog-description">Keep the reins, or step down and take a closer look.</p><div class="help-grid">${[
      ['W A S D', 'Walk / guide the wagon', 'W/S guide, A/D steer at the reins.'], ['SHIFT', 'Sprint on foot', 'Hold while walking.'], ['SPACE', 'Jump / wagon brake', 'Pauses narration during the cutscene.'], ['MOUSE', 'Look around', 'Click to capture, or click and drag.'], ['V', 'Change perspective', 'First person or third person.'], ['SCROLL', 'Camera distance', 'Zoom in or out in third person.'], ['M', 'World map', 'Find your place in the woodland.'], ['P', 'Photo mode', 'Hide the interface. Keep the moment.'], ['E', 'Open / inspect', 'Open nearby cargo or examine the clearing.'], ['R', 'Board / dismount', 'Step down to reach the cargo.'], ['I', 'Inventory', 'Currency, quantities, and gp values.'], ['N', 'Story journal', 'The Narrator’s complete text.'], ['ESC', 'Pause / release mouse', 'Take a breath. The world will wait.'],
    ].map(([key, label, note]) => `<div class="help-row"><kbd>${key}</kbd><div><strong>${label}</strong><span>${note}</span></div></div>`).join('')}</div><div class="dialog-footnote">${icon('leaf')} The bean is a placeholder. The adventure is just beginning.</div>`;
    if (kind === 'pause') return `${close}<div class="pause-emblem">${icon('leaf')}</div><div class="dialog-eyebrow">THE ROAD CAN WAIT</div><h2 id="dialog-title">A moment of quiet.</h2><p class="dialog-description">Your little corner of the world will be right here.</p><div class="pause-actions"><button class="primary-action" data-action="resume">${icon('play')} Back to the woodland ${icon('arrow-right')}</button><button data-action="settings">${icon('sliders-horizontal')} World settings ${icon('chevron-right')}</button><button data-action="help">${icon('compass')} A guide to exploring ${icon('chevron-right')}</button><button data-action="reset" ${this.world.adventure.inventory.arrived ? '' : 'disabled'}>${icon('rotate-ccw')} Return to the wagon</button><button data-action="long-rest" ${this.world.adventure.inventory.arrived && this.world.controller.started ? '' : 'disabled'}>${icon('moon')} Long rest — sleep until morning</button></div><div class="dialog-footnote">TRIBOAR TRAIL · THE SWORD COAST</div>`;
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
      if (typeof p.volume === 'number' && Number.isFinite(p.volume)) this.config.volume = Math.max(0, Math.min(1, p.volume));
      if (typeof p.sensitivity === 'number' && Number.isFinite(p.sensitivity)) this.config.sensitivity = Math.max(.3, Math.min(2.2, p.sensitivity));
      if (typeof p.invertY === 'boolean') this.config.invertY = p.invertY;
      if (typeof p.musicVolume === 'number' && Number.isFinite(p.musicVolume)) this.config.musicVolume = Math.max(0, Math.min(1, p.musicVolume));
      if (typeof p.musicEnabled === 'boolean') this.config.musicEnabled = p.musicEnabled;
      if (p.weatherOverride === 'auto' || (typeof p.weatherOverride === 'string' && (WEATHER_IDS as readonly string[]).includes(p.weatherOverride))) this.config.weatherOverride = p.weatherOverride;
    } catch { /* Storage may be blocked in private/embedded browsing. */ }
  }
  private savePreferences() { try { localStorage.setItem('astra-preferences-v1', JSON.stringify(this.config)); } catch { /* Settings still work for this session. */ } }
  private applyPreferences() { this.world.setQuality(this.config.quality); this.world.setWeatherOverride(this.config.weatherOverride); this.world.controller.sensitivity = this.config.sensitivity; this.world.controller.invertY = this.config.invertY; this.audio.setVolume(this.config.volume); this.music.setVolume(this.config.musicVolume); this.music.setEnabled(this.config.musicEnabled); this.updateChip(this.state); }
  dispose() { this.abort.abort(); this.adventureUI.dispose(); this.music.dispose(); this.audio.dispose(); clearTimeout(this.toastTimer); clearTimeout(this.discoveryTimer); }
}
