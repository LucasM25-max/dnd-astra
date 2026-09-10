import * as THREE from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
import { terrainHeight } from './landscape';
import {
  daylightFactor, MINUTES_PER_REAL_SECOND, pickWeather, sunDirection, sunElevation,
  WEATHER_IDS, WIND_SPEED, WEATHER_STRENGTH, type GameClock, type Season, type WeatherId,
} from '../game/time';
import type { Quality } from './world';

interface WeatherPalette {
  sunMul: number; moonMul: number; hemiMul: number; shaft: number; envDay: number; expDay: number;
  skyTurbidity: number; skyRayleigh: number;
  fogDay: string; fogDayDensity: number; fogNight: string; fogNightDensity: number;
  skyColor: string; groundColor: string;
}
const PALETTES: Record<WeatherId, WeatherPalette> = {
  sun: { sunMul: 1, moonMul: 1, hemiMul: 1.95, shaft: 1, envDay: .70, expDay: 1.06, skyTurbidity: 6, skyRayleigh: 1.65, fogDay: '#c3c6a9', fogDayDensity: .0125, fogNight: '#1d2a36', fogNightDensity: .017, skyColor: '#d1ded9', groundColor: '#746b48' },
  overcast: { sunMul: .28, moonMul: .55, hemiMul: 2.1, shaft: 0, envDay: .66, expDay: 1.02, skyTurbidity: 20, skyRayleigh: .35, fogDay: '#aebbb8', fogDayDensity: .025, fogNight: '#222c35', fogNightDensity: .026, skyColor: '#c1d0d6', groundColor: '#56625c' },
  rain: { sunMul: .34, moonMul: .5, hemiMul: 1.7, shaft: 0, envDay: .60, expDay: .98, skyTurbidity: 16, skyRayleigh: .5, fogDay: '#9aa79f', fogDayDensity: .021, fogNight: '#182229', fogNightDensity: .024, skyColor: '#a9bcc2', groundColor: '#4a5a50' },
  storm: { sunMul: .20, moonMul: .4, hemiMul: 1.5, shaft: 0, envDay: .50, expDay: .92, skyTurbidity: 26, skyRayleigh: .4, fogDay: '#7e8b93', fogDayDensity: .026, fogNight: '#141d26', fogNightDensity: .028, skyColor: '#8fa3ad', groundColor: '#3d4a4a' },
  snow: { sunMul: .55, moonMul: .85, hemiMul: 2.0, shaft: .25, envDay: .68, expDay: 1.0, skyTurbidity: 10, skyRayleigh: .75, fogDay: '#c0c8c7', fogDayDensity: .02, fogNight: '#2a3644', fogNightDensity: .021, skyColor: '#d8e2e2', groundColor: '#8d97a0' },
  wind: { sunMul: .85, moonMul: .8, hemiMul: 1.9, shaft: .4, envDay: .70, expDay: 1.04, skyTurbidity: 7, skyRayleigh: 1.3, fogDay: '#b9c3a4', fogDayDensity: .016, fogNight: '#1f2c38', fogNightDensity: .02, skyColor: '#cdd8c8', groundColor: '#6d7a52' },
};

export interface WeatherEngineRefs {
  scene: THREE.Scene; renderer: THREE.WebGLRenderer; sun: THREE.DirectionalLight; fill: THREE.DirectionalLight; hemisphere: THREE.HemisphereLight;
  sky: Sky; shaftMaterial: THREE.ShaderMaterial; dustMaterial: THREE.ShaderMaterial;
  onThunder?: (strength: number, pan: number) => void;
}
export interface WeatherFrame {
  current: WeatherId; next: WeatherId; rain: number; snow: number; wind: number; storm: number; daylight: number;
}

const RAIN_SHADERS = {
  vertexShader: `
    uniform float uPixelRatio;
    attribute float aFade; attribute float aSeed;
    varying float vFade; varying float vDepth;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.);
      vDepth = -mv.z;
      float top = 1. - smoothstep(19., 23., position.y);
      float ground = smoothstep(-4., -1.5, position.y);
      vFade = aFade * top * ground * (.7 + aSeed * .3);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uOpacity; uniform vec3 uFogColor; uniform float uFogDensity;
    varying float vFade; varying float vDepth;
    void main() {
      float fog = 1. - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
      vec3 c = mix(uColor, uFogColor, fog);
      gl_FragColor = vec4(c, uOpacity * vFade * (1. - fog * .85));
    }`,
};

function moonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  rg.addColorStop(0, 'rgba(235,240,248,1)'); rg.addColorStop(.42, 'rgba(222,230,242,.96)'); rg.addColorStop(.62, 'rgba(200,214,232,.5)'); rg.addColorStop(1, 'rgba(190,205,228,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  g.globalAlpha = .14; g.fillStyle = '#7d8ba0';
  for (const [x, y, r] of [[46, 52, 9], [78, 70, 7], [60, 84, 5], [84, 44, 4], [40, 76, 3.4]]) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

/** Streaked rain falling in a camera-following box. `drizzle` = smaller, slower layer. */
class RainLayer {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array; private vel: Float32Array; private len: Float32Array;
  count: number; span: number; height: number;
  constructor(count: number, span: number, height: number, drizzle: boolean) {
    this.count = count; this.span = span; this.height = height;
    this.pos = new Float32Array(count * 3); this.vel = new Float32Array(count * 3); this.len = new Float32Array(count);
    for (let i = 0; i < count; i++) this.respawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    geo.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(count * 2), 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(count * 2), 1));
    const fade = geo.getAttribute('aFade') as THREE.BufferAttribute, seed = geo.getAttribute('aSeed') as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      fade.setX(i * 2, 1); fade.setX(i * 2 + 1, 0);
      const s = Math.random(); seed.setX(i * 2, s); seed.setX(i * 2 + 1, s);
      this.len[i] = drizzle ? .28 + Math.random() * .3 : .75 + Math.random() * .85;
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(drizzle ? '#b9c6d4' : '#a9bccb') }, uOpacity: { value: 0 },
        uFogColor: { value: new THREE.Color('#888') }, uFogDensity: { value: .02 },
      },
      vertexShader: RAIN_SHADERS.vertexShader, fragmentShader: RAIN_SHADERS.fragmentShader,
      transparent: true, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false; this.lines.renderOrder = 4; this.lines.visible = false;
  }
  private respawn(i: number, anywhere: boolean) {
    const s = this.span;
    this.pos[i * 3] = (Math.random() - .5) * s * 2;
    this.pos[i * 3 + 1] = anywhere ? Math.random() * this.height : this.height * (.82 + Math.random() * .18);
    this.pos[i * 3 + 2] = (Math.random() - .5) * s * 2;
  }
  setFog(color: THREE.Color, density: number, opacity: number) {
    const u = (this.lines.material as THREE.ShaderMaterial).uniforms;
    (u.uFogColor.value as THREE.Color).copy(color); u.uFogDensity.value = density; u.uOpacity.value = opacity;
  }
  update(dt: number, windX: number, windZ: number, fall: number) {
    if (!this.lines.visible) return;
    const p = this.pos, v = this.vel, geo = this.lines.geometry, attr = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      v[i * 3 + 1] = -fall * (0.75 + (this.len[i] / 1.6) * .5);
      v[i * 3] = windX; v[i * 3 + 2] = windZ;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < -4) this.respawn(i, false);
      const dx = v[i * 3], dy = v[i * 3 + 1], dz = v[i * 3 + 2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      const L = this.len[i];
      const i6 = i * 6;
      arr[i6] = p[i * 3]; arr[i6 + 1] = p[i * 3 + 1]; arr[i6 + 2] = p[i * 3 + 2];
      arr[i6 + 3] = p[i * 3] - (dx / dl) * L; arr[i6 + 4] = p[i * 3 + 1] - (dy / dl) * L; arr[i6 + 5] = p[i * 3 + 2] - (dz / dl) * L;
    }
    attr.needsUpdate = true;
  }
  dispose() { this.lines.geometry.dispose(); (this.lines.material as THREE.Material).dispose(); }
}

/** Soft drifting snowflakes. */
class SnowLayer {
  readonly points: THREE.Points;
  private pos: Float32Array; private vy: Float32Array; private seed: Float32Array;
  count: number; span: number; height: number;
  constructor(count: number, span: number, height: number) {
    this.count = count; this.span = span; this.height = height;
    this.pos = new Float32Array(count * 3); this.vy = new Float32Array(count); this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - .5) * span * 2;
      this.pos[i * 3 + 1] = Math.random() * height - 2;
      this.pos[i * 3 + 2] = (Math.random() - .5) * span * 2;
      this.vy[i] = .55 + Math.random() * .85; this.seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uSize: { value: 42 }, uFogColor: { value: new THREE.Color('#888') }, uFogDensity: { value: .02 } },
      vertexShader: `
        uniform float uTime, uSize; attribute float aSeed; varying float vFade; varying float vDepth;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * (.5 + fract(aSeed) * .4) + aSeed * 6.28) * .55;
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          vDepth = -mv.z;
          vFade = smoothstep(-2., .4, position.y) * (1. - smoothstep(14., 17., position.y)) * (.65 + fract(aSeed * 7.1) * .35);
          gl_PointSize = uSize * (.55 + fract(aSeed * 3.7) * .9) / max(1., -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uOpacity; uniform vec3 uFogColor; uniform float uFogDensity;
        varying float vFade; varying float vDepth;
        void main() {
          float d = length(gl_PointCoord - .5);
          float a = smoothstep(.5, .12, d) * vFade * uOpacity;
          float fog = 1. - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
          gl_FragColor = vec4(mix(vec3(.93, .96, 1.), uFogColor, fog), a * (1. - fog * .8));
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false; this.points.renderOrder = 4; this.points.visible = false;
  }
  setFog(color: THREE.Color, density: number, opacity: number) {
    const u = this.points.material as THREE.ShaderMaterial;
    (u.uniforms.uFogColor.value as THREE.Color).copy(color); u.uniforms.uFogDensity.value = density; u.uniforms.uOpacity.value = opacity;
  }
  update(dt: number, windX: number, windZ: number, time: number) {
    if (!this.points.visible) return;
    const u = this.points.material as THREE.ShaderMaterial; u.uniforms.uTime.value = time;
    const p = this.pos, s = this.span * .5, h = this.height;
    for (let i = 0; i < this.count; i++) {
      p[i * 3] += (windX * .3 + Math.sin(time * .7 + this.seed[i]) * .5) * dt;
      p[i * 3 + 1] -= this.vy[i] * dt;
      p[i * 3 + 2] += (windZ * .3 + Math.cos(time * .6 + this.seed[i] * 1.7) * .4) * dt;
      if (p[i * 3 + 1] < -2) { p[i * 3 + 1] = h * (.9 + Math.random() * .1); p[i * 3] = (Math.random() - .5) * s * 2; p[i * 3 + 2] = (Math.random() - .5) * s * 2; }
      if (p[i * 3] > s) p[i * 3] -= s * 2; else if (p[i * 3] < -s) p[i * 3] += s * 2;
      if (p[i * 3 + 2] > s) p[i * 3 + 2] -= s * 2; else if (p[i * 3 + 2] < -s) p[i * 3 + 2] += s * 2;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() { this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose(); }
}

/** Faint motes streaking with dry wind. */
class WindMotes {
  readonly points: THREE.Points;
  private pos: Float32Array; private speed: Float32Array;
  count: number; span: number;
  constructor(count: number, span: number) {
    this.count = count; this.span = span;
    this.pos = new Float32Array(count * 3); this.speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - .5) * span * 2;
      this.pos[i * 3 + 1] = .4 + Math.random() * 7;
      this.pos[i * 3 + 2] = (Math.random() - .5) * span * 2;
      this.speed[i] = 3 + Math.random() * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({ size: .045, color: '#d8dfd0', transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false; this.points.renderOrder = 4; this.points.visible = false;
  }
  update(dt: number, windX: number, windZ: number, time: number) {
    if (!this.points.visible) return;
    (this.points.material as THREE.PointsMaterial).opacity = .16 * (.7 + .3 * Math.sin(time * 1.3));
    const p = this.pos, s = this.span * .5;
    for (let i = 0; i < this.count; i++) {
      const sp = this.speed[i];
      p[i * 3] += windX * sp * dt; p[i * 3 + 2] += windZ * sp * dt;
      p[i * 3 + 1] += Math.sin(time * 2 + i) * .3 * dt;
      if (p[i * 3] > s) p[i * 3] -= s * 2; else if (p[i * 3] < -s) p[i * 3] += s * 2;
      if (p[i * 3 + 2] > s) p[i * 3 + 2] -= s * 2; else if (p[i * 3 + 2] < -s) p[i * 3 + 2] += s * 2;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() { this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose(); }
}

/** Star field + moon, visible at night. */
class NightSky {
  readonly stars: THREE.Points; readonly moon: THREE.Sprite;
  private starMat: THREE.ShaderMaterial;
  constructor() {
    const n = 850;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, el = Math.asin(Math.random() * .98 + .02);
      const r = 230;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * r; pos[i * 3 + 1] = Math.sin(el) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime; varying float vA;
        void main() {
          vA = (.5 + .5 * sin(uTime * (.4 + fract(aSeed) * 1.1) + aSeed * 6.28)) * (.55 + fract(aSeed * 3.3) * .45);
          vec4 mv = modelViewMatrix * vec4(position, 1.);
          gl_PointSize = 1.4 + fract(aSeed * 7.7) * 1.5;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uOpacity; varying float vA;
        void main() { float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, d) * vA * uOpacity; if (a < .01) discard; gl_FragColor = vec4(.92, .95, 1., a); }`,
      transparent: true, depthWrite: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false; this.stars.renderOrder = -2; this.stars.visible = false;
    const moonMat = new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.moon = new THREE.Sprite(moonMat); this.moon.scale.setScalar(30); this.moon.renderOrder = -1; this.moon.visible = false;
  }
  update(dir: THREE.Vector3, time: number, nightFactor: number) {
    const show = nightFactor > .03;
    this.stars.visible = show; this.moon.visible = show;
    if (!show) return;
    this.starMat.uniforms.uTime.value = time;
    this.starMat.uniforms.uOpacity.value = nightFactor * .9;
    (this.moon.material as THREE.SpriteMaterial).opacity = nightFactor * .85;
    const m = dir.clone().normalize(); m.y = Math.max(m.y, .35); m.normalize();
    this.moon.position.copy(m.multiplyScalar(200));
  }
  dispose() {
    this.stars.geometry.dispose(); this.starMat.dispose();
    (this.moon.material as THREE.SpriteMaterial).map?.dispose(); (this.moon.material as THREE.Material).dispose();
  }
}

/** A jagged bolt + decaying flash for storms. */
class LightningRig {
  readonly bolt: THREE.Line;
  flash = 0;
  private boltUntil = 0; private flickerAt = 0;
  private geo = new THREE.BufferGeometry();
  constructor() {
    const mat = new THREE.LineBasicMaterial({ color: '#dfe9ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bolt = new THREE.Line(this.geo, mat);
    this.bolt.frustumCulled = false; this.bolt.visible = false; this.bolt.renderOrder = 5;
    const pts = new Float32Array(17 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  }
  trigger(time: number, cameraX: number, cameraZ: number) {
    this.flash = 1; this.boltUntil = time + .11; this.flickerAt = time + .2;
    const px = cameraX + (Math.random() - .5) * 130, pz = cameraZ + (Math.random() - .5) * 130;
    const top = 85 + Math.random() * 30, ground = terrainHeight(px, pz) + 1;
    const attr = this.geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const jx = i === 0 || i === 16 ? 0 : (Math.random() - .5) * 7 * (1 - Math.abs(t - .4));
      const jz = i === 0 || i === 16 ? 0 : (Math.random() - .5) * 7 * (1 - Math.abs(t - .4));
      attr.setXYZ(i, px + jx, top + (ground - top) * t, pz + jz);
    }
    attr.needsUpdate = true; this.bolt.visible = true;
  }
  /** Decays the flash; bolts and thunder are triggered by the engine. */
  update(dt: number, time: number) {
    if (this.flickerAt > 0 && time >= this.flickerAt) { this.flickerAt = 0; this.flash = Math.max(this.flash, .6); }
    this.flash = Math.max(0, this.flash - dt * 6.5);
    if (time > this.boltUntil) this.bolt.visible = false;
  }
  dispose() { this.geo.dispose(); (this.bolt.material as THREE.Material).dispose(); }
}

export class WeatherEngine {
  current: WeatherId = 'sun';
  next: WeatherId = 'sun';
  private override: WeatherId | 'auto' = 'auto';
  private from: WeatherId = 'sun'; private to: WeatherId = 'sun'; private t = 1;
  private periodMin = 240;
  private season: Season = 'winter';
  private levels: Record<WeatherId, number> = { sun: 1, overcast: 0, rain: 0, storm: 0, snow: 0, wind: 0 };
  private rain!: RainLayer; private drizzle!: RainLayer; private snow!: SnowLayer; private motes!: WindMotes;
  private night = new NightSky(); private lightning = new LightningRig();
  private group = new THREE.Group();
  private fog = new THREE.Color('#c3c6a9'); private fogDensity = .0125;
  private sunColor = new THREE.Color('#ffe0a6'); private tmpColor = new THREE.Color(); private tmpColor2 = new THREE.Color();
  private windDir = new THREE.Vector3(.4, 0, .6).normalize();
  private time = 0;
  private paletteBlend: { sunMul: number; moonMul: number; hemiMul: number; shaft: number; envDay: number; expDay: number; skyT: number; skyR: number; hemi: THREE.Color; ground: THREE.Color; fogDay: THREE.Color; fogNight: THREE.Color; fogDayD: number; fogNightD: number } = {
    sunMul: 1, moonMul: 1, hemiMul: 1.95, shaft: 1, envDay: .70, expDay: 1.06, skyT: 6, skyR: 1.65,
    hemi: new THREE.Color('#d1ded9'), ground: new THREE.Color('#746b48'), fogDay: new THREE.Color('#c3c6a9'), fogNight: new THREE.Color('#1d2a36'), fogDayD: .0125, fogNightD: .017,
  };

  constructor(private refs: WeatherEngineRefs, private quality: Quality) {
    const r = refs.scene;
    r.add(this.night.stars, this.night.moon, this.lightning.bolt, this.group);
    this.buildParticles();
  }
  /**
   * Force a condition, or hand the skies back to the seasons ('auto').
   * An explicit choice starts crossfading immediately.
   */
  setOverride(v: WeatherId | 'auto') {
    if (v === this.override) return;
    this.override = v;
    this.from = this.to; this.t = 0;
    this.to = v !== 'auto' ? v : pickWeather(this.season);
    this.periodMin = 150 + Math.random() * 330;
  }
  private buildParticles() {
    const q = this.quality;
    const main = q === 'performance' ? 550 : q === 'balanced' ? 1100 : 1800;
    const driz = q === 'performance' ? 260 : q === 'balanced' ? 520 : 880;
    const snowN = q === 'performance' ? 420 : q === 'balanced' ? 780 : 1300;
    const motesN = q === 'performance' ? 220 : q === 'balanced' ? 340 : 460;
    if (this.rain) { this.rain.dispose(); this.drizzle.dispose(); this.snow.dispose(); this.motes.dispose(); this.group.remove(this.rain.lines, this.drizzle.lines, this.snow.points, this.motes.points); }
    this.rain = new RainLayer(main, 30, 24, false); this.drizzle = new RainLayer(driz, 26, 20, true);
    this.snow = new SnowLayer(snowN, 26, 18); this.motes = new WindMotes(motesN, 22);
    this.group.add(this.rain.lines, this.drizzle.lines, this.snow.points, this.motes.points);
  }
  setQuality(q: Quality) { this.quality = q; this.buildParticles(); }

  /**
   * Drive the weather schedule. Runs on real elapsed time (capped, so a
   * backgrounded tab cannot fast-forward the skies); `dt` for particle
   * physics is applied separately by `apply`.
   */
  tick(realDelta: number, clock: GameClock) {
    const gdt = Math.min(2, Math.max(0, realDelta));
    this.time += gdt;
    this.season = clock.season;
    this.periodMin -= gdt * MINUTES_PER_REAL_SECOND;
    if (this.periodMin <= 0) {
      this.from = this.to; this.t = 0;
      this.to = this.override !== 'auto' ? this.override : pickWeather(clock.season);
      this.periodMin = 150 + Math.random() * 330; // 2.5–8 in-game hours of one condition
    }
    this.t = Math.min(1, this.t + gdt / 45);
    const k = this.t * this.t * (3 - 2 * this.t);
    for (const id of WEATHER_IDS) {
      this.levels[id] = this.from === this.to ? (id === this.to ? 1 : 0)
        : (this.from === id ? 1 : 0) * (1 - k) + (this.to === id ? 1 : 0) * k;
    }
    this.current = this.to; this.next = this.to;
  }

  /** Apply lighting + particles for the current moment. Returns live levels for audio. */
  apply(dt: number, clock: GameClock, camera: THREE.PerspectiveCamera): WeatherFrame {
    const refs = this.refs, lvl = this.levels, P = this.paletteBlend;
    // Composite the weather palettes by level.
    let sunMul = 0, moonMul = 0, hemiMul = 0, shaft = 0, envDay = 0, expDay = 0, skyT = 0, skyR = 0, fogDayD = 0, fogNightD = 0;
    P.hemi.setRGB(0, 0, 0); P.ground.setRGB(0, 0, 0); P.fogDay.setRGB(0, 0, 0); P.fogNight.setRGB(0, 0, 0);
    for (const id of WEATHER_IDS) {
      const l = lvl[id]; if (l <= 0.0001) continue;
      const pa = PALETTES[id];
      sunMul += l * pa.sunMul; moonMul += l * pa.moonMul; hemiMul += l * pa.hemiMul; shaft += l * pa.shaft;
      envDay += l * pa.envDay; expDay += l * pa.expDay; skyT += l * pa.skyTurbidity; skyR += l * pa.skyRayleigh;
      fogDayD += l * pa.fogDayDensity; fogNightD += l * pa.fogNightDensity;
      P.hemi.add(this.tmpColor.set(pa.skyColor).multiplyScalar(l));
      P.ground.add(this.tmpColor.set(pa.groundColor).multiplyScalar(l));
      P.fogDay.add(this.tmpColor.set(pa.fogDay).multiplyScalar(l));
      P.fogNight.add(this.tmpColor.set(pa.fogNight).multiplyScalar(l));
    }
    const hour = clock.hourF, season = clock.season;
    const dayF = daylightFactor(hour, season);
    const elevDeg = sunElevation(hour, season);
    const sunDir = sunDirection(hour, season);
    const target = refs.sun.target.position;

    // Fog: day/night blend, then a lightning tint.
    this.fog.copy(P.fogNight).lerp(P.fogDay, dayF);
    this.fogDensity = P.fogNightD + (P.fogDayD - P.fogNightD) * dayF;
    const flash = this.lightning.flash;
    if (flash > .01) this.fog.lerp(this.tmpColor.set('#9db4d6'), flash * .3);
    (refs.scene.fog as THREE.FogExp2).color.copy(this.fog);
    (refs.scene.fog as THREE.FogExp2).density = this.fogDensity;
    (refs.scene.background as THREE.Color).copy(this.fog);

    // Sun (daylight) — hidden fully at night.
    const sunOn = elevDeg > -3 && dayF > .02;
    refs.sun.intensity = sunOn ? 3.8 * dayF * sunMul * (1 + flash * 2.2) : 0;
    this.sunColor.set('#ff8a4a');
    if (elevDeg > 8) this.sunColor.lerp(this.tmpColor.set('#ffc27a'), Math.min(1, (elevDeg - 8) / 14));
    if (elevDeg > 22) this.sunColor.lerp(this.tmpColor.set('#ffe0a6'), Math.min(1, (elevDeg - 22) / 16));
    if (elevDeg > 42) this.sunColor.lerp(this.tmpColor.set('#fff2d8'), Math.min(1, (elevDeg - 42) / 18));
    refs.sun.color.copy(this.sunColor);
    if (sunOn) {
      const d = new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z);
      refs.sun.position.copy(target).addScaledVector(d, 45);
      refs.sky.material.uniforms.sunPosition.value.copy(d);
    }
    // Fill light follows daylight and clears.
    refs.fill.intensity = .75 * dayF * (0.35 + 0.65 * Math.min(1, sunMul + .15));

    // Moon (night) — fades in only once the sun is well below the horizon, not during twilight.
    const nightF = 1 - dayF;
    const darkF = THREE.MathUtils.smoothstep(-elevDeg, 2, 11); // 0 at sunset, 1 once truly dark
    if (darkF > .02 && nightF > .02) {
      const md = new THREE.Vector3(-sunDir.x, .58, -sunDir.z).normalize();
      // Reuse the sun light as moonlight once the day has fully gone.
      if (!sunOn) {
        refs.sun.intensity = 1.15 * nightF * darkF * moonMul * (1 + flash * 1.6);
        refs.sun.color.set('#93a7c8');
        refs.sun.position.copy(target).addScaledVector(md, 50);
      }
      this.night.update(md, this.time, darkF * Math.min(1, .5 + moonMul * .5));
    } else this.night.update(new THREE.Vector3(0, 1, 0), this.time, 0);

    // Hemisphere (sky bounce).
    refs.hemisphere.color.copy(this.tmpColor.set('#33445c').lerp(P.hemi, dayF));
    refs.hemisphere.groundColor.copy(this.tmpColor2.set('#1e2731').lerp(P.ground, dayF));
    refs.hemisphere.intensity = (.68 + (hemiMul - .68) * dayF) * (1 + flash * .9);

    // Sky dome + environment + exposure.
    const sky = refs.sky.material.uniforms;
    sky.turbidity.value = skyT; sky.rayleigh.value = skyR;
    refs.scene.environmentIntensity = .17 + (envDay - .17) * dayF + flash * .25;
    refs.renderer.toneMappingExposure = .95 + (expDay - .95) * dayF;

    // Volumetric shafts + drifting dust.
    const shaftOpacity = .075 * dayF * shaft * (elevDeg > 2 ? 1 : 0);
    refs.shaftMaterial.uniforms.opacity.value = shaftOpacity;
    const dust = refs.dustMaterial.uniforms;
    dust.tint.value.copy(this.tmpColor.set('#e4d9a9').lerp(this.tmpColor2.set('#d9e6a0'), nightF * .8));
    dust.opacity.value = (.48 * dayF + .5 * nightF) * (1 - .45 * (lvl.rain + lvl.storm));

    // Particles.
    const rainAmt = lvl.rain * WEATHER_STRENGTH.rain + lvl.storm * WEATHER_STRENGTH.storm;
    const windSpeed = WEATHER_IDS.reduce((s, id) => s + lvl[id] * WIND_SPEED[id], 0);
    this.windDir.set(Math.sin(this.time * .05), 0, Math.cos(this.time * .05)).normalize();
    const gust = 1 + Math.sin(this.time * .5) * .3 + Math.sin(this.time * 1.7 + 1.3) * .18;
    const wx = this.windDir.x * windSpeed * gust, wz = this.windDir.z * windSpeed * gust;

    this.group.position.set(camera.position.x, 0, camera.position.z);
    const rainOn = rainAmt > .015;
    this.rain.lines.visible = this.drizzle.lines.visible = rainOn;
    if (rainOn) {
      this.rain.setFog(this.fog, this.fogDensity, Math.min(1, rainAmt) * .5);
      this.drizzle.setFog(this.fog, this.fogDensity, Math.min(1, rainAmt) * .3);
      this.rain.update(dt, wx, wz, 11);
      this.drizzle.update(dt, wx * .8, wz * .8, 7.5);
    }
    const snowOn = lvl.snow > .015;
    this.snow.points.visible = snowOn;
    if (snowOn) { this.snow.setFog(this.fog, this.fogDensity, Math.min(1, lvl.snow) * .9); this.snow.update(dt, wx, wz, this.time); }
    const motesOn = lvl.wind > .015;
    this.motes.points.visible = motesOn;
    if (motesOn) this.motes.update(dt, this.windDir.x * 1, this.windDir.z * 1, this.time);

    // Lightning scheduling (visual + thunder).
    if (lvl.storm > .35) {
      this.lightning.update(dt, this.time);
      this.stormTrigger(dt, lvl.storm, camera);
    } else if (this.lightning.flash <= .01) this.lightning.bolt.visible = false;

    return { current: this.current, next: this.next, rain: rainAmt, snow: lvl.snow, wind: lvl.wind * gust, storm: lvl.storm, daylight: dayF };
  }
  private stormTimer = 6;
  private stormTrigger(dt: number, storm: number, camera: THREE.PerspectiveCamera) {
    this.stormTimer -= dt * storm;
    if (this.stormTimer > 0) return;
    this.stormTimer = 5 + Math.random() * 13;
    const pan = (Math.random() * 2 - 1) * .8;
    this.lightning.trigger(this.time, camera.position.x, camera.position.z);
    window.setTimeout(() => this.refs.onThunder?.(.5 + Math.random() * .5, pan), 350 + Math.random() * 1100);
  }

  dispose() {
    this.rain?.dispose(); this.drizzle?.dispose(); this.snow?.dispose(); this.motes?.dispose(); this.night.dispose(); this.lightning.dispose();
  }
}
