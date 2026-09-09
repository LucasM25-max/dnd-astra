import * as THREE from 'three';

/**
 * Combat visual effects: slash arcs, impact bursts, blood, shock rings and
 * floating damage numbers.
 *
 * Everything is short-lived, pooled-per-event, and self-disposing. Floaters
 * render as crisp DOM text over the canvas, projected from world space every
 * frame, so numbers stay readable while the camera moves.
 */

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  t: number;
  life: number;
  gravity: number;
  drag: number;
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  from: number;
  to: number;
}

interface Arc {
  mesh: THREE.Mesh;
  baseScale: number;
  t: number;
  life: number;
}

interface Floater {
  el: HTMLDivElement;
  world: THREE.Vector3;
  t: number;
  life: number;
  rise: number;
  scaleIn: number;
}

export class CombatFx {
  readonly group = new THREE.Group();
  private bursts: Burst[] = [];
  private rings: Ring[] = [];
  private arcs: Arc[] = [];
  private floaters: Floater[] = [];
  private layer: HTMLDivElement;
  private disposed = false;
  private lastCamera: THREE.PerspectiveCamera | null = null;
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(parent: THREE.Object3D) {
    this.group.name = 'CombatFx';
    parent.add(this.group);
    this.layer = document.createElement('div');
    this.layer.className = 'combat-floaters';
    this.layer.setAttribute('aria-hidden', 'true');
    document.body.append(this.layer);
  }

  /** Compile the shared spark/arc/ring programs before the first blow lands,
      staged inside the live scene so the cached programs match its lights. */
  static precompile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const warm = new THREE.Group();
    warm.position.set(0, -50, 0);
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 24),
      new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    const sparks = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({ color: '#fff', size: .075, transparent: true, opacity: .95, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    const blood = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({ color: '#6e1812', size: .06, transparent: true, opacity: .92, depthWrite: false, sizeAttenuation: true }));
    warm.add(arc, sparks, blood);
    scene.add(warm);
    renderer.compile(scene, camera);
    scene.remove(warm);
    warm.clear();
  }

  /** A bright arc that sweeps across the target along the swing direction. */
  slashArc(from: THREE.Vector3, to: THREE.Vector3, critical = false) {
    const mid = from.clone().lerp(to, 0.72);
    const distance = from.distanceTo(to);
    const geometry = new THREE.RingGeometry(0.24, 0.34, 28, 1, -0.35, 2.3);
    const material = new THREE.MeshBasicMaterial({
      color: critical ? '#ffd68c' : '#ffe9c4',
      transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(mid).add(new THREE.Vector3(0, Math.min(0.35, distance * 0.2), 0));
    mesh.lookAt(to);
    mesh.rotateX(Math.PI / 2);
    mesh.rotateZ(Math.random() * Math.PI - Math.PI / 2);
    const scale = THREE.MathUtils.clamp(distance * 1.15, 0.8, 2.4);
    mesh.scale.setScalar(scale * 0.6);
    mesh.renderOrder = 9;
    this.group.add(mesh);
    this.arcs.push({ mesh, baseScale: scale, t: 0, life: critical ? 0.34 : 0.26 });
  }

  /** Spark/debris burst. */
  impact(position: THREE.Vector3, colour = '#ffcf8c', count = 16, speed = 2.6, life = 0.42) {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x; positions[i * 3 + 1] = position.y; positions[i * 3 + 2] = position.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.35 + Math.random() * 0.65);
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * v;
      velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * v * 0.9 + 0.6;
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * v;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: colour, size: 0.075, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 9;
    points.frustumCulled = false;
    this.group.add(points);
    this.bursts.push({ points, velocities, t: 0, life, gravity: 5.5, drag: 2.2 });
  }

  /** Dark arterial spray on a hit; heavier on a kill. */
  blood(position: THREE.Vector3, strength = 1) {
    const count = Math.round(10 + strength * 10);
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x; positions[i * 3 + 1] = position.y; positions[i * 3 + 2] = position.z;
      const theta = Math.random() * Math.PI * 2;
      const v = (0.8 + Math.random() * 1.6) * strength;
      velocities[i * 3] = Math.cos(theta) * v * 0.6;
      velocities[i * 3 + 1] = 0.6 + Math.random() * 1.6 * strength;
      velocities[i * 3 + 2] = Math.sin(theta) * v * 0.6;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: '#6e1812', size: 0.06, transparent: true, opacity: 0.92,
      depthWrite: false, sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 9;
    points.frustumCulled = false;
    this.group.add(points);
    this.bursts.push({ points, velocities, t: 0, life: 0.6 + strength * 0.2, gravity: 8.5, drag: 1.1 });
  }

  /** An expanding ground ring for critical hits and heavy blows. */
  shockRing(position: THREE.Vector3, radius = 1.1, colour = '#ffd68c') {
    const geometry = new THREE.RingGeometry(0.82, 1, 48);
    const material = new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position).add(new THREE.Vector3(0, 0.04, 0));
    mesh.renderOrder = 8;
    this.group.add(mesh);
    this.rings.push({ mesh, t: 0, life: 0.5, from: 0.25, to: radius });
  }

  /** A floating combat readout ("12!", "MISS", "CRITICAL 18!"). */
  floater(world: THREE.Vector3, text: string, kind: 'damage' | 'crit' | 'miss' | 'heal' | 'spell' = 'damage') {
    if (this.disposed) return;
    const el = document.createElement('div');
    el.className = `combat-floater floater-${kind}`;
    el.textContent = text;
    // Invisible until the first update() projects it: on a slow frame a
    // newborn floater would otherwise flash at the layer's top-left corner.
    el.style.opacity = '0';
    this.layer.append(el);
    const floater: Floater = { el, world: world.clone(), t: 0, life: 1.15, rise: 0, scaleIn: 0 };
    this.floaters.push(floater);
    // Position immediately when a previous frame is known, so even a
    // single-frame read lands on the target instead of the corner.
    if (this.lastCamera) this.placeFloater(floater, this.lastCamera, this.lastWidth, this.lastHeight);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, width: number, height: number) {
    // Bursts.
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.t += dt;
      const position = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const drag = Math.exp(-burst.drag * dt);
      for (let p = 0; p < position.count; p++) {
        burst.velocities[p * 3 + 1] -= burst.gravity * dt;
        burst.velocities[p * 3] *= drag;
        burst.velocities[p * 3 + 1] *= drag;
        burst.velocities[p * 3 + 2] *= drag;
        position.setXYZ(p,
          position.getX(p) + burst.velocities[p * 3] * dt,
          position.getY(p) + burst.velocities[p * 3 + 1] * dt,
          position.getZ(p) + burst.velocities[p * 3 + 2] * dt);
      }
      position.needsUpdate = true;
      const material = burst.points.material as THREE.PointsMaterial;
      material.opacity = Math.max(0, 1 - burst.t / burst.life) * 0.95;
      if (burst.t >= burst.life) {
        this.group.remove(burst.points);
        burst.points.geometry.dispose();
        material.dispose();
        this.bursts.splice(i, 1);
      }
    }
    // Rings.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.t += dt;
      const k = Math.min(1, ring.t / ring.life);
      const eased = 1 - Math.pow(1 - k, 3);
      ring.mesh.scale.setScalar(ring.from + (ring.to - ring.from) * eased);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
      if (k >= 1) {
        this.group.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    // Arcs.
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i];
      arc.t += dt;
      const k = Math.min(1, arc.t / arc.life);
      arc.mesh.scale.setScalar(arc.baseScale * THREE.MathUtils.lerp(0.6, 1.25, k));
      (arc.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.95;
      arc.mesh.rotateZ(dt * 4);
      if (k >= 1) {
        this.group.remove(arc.mesh);
        arc.mesh.geometry.dispose();
        (arc.mesh.material as THREE.Material).dispose();
        this.arcs.splice(i, 1);
      }
    }
    // Floaters: project and drift.
    this.lastCamera = camera; this.lastWidth = width; this.lastHeight = height;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const floater = this.floaters[i];
      floater.t += dt;
      const k = Math.min(1, floater.t / floater.life);
      floater.rise += dt * 46;
      floater.scaleIn = Math.min(1, floater.scaleIn + dt * 6);
      this.placeFloater(floater, camera, width, height);
      if (k >= 1) {
        floater.el.remove();
        this.floaters.splice(i, 1);
      }
    }
  }

  private placeFloater(floater: Floater, camera: THREE.PerspectiveCamera, width: number, height: number) {
    const k = Math.min(1, floater.t / floater.life);
    const p = floater.world.clone().project(camera);
    if (p.z < 1) {
      const x = (p.x * 0.5 + 0.5) * width;
      const y = (-p.y * 0.5 + 0.5) * height - floater.rise;
      const pop = 1 + (1 - floater.scaleIn) * 0.6;
      floater.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(floater.scaleIn * pop).toFixed(3)})`;
      floater.el.style.opacity = String(Math.min(1, (1 - k) * 2.4));
    } else {
      floater.el.style.opacity = '0';
    }
  }

  dispose() {
    this.disposed = true;
    for (const burst of this.bursts) { burst.points.geometry.dispose(); (burst.points.material as THREE.Material).dispose(); }
    for (const ring of this.rings) { ring.mesh.geometry.dispose(); (ring.mesh.material as THREE.Material).dispose(); }
    for (const arc of this.arcs) { arc.mesh.geometry.dispose(); (arc.mesh.material as THREE.Material).dispose(); }
    for (const floater of this.floaters) floater.el.remove();
    this.bursts = []; this.rings = []; this.arcs = []; this.floaters = [];
    this.layer.remove();
    this.group.parent?.remove(this.group);
  }
}
