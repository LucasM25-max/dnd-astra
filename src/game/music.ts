/**
 * DramaticScore: music has been removed per request.
 * This class remains as a silent stub to maintain interface compatibility.
 */

export class DramaticScore {
  enabled = false;
  volume = 0;

  begin(): void {
    // Music has been disabled.
  }

  setEnabled(_enabled: boolean): void {
    this.enabled = false;
  }

  setVolume(_volume: number): void {
    this.volume = 0;
  }

  setPaused(_paused: boolean): void {
    // Silent stub.
  }

  setWeather(_storm: boolean, _wind: number): void {
    // Silent stub.
  }

  dispose(): void {
    // Silent stub.
  }
}
