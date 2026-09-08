export const mark = `<svg class="astra-mark" viewBox="0 0 40 48" fill="none" aria-hidden="true"><path d="M20 2 37 31 20 45 3 31 20 2Z"/><path d="M20 2v43M3 31h34L20 17 3 31Zm17-14v28"/><path d="m20 8 12.5 22L20 39.5 7.5 30 20 8Z" opacity=".35"/></svg>`;
export function renderShell(host: HTMLElement) {
  host.innerHTML = `
    <main id="experience" aria-label="Astra woodland explorer">
      <div id="world"></div>
      <div class="screen-shade" aria-hidden="true"></div><div class="cinema-borders" aria-hidden="true"></div>
      <div class="hud">
        <header class="topbar">
          <div class="brand">${mark}<div class="brand-name">ASTRA<span>A WORLD BEYOND THE MAP</span></div><span class="preview-tag">CHAPTER ONE</span></div>
          <div class="compass"><canvas id="compass-canvas" aria-label="Compass heading east"></canvas></div>
          <nav class="world-tools" aria-label="World tools">
            <span class="live-indicator"><span></span><span id="live-mode">THE OPENING CHAPTER</span></span><span class="hud-wallet"><i data-lucide="coins"></i><span id="hud-gold">0 gp</span></span><button class="icon-button inventory-tool" id="inventory-toggle" aria-label="Open inventory" title="Inventory · I"><i data-lucide="backpack"></i><span id="inventory-count">0</span></button><button class="icon-button" id="journal-toggle" aria-label="Open story journal" title="Story journal · N"><i data-lucide="book-open"></i></button>
            <button class="icon-button" id="sound-toggle" aria-label="Enable forest ambience" title="Enable forest ambience"><i data-lucide="volume-x"></i></button>
            <button class="icon-button" id="photo-toggle" aria-label="Photo mode" title="Photo mode · P"><i data-lucide="camera"></i></button>
            <span class="tool-separator"></span>
            <button class="icon-button" id="settings-toggle" aria-label="World settings" title="World settings"><i data-lucide="sliders-horizontal"></i></button>
            <button class="icon-button fullscreen-button" id="fullscreen-toggle" aria-label="Enter fullscreen" title="Enter fullscreen"><i data-lucide="maximize"></i></button>
          </nav>
        </header>
        <div class="region-label"><span class="region-rule"></span><div><span class="micro-label">THE SWORD COAST</span><p id="region-name">Triboar Trail</p></div></div>
        <section class="welcome" aria-labelledby="world-title">
          <div class="chapter"><span class="chapter-diamond">◇</span> THE SWORD COAST <span class="chapter-divider"></span> CHAPTER I</div>
          <h1 id="world-title">Triboar Trail<span class="title-period">.</span></h1>
          <div class="scene-tag"><span></span> A DELIVERY FOR GUNDREN</div>
          <p class="welcome-copy">A wagon full of provisions. A promise to keep.<br>Some roads lead to more than a destination.</p>
          <div class="title-actions"><button class="enter-button" id="enter-world"><span>Begin your journey</span><i data-lucide="arrow-right"></i></button><button class="character-button" id="character-create"><i data-lucide="user-round-pen"></i><span>Create character</span></button></div>
          <div class="welcome-note" id="welcome-save-note">A VOICED OPENING · YOUR ADVENTURE BEGINS HERE</div>
        </section>
        <div class="journey-status"><div class="traveller-emblem"><i data-lucide="footprints"></i></div><div><span class="micro-label" id="travel-mode">AT THE REINS</span><p id="travel-flavour">A promise to keep.</p></div><div class="journey-line"></div></div>
        <button id="mount-toggle" class="mount-button" hidden><i data-lucide="log-out"></i><span id="mount-label">Step down</span><kbd>R</kbd></button><aside class="map-cluster" aria-label="Local area">
          <button id="time-toggle" class="time-of-day" aria-label="Change atmosphere"><i data-lucide="sun"></i><div><span id="time-label">GOLDEN HOUR</span><small id="time-detail">A quiet afternoon</small></div></button>
          <button class="minimap-panel" id="map-toggle" aria-label="Open world map" aria-haspopup="dialog">
            <div class="minimap-heading"><span>YOUR SURROUNDINGS</span><i data-lucide="expand"></i></div>
            <div class="minimap-frame"><canvas id="minimap-canvas" aria-label="Live local map without grid"></canvas><div class="minimap-corner tl"></div><div class="minimap-corner tr"></div><div class="minimap-corner bl"></div><div class="minimap-corner br"></div></div>
            <div class="minimap-bottom"><span>Triboar Trail</span><kbd>M</kbd></div>
          </button>
          <div class="scene-build"><span class="scene-build-dot"></span> THE TRIBOAR TRAIL <span>CHAPTER I</span></div>
        </aside>
        <footer class="bottom-bar">
          <div class="control-hints" aria-label="Keyboard controls">
            <div class="control-item"><span class="key-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span class="foot-hint">Walk</span><span class="wagon-hint">Guide & steer</span></div>
            <div class="control-item"><i data-lucide="mouse"></i><span>Look</span></div>
            <div class="control-item optional-control"><kbd class="wide-key">SHIFT</kbd><span class="foot-hint">Sprint</span><span class="wagon-hint">Steady pace</span></div>
            <div class="control-item optional-control"><kbd class="wide-key">SPACE</kbd><span class="foot-hint">Jump</span><span class="wagon-hint">Brake</span></div>
          </div>
          <div class="view-switch" role="group" aria-label="Camera perspective">
            <button data-view="first" aria-pressed="false"><i data-lucide="eye"></i><span>First person</span></button>
            <button data-view="third" class="selected" aria-pressed="true"><i data-lucide="person-standing"></i><span>Third person</span></button>
            <kbd>V</kbd>
          </div>
          <button id="help-toggle" class="help-button" aria-label="Show controls"><i data-lucide="circle-help"></i><span>Controls</span><kbd>H</kbd></button>
        </footer>
        <div class="pointer-hint" id="pointer-hint"><span class="hint-dot"></span> Hold and drag to look <span>·</span> <kbd>WASD</kbd> to move</div>
        <div class="crosshair" aria-hidden="true"></div>
        <button id="inspect-prompt" class="inspect-prompt" hidden><kbd>E</kbd><span id="inspect-label">Inspect the cargo manifest</span></button>
        <button id="journey-skip" class="journey-skip" hidden><span>Skip opening</span><i data-lucide="skip-forward"></i></button>
        <section id="narrator-panel" class="narrator-panel" aria-label="Narrator dialogue">
          <div class="narrator-top"><span class="narrator-seal">◇</span><span class="narrator-name">NARRATOR</span><span class="narrator-heading" id="narrator-heading"></span><span class="narrator-page" id="narrator-page">1 / 4</span></div>
          <p id="narrator-text" aria-live="polite" aria-atomic="true"></p>
          <div class="narrator-bottom"><span id="narrator-chapter">A DELIVERY FOR GUNDREN</span><div class="narrator-controls"><span class="narrator-audio-status" id="narrator-audio-status">THE STORY UNFOLDS</span><button id="narrator-repeat" aria-label="Replay this narration" title="Replay this passage"><i data-lucide="rotate-ccw"></i></button><button id="narrator-voice" aria-label="Mute Narrator" title="Narrator voice"><i data-lucide="volume-2"></i></button><button id="narrator-pause" aria-label="Pause narration" title="Pause or resume narration"><i data-lucide="pause"></i></button><span class="narrator-controls-divider"></span><button id="narrator-journal" aria-label="Read the complete story" title="Story journal · N"><i data-lucide="book-open"></i></button><button id="narrator-next" aria-label="Continue to the next narration" title="Continue to the next passage"><i data-lucide="chevron-right"></i></button></div></div>
          <div id="narrator-progress-track" class="narrator-progress-track" role="progressbar" aria-label="Narration progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="narrator-progress"></div></div>
        </section>
        <div class="touch-controls"><div id="joystick" role="group" aria-label="Touch movement joystick"><div id="joystick-knob"></div></div><button id="touch-jump" aria-label="Jump"><i data-lucide="arrow-up"></i></button></div>
      </div>
      <div id="discovery" class="discovery" aria-live="polite"><div>◇ &nbsp; A LITTLE FURTHER INTO THE WORLD &nbsp; ◇</div><p id="discovery-name"></p></div>
      <div id="toast" role="status" class="toast"></div>
      <div class="photo-mode-label">PHOTO MODE <span>THE TRIBOAR TRAIL</span></div>
      <div class="photo-toolbar"><div><i data-lucide="camera"></i><span>A moment in the wild</span></div><button id="capture-photo"><i data-lucide="download"></i> Save photograph</button><button id="exit-photo" class="icon-button" aria-label="Exit photo mode"><i data-lucide="x"></i></button></div>
      <div id="dialog-backdrop" class="dialog-backdrop" hidden><section id="dialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"></section></div>
      <div id="loading" class="loading-screen" role="status" aria-live="polite"><div class="loading-brand">${mark}<span>ASTRA</span></div><p>The woodland is waking.</p><div class="loading-track"><div id="loading-progress"></div></div><span id="loading-label">Finding the old road</span><div class="loading-footnote">AN EXPLORABLE WORLD · BUILT IN REAL TIME</div></div>
    </main>`;
}
