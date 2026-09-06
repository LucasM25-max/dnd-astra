import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CollisionField, LANDMARKS, seededRandom, terrainHeight } from './landscape';
import { loadMaterials, type Materials } from './materials';
import { createTerrain, createForest, type Nature } from './nature';
import { createAmbush } from './props';
import { PlayerController, type CameraMode } from './controller';

export type Quality = 'performance' | 'balanced' | 'high';
export type Atmosphere = 'golden' | 'overcast' | 'blue';
export interface WorldState {
  x: number; y: number; z: number; yaw: number; mode: CameraMode; moving: boolean; grounded: boolean;
  started: boolean; paused: boolean; fps: number; landmark: string | null; distanceWalked: number;
}
export class WoodlandWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(59, 1, .08, 260);
  readonly collision = new CollisionField();
  controller!: PlayerController;
  private material!: Materials;
  private nature!: Nature;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private film!: ShaderPass;
  private sky = new Sky();
  private sun = new THREE.DirectionalLight('#ffe0a6', 3.8);
  private hemisphere = new THREE.HemisphereLight('#d1ded9', '#746b48', 1.95);
  private particles!: THREE.Points;
  private shaftMaterial!: THREE.ShaderMaterial;
  private shafts: { mesh: THREE.Mesh; start: THREE.Vector3; end: THREE.Vector3; width: number }[] = [];
  private observer: ResizeObserver;
  private lastFrame = 0;
  private elapsed = 0;
  private raf = 0;
  private quality: Quality = 'high';
  private frameCount = 0;
  private fpsTimer = 0;
  private fps = 60;
  private running = false;
  private renderDirty = true;
  private environmentTexture?: THREE.Texture;
  private visited = new Set<string>();
  private cleanups: (() => void)[] = [];
  onUpdate: (state: WorldState) => void = () => {};
  onDiscovery: (name: string) => void = () => {};
  onContextLost: () => void = () => {};

  constructor(private host: HTMLElement) {
    try {
      const savedQuality = JSON.parse(localStorage.getItem('astra-preferences-v1') ?? '{}').quality;
      if (['performance', 'balanced', 'high'].includes(savedQuality)) this.quality = savedQuality;
    } catch { /* Embedded/private browsing can disable storage. */ }
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.id = 'world-canvas';
    this.host.append(this.renderer.domElement);
    this.scene.background = new THREE.Color('#bac7b0');
    this.scene.fog = new THREE.FogExp2('#c3c6a9', .0125);
    this.scene.add(this.hemisphere, this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight('#e1e4ca', .75); fill.position.set(-25, 15, 20); this.scene.add(fill);
    this.sun.position.set(-22, 32, -20); this.sun.target.position.set(0, 0, -2);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { near: 5, far: 125, left: -31, right: 31, top: 31, bottom: -31 });
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -.00015; this.sun.shadow.normalBias = .025;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sky.scale.setScalar(400);
    const uniforms = this.sky.material.uniforms;
    uniforms.turbidity.value = 6; uniforms.rayleigh.value = 1.65; uniforms.mieCoefficient.value = .007; uniforms.mieDirectionalG.value = .86;
    uniforms.sunPosition.value.copy(this.sun.position).normalize();
    this.scene.add(this.sky);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.host);
    const lost = (e: Event) => { e.preventDefault(); this.stop(); this.onContextLost(); };
    this.renderer.domElement.addEventListener('webglcontextlost', lost);
    this.cleanups.push(() => this.renderer.domElement.removeEventListener('webglcontextlost', lost));
    this.resize();
  }
  async initialize(progress: (amount: number, label: string) => void) {
    progress(12, 'Gathering light between the leaves');
    this.material = await loadMaterials(this.renderer, label => progress(24, label));
    progress(40, 'Following the old road');
    await yieldToBrowser();
    createTerrain(this.scene, this.material);
    progress(52, 'Growing the ancient woodland');
    await yieldToBrowser();
    this.nature = createForest(this.scene, this.material, this.collision);
    progress(72, 'Leaving a story on the trail');
    await yieldToBrowser();
    await createAmbush(this.scene, this.material, this.collision);
    progress(82, 'Letting the afternoon settle in');
    const environment = await new HDRLoader().loadAsync('/environment/forest.hdr');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTarget = pmrem.fromEquirectangular(environment);
    this.environmentTexture = envTarget.texture; this.scene.environment = envTarget.texture; this.scene.environmentIntensity = .70;
    this.scene.environmentRotation.y = 1.6;
    environment.dispose(); pmrem.dispose(); this.cleanups.push(() => envTarget.dispose());
    this.controller = new PlayerController(this.camera, this.renderer.domElement, this.collision, this.scene);
    this.addAtmosphere(); this.setupPostprocessing(); this.setQuality(this.quality); this.resize();
    progress(92, 'Opening your window to the wild');
    await yieldToBrowser();
    await this.renderer.compileAsync(this.scene, this.camera);
    this.composer.render();
    progress(100, 'The trail is yours');
    this.running = true; this.lastFrame = performance.now(); this.raf = requestAnimationFrame(this.frame);
  }
  private setupPostprocessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.host.clientWidth, this.host.clientHeight), .17, .7, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : .005 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float time, grain; varying vec2 vUv;
        void main(){
          vec3 c=texture2D(tDiffuse,vUv).rgb;
          float v=smoothstep(.2,.82,length((vUv-.5)*vec2(1.,.9)));
          c*=1.-v*.17;
          float n=fract(sin(dot(vUv+fract(time*.013),vec2(12.9898,78.233)))*43758.5453)-.5;
          c+=n*grain;
          gl_FragColor=vec4(c,1.);
        }`,
    });
    this.composer.addPass(this.film);
  }
  private addAtmosphere() {
    const rng = seededRandom(617), positions: number[] = [], seeds: number[] = [];
    for (let i = 0; i < 450; i++) { positions.push((rng() - .5) * 62, .8 + rng() * 14, (rng() - .5) * 55); seeds.push(rng()); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, tint: { value: new THREE.Color('#e4d9a9') }, opacity: { value: .48 }, pixelRatio: { value: this.renderer.getPixelRatio() } },
      vertexShader: `uniform float time,pixelRatio;attribute float aSeed;varying float vFade;
        void main(){vec3 p=position;p.x+=sin(time*.18+aSeed*60.)*.65;p.z+=cos(time*.13+aSeed*30.)*.7;p.y+=sin(time*.2+aSeed*50.)*.6;
        vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize=clamp((10.+aSeed*14.)/(-mv.z),.8,3.0)*pixelRatio;
        vFade=(.4+aSeed*.6)*(1.-smoothstep(8.,42.,-mv.z));}`,
      fragmentShader: 'uniform vec3 tint;uniform float opacity;varying float vFade;void main(){float a=(1.-smoothstep(.05,.5,length(gl_PointCoord-.5)));gl_FragColor=vec4(tint,a*vFade*opacity);}',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(g, m); this.particles.frustumCulled = false; this.scene.add(this.particles);
    this.shaftMaterial = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: .075 }, tint: { value: new THREE.Color('#f9e9b5') }, time: { value: 0 } },
      vertexShader: 'varying vec2 vUv;varying float vDepth;void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.);vDepth=-p.z;gl_Position=projectionMatrix*p;}',
      fragmentShader: `uniform float opacity,time;uniform vec3 tint;varying vec2 vUv;varying float vDepth;
        void main(){float edge=pow(max(0.,1.-abs(vUv.x-.5)*2.),2.);float ends=smoothstep(0.,.12,vUv.y)*(1.-smoothstep(.28,1.,vUv.y));
        float w=.84+sin(vUv.y*19.+time*.16)*.07;float fade=smoothstep(1.,5.,vDepth)*(1.-smoothstep(28.,65.,vDepth));
        gl_FragColor=vec4(tint,opacity*edge*ends*w*fade);}`,
      side: THREE.DoubleSide, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    });
    const origins = [[-16, 14, -7], [-9, 16, -9], [-4, 15, -8], [2, 16, -10], [-19, 13, -4], [8, 16, -14]];
    origins.forEach(([x, y, z], i) => {
      const start = new THREE.Vector3(x, y, z), end = start.clone().add(new THREE.Vector3(.48, -.76, .44).multiplyScalar(19));
      const geometry = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.Mesh(geometry, this.shaftMaterial); mesh.frustumCulled = false; mesh.renderOrder = 3; this.scene.add(mesh);
      this.shafts.push({ mesh, start, end, width: .65 + i % 3 * .65 });
    });
  }
  setQuality(quality: Quality) {
    this.quality = quality;
    this.renderDirty = true;
    this.renderer.shadowMap.type = quality === 'performance' ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    if (this.environmentTexture) this.scene.environment = quality === 'performance' ? null : this.environmentTexture;
    this.scene.traverse(o => {
      if (o instanceof THREE.InstancedMesh && o.userData.density) {
        const d = o.userData.density;
        o.count = Math.max(1, Math.floor(d.total * (quality === 'high' ? 1 : d[quality])));
      }
    });
    const ratio = quality === 'performance' ? .85 : quality === 'balanced' ? 1.15 : 1.65;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratio));
    const shadowSize = quality === 'performance' ? 1024 : quality === 'balanced' ? 1536 : 2048;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    this.renderer.shadowMap.needsUpdate = true;
    if (this.bloom) this.bloom.enabled = quality !== 'performance';
    if (this.nature) {
      const factor = quality === 'performance' ? .18 : quality === 'balanced' ? .72 : 1;
      this.nature.grass.count = Math.floor(this.nature.detailCounts[0] * factor);
      this.nature.ferns.count = Math.floor(this.nature.detailCounts[1] * (quality === 'performance' ? .25 : quality === 'balanced' ? .8 : 1));
    }
    if (this.particles) (this.particles.material as THREE.ShaderMaterial).uniforms.pixelRatio.value = this.renderer.getPixelRatio();
    this.resize();
  }
  setAtmosphere(atmosphere: Atmosphere) {
    this.renderDirty = true;
    const fog = this.scene.fog as THREE.FogExp2;
    const particleMat = this.particles.material as THREE.ShaderMaterial;
    if (atmosphere === 'golden') {
      this.sun.color.set('#ffe0a6'); this.sun.intensity = 3.8;
      this.hemisphere.color.set('#d1ded9'); this.hemisphere.groundColor.set('#746b48'); this.hemisphere.intensity = 1.95;
      this.scene.environmentIntensity = .70; this.renderer.toneMappingExposure = 1.06;
      fog.color.set('#c3c6a9'); fog.density = .0125;
      this.sky.material.uniforms.turbidity.value = 6; this.sky.material.uniforms.rayleigh.value = 1.65;
      this.shaftMaterial.uniforms.opacity.value = .075;
      particleMat.uniforms.tint.value.set('#e4d9a9'); particleMat.uniforms.opacity.value = .48;
    } else if (atmosphere === 'overcast') {
      this.sun.color.set('#c9d9e5'); this.sun.intensity = .85;
      this.hemisphere.color.set('#c1d0d6'); this.hemisphere.groundColor.set('#56625c'); this.hemisphere.intensity = 2.1;
      this.scene.environmentIntensity = .66; this.renderer.toneMappingExposure = 1.02;
      fog.color.set('#aebbb8'); fog.density = .025;
      this.sky.material.uniforms.turbidity.value = 20; this.sky.material.uniforms.rayleigh.value = .35;
      this.shaftMaterial.uniforms.opacity.value = 0;
      particleMat.uniforms.tint.value.set('#c5d4d1'); particleMat.uniforms.opacity.value = .22;
    } else {
      this.sun.color.set('#aac6ed'); this.sun.intensity = .55;
      this.hemisphere.color.set('#7189ac'); this.hemisphere.groundColor.set('#263e3f'); this.hemisphere.intensity = 1.2;
      this.scene.environmentIntensity = .17; this.renderer.toneMappingExposure = .86;
      fog.color.set('#526e79'); fog.density = .022;
      this.sky.material.uniforms.turbidity.value = 9; this.sky.material.uniforms.rayleigh.value = .55;
      this.shaftMaterial.uniforms.opacity.value = .023; this.shaftMaterial.uniforms.tint.value.set('#94bedb');
      particleMat.uniforms.tint.value.set('#d3e896'); particleMat.uniforms.opacity.value = .8;
    }
    if (atmosphere !== 'blue') this.shaftMaterial.uniforms.tint.value.set('#f9e9b5');
    this.sky.visible = atmosphere === 'golden';
    (this.scene.background as THREE.Color).copy(fog.color);
  }
  setMode(mode: CameraMode) {
    this.renderDirty = true; this.renderer.shadowMap.needsUpdate = true;
    this.controller.setMode(mode); this.camera.fov = mode === 'first' ? 72 : 59; this.camera.updateProjectionMatrix();
  }
  getState(): WorldState {
    const c = this.controller, p = c.position;
    const place = LANDMARKS.find(l => Math.hypot(p.x - l.x, p.z - l.z) < l.radius);
    return { x: p.x, y: p.y, z: p.z, yaw: c.yaw, mode: c.mode, moving: c.velocity.length() > .3, grounded: c.grounded, started: c.started, paused: c.paused, fps: this.fps, landmark: place?.id ?? null, distanceWalked: c.walkDistance };
  }
  private frame = (now: number) => {
    if (!this.running) return;
    const realDelta = (now - this.lastFrame) / 1000;
    const dt = Math.min(realDelta, .1); this.lastFrame = now; this.elapsed += dt;
    this.controller.update(dt);
    this.material.wind.value = this.elapsed;
    const particleMat = this.particles.material as THREE.ShaderMaterial;
    particleMat.uniforms.time.value = this.elapsed; this.shaftMaterial.uniforms.time.value = this.elapsed;
    this.film.uniforms.time.value = this.elapsed;
    for (const shaft of this.shafts) {
      const axis = shaft.end.clone().sub(shaft.start), view = this.camera.position.clone().sub(shaft.start), side = axis.cross(view).normalize();
      const a = shaft.mesh.geometry.getAttribute('position');
      const vertices = [shaft.start.clone().addScaledVector(side, -shaft.width * .28), shaft.start.clone().addScaledVector(side, shaft.width * .28), shaft.end.clone().addScaledVector(side, -shaft.width), shaft.end.clone().addScaledVector(side, shaft.width)];
      vertices.forEach((v, i) => a.setXYZ(i, v.x, v.y, v.z)); a.needsUpdate = true;
    }
    // Keep the high-resolution shadow region around the traveller.
    const targetX = Math.round(this.controller.position.x / 4) * 4, targetZ = Math.round(this.controller.position.z / 4) * 4;
    if (this.controller.velocity.lengthSq() > .0004 || !this.controller.grounded || this.sun.target.position.x !== targetX || this.sun.target.position.z !== targetZ) this.renderer.shadowMap.needsUpdate = true;
    this.sun.target.position.set(targetX, terrainHeight(targetX, targetZ), targetZ);
    this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(-22, 32, -20));
    this.renderer.info.reset();
    if (!this.controller.paused || this.renderDirty) { this.composer.render(); this.renderDirty = false; }
    this.frameCount++; this.fpsTimer += realDelta;
    if (this.fpsTimer > 1) { this.fps = Math.round(this.frameCount / this.fpsTimer); this.frameCount = 0; this.fpsTimer = 0; }
    if (this.frameCount % 3 === 0) {
      const state = this.getState(); this.onUpdate(state);
      if (state.started && state.landmark && !this.visited.has(state.landmark)) {
        this.visited.add(state.landmark); this.onDiscovery(LANDMARKS.find(l => l.id === state.landmark)!.name);
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  };
  resize() {
    this.renderDirty = true;
    const w = this.host.clientWidth || window.innerWidth, h = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.composer?.setPixelRatio(this.renderer.getPixelRatio()); this.composer?.setSize(w, h);
  }
  async screenshot() {
    this.composer.render();
    const blob = await new Promise<Blob | null>(resolve => this.renderer.domElement.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not save this frame.');
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `astra-triboar-trail-${Date.now()}.png`; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  get diagnostics() { return { ...this.renderer.info.render, quality: this.quality, trees: this.nature?.trees ?? 0 }; }
  stop() { this.running = false; cancelAnimationFrame(this.raf); this.controller?.setPaused(true); }
  dispose() {
    this.stop(); this.observer.disconnect(); this.controller?.dispose(); this.cleanups.forEach(fn => fn());
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.scene.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => materials.add(m));
      }
    });
    this.material?.textures.forEach(t => textures.add(t));
    if (this.material?.leafDepth) materials.add(this.material.leafDepth);
    materials.forEach(m => { Object.values(m).forEach(v => { if (v instanceof THREE.Texture) textures.add(v); }); m.dispose(); });
    geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose());
    this.composer?.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
const yieldToBrowser = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
