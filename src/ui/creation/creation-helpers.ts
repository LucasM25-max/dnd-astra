/** Escape user text (hero names) before injecting into HTML. */
export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PATHS: Record<string, string> = {
  shield: 'M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z',
  sword: 'M4 20l3-1 9-9 2-5-5 2-9 9z M14 6l4 4',
  swords: 'M4 4l9 9 M4 20L5 15l9-9 M20 4l-9 9 M20 20l-1-5-9-9',
  axe: 'M5 3c5 0 9 2 11 7-3 1-8 0-11-7z M7 10L4 21',
  hammer: 'M4 9l7-5 4 3-7 5z M11 11l8 8',
  bow: 'M6 3c6 3 6 15 0 18 M6 3l4 3 M6 21l4-3 M10 6v12',
  quiver: 'M9 4h6l-1 16H10z M13 4l4-2 M10 4L7 2 M12 8v4',
  heart: 'M12 20s-7-4.3-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.7-7 10-7 10z',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z M12 12m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0',
  zap: 'M13 2L4 14h6l-1 8 9-12h-6z',
  check: 'M4 12.5l5 5L20 6.5',
  dice: 'M5 5h14v14H5z M9 9h.1 M15 9h.1 M12 12h.1 M9 15h.1 M15 15h.1',
  chevron: 'M9 5l7 7-7 7',
  back: 'M15 5l-7 7 7 7',
  x: 'M6 6l12 12 M18 6L6 18',
  moon: 'M19 13.5A7.5 7.5 0 0110.5 5 7.5 7.5 0 1019 13.5z',
  coin: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 8v8 M9.5 10h4a2 2 0 010 4H10',
  pack: 'M7 8V6a5 5 0 0110 0v2 M5 8h14l-1 12H6z M9 12v4 M15 12v4',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
  helmet: 'M4 13a8 8 0 0116 0v4H4z M4 17h16 M12 5v4',
  scroll: 'M7 3h11a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z M9 8h6 M9 12h6 M9 16h4',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.1',
  speaker: 'M4 10v4h4l5 4V6l-5 4z M16 9a4 4 0 010 6',
  feather: 'M20 4c-5 0-11 4-13 10l-3 6 6-3c6-2 10-8 10-13z M8 16l6-6',
  paw: 'M12 12c1.8 0 3.5 1.4 3.5 3.4 0 2.2-1.6 3.6-3.5 3.6s-3.5-1.4-3.5-3.6c0-2 1.7-3.4 3.5-3.4z M7 9.5a1.8 1.8 0 113.6 0 M13.4 9.5a1.8 1.8 0 113.6 0 M9.5 6a1.8 1.8 0 113.6 0',
  dumbbell: 'M4 9v6 M7 7v10 M17 7v10 M20 9v6 M7 12h10',
  book: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z M8 4v13 M11 8h4',
  flame: 'M12 3c1 4-4 5.5-4 10a4 4 0 008 0c0-2-1-3.5-2-5-.6 1.4-1.6 2-2.6 2C13 8.5 12.6 5.5 12 3z',
  search: 'M10 4a6 6 0 104.5 10L19 19 M13.5 13.5L19 19',
  compass: 'M12 21a9 9 0 100-18 9 9 0 000 18z M15.5 8.5l-2 5-5 2 2-5z',
  footprints: 'M6 4c2 0 3 2.5 3 5s-1 4-3 4-3-1.5-3-4S4 4 6 4z M18 9c-2 0-3 2.5-3 5s1 4 3 4 3-1.5 3-4-1-5-3-5z M6 17v3 M18 14v3',
  shirt: 'M8 4l4 2 4-2 4 4-3 3v11H7V11L4 8l4-4z',
};

export function icon(name: string, cls = 'cc-icon'): string {
  const d = PATHS[name] ?? PATHS.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

/** Darken a #rrggbb hex colour by `amt` (0–1). */
export function darken(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v * (1 - amt))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Skill icon per card in the class/species pickers. */
export const SKILL_ICONS: Record<string, string> = {
  acrobatics: 'feather',
  animal_handling: 'paw',
  athletics: 'dumbbell',
  history: 'book',
  insight: 'eye',
  intimidation: 'flame',
  perception: 'search',
  survival: 'compass',
};
