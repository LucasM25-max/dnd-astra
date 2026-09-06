import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import script from '../src/game/narration-script.json';
import { introductionProgress, INTRO_COUNT } from '../src/game/narrator';
import { journeyPose, JOURNEY_START_X, JOURNEY_END_X } from '../src/game/road';
import { pathAmount } from '../src/engine/landscape';
const opening = `You began your adventuring career in the city of Neverwinter. A dwarf named Gundren Rockseeker hired you to bring a wagonload of provisions to the rough-and-tumble settlement of Phandalin, a couple of days' travel south of the city. Gundren was clearly excited and more than a little secretive about his reasons for the trip, saying only that he and his brothers had found "something big," and that he'd pay you ten gold pieces each for escorting his supplies safely to Barthen's Provisions, a trading post in Phandalin. He then set out ahead of you on horse, along with a warrior escort named Sildar Hallwinter, claiming he needed to arrive early to "take care of business."`;
const road = `You've spent the last few days following the High Road south from Neverwinter, and you've just recently veered east along the Triboar Trail. You've had no trouble so far, but you know this territory can be dangerous. Bandits and outlaws have been known to lurk along this road.`;
const arrival = `You've been on the Triboar Trail for about half a day and are nearing a side road leading south toward Phandalin. As you come around a bend, you stumble upon the scene of a recent battle. The woods press close to the trail here, with a steep embankment and dense thickets on either side. Two horses wander the road, sniffing at ransacked personal effects.`;
describe('the Narrator and opening route', () => {
  it('preserves the requested prose verbatim without voice tags appearing in subtitles', () => {
    expect(script.lines.slice(0, 3).map(l => l.text).join(' ')).toBe(opening);
    expect(script.lines[3].text).toBe(road); expect(script.lines.slice(4).map(l => l.text).join(' ')).toBe(arrival);
    expect(script.lines.every(l => !l.text.includes('['))).toBe(true); expect(INTRO_COUNT).toBe(4);
  });
  it('ships a real, nonempty audio file and duration for each exact passage', () => {
    const manifest = JSON.parse(readFileSync('public/audio/narration/manifest.json', 'utf8'));
    for (const line of script.lines) {
      const clip = manifest.clips[line.id]; expect(clip.duration).toBeGreaterThan(5); expect(clip.duration).toBeLessThan(100);
      expect(existsSync(`public${clip.file}`)).toBe(true); expect(readFileSync(`public${clip.file}`).length).toBeGreaterThan(10000);
    }
  });
  it('uses playback time, not frame count, to position the cutscene', () => {
    const durations = [14, 17, 11, 18, 13, 12];
    expect(introductionProgress(0, 7, durations)).toBeCloseTo(7 / 60);
    expect(introductionProgress(2, 5, durations)).toBeCloseTo(36 / 60);
    expect(introductionProgress(4, 0, durations)).toBe(1); expect(introductionProgress(-1, 0, durations)).toBe(0);
  });
  it('keeps the opening wagon on the original, continuous road and ends before the horses', () => {
    expect(journeyPose(0).x).toBe(JOURNEY_START_X); expect(journeyPose(1).x).toBeCloseTo(JOURNEY_END_X, 8);
    for (let i = 0; i <= 100; i++) { const p = journeyPose(i / 100); expect(pathAmount(p.x, p.z)).toBe(1); expect(Number.isFinite(p.yaw)).toBe(true); }
  });
});
