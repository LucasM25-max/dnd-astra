/** Shared HP globe renderer (character-creation summary + gameplay HUD). */

export function hpGlobeSVG(current: number, max: number, size = 64): string {
  const frac = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const r = 24, circ = 2 * Math.PI * r;
  const off = circ * (1 - frac);
  const low = frac <= 0.25;
  return `<svg class="hp-globe${low ? ' low' : ''}" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="Health ${current} of ${max}">`
    + `<defs><radialGradient id="hpglobe-grad" cx="35%" cy="30%" r="80%">`
    + `<stop offset="0%" stop-color="#ff9a86"/><stop offset="55%" stop-color="#c0392b"/><stop offset="100%" stop-color="#6e1a12"/>`
    + `</radialGradient></defs>`
    + `<circle cx="32" cy="32" r="29" fill="#101018" stroke="#c9a84c" stroke-width="2.5"/>`
    + `<circle cx="32" cy="32" r="24" fill="#1c0e0c"/>`
    + `<circle cx="32" cy="32" r="24" fill="none" stroke="#33222a" stroke-width="7"/>`
    + `<circle cx="32" cy="32" r="24" fill="none" stroke="url(#hpglobe-grad)" stroke-width="7" stroke-linecap="round"`
    + ` stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 32 32)"/>`
    + `<text class="hp-num" x="32" y="31" text-anchor="middle">${current}</text>`
    + `<text class="hp-max" x="32" y="44" text-anchor="middle">/ ${max}</text>`
    + `</svg>`;
}
