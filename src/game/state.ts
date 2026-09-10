/** Global game-state machine: base states plus transient overlays (camp, cinematics). */
export type GameBaseState = 'MAIN_MENU' | 'CHARACTER_CREATION' | 'GAMEPLAY';
export type GameOverlay = 'CAMP' | 'CINEMATIC';
export type GameState = GameBaseState | GameOverlay;

class GameStateManager {
  private base: GameBaseState = 'MAIN_MENU';
  private overlays = new Set<string>();
  onChange: () => void = () => {};

  get current(): GameState {
    if (this.overlays.size) return [...this.overlays].includes('CAMP') && !this.has('CINEMATIC:dice') && !this.has('CINEMATIC:rest') && !this.has('CINEMATIC:narration')
      ? 'CAMP'
      : 'CINEMATIC';
    return this.base;
  }

  get baseState(): GameBaseState { return this.base; }
  get inCinematic(): boolean { return [...this.overlays].some(o => o.startsWith('CINEMATIC')); }
  get inCamp(): boolean { return this.overlays.has('CAMP'); }

  setBase(state: GameBaseState) {
    this.base = state;
    document.body.dataset.gamestate = this.current.toLowerCase().replace('_', '-');
    this.onChange();
  }

  enter(overlay: GameOverlay, reason = 'default') {
    this.overlays.add(`${overlay}:${reason}`);
    document.body.dataset.gamestate = this.current.toLowerCase().replace('_', '-');
    this.onChange();
  }

  exit(overlay: GameOverlay, reason = 'default') {
    this.overlays.delete(`${overlay}:${reason}`);
    document.body.dataset.gamestate = this.current.toLowerCase().replace('_', '-');
    this.onChange();
  }

  private has(key: string) { return this.overlays.has(key); }

  /** True while input should be frozen (creation, camp menu open, any cinematic). */
  get inputFrozen(): boolean {
    return this.base !== 'GAMEPLAY' || this.overlays.size > 0;
  }
}

export const gameState = new GameStateManager();
