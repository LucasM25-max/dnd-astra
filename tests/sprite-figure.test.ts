import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpriteFigure, SPRITE_DIRECTIONS, type FigureDef } from '../src/engine/actors/sprite-figure';

function figureDef(overrides: Partial<FigureDef> = {}): FigureDef {
  return {
    atlas: 'test.webp', cellW: 128, cellH: 272, columns: 16, rows: 2, height: 1.78,
    states: { idle: { rows: [0], fps: 0 }, walk: { rows: [1], fps: 3 } },
    ...overrides,
  };
}
const cameraAt = (x: number, z: number) => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
  camera.position.set(x, 2, z);
  camera.updateMatrixWorld();
  return camera;
};
const rectOf = (f: SpriteFigure) => (f as unknown as { material: THREE.ShaderMaterial }).material.uniforms.uRectA.value as THREE.Vector4;

describe('sprite figure direction selection', () => {
  it('shows the front view when the camera is directly in front', () => {
    const figure = new SpriteFigure(figureDef(), new THREE.Texture());
    figure.place(0, 0, 0);              // facing -Z
    figure.root.updateMatrixWorld(true);
    figure.update(1 / 60, { speed: 0, pose: 'idle', crouch: 0, actionPhase: 0 }, cameraAt(0, -5));
    expect(rectOf(figure).x).toBeCloseTo(0 / SPRITE_DIRECTIONS, 5);   // column 0
  });

  it('shows the right flank when the camera is at the actor\'s right hand (+X)', () => {
    const figure = new SpriteFigure(figureDef(), new THREE.Texture());
    figure.place(0, 0, 0);
    figure.root.updateMatrixWorld(true);
    figure.update(1 / 60, { speed: 0, pose: 'idle', crouch: 0, actionPhase: 0 }, cameraAt(5, 0));
    expect(rectOf(figure).x).toBeCloseTo(4 / SPRITE_DIRECTIONS, 2);   // column 4
  });

  it('shows the back view when the camera is behind', () => {
    const figure = new SpriteFigure(figureDef(), new THREE.Texture());
    figure.place(0, 0, 0);
    figure.root.updateMatrixWorld(true);
    figure.update(1 / 60, { speed: 0, pose: 'idle', crouch: 0, actionPhase: 0 }, cameraAt(0, 5));
    expect(rectOf(figure).x).toBeCloseTo(8 / SPRITE_DIRECTIONS, 2);   // column 8
  });

  it('shows the left flank when the camera is at the actor\'s left hand (-X)', () => {
    const figure = new SpriteFigure(figureDef(), new THREE.Texture());
    figure.place(0, 0, 0);
    figure.root.updateMatrixWorld(true);
    figure.update(1 / 60, { speed: 0, pose: 'idle', crouch: 0, actionPhase: 0 }, cameraAt(-5, 0));
    expect(rectOf(figure).x).toBeCloseTo(12 / SPRITE_DIRECTIONS, 2);  // column 12
  });

  it('rotates the selection with the actor\'s own facing', () => {
    const figure = new SpriteFigure(figureDef(), new THREE.Texture());
    figure.place(0, 0, Math.PI / 2);    // yaw +90°: the actor now faces -X, its right flank points -Z
    figure.root.updateMatrixWorld(true);
    figure.update(1 / 60, { speed: 0, pose: 'idle', crouch: 0, actionPhase: 0 }, cameraAt(0, -5));
    expect(rectOf(figure).x).toBeCloseTo(4 / SPRITE_DIRECTIONS, 1);
  });

  it('billboards the card toward the camera without pitch', () => {
    const figure = new SpriteFigure(figureDef(), new THREE.Texture());
    figure.place(0, 0, 0);
    figure.root.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(3, 8, 3);       // high camera: card must still only yaw
    camera.updateMatrixWorld();
    figure.update(1 / 60, { speed: 0, pose: 'idle', crouch: 0, actionPhase: 0 }, camera);
    const mesh = (figure as unknown as { mesh: THREE.Mesh }).mesh;
    expect(mesh.rotation.x).toBeCloseTo(0, 5);
    expect(mesh.rotation.z).toBeCloseTo(0, 5);
    expect(mesh.rotation.y).toBeCloseTo(Math.atan2(3, 3), 5);
  });

  it('uses world position and yaw when parented under a rotated group', () => {
    const parent = new THREE.Group();
    parent.rotation.y = Math.PI;        // avatar looking back over +Z
    parent.position.set(10, 0, 10);
    const figure = new SpriteFigure(figureDef(), new THREE.Texture());
    parent.add(figure.root);
    figure.root.updateMatrixWorld(true);
    figure.update(1 / 60, { speed: 0, pose: 'idle', crouch: 0, actionPhase: 0 }, cameraAt(10, 20)); // due +Z of the actor
    // World yaw of the figure is π (facing +Z); the camera at +Z is in FRONT → column 0.
    expect(rectOf(figure).x).toBeCloseTo(0, 1);
  });

  it('plays walk rows at a speed-scaled cadence and stays finite', () => {
    const figure = new SpriteFigure(figureDef(), new THREE.Texture());
    figure.place(0, 0, 0);
    figure.root.updateMatrixWorld(true);
    for (let i = 0; i < 600; i++) {
      figure.update(1 / 60, { speed: 1.2, pose: 'walk', crouch: 0, actionPhase: 0 }, cameraAt(Math.sin(i * .01) * 5, Math.cos(i * .01) * 5));
    }
    const blend = (figure as unknown as { material: THREE.ShaderMaterial }).material.uniforms.uBlend.value as number;
    expect(Number.isFinite(blend)).toBe(true);
    expect(blend).toBeGreaterThanOrEqual(0);
    expect(blend).toBeLessThanOrEqual(1);
    figure.dispose();
  });
});
