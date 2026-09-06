import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CollisionField, terrainHeight } from './landscape';
import type { Materials } from './materials';

export async function createAmbush(scene: THREE.Scene, materials: Materials, collision: CollisionField) {
  const gltf = await new GLTFLoader().loadAsync('/models/horse.glb');
  const original = gltf.scene;
  for (const [x, z, angle, color] of [[5.9, .7, -.7, '#82796b'], [6.9, 3.2, 1.1, '#514536']] as const) {
    const group = new THREE.Group(), horse = original.clone(true);
    horse.scale.setScalar(.0088);
    horse.rotation.z = Math.PI / 2;
    horse.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      const geometry = obj.geometry.clone();
      geometry.computeVertexNormals();
      obj.geometry = geometry;
      obj.material = new THREE.MeshStandardMaterial({ color, roughness: .96, vertexColors: false });
      obj.castShadow = true; obj.receiveShadow = true;
    });
    group.add(horse);
    const bounds = new THREE.Box3().setFromObject(horse);
    horse.position.y -= bounds.min.y;
    horse.position.x -= (bounds.max.x + bounds.min.x) * .5;
    horse.position.z -= (bounds.max.z + bounds.min.z) * .5;
    group.rotation.y = angle;
    group.position.set(x, terrainHeight(x, z) - .01, z);
    scene.add(group);
    collision.add({ x, z, radius: .58, bottom: group.position.y, top: group.position.y + .56 });
    // A worn pack beside each horse; no combat or graphic effects.
    const leather = new THREE.MeshStandardMaterial({ color: '#514b39', roughness: .95 });
    const bag = new THREE.Mesh(new THREE.BoxGeometry(.40, .22, .35, 2, 2, 2), leather);
    bag.position.set(x - .72, terrainHeight(x - .72, z + .32) + .12, z + .32); bag.rotation.set(.06, angle + .4, -.1); bag.castShadow = true; bag.receiveShadow = true; scene.add(bag);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(.035, .236, .37), new THREE.MeshStandardMaterial({ color: '#2b3027', roughness: .9 }));
    strap.position.copy(bag.position); strap.rotation.copy(bag.rotation); scene.add(strap);
  }
  const arrowWood = new THREE.MeshStandardMaterial({ color: '#62543b', roughness: .95 });
  const feather = new THREE.MeshStandardMaterial({ color: '#222923', side: THREE.DoubleSide, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const group = new THREE.Group(), x = 5 + Math.sin(i * 4.2) * 1.4, z = 2.0 + Math.cos(i * 2.8) * 1.3;
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
