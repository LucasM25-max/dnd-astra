import * as THREE from 'three';
import { seededRandom } from '../landscape';
export interface AdventureMaterials {
  wood: THREE.MeshStandardMaterial; woodDark: THREE.MeshStandardMaterial; woodEnd: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial; brass: THREE.MeshStandardMaterial; leather: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial; rope: THREE.MeshStandardMaterial; tarp: THREE.MeshStandardMaterial;
  coat: THREE.Texture; coatNormal: THREE.Texture; hoof: THREE.MeshStandardMaterial; eye: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial; horn: THREE.MeshStandardMaterial; oil: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
}
export async function loadAdventureMaterials(renderer: THREE.WebGLRenderer): Promise<AdventureMaterials> {
  const loader = new THREE.TextureLoader(), anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = async (name: string, color: boolean) => {
    const t = await loader.loadAsync(`/textures/${name}.webp`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy;
    if (color) t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const [oak, oakN, burlap, burlapN, coat, coatNormal] = await Promise.all([load('wagon-oak', true), load('wagon-oak-normal', false), load('wagon-burlap', true), load('wagon-burlap-normal', false), load('animal-coat', true), load('animal-coat-normal', false)]);
  const wood = new THREE.MeshStandardMaterial({ map: oak, normalMap: oakN, color: '#c6b48e', roughness: .86, normalScale: new THREE.Vector2(.7, .7) });
  const woodDark = wood.clone(); woodDark.color.set('#8e7854');
  const woodEnd = new THREE.MeshStandardMaterial({ map: endGrain(), color: '#aa9470', roughness: .95 });
  const iron = new THREE.MeshStandardMaterial({ color: '#4c4e45', metalness: .82, roughness: .68, normalMap: oakN, normalScale: new THREE.Vector2(.13, .13) });
  const brass = new THREE.MeshStandardMaterial({ color: '#a38748', metalness: .77, roughness: .52 });
  const leather = new THREE.MeshStandardMaterial({ color: '#443322', roughness: .84, normalMap: burlapN, normalScale: new THREE.Vector2(.12, .12) });
  const cloth = new THREE.MeshStandardMaterial({ map: burlap, normalMap: burlapN, normalScale: new THREE.Vector2(.72, .72), color: '#d1c1a0', roughness: 1 });
  const rope = new THREE.MeshStandardMaterial({ map: burlap, color: '#847256', roughness: 1 });
  const tarp = cloth.clone(); tarp.color.set('#607059'); tarp.side = THREE.DoubleSide;
  const hoof = new THREE.MeshStandardMaterial({ color: '#302b23', roughness: .73, normalMap: oakN, normalScale: new THREE.Vector2(.24, .24) });
  const eye = new THREE.MeshPhysicalMaterial({ color: '#140f0a', roughness: .12, clearcoat: .8, clearcoatRoughness: .09 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#c1bf9e', roughness: .18, metalness: .08, transparent: true, opacity: .33, depthWrite: false, side: THREE.DoubleSide });
  const horn = new THREE.MeshStandardMaterial({ color: '#d0c4a0', roughness: .65, normalMap: coatNormal, normalScale: new THREE.Vector2(.17, .17), vertexColors: true });
  const oil = new THREE.MeshStandardMaterial({ color: '#302c18', metalness: .06, roughness: .23 });
  return { wood, woodDark, woodEnd, iron, brass, leather, cloth, rope, tarp, coat, coatNormal, hoof, eye, glass, horn, oil, textures: [oak, oakN, burlap, burlapN, coat, coatNormal, woodEnd.map!] };
}
function endGrain() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!, rng = seededRandom(831);
  ctx.fillStyle = '#b49d71'; ctx.fillRect(0, 0, 256, 256);
  for (let r = 4; r < 180; r += 3 + rng() * 3) {
    ctx.beginPath();
    for (let i = 0; i <= 90; i++) { const a = i / 90 * Math.PI * 2, n = r * (1 + Math.sin(a * 3 + r * .03) * .035); const x = 119 + Math.cos(a) * n, y = 138 + Math.sin(a) * n * .94; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = `rgba(64,46,22,${.1 + rng() * .22})`; ctx.lineWidth = .6 + rng(); ctx.stroke();
  }
  for (let i = 0; i < 7000; i++) { ctx.fillStyle = rng() > .5 ? '#e3cba62a' : '#37200e20'; ctx.fillRect(rng() * 256, rng() * 256, 1, 1); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
export function stencil(text: string, width = 512, height = 128) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, width, height);
  ctx.font = `bold ${Math.round(height * .3)}px Georgia`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#28271ddd'; ctx.fillText(text, width / 2, height / 2, width - 16);
  const rng = seededRandom(53); ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 800; i++) { ctx.fillStyle = `rgba(0,0,0,${rng() * .6})`; ctx.fillRect(rng() * width, rng() * height, 1 + rng() * 3, 1); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
}
