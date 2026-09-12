import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SkeletalHero } from './character/skeletal/SkeletalHero';
import { CLIP_DEFS, type ClipName } from './character/skeletal/HeroClips';
import { portraitDef, PORTRAITS } from './game/character';
import type { WeaponId } from './character/skeletal/HeroWeapons';

/**
 * TEMP harness for iterating on the skeletal hero (deleted before merge).
 * URL params: clip, t (freeze time), portrait, main, off, angle, noturn, nopanel.
 */

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#141c15');
scene.fog = new THREE.Fog('#141c15', 6, 14);
// Image-based light so plate/mail/blade read as metal (kept dim for mood).
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
}

// Pedestal + ground shadow catcher.
const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(0.62, 0.7, 0.12, 40),
  new THREE.MeshStandardMaterial({ color: '#2c362c', roughness: 0.85 }),
);
pedestal.position.y = -0.06;
pedestal.receiveShadow = true;
scene.add(pedestal);
const trim = new THREE.Mesh(
  new THREE.TorusGeometry(0.62, 0.018, 10, 48),
  new THREE.MeshStandardMaterial({ color: '#8a6f3c', roughness: 0.4, metalness: 0.8 }),
);
trim.rotation.x = Math.PI / 2;
trim.position.y = -0.012;
scene.add(trim);

// Woodland 3-point light.
scene.add(new THREE.HemisphereLight('#cdd8c0', '#1a2418', 0.55));
const key = new THREE.DirectionalLight('#ffe8c4', 2.0);
key.position.set(2.2, 3.4, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -1.5;
key.shadow.camera.right = 1.5;
key.shadow.camera.top = 2.5;
key.shadow.camera.bottom = -0.5;
key.shadow.camera.far = 10;
key.shadow.bias = -0.0005;
scene.add(key);
const rim = new THREE.DirectionalLight('#9ab8ff', 1.1);
rim.position.set(-2.4, 2.2, -2.2);
scene.add(rim);
const fill = new THREE.DirectionalLight('#ffd9b0', 0.5);
fill.position.set(-1.2, 1.0, 2.8);
scene.add(fill);

const factory = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const hero = new SkeletalHero({
  canvasFactory: factory,
  preset: portraitDef(params.get('portrait') ?? 'male_01'),
  equipment: {
    mainHand: (params.get('main') as WeaponId) ?? 'longsword',
    offHand: (params.get('off') as WeaponId | 'none' | null) === 'none' ? null : ((params.get('off') as WeaponId) ?? 'shield'),
  },
});
scene.add(hero.root);

// TEMP debug: ?hairTint=red isolates cap placement (double-sided basic red).
{
  const hair = hero.root.getObjectByProperty('name', `hair_${portraitDef(params.get('portrait') ?? 'male_01').hairStyle}`);
  if (hair && params.get('hairTint') === 'red') {
    hair.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.material = new THREE.MeshBasicMaterial({ color: '#ff0000', side: THREE.DoubleSide });
      }
    });
  }
  if (hair && params.get('hideHair') === '1') hair.visible = false;
}

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 50);

type Angle = 'front' | 'side' | 'back' | 'face' | 'full' | 'shield' | 'top';
const ANGLES: Record<Angle, { pos: [number, number, number]; look: [number, number, number] }> = {
  front: { pos: [0, 1.32, 3.6], look: [0, 0.98, 0] },
  side: { pos: [-3.6, 1.3, 0.4], look: [0, 0.98, 0] },
  back: { pos: [0, 1.4, -3.6], look: [0, 1.0, 0] },
  face: { pos: [0.12, 1.66, 1.15], look: [0, 1.64, 0] },
  full: { pos: [-1.7, 1.15, 3.1], look: [0, 0.92, 0] },
  shield: { pos: [2.0, 1.0, 1.7], look: [0.3, 0.82, 0] },
  top: { pos: [0.01, 3.4, 0.9], look: [0, 1.45, 0] },
};

let angle = (params.get('angle') as Angle) || 'front';
function applyAngle(): void {
  const a = ANGLES[angle] ?? ANGLES.front;
  camera.position.set(...a.pos);
  camera.lookAt(...a.look);
}
applyAngle();

let frozen: { clip: ClipName; t: number } | null = null;
const clipParam = params.get('clip') as ClipName | null;
if (clipParam && CLIP_DEFS[clipParam]) {
  if (params.has('t')) {
    frozen = { clip: clipParam, t: Number(params.get('t')) };
    hero.freezeAt(clipParam, frozen.t);
  } else if (CLIP_DEFS[clipParam].loop) {
    hero.playLocomotion(clipParam);
  } else {
    void hero.playOneShot(clipParam, { hold: params.get('hold') === '1' });
  }
}

let turntable = params.get('noturn') !== '1' && !frozen;
const clock = new THREE.Clock();
function tick(): void {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  if (!frozen) hero.update(dt);
  if (turntable) hero.root.rotation.y += dt * 0.5;
  renderer.render(scene, camera);
}
tick();

// Control panel (hidden for clean screenshots with ?nopanel=1).
const panel = document.getElementById('panel')!;
if (params.get('nopanel') === '1') panel.classList.add('hide');
{
  const el = document.createElement('div');
  const clipBtns = (Object.keys(CLIP_DEFS) as ClipName[])
    .map(c => `<button data-clip="${c}" class="${clipParam === c ? 'on' : ''}">${c}</button>`)
    .join('');
  el.innerHTML =
    `<h3>Hero harness · ${hero.triangleCount.toLocaleString()} tris</h3>` +
    `<div class="row">${clipBtns}</div>` +
    `<div class="row">${(['front', 'side', 'back', 'face', 'full', 'shield'] as Angle[]).map(a => `<button data-angle="${a}" class="${angle === a ? 'on' : ''}">${a}</button>`).join('')}</div>` +
    `<label>portrait <select id="h-portrait">${PORTRAITS.map(p => `<option value="${p.id}" ${p.id === (params.get('portrait') ?? 'male_01') ? 'selected' : ''}>${p.id}</option>`).join('')}</select></label>` +
    `<label>main <select id="h-main">${['longsword', 'battleaxe', 'warhammer'].map(w => `<option ${w === (params.get('main') ?? 'longsword') ? 'selected' : ''}>${w}</option>`).join('')}</select></label>` +
    `<label>off <select id="h-off">${['shield', 'shortsword', 'none'].map(w => `<option ${w === (params.get('off') ?? 'shield') ? 'selected' : ''}>${w}</option>`).join('')}</select></label>` +
    `<label>freeze t <input id="h-t" type="range" min="0" max="1.6" step="0.02" value="0" /></label>` +
    `<div class="row"><button id="h-turn">turntable: ${turntable ? 'on' : 'off'}</button><button id="h-idle">resume idle</button></div>`;
  panel.appendChild(el);
  const reload = (): void => {
    const q = new URLSearchParams({
      portrait: (document.getElementById('h-portrait') as HTMLSelectElement).value,
      main: (document.getElementById('h-main') as HTMLSelectElement).value,
      off: (document.getElementById('h-off') as HTMLSelectElement).value,
      angle,
      nopanel: params.get('nopanel') ?? '0',
    });
    location.search = q.toString();
  };
  el.querySelectorAll('[data-clip]').forEach(b =>
    b.addEventListener('click', () => {
      const c = (b as HTMLElement).dataset.clip as ClipName;
      if (CLIP_DEFS[c].loop) {
        frozen = null;
        hero.playLocomotion(c);
      } else {
        void hero.playOneShot(c);
      }
      el.querySelectorAll('[data-clip]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    }),
  );
  el.querySelectorAll('[data-angle]').forEach(b =>
    b.addEventListener('click', () => {
      angle = (b as HTMLElement).dataset.angle as Angle;
      applyAngle();
      el.querySelectorAll('[data-angle]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    }),
  );
  (document.getElementById('h-turn') as HTMLButtonElement).addEventListener('click', e => {
    turntable = !turntable;
    (e.target as HTMLButtonElement).textContent = `turntable: ${turntable ? 'on' : 'off'}`;
  });
  (document.getElementById('h-idle') as HTMLButtonElement).addEventListener('click', () => {
    frozen = null;
    hero.playLocomotion('idle');
  });
  (document.getElementById('h-t') as HTMLInputElement).addEventListener('change', e => {
    const t = Number((e.target as HTMLInputElement).value);
    const active = el.querySelector('[data-clip].on')?.getAttribute('data-clip') as ClipName | null;
    if (active) {
      frozen = { clip: active, t };
      hero.freezeAt(active, t);
    }
  });
  for (const id of ['h-portrait', 'h-main', 'h-off']) {
    (document.getElementById(id) as HTMLSelectElement).addEventListener('change', reload);
  }
}

(window as unknown as { __hero: unknown }).__hero = {
  hero,
  freezeAt: (clip: ClipName, t: number) => {
    frozen = { clip, t };
    hero.freezeAt(clip, t);
  },
  setAngle: (a: Angle) => {
    angle = a;
    applyAngle();
  },
  triangleCount: hero.triangleCount,
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
