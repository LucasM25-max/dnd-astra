export const mark = `<svg class="astra-mark" viewBox="0 0 40 48" fill="none" aria-hidden="true"><path d="M20 2 37 31 20 45 3 31 20 2Z"/><path d="M20 2v43M3 31h34L20 17 3 31Zm17-14v28"/><path d="m20 8 12.5 22L20 39.5 7.5 30 20 8Z" opacity=".35"/></svg>`;
export function renderShell(host: HTMLElement) {
  host.innerHTML = `
    <main id="experience" aria-label="Astra woodland explorer">
      <div id="world"></div>
      <div class="screen-shade" aria-hidden="true"></div>
      <div class="hud">
        <header class="topbar">
          <div class="brand">${mark}<div class="brand-name">ASTRA<span>A WORLD BEYOND THE MAP</span></div><span class="preview-tag">WORLD PREVIEW</span></div>
          <div class="compass"><canvas id="compass-canvas" aria-label="Compass heading east"></canvas></div>
          <nav class="world-tools" aria-label="World tools">
            <span class="live-indicator"><span></span> EXPLORATION</span>
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
          <div class="scene-tag"><span></span> GOBLIN AMBUSH</div>
          <p class="welcome-copy">An old road. An ancient forest.<br>And a silence that feels a little too still.</p>
          <button class="enter-button" id="enter-world"><span>Enter the woodland</span><i data-lucide="arrow-right"></i></button>
          <div class="welcome-note">NO QUEST TO FOLLOW. JUST A WORLD TO EXPLORE.</div>
        </section>
        <div class="journey-status"><div class="traveller-emblem"><i data-lucide="footprints"></i></div><div><span class="micro-label">THE WANDERER</span><p>Make your own way.</p></div><div class="journey-line"></div></div>
        <aside class="map-cluster" aria-label="Local area">
          <button id="time-toggle" class="time-of-day" aria-label="Change atmosphere"><i data-lucide="sun"></i><div><span id="time-label">GOLDEN HOUR</span><small id="time-detail">A quiet afternoon</small></div></button>
          <button class="minimap-panel" id="map-toggle" aria-label="Open world map" aria-haspopup="dialog">
            <div class="minimap-heading"><span>YOUR SURROUNDINGS</span><i data-lucide="expand"></i></div>
            <div class="minimap-frame"><canvas id="minimap-canvas" aria-label="Live local map without grid"></canvas><div class="minimap-corner tl"></div><div class="minimap-corner tr"></div><div class="minimap-corner bl"></div><div class="minimap-corner br"></div></div>
            <div class="minimap-bottom"><span>Triboar Trail</span><kbd>M</kbd></div>
          </button>
          <div class="scene-build"><span class="scene-build-dot"></span> FREE ROAM <span>ENVIRONMENT 01</span></div>
        </aside>
        <footer class="bottom-bar">
          <div class="control-hints" aria-label="Keyboard controls">
            <div class="control-item"><span class="key-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Move</span></div>
            <div class="control-item"><i data-lucide="mouse"></i><span>Look</span></div>
            <div class="control-item optional-control"><kbd class="wide-key">SHIFT</kbd><span>Sprint</span></div>
            <div class="control-item optional-control"><kbd class="wide-key">SPACE</kbd><span>Jump</span></div>
          </div>
          <div class="view-switch" role="group" aria-label="Camera perspective">
            <button data-view="first" aria-pressed="false"><i data-lucide="eye"></i><span>First person</span></button>
            <button data-view="third" class="selected" aria-pressed="true"><i data-lucide="person-standing"></i><span>Third person</span></button>
            <kbd>V</kbd>
          </div>
          <button id="help-toggle" class="help-button" aria-label="Show controls"><i data-lucide="circle-help"></i><span>Controls</span><kbd>H</kbd></button>
        </footer>
        <div class="pointer-hint" id="pointer-hint"><span class="hint-dot"></span> Click to look around <span>·</span> <kbd>ESC</kbd> to release</div>
        <div class="crosshair" aria-hidden="true"></div>
        <button id="inspect-prompt" class="inspect-prompt" hidden><kbd>E</kbd><span>Inspect the clearing</span></button>
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
