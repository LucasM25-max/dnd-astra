import * as THREE from 'three';

/** Soft round sprite texture (dust motes, embers, smoke, healing sparkles). */
function puffTexture(inner: string, outer: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  material: THREE.PointsMaterial;
  geometry: THREE.BufferGeometry;
}

interface Loop {
  points: THREE.Points;
  velocities: Float32Array;
  seeds: Float32Array;
  origin: THREE.Vector3;
  height: number;
  radius: number;
  material: THREE.PointsMaterial;
  geometry: THREE.BufferGeometry;
  active: boolean;
}

/** Pooled CPU particle effects: bursts (dust, healing) and loops (embers, smoke). */
export class ParticleEffects {
  private bursts: Burst[] = [];
  private loops: Loop[] = [];
  private textures: THREE.Texture[] = [];
  private loopUniforms: { material: THREE.ShaderMaterial; origin: THREE.Vector3 }[] = [];

  constructor(private scene: THREE.Scene) {}

  private texture(inner: string, outer: string): THREE.Texture {
    const texture = puffTexture(inner, outer);
    this.textures.push(texture);
    return texture;
  }

  /** Sunbeam dust motes drifting over a point. */
  dustBurst(position: THREE.Vector3, count = 42): void {
    this.spawnBurst(position, count, {
      color: '#e4d9a9', size: 0.09, life: 3.2, spread: 1.1, rise: 0.12, gravity: -0.02,
      blending: THREE.AdditiveBlending, opacity: 0.75,
    });
  }

  /** Green healing numbers' sparkle companion. */
  healingSparkles(position: THREE.Vector3, count = 36): void {
    this.spawnBurst(position, count, {
      color: '#7ee787', size: 0.11, life: 1.8, spread: 0.5, rise: 1.1, gravity: 0.4,
      blending: THREE.AdditiveBlending, opacity: 0.9,
    });
  }

  /** Golden inspiration shimmer. */
  inspirationShimmer(position: THREE.Vector3, count = 28): void {
    this.spawnBurst(position, count, {
      color: '#e3cea1', size: 0.1, life: 2.2, spread: 0.6, rise: 0.8, gravity: 0.2,
      blending: THREE.AdditiveBlending, opacity: 0.9,
    });
  }

  private spawnBurst(
    origin: THREE.Vector3, count: number,
    opts: { color: string; size: number; life: number; spread: number; rise: number; gravity: number; blending: THREE.Blending; opacity: number },
  ): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x + (Math.random() - 0.5) * opts.spread;
      positions[i * 3 + 1] = origin.y + Math.random() * 0.6;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * opts.spread;
      velocities[i * 3] = (Math.random() - 0.5) * 0.3;
      velocities[i * 3 + 1] = opts.rise * (0.4 + Math.random() * 0.8);
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: this.texture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
      color: opts.color, size: opts.size, transparent: true, opacity: opts.opacity,
      depthWrite: false, blending: opts.blending, sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, velocities, life: opts.life, maxLife: opts.life, gravity: opts.gravity, drag: 0.4, material, geometry });
  }

  /** Continuous campfire embers + smoke. Dispose when leaving camp. */
  campfireLoop(origin: THREE.Vector3): { dispose: () => void } {
    const disposers: (() => void)[] = [];

    // Embers: a shader-driven point cloud — each spark lives on its own
    // cycle, rises, wobbles on the thermals, and fades gold → ember red.
    {
      const count = 64;
      const seeds = new Float32Array(count * 2);
      const offsets = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        seeds[i * 2] = Math.random();           // life phase
        seeds[i * 2 + 1] = 0.55 + Math.random() * 0.75; // speed
        offsets[i * 2] = (Math.random() - 0.5) * 0.5;
        offsets[i * 2 + 1] = (Math.random() - 0.5) * 0.5;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));
      geometry.setAttribute('aOff', new THREE.BufferAttribute(offsets, 2));
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uOrigin: { value: origin.clone() },
          uHeight: { value: 3.1 },
          uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        },
        vertexShader: `
          uniform float uTime, uHeight, uPixelRatio; uniform vec3 uOrigin;
          attribute vec2 aSeed; attribute vec2 aOff;
          varying float vLife; varying float vFlicker;
          void main() {
            float life = fract(aSeed.x + uTime * 0.13 * aSeed.y);
            vLife = life;
            float rise = life * uHeight;
            vec3 p = uOrigin;
            p.x += aOff.x * (1.0 + rise * 1.5) + sin(uTime * 1.6 + aSeed.x * 61.0 + rise * 3.4) * (0.06 + rise * 0.08);
            p.z += aOff.y * (1.0 + rise * 1.5) + cos(uTime * 1.3 + aSeed.x * 27.0 + rise * 2.8) * (0.06 + rise * 0.08);
            p.y += rise * (0.55 + aSeed.y * 0.5);
            vFlicker = 0.6 + 0.4 * sin(uTime * 21.0 + aSeed.x * 90.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            // Sparkle size, clamped so embers passing the lens never bloom into lens-filling discs.
            gl_PointSize = min(30.0, (2.6 + aSeed.y * 2.6) * (1.0 - life * 0.55) * (14.0 / max(1.0, -mv.z)) * 2.4) * uPixelRatio;
          }`,
        fragmentShader: `
          varying float vLife; varying float vFlicker;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.08, d) * (1.0 - smoothstep(0.62, 1.0, vLife)) * smoothstep(0.0, 0.12, vLife);
            vec3 col = mix(vec3(1.0, 0.85, 0.45), vec3(0.98, 0.32, 0.08), vLife);
            gl_FragColor = vec4(col * (1.1 + vFlicker * 0.5), a * (0.5 + vFlicker * 0.5) * 0.9);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      this.scene.add(points);
      disposers.push(() => { this.scene.remove(points); geometry.dispose(); material.dispose(); });
      this.loopUniforms.push({ material, origin: origin.clone() });
    }

    // Smoke: slow grey puffs swelling and drifting off the wind line.
    disposers.push(this.spawnLoop(origin.clone().add(new THREE.Vector3(0, 1.15, 0)), 24, {
      color: '#9a958a', size: 0.62, height: 3.8, radius: 0.5, speed: 0.42,
      blending: THREE.NormalBlending, opacity: 0.2,
    }));
    return { dispose: () => disposers.forEach(d => d()) };
  }

  private spawnLoop(
    origin: THREE.Vector3, count: number,
    opts: { color: string; size: number; height: number; radius: number; speed: number; blending: THREE.Blending; opacity: number },
  ): () => void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seeds[i] = Math.random();
      positions[i * 3] = origin.x + (Math.random() - 0.5) * opts.radius;
      positions[i * 3 + 1] = origin.y + Math.random() * opts.height;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * opts.radius;
      velocities[i] = opts.speed * (0.6 + Math.random() * 0.7);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: this.texture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
      color: opts.color, size: opts.size, transparent: true, opacity: opts.opacity,
      depthWrite: false, blending: opts.blending, sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
    const loop: Loop = { points, velocities, seeds, origin: origin.clone(), height: opts.height, radius: opts.radius, material, geometry, active: true };
    this.loops.push(loop);
    return () => {
      loop.active = false;
      this.scene.remove(points);
      geometry.dispose();
      material.dispose();
      this.loops = this.loops.filter(l => l !== loop);
    };
  }

  update(dt: number, elapsed: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.points);
        b.geometry.dispose();
        b.material.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const positions = b.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = positions.array as Float32Array;
      for (let j = 0; j < arr.length; j += 3) {
        b.velocities[j + 1] -= b.gravity * dt;
        b.velocities[j] *= 1 - b.drag * dt;
        b.velocities[j + 2] *= 1 - b.drag * dt;
        arr[j] += b.velocities[j] * dt;
        arr[j + 1] += b.velocities[j + 1] * dt;
        arr[j + 2] += b.velocities[j + 2] * dt;
      }
      positions.needsUpdate = true;
      b.material.opacity = Math.max(0, (b.life / b.maxLife)) * 0.9;
    }
    for (const loop of this.loops) {
      if (!loop.active) continue;
      const positions = loop.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = positions.array as Float32Array;
      const count = loop.velocities.length;
      for (let j = 0; j < count; j++) {
        let y = arr[j * 3 + 1] + loop.velocities[j] * dt;
        if (y > loop.origin.y + loop.height) {
          y = loop.origin.y;
          arr[j * 3] = loop.origin.x + (Math.random() - 0.5) * loop.radius;
          arr[j * 3 + 2] = loop.origin.z + (Math.random() - 0.5) * loop.radius;
        }
        arr[j * 3 + 1] = y;
        // Drift with a lazy gust line so the plume leans downwind.
        arr[j * 3] += (Math.sin(elapsed * 2 + loop.seeds[j] * 20) * 0.25 + 0.16) * dt;
      }
      // Plume breathes: puffs swell gently as the column rises.
      loop.material.size = 0.52 + 0.14 * (0.5 + 0.5 * Math.sin(elapsed * 0.7));
      positions.needsUpdate = true;
    }
    for (const ember of this.loopUniforms) ember.material.uniforms.uTime.value = elapsed;
  }

  dispose(): void {
    for (const b of this.bursts) {
      this.scene.remove(b.points);
      b.geometry.dispose();
      b.material.dispose();
    }
    for (const loop of this.loops) {
      this.scene.remove(loop.points);
      loop.geometry.dispose();
      loop.material.dispose();
    }
    for (const t of this.textures) t.dispose();
    this.bursts = [];
    this.loops = [];
    this.textures = [];
    this.loopUniforms = [];
  }
}
