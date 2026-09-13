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
    disposers.push(this.spawnLoop(origin, 46, {
      color: '#ff9a3c', size: 0.12, height: 2.2, radius: 0.35, speed: 0.9,
      blending: THREE.AdditiveBlending, opacity: 0.95,
    }));
    disposers.push(this.spawnLoop(origin.clone().add(new THREE.Vector3(0, 1.2, 0)), 22, {
      color: '#8a8a8a', size: 0.5, height: 3.4, radius: 0.5, speed: 0.5,
      blending: THREE.NormalBlending, opacity: 0.28,
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
        arr[j * 3] += Math.sin(elapsed * 2 + loop.seeds[j] * 20) * dt * 0.25;
      }
      positions.needsUpdate = true;
    }
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
  }
}
