import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Narrator } from '../src/game/narrator';
class FakeAudio {
  static latest: FakeAudio;
  currentTime = 0; duration = 10; readyState = 4; paused = true; ended = false; muted = false; volume = 1; preload = ''; src = '';
  onended: (() => void) | null = null; onerror: (() => void) | null = null; onloadedmetadata: (() => void) | null = null;
  playCalls = 0; blocked = false;
  constructor() { FakeAudio.latest = this; }
  load() { this.currentTime = 0; this.ended = false; this.onloadedmetadata?.(); }
  async play() { this.playCalls++; if (this.blocked) throw new DOMException('Blocked', 'NotAllowedError'); this.paused = false; }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
  finish() { this.currentTime = this.duration; this.ended = true; this.onended?.(); }
}
beforeEach(() => { vi.stubGlobal('Audio', FakeAudio); vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ clips: {} }) })); });
afterEach(() => vi.unstubAllGlobals());
describe('narration transport and control handoff', () => {
  it('does not autoplay before the player begins the journey', async () => {
    const n = new Narrator(); await n.initialize(); expect(FakeAudio.latest.playCalls).toBe(0); expect(n.state.phase).toBe('title'); n.dispose();
  });
  it('hands control back exactly once after all four opening passages, then reads the arrival', async () => {
    const n = new Narrator(), handoff = vi.fn(), complete = vi.fn(); n.onHandoff = handoff; n.onComplete = complete;
    await n.initialize(); n.start(); const a = FakeAudio.latest;
    for (let i = 0; i < 3; i++) { a.finish(); expect(handoff).not.toHaveBeenCalled(); }
    a.finish(); expect(handoff).toHaveBeenCalledTimes(1); expect(n.state.phase).toBe('arrival'); expect(n.state.index).toBe(4);
    n.skipJourney(); expect(handoff).toHaveBeenCalledTimes(1);
    a.finish(); a.finish(); expect(n.state.phase).toBe('exploration'); expect(n.state.active).toBe(false); expect(complete).toHaveBeenCalledTimes(1); n.dispose();
  });
  it('ignores stale ended callbacks after changing pages', async () => {
    const n = new Narrator(); await n.initialize(); n.start(); const stale = FakeAudio.latest.onended;
    n.next(); stale?.(); expect(n.state.index).toBe(1); n.dispose();
  });
  it('preserves a deliberate reader pause when a menu is opened and closed', async () => {
    const n = new Narrator(); await n.initialize(); n.start(); n.togglePause(); n.setPaused(true); n.setPaused(false);
    expect(n.state.paused).toBe(true); expect(FakeAudio.latest.paused).toBe(true);
    n.togglePause(); expect(n.state.paused).toBe(false); expect(FakeAudio.latest.paused).toBe(false); n.dispose();
  });
  it('keeps subtitles and the journey usable if browser audio playback is denied', async () => {
    const n = new Narrator(); await n.initialize(); FakeAudio.latest.blocked = true; n.start(); await Promise.resolve(); await Promise.resolve();
    expect(n.state.fallback).toBe(true); n.update(40); expect(n.state.index).toBe(1);
    n.skipJourney(); expect(n.state.phase).toBe('arrival'); n.dispose();
  });
  it('resumes an existing save without replaying or duplicating the opening handoff', async () => {
    const n = new Narrator(), handoff = vi.fn(); n.onHandoff = handoff; await n.initialize(); n.start(true);
    expect(n.state.phase).toBe('exploration'); expect(n.state.active).toBe(false); expect(handoff).not.toHaveBeenCalled(); n.dispose();
  });
});
