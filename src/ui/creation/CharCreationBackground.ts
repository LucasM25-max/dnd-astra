/**
 * Creation backdrop: the pre-rendered dusk skyline with a slow cinematic pan.
 * If the sky texture is missing the CSS gradient fallback still carries the scene.
 */
export function createCreationBackground(): HTMLElement {
  const bg = document.createElement('div');
  bg.className = 'creation-bg';
  bg.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img');
  img.className = 'creation-bg-pan';
  img.src = '/images/skies/sky_dusk.webp';
  img.alt = '';
  img.addEventListener('error', () => img.remove());
  const vignette = document.createElement('div');
  vignette.className = 'creation-bg-vignette';
  bg.append(img, vignette);
  return bg;
}
