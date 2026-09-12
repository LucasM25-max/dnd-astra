import * as THREE from 'three';
import { AnimationStateMachine, type SeatKind } from './AnimationStateMachine';
import { SkeletalHero } from './skeletal/SkeletalHero';
import type { SocketName } from './SocketManager';

export interface LocomotionSample {
  dt: number;
  speed: number;
  sprint?: boolean;
  seated?: boolean;
  seat?: SeatKind;
  paused?: boolean;
}

/** Legacy anchor aliases (wagon reins ask for handL/handR). */
const SOCKET_ALIASES: Record<string, SocketName> = {
  handL: 'offhand',
  handR: 'mainhand',
  mainhand: 'mainhand',
  offhand: 'offhand',
  back: 'back',
  hip: 'hip',
  quiver: 'quiver',
};

function domCanvasFactory(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * The player's visible body: a SkeletalHero driven by the animation state
 * machine. The movement controller feeds locomotion samples; one-shots and
 * gear flow through PlayerCharacterController onto the same hero instance.
 */
export class SkeletalPlayerActor {
  readonly root: THREE.Object3D;
  readonly hero: SkeletalHero;
  readonly anim: AnimationStateMachine;
  /** Accepted for controller compatibility; the rig casts real shadows. */
  shadowDrop = 0;

  constructor() {
    this.hero = new SkeletalHero({ canvasFactory: domCanvasFactory });
    this.anim = new AnimationStateMachine(this.hero);
    this.root = this.hero.root;
  }

  update(sample: LocomotionSample): void {
    const paused = sample.paused ?? false;
    // Pause freezes travel speed, never the pose track: kneels and sits must
    // play through interaction and rest cinematics.
    this.anim.updateLocomotion(
      sample.dt,
      paused ? 0 : sample.speed,
      sample.sprint ?? false,
      sample.seated ?? false,
      sample.seat ?? 'ground',
    );
  }

  anchorPosition(name: string, target: THREE.Vector3): THREE.Vector3 {
    const socket = SOCKET_ALIASES[name];
    if (!socket) return this.root.getWorldPosition(target);
    return this.hero.anchorPosition(socket, target);
  }

  dispose(): void {
    this.hero.dispose();
  }
}
