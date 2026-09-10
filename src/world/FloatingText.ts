import * as THREE from 'three';

/** Floating combat-text numbers (+5 HP) projected from world to screen. */
export class FloatingText {
  constructor(private camera: THREE.Camera) {}

  show(text: string, kind: 'heal' | 'info' | 'debuff', worldPos: THREE.Vector3): void {
    const host = document.getElementById('experience') ?? document.body;
    const projected = worldPos.clone().project(this.camera);
    if (projected.z > 1) return;
    const el = document.createElement('div');
    el.className = `float-text ${kind}`;
    el.textContent = text;
    el.style.left = `${((projected.x + 1) / 2) * 100}%`;
    el.style.top = `${((-projected.y + 1) / 2) * 100}%`;
    host.append(el);
    window.setTimeout(() => el.remove(), 2300);
  }
}
