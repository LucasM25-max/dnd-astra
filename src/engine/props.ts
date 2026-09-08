import * as THREE from 'three';
import { CollisionField, terrainHeight } from './landscape';
import type { Materials } from './materials';

export async function createAmbush(scene: THREE.Scene, materials: Materials, collision: CollisionField) {
  // Ambush clearing is now just east of spawn on the 15ft main trail
  const ambushX = 14;
  const ambushZ = 0;

  // Ransacked belongings beside the living horses
  const bagPositions: [number, number, number][] = [
    [ambushX - 0.8, ambushZ + 1.2, -0.7],
    [ambushX + 0.6, ambushZ + 0.9, 1.1]
  ];

  for (const [x, z, angle] of bagPositions) {
    const leather = new THREE.MeshStandardMaterial({ color: '#514b39', roughness: .95 });
    const bag = new THREE.Mesh(new THREE.BoxGeometry(.40, .22, .35, 2, 2, 2), leather);
    bag.position.set(x - .72, terrainHeight(x - .72, z + .32) + .12, z + .32);
    bag.rotation.set(.06, angle + .4, -.1);
    bag.castShadow = true; bag.receiveShadow = true; scene.add(bag);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(.035, .236, .37), new THREE.MeshStandardMaterial({ color: '#2b3027', roughness: .9 }));
    strap.position.copy(bag.position); strap.rotation.copy(bag.rotation); scene.add(strap);
  }

  const arrowWood = new THREE.MeshStandardMaterial({ color: '#62543b', roughness: .95 });
  const feather = new THREE.MeshStandardMaterial({ color: '#222923', side: THREE.DoubleSide, roughness: 1 });
  for (let i = 0; i < 8; i++) {
    const group = new THREE.Group();
    const x = ambushX + Math.sin(i * 4.2) * 1.8;
    const z = ambushZ + Math.cos(i * 2.8) * 1.6;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .7, 5), arrowWood);
    group.add(shaft);
    for (const a of [0, Math.PI / 2]) {
      const vane = new THREE.Mesh(new THREE.PlaneGeometry(.075, .13), feather); vane.position.y = .25; vane.rotation.y = a; group.add(vane);
    }
    group.position.set(x, terrainHeight(x, z) + .05, z); group.rotation.set(1.49, i * 1.7, .1); group.castShadow = true; scene.add(group);
  }

  // Signpost to Phandalin - at the eastern bend where road turns south
  const signX = 8046;
  const signZ = 120;
  const post = new THREE.Group(); post.position.set(signX, terrainHeight(signX, signZ), signZ); post.rotation.z = -.08;
  const upright = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, 1.7, 7), materials.bark); upright.position.y = .78; upright.castShadow = true; post.add(upright);
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#514333'; ctx.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 80; i++) { ctx.strokeStyle = `rgba(23,20,14,${.03 + i % 4 * .015})`; ctx.beginPath(); ctx.moveTo(0, i * 1.6); ctx.lineTo(512, i * 1.6 + Math.sin(i) * 6); ctx.stroke(); }
  ctx.fillStyle = '#b0a18a'; ctx.font = '38px Georgia'; ctx.textAlign = 'center'; ctx.fillText('PHANDALIN  →', 256, 79);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, .35, .09), [materials.wood, materials.wood, materials.wood, materials.wood, new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }), materials.wood]);
  sign.position.y = 1.4; sign.castShadow = true; post.add(sign); scene.add(post);
  collision.add({ x: signX, z: signZ, radius: .15, bottom: post.position.y, top: post.position.y + 1.6 });

  // Additional sign near spawn
  const spawnSignX = -20;
  const spawnSignZ = 2;
  const post2 = new THREE.Group(); post2.position.set(spawnSignX, terrainHeight(spawnSignX, spawnSignZ), spawnSignZ); post2.rotation.z = -.05;
  const upright2 = new THREE.Mesh(new THREE.CylinderGeometry(.06, .09, 1.5, 6), materials.bark); upright2.position.y = .68; upright2.castShadow = true; post2.add(upright2);
  const canvas2 = document.createElement('canvas'); canvas2.width = 512; canvas2.height = 128;
  const ctx2 = canvas2.getContext('2d')!;
  ctx2.fillStyle = '#4a3f2f'; ctx2.fillRect(0, 0, 512, 128);
  ctx2.fillStyle = '#c4b59a'; ctx2.font = '32px Georgia'; ctx2.textAlign = 'center'; ctx2.fillText('TRIBOAR TRAIL', 256, 75);
  const tex2 = new THREE.CanvasTexture(canvas2); tex2.colorSpace = THREE.SRGBColorSpace;
  const sign2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, .30, .08), [materials.wood, materials.wood, materials.wood, materials.wood, new THREE.MeshStandardMaterial({ map: tex2, roughness: 1 }), materials.wood]);
  sign2.position.y = 1.25; sign2.castShadow = true; post2.add(sign2); scene.add(post2);
  collision.add({ x: spawnSignX, z: spawnSignZ, radius: .12, bottom: post2.position.y, top: post2.position.y + 1.5 });
}
