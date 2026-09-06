import * as THREE from 'three';
import { CollisionField, terrainHeight } from './landscape';
import type { Materials } from './materials';

export async function createAmbush(scene: THREE.Scene, materials: Materials, collision: CollisionField) {
  for (const [x, z, angle] of [[9.07, 1.47, -.7], [10.20, 1.64, 1.1]] as const) {
    // Ransacked belongings beside the living horses; no gore or combat.
    const leather = new THREE.MeshStandardMaterial({ color: '#514b39', roughness: .95 });
    const bag = new THREE.Mesh(new THREE.BoxGeometry(.40, .22, .35, 2, 2, 2), leather);
    bag.position.set(x - .72, terrainHeight(x - .72, z + .32) + .12, z + .32); bag.rotation.set(.06, angle + .4, -.1); bag.castShadow = true; bag.receiveShadow = true; scene.add(bag);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(.035, .236, .37), new THREE.MeshStandardMaterial({ color: '#2b3027', roughness: .9 }));
    strap.position.copy(bag.position); strap.rotation.copy(bag.rotation); scene.add(strap);
  }
  const arrowWood = new THREE.MeshStandardMaterial({ color: '#62543b', roughness: .95 });
  const feather = new THREE.MeshStandardMaterial({ color: '#222923', side: THREE.DoubleSide, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const group = new THREE.Group(), x = 9.7 + Math.sin(i * 4.2) * 1.4, z = 2.0 + Math.cos(i * 2.8) * 1.3;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .7, 5), arrowWood);
    group.add(shaft);
    for (const a of [0, Math.PI / 2]) {
      const vane = new THREE.Mesh(new THREE.PlaneGeometry(.075, .13), feather); vane.position.y = .25; vane.rotation.y = a; group.add(vane);
    }
    group.position.set(x, terrainHeight(x, z) + .05, z); group.rotation.set(1.49, i * 1.7, .1); group.castShadow = true; scene.add(group);
  }
  const x = 18, z = 4.5;
  const post = new THREE.Group(); post.position.set(x, terrainHeight(x, z), z); post.rotation.z = -.08;
  const upright = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, 1.7, 7), materials.bark); upright.position.y = .78; upright.castShadow = true; post.add(upright);
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#514333'; ctx.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 80; i++) { ctx.strokeStyle = `rgba(23,20,14,${.03 + i % 4 * .015})`; ctx.beginPath(); ctx.moveTo(0, i * 1.6); ctx.lineTo(512, i * 1.6 + Math.sin(i) * 6); ctx.stroke(); }
  ctx.fillStyle = '#b0a18a'; ctx.font = '38px Georgia'; ctx.textAlign = 'center'; ctx.fillText('PHANDALIN  →', 256, 79);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, .35, .09), [materials.wood, materials.wood, materials.wood, materials.wood, new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }), materials.wood]);
  sign.position.y = 1.4; sign.castShadow = true; post.add(sign); scene.add(post);
  collision.add({ x, z, radius: .15, bottom: post.position.y, top: post.position.y + 1.6 });
}
