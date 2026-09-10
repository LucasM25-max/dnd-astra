/** Cinematic BG3-style subtitles: bottom-centre, white on shadow, no box. */
let root: HTMLElement | null = null;
let textEl: HTMLElement | null = null;
let typeTimer = 0;

function ensure(): void {
  if (root) return;
  const host = document.getElementById('experience') ?? document.body;
  root = document.createElement('div');
  root.id = 'cinematic-subtitles';
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = '<span id="cinematic-subtitles-text"></span>';
  host.append(root);
  textEl = root.querySelector('#cinematic-subtitles-text');
}

export function showCinematicSubtitle(text: string): void {
  ensure();
  window.clearInterval(typeTimer);
  const full = `NARRATOR: “${text}”`;
  root!.classList.add('visible');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    textEl!.textContent = full;
    return;
  }
  // Typewriter fade-in, capped so long lines never lag the voice.
  const step = Math.max(1, Math.floor(full.length / 40));
  let i = 0;
  textEl!.textContent = '';
  typeTimer = window.setInterval(() => {
    i += step;
    textEl!.textContent = full.slice(0, i);
    if (i >= full.length) window.clearInterval(typeTimer);
  }, 30);
}

export function hideCinematicSubtitle(): void {
  window.clearInterval(typeTimer);
  root?.classList.remove('visible');
}
