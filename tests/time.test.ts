import { describe, it, expect } from 'vitest';
import {
  MONTHS, MONTH_LENGTH, SEASONS, HOLIDAYS, holidayOf, nextHoliday,
  GameClock, MINUTES_PER_REAL_SECOND, sunriseSunset, sunElevation, sunAzimuth, sunDirection,
  daylightFactor, WEATHER_IDS, pickWeather,
} from '../src/game/time';
import { validateSave, newJourney } from '../src/game/save';

describe('the Calendar of Harptos', () => {
  it('has twelve 30-day months with the seasons of the Sword Coast', () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTH_LENGTH).toBe(30);
    expect(MONTHS[2].name).toBe('Ches');
    expect(MONTHS[2].season).toBe('winter');
    expect(MONTHS.map(m => m.season)).toEqual(['winter', 'winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn']);
    expect(SEASONS.winter).toBe('Winter');
  });
  it('keeps the four named days from the reference calendar', () => {
    expect(holidayOf(2, 19)?.name).toBe('Midwinter');
    expect(holidayOf(5, 20)?.name).toBe('Day of New Leaves');
    expect(holidayOf(8, 21)?.name).toBe('Highharvestide');
    expect(holidayOf(11, 20)?.name).toBe('Feast of the Long Night');
    expect(holidayOf(2, 20)).toBeNull();
  });
  it('finds the next holiday across month boundaries', () => {
    expect(nextHoliday(2, 15)).toEqual({ holiday: HOLIDAYS['2-19'], inDays: 4 });
    expect(nextHoliday(2, 29)?.holiday.name).toBe('Day of New Leaves');
    expect(nextHoliday(2, 29)?.inDays).toBe(81); // rolls through Tarsakh and Mirtul into Kythorn
    expect(nextHoliday(2, 19)?.inDays).toBe(0); // a holiday today
  });
});

describe('the game clock', () => {
  it('starts on 15 Ches at 2:30 pm, a quiet winter afternoon', () => {
    const clock = new GameClock();
    expect(clock.dateLabel()).toBe('15 Ches');
    expect(clock.timeLabel()).toBe('2:30 pm');
    expect(clock.season).toBe('winter');
  });
  it('runs at one in-game minute per five real seconds', () => {
    expect(MINUTES_PER_REAL_SECOND).toBeCloseTo(.2);
    const clock = new GameClock(2, 15, 870);
    clock.advance(5);
    expect(clock.minuteOfDay).toBeCloseTo(871);
  });
  it('labels midday and midnight in twelve-hour time', () => {
    const clock = new GameClock();
    clock.setMinuteOfDay(0); expect(clock.timeLabel()).toBe('12:00 am');
    clock.setMinuteOfDay(720); expect(clock.timeLabel()).toBe('12:00 pm');
    clock.setMinuteOfDay(360); expect(clock.timeLabel()).toBe('6:00 am');
    clock.setMinuteOfDay(1439); expect(clock.timeLabel()).toBe('11:59 pm');
  });
  it('rolls the day, month, and season over the year', () => {
    const clock = new GameClock(2, 30, 1435);
    clock.advance(25); // 5 minutes
    expect(clock.day).toBe(1); expect(clock.month).toBe(3); expect(clock.minuteOfDay).toBeCloseTo(0, 5);
    expect(clock.season).toBe('spring');
    const nightal = new GameClock(11, 30, 1435);
    nightal.advance(25);
    expect(nightal.month).toBe(0); expect(nightal.day).toBe(1); expect(nightal.season).toBe('winter');
  });
  it('rests until 6:00 am, rolling the day when needed', () => {
    const night = new GameClock(2, 15, 1380);
    expect(night.restUntilMorning()).toBe(true);
    expect(night.day).toBe(16); expect(night.minuteOfDay).toBe(360);
    const dawn = new GameClock(2, 15, 200);
    expect(dawn.restUntilMorning()).toBe(false);
    expect(dawn.day).toBe(15); expect(dawn.minuteOfDay).toBe(360);
    const exact = new GameClock(2, 15, 360);
    expect(exact.restUntilMorning()).toBe(true);
    expect(exact.day).toBe(16);
  });
});

describe('the sun over the Sword Coast', () => {
  it('gives eight hours of winter daylight from 8:15 to 4:15 pm', () => {
    expect(sunriseSunset('winter')).toEqual([8.25, 16.25]);
    expect(sunriseSunset('summer')).toEqual([6.25, 20.25]);
  });
  it('peaks due south at its seasonal maximum', () => {
    const [rise, set] = sunriseSunset('winter');
    const noon = (rise + set) / 2;
    expect(sunElevation(noon, 'winter')).toBeCloseTo(38);
    const dir = sunDirection(noon, 'winter');
    expect(dir.x).toBeCloseTo(0, 4);
    expect(dir.z).toBeGreaterThan(.7); // south, tilted back by the 38° winter noon
    expect(sunAzimuth(noon, 'winter')).toBeCloseTo(180);
  });
  it('rises in the east and sets in the west', () => {
    const rise = sunDirection(8.4, 'winter'); // fifteen minutes after sunrise
    const set = sunDirection(16.1, 'winter'); // fifteen minutes before sunset
    expect(rise.x).toBeGreaterThan(.9);
    expect(set.x).toBeLessThan(-.9);
  });
  it('is dark at midnight, bright at midday, and smooth across the horizon', () => {
    expect(daylightFactor(0, 'winter')).toBe(0);
    expect(daylightFactor(12.25, 'winter')).toBe(1);
    expect(daylightFactor(8.25, 'winter')).toBeCloseTo(.35, 1); // civil twilight right at sunrise
    expect(daylightFactor(20, 'winter')).toBe(0);
    const before = sunElevation(8.24, 'winter'), after = sunElevation(8.26, 'winter');
    expect(Math.abs(after - before)).toBeLessThan(1); // no pop at dawn
    // A full hour before sunrise the sky is still (nearly) dark; at the horizon it has begun to brighten.
    expect(daylightFactor(7.25, 'winter')).toBeLessThan(.1);
    expect(daylightFactor(8.25, 'winter')).toBeGreaterThan(.3);
  });
});

describe('the seasons and the sky', () => {
  it('chooses weather from the seasonal table only', () => {
    for (const id of WEATHER_IDS) expect(['sun', 'overcast', 'rain', 'storm', 'snow', 'wind']).toContain(id);
    const winter: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) {
      const roll = i / 3000;
      winter[pickWeather('winter', () => roll)] = (winter[pickWeather('winter', () => roll)] ?? 0) + 1;
    }
    expect(winter.snow ?? 0).toBeGreaterThan(winter.rain ?? 0); // snow is the winter voice
    expect(winter.snow ?? 0).toBeGreaterThan(winter.storm ?? 0);
    const summer = pickWeather('summer', () => 0.9999);
    expect(summer).toBe('wind');
  });
  it('never offers spring snow through the picker', () => {
    for (let i = 0; i < 2000; i++) expect(pickWeather('spring', () => i / 2000)).not.toBe('snow');
  });
});

describe('journey saves carry the calendar', () => {
  it('accepts a valid time field and rejects a broken one', () => {
    const ok = newJourney(); ok.arrived = true; ok.time = { month: 2, day: 15, minuteOfDay: 870 };
    expect(validateSave(ok)).toBe(true);
    const bad = newJourney(); bad.time = { month: 12, day: 15, minuteOfDay: 870 };
    expect(validateSave(bad)).toBe(false);
    const long = newJourney(); long.time = { month: 2, day: 15, minuteOfDay: 1440 };
    expect(validateSave(long)).toBe(false);
  });
});
