/**
 * The Calendar of Harptos: twelve 30-day months, four seasons, and the
 * named days. The game clock runs at one in-game minute per five real
 * seconds, so two hours of play cover one full in-game day.
 */

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export const SEASONS: Record<Season, string> = { winter: 'Winter', spring: 'Spring', summer: 'Summer', autumn: 'Autumn' };

export interface HarptosMonth { name: string; epithet: string; season: Season }
export const MONTHS: HarptosMonth[] = [
  { name: 'Hammer', epithet: 'Deepwinter', season: 'winter' },
  { name: 'Alturiak', epithet: 'The Claw of Winter', season: 'winter' },
  { name: 'Ches', epithet: 'The Claw of Sunsets', season: 'winter' },
  { name: 'Tarsakh', epithet: 'The Claw of Storms', season: 'spring' },
  { name: 'Mirtul', epithet: 'The Melting', season: 'spring' },
  { name: 'Kythorn', epithet: 'The Time of Flowers', season: 'spring' },
  { name: 'Flamerule', epithet: 'Summertime', season: 'summer' },
  { name: 'Eleasias', epithet: 'Highsun', season: 'summer' },
  { name: 'Eleint', epithet: 'The Fading', season: 'summer' },
  { name: 'Marpenoth', epithet: 'Leafall', season: 'autumn' },
  { name: 'Uktar', epithet: 'The Rotting', season: 'autumn' },
  { name: 'Nightal', epithet: 'The Drawing Down', season: 'autumn' },
];
export const MONTH_LENGTH = 30;

export type HolidayTone = 'winter' | 'spring' | 'summer' | 'autumn';
export interface Holiday { name: string; tone: HolidayTone; blurb: string }

/** Named days of the year, keyed `${monthIndex}-${day}`. */
export const HOLIDAYS: Record<string, Holiday> = {
  '2-19': { name: 'Midwinter', tone: 'winter', blurb: 'The longest night. Fires are lit against the dark.' },
  '5-20': { name: 'Day of New Leaves', tone: 'spring', blurb: 'The woods put out their first bright growth.' },
  '8-21': { name: 'Highharvestide', tone: 'summer', blurb: 'The third day of the harvest thanksgiving.' },
  '11-20': { name: 'Feast of the Long Night', tone: 'autumn', blurb: 'Lanterns out; the year turns toward winter.' },
};
export const holidayOf = (month: number, day: number): Holiday | null => HOLIDAYS[`${month}-${day}`] ?? null;

export const nextHoliday = (month: number, day: number): { holiday: Holiday; inDays: number } | null => {
  const today = holidayOf(month, day);
  if (today) return { holiday: today, inDays: 0 };
  for (let d = 1; d <= 360; d++) {
    let m = month, dd = day + d;
    while (dd > MONTH_LENGTH) { dd -= MONTH_LENGTH; m = (m + 1) % 12; }
    const h = holidayOf(m, dd);
    if (h) return { holiday: h, inDays: d };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/** One in-game minute passes every five real seconds: 2 real hours = 1 day. */
export const MINUTES_PER_REAL_SECOND = 1 / 5;
export const MINUTES_PER_DAY = 1440;

export class GameClock {
  month = 2; // Ches
  day = 15;
  minuteOfDay = 870; // 14:30 — a quiet afternoon
  private seasonCache: Season = MONTHS[this.month].season;

  constructor(month = 2, day = 15, minuteOfDay = 870) {
    this.month = Math.min(11, Math.max(0, Math.floor(month)));
    this.day = Math.min(MONTH_LENGTH, Math.max(1, Math.floor(day)));
    this.minuteOfDay = Math.min(1439, Math.max(0, Math.floor(minuteOfDay)));
    this.seasonCache = MONTHS[this.month].season;
  }
  get season(): Season { return this.seasonCache; }
  get hour() { return Math.floor(this.minuteOfDay / 60); }
  get minute() { return Math.floor(this.minuteOfDay % 60); }
  /** Fractional hour 0..24. */
  get hourF() { return this.minuteOfDay / 60; }
  setMinuteOfDay(minutes: number) {
    this.minuteOfDay = Math.min(1439, Math.max(0, Math.floor(minutes)));
  }
  restore(month: number, day: number, minuteOfDay: number) {
    this.month = Math.min(11, Math.max(0, Math.floor(month)));
    this.day = Math.min(MONTH_LENGTH, Math.max(1, Math.floor(day)));
    this.minuteOfDay = Math.min(1439, Math.max(0, Math.floor(minuteOfDay)));
    this.seasonCache = MONTHS[this.month].season;
  }
  nextDay() {
    if (this.day < MONTH_LENGTH) this.day++;
    else { this.day = 1; this.month = (this.month + 1) % 12; }
    this.seasonCache = MONTHS[this.month].season;
  }
  /** Advance the game clock by whole hours (short rests, travel). */
  advanceHours(hours: number): void {
    let m = this.minuteOfDay + Math.round(hours * 60);
    while (m >= MINUTES_PER_DAY) { m -= MINUTES_PER_DAY; this.nextDay(); }
    while (m < 0) m += MINUTES_PER_DAY;
    this.minuteOfDay = m;
  }
  advance(realSeconds: number) {
    let m = this.minuteOfDay + Math.max(0, realSeconds) * MINUTES_PER_REAL_SECOND;
    while (m >= MINUTES_PER_DAY) { m -= MINUTES_PER_DAY; this.nextDay(); }
    this.minuteOfDay = m;
  }
  /** Advance to the next 06:00 (an optional long rest). */
  restUntilMorning() {
    if (this.minuteOfDay < 360) { this.minuteOfDay = 360; return false; }
    this.nextDay(); this.minuteOfDay = 360; return true;
  }
  dateLabel() { return `${this.day} ${MONTHS[this.month].name}`; }
  timeLabel() {
    const h = this.hour, m = this.minute;
    const period = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }
  get epochMinutes() { return (this.month * MONTH_LENGTH + (this.day - 1)) * MINUTES_PER_DAY + this.minuteOfDay; }
}

// ---------------------------------------------------------------------------
// Sun geometry (pure math, unit-testable)
// ---------------------------------------------------------------------------

const DAY_LENGTHS: Record<Season, [number, number]> = {
  winter: [8.25, 16.25], // 8 hours of daylight in the deep months
  spring: [7.25, 18.25],
  summer: [6.25, 20.25], // 14 hours under highsun
  autumn: [7.25, 18.25],
};
const MAX_ELEVATION: Record<Season, number> = { winter: 38, spring: 48, summer: 58, autumn: 48 };

export const sunriseSunset = (season: Season): [number, number] => DAY_LENGTHS[season];

/** Sun elevation in degrees; negative below the horizon. Continuous at the horizon — a smooth ~1-hour dawn and dusk, no pops. */
export function sunElevation(hour: number, season: Season): number {
  const [rise, set] = DAY_LENGTHS[season];
  const t = (hour - rise) / (set - rise);
  if (t > 0 && t < 1) return Math.sin(Math.PI * t) * MAX_ELEVATION[season];
  const d = Math.min(1, Math.max(0, t < 0 ? -t : t - 1)); // 0 at the horizon, 1 an hour of night on either side
  return -30 * d;
}
/** Sun azimuth in degrees, 0 = north, 90 = east, clockwise. */
export function sunAzimuth(hour: number, season: Season): number {
  const [rise, set] = DAY_LENGTHS[season];
  const t = Math.min(1, Math.max(0, (hour - rise) / (set - rise)));
  return 90 + 180 * t;
}
/**
 * Direction to the sun, unit vector, world axes: +x east, +y up, -z north.
 * East at sunrise, due south at midday, west at sunset.
 */
export function sunDirection(hour: number, season: Season): { x: number; y: number; z: number } {
  const el = (sunElevation(hour, season) * Math.PI) / 180;
  const az = (sunAzimuth(hour, season) * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}
/** 0 = deep night, 1 = full daylight; a twilight band spans +/- a few degrees. */
export function daylightFactor(hour: number, season: Season): number {
  const el = sunElevation(hour, season);
  const t = (el + 4) / 10;
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export type WeatherId = 'sun' | 'overcast' | 'rain' | 'storm' | 'snow' | 'wind';
export const WEATHER_IDS: WeatherId[] = ['sun', 'overcast', 'rain', 'storm', 'snow', 'wind'];
export const WEATHER_NAMES: Record<WeatherId, string> = {
  sun: 'Clear skies', overcast: 'Heavy cloud', rain: 'Rain', storm: 'A storm', snow: 'Snow', wind: 'Winds',
};
export const WEATHER_LINES: Record<WeatherId, string> = {
  sun: 'A quiet sky', overcast: 'Grey light through the trees', rain: 'Rain falls softly',
  storm: 'Thunder rolls in', snow: 'Snow drifts down', wind: 'The wind rises',
};

const WEIGHTS: Record<Season, Record<WeatherId, number>> = {
  winter: { snow: .30, overcast: .26, sun: .14, wind: .14, rain: .10, storm: .06 },
  spring: { rain: .30, sun: .24, overcast: .22, wind: .12, storm: .12, snow: 0 },
  summer: { sun: .44, overcast: .18, storm: .16, rain: .16, wind: .06, snow: 0 },
  autumn: { rain: .30, overcast: .24, sun: .20, wind: .14, storm: .12, snow: 0 },
};
export const pickWeather = (season: Season, rand: () => number = Math.random): WeatherId => {
  let roll = rand();
  for (const id of WEATHER_IDS) {
    roll -= WEIGHTS[season][id];
    if (roll <= 0) return id;
  }
  return 'sun';
};

/** How hard the weather hits (rainfall amount, gust strength, etc). */
export const WEATHER_STRENGTH: Record<WeatherId, number> = {
  sun: 0, overcast: 0, rain: 1, storm: 1.35, snow: 1, wind: 1,
};
export const WIND_SPEED: Record<WeatherId, number> = {
  sun: .6, overcast: 1.1, rain: 3.2, storm: 7.5, snow: 1.6, wind: 5.5,
};
