import * as THREE from 'three';
import { CAMP, CollisionField, seededRandom, terrainHeight } from './landscape';
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

export interface CampfireSite {
  position: THREE.Vector3
  update(elapsed: number): void
  dispose(): void
}

/** Warmth shared by everything near the fire. */
const FIRE_LIGHT = '#ff9a3c'

function campTex(loader: THREE.TextureLoader, file: string, repeat = 1): Promise<THREE.Texture | null> {
  return loader.loadAsync(`/textures/camp/${file}`).then(t => {
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat, repeat)
    return t
  }).catch(() => null)
}
function worldTex(loader: THREE.TextureLoader, file: string, repeat: [number, number]): Promise<THREE.Texture | null> {
  return loader.loadAsync(`/textures/${file}`).then(t => {
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat[0], repeat[1])
    return t
  }).catch(() => null)
}

/** Painted flame sheet: a bright base fanning into licking tongues that thin upward. */
function paintFlameTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 128; canvas.height = 168
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, 128, 168)
  ctx.globalCompositeOperation = 'lighter'
  const tongues: [number, number, number][] = [[64, 1.0, 0], [40, .62, 2.1], [88, .58, 4.4], [56, .78, 1.1], [74, .7, 5.2]]
  for (const [cx, scale, phase] of tongues) {
    const w = 34 * scale
    const hgt = (150 - 26 * Math.abs(cx - 64) / 40) * scale
    const grad = ctx.createLinearGradient(0, 168, 0, 168 - hgt)
    grad.addColorStop(0, 'rgba(255,120,24,0.95)')
    grad.addColorStop(0.28, 'rgba(255,168,54,0.92)')
    grad.addColorStop(0.62, 'rgba(255,214,120,0.55)')
    grad.addColorStop(1, 'rgba(255,236,180,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(cx - w / 2, 168)
    ctx.bezierCurveTo(cx - w / 2, 168 - hgt * .45, cx - w * .18 + Math.sin(phase) * 7, 168 - hgt * .72, cx + Math.sin(phase + 2) * 9, 168 - hgt)
    ctx.bezierCurveTo(cx + w * .3, 168 - hgt * .6, cx + w / 2, 168 - hgt * .4, cx + w / 2, 168)
    ctx.closePath()
    ctx.fill()
  }
  // Hot core at the base of the fire.
  const core = ctx.createRadialGradient(64, 158, 4, 64, 158, 46)
  core.addColorStop(0, 'rgba(255,244,214,0.9)')
  core.addColorStop(1, 'rgba(255,150,50,0)')
  ctx.fillStyle = core
  ctx.fillRect(18, 118, 92, 50)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

/** Soft round glow (fire halo, lantern bloom). */
function paintGlowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62)
  g.addColorStop(0, 'rgba(255,190,110,0.95)')
  g.addColorStop(0.45, 'rgba(255,130,44,0.32)')
  g.addColorStop(1, 'rgba(255,110,30,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * The woodland camp: a fire pit with a stone ring, stacked firewood, crossed
 * animated flames and glowing coals under a flickering light; a tripod pot,
 * log benches, a bedroll, a supply crate, and a lantern on a forked stake.
 * Sits in its own flattened clearing a few metres off the trail — see
 * `CAMP` in landscape.ts (the terrain and forest generation honour it).
 */
export async function createCampfireSite(scene: THREE.Scene, collision: CollisionField): Promise<CampfireSite> {
  const x = CAMP.x, z = CAMP.z, y = terrainHeight(x, z)
  const rng = seededRandom(2024)
  const loader = new THREE.TextureLoader()
  const [groundTex, groundN, charTex, charN, woolTex, barkTex, rockTex] = await Promise.all([
    campTex(loader, 'camp-ground.webp', 3.4), campTex(loader, 'camp-ground-normal.webp', 3.4),
    campTex(loader, 'charred-log.webp', 1), campTex(loader, 'charred-log-normal.webp', 1),
    campTex(loader, 'bedroll-wool.webp', 2),
    worldTex(loader, 'bark-moss.webp', [1.6, 1]), worldTex(loader, 'rock.webp', [1, 1]),
  ])
  const site = new THREE.Group()
  site.name = 'Woodland camp'
  site.position.set(x, y, z)
  scene.add(site)
  const geoms: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [], textures: THREE.Texture[] = [groundTex, groundN, charTex, charN, woolTex, barkTex, rockTex].filter(Boolean) as THREE.Texture[]
  const track = <T extends THREE.Mesh>(m: T, cast = true, receive = cast): T => { m.castShadow = cast; m.receiveShadow = receive; geoms.push(m.geometry); mats.push(m.material as THREE.Material); site.add(m); return m }
  const std = (opts: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => { const m = new THREE.MeshStandardMaterial(opts); return m }

  // — Trampled earth floor of the clearing (kept inside the flattened terrace). —
  {
    const geo = new THREE.CircleGeometry(2.72, 40)
    geo.rotateX(-Math.PI / 2)
    const mat = std({ map: groundTex ?? undefined, normalMap: groundN ?? undefined, normalScale: new THREE.Vector2(0.9, 0.9), color: '#c9b8a2', roughness: 1 })
    const floor = new THREE.Mesh(geo, mat)
    floor.position.y = 0.014
    floor.receiveShadow = true
    geoms.push(geo); mats.push(mat)
    site.add(floor)
  }
  // — Scorched patch beneath the fire. —
  {
    const geo = new THREE.CircleGeometry(1.06, 28)
    geo.rotateX(-Math.PI / 2)
    const mat = std({ color: '#171009', roughness: 1, transparent: true, opacity: 0.82 })
    const scorch = new THREE.Mesh(geo, mat)
    scorch.position.y = 0.021
    geoms.push(geo); mats.push(mat)
    site.add(scorch)
  }

  // — Stone ring: irregular, half-sunk, warmed on the fire-facing side. —
  {
    const stoneMat = std({ map: rockTex ?? undefined, color: rockTex ? '#b5ac9c' : '#7d7f7a', roughness: 0.95 })
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + (rng() - 0.5) * 0.22
      const r = 0.68 + (rng() - 0.5) * 0.14
      const geo = new THREE.IcosahedronGeometry(0.13 + rng() * 0.075, 1)
      const pos = geo.getAttribute('position')
      for (let v = 0; v < pos.count; v++) {
        const ny = pos.getY(v) / 0.2
        pos.setXYZ(v, pos.getX(v) * (0.86 + rng() * 0.3), ny < 0 ? pos.getY(v) * 0.55 : pos.getY(v) * 0.9, pos.getZ(v) * (0.86 + rng() * 0.3))
      }
      geo.computeVertexNormals()
      const rock = new THREE.Mesh(geo, stoneMat)
      rock.position.set(Math.cos(a) * r, 0.045 + rng() * 0.02, Math.sin(a) * r)
      rock.rotation.set(rng() * 3, rng() * 3, rng() * 3)
      track(rock)
      geoms.push(geo)
    }
    mats.push(stoneMat)
  }

  // — Firewood: two base logs crossed, five stacked to a lean-to, one spare split log. —
  const charMat = std({ map: charTex ?? undefined, normalMap: charN ?? undefined, color: charTex ? '#c7b29a' : '#33271c', roughness: 0.96 })
  mats.push(charMat)
  {
    const log = (len: number, rTop: number, rBot: number, px: number, py: number, pz: number, tilt: number, yaw: number): void => {
      const geo = new THREE.CylinderGeometry(rTop, rBot, len, 9, 1)
      const mesh = new THREE.Mesh(geo, charMat)
      mesh.position.set(px, py, pz)
      mesh.rotation.set(0, yaw, Math.PI / 2)
      mesh.rotateX(tilt)
      track(mesh)
      geoms.push(geo)
    }
    log(1.02, 0.07, 0.08, 0, 0.07, 0, 0, 0.36)
    log(1.0, 0.065, 0.075, 0, 0.07, 0, 0, 1.85)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.5
      log(0.82, 0.05, 0.06, Math.cos(a) * 0.17, 0.4, Math.sin(a) * 0.17, -1.02, a + Math.PI / 2)
    }
    log(0.66, 0.05, 0.055, 0.92, 0.05, -0.62, 0, 2.6) // spare beside the ring
    // Glowing gaps at the base of the stack.
    const emberMat = std({ color: '#2a0f05', emissive: new THREE.Color('#ff6a1e'), emissiveIntensity: 2.4, roughness: 1 })
    mats.push(emberMat)
    for (let i = 0; i < 5; i++) {
      const geo = new THREE.SphereGeometry(0.028 + rng() * 0.02, 6, 5)
      const a = (i / 5) * Math.PI * 2 + 1.1
      const mesh = new THREE.Mesh(geo, emberMat)
      mesh.position.set(Math.cos(a) * 0.3, 0.09, Math.sin(a) * 0.3)
      geoms.push(geo)
      site.add(mesh)
    }
  }

  // — Coal bed: emissive discs that breathe with the fire. —
  const coalMat = std({ color: '#1c0f08', emissive: new THREE.Color('#ff521e'), emissiveIntensity: 1.05, roughness: 1 })
  mats.push(coalMat)
  {
    const geo = new THREE.CircleGeometry(0.4, 16)
    geo.rotateX(-Math.PI / 2)
    const bed = new THREE.Mesh(geo, coalMat)
    bed.position.y = 0.05
    geoms.push(geo)
    site.add(bed)
  }

  // — Flames: three crossed textured planes with a licking vertex wobble,
  //    plus a hot inner sheet. All additive; bloom picks the crest up. —
  const flameMap = paintFlameTexture()
  textures.push(flameMap)
  const glowMap = paintGlowTexture()
  textures.push(glowMap)
  type FlameLayer = { mat: THREE.ShaderMaterial; base: number; sway: number; speed: number }
  const flameLayers: FlameLayer[] = []
  {
    const layer = (w: number, h: number, y: number, colorA: string, colorB: string, opacity: number, phase: number): void => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uMap: { value: flameMap }, uColorA: { value: new THREE.Color(colorA) }, uColorB: { value: new THREE.Color(colorB) }, uOpacity: { value: opacity }, uPhase: { value: phase }, uFlicker: { value: 1 } },
        vertexShader: `
          uniform float uTime, uPhase;
          varying vec2 vUv;
          void main(){
            vUv = uv;
            vec3 p = position;
            float k = p.y * 2.0 / ${h.toFixed(3)}; k = max(0., k); k *= k;
            p.x += sin(uTime * 7.4 + uPhase + p.y * 6.2) * 0.05 * k;
            p.z += cos(uTime * 5.9 + uPhase * 1.7 + p.y * 4.4) * 0.038 * k;
            p.y *= 1.0 + sin(uTime * 10.3 + uPhase * 2.3) * 0.07;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: `
          uniform sampler2D uMap; uniform float uTime, uOpacity, uPhase; uniform vec3 uColorA, uColorB; uniform float uFlicker;
          varying vec2 vUv;
          void main(){
            vec2 uv = vUv;
            uv.x += sin(uTime * 6.1 + uv.y * 15.0 + uPhase) * 0.03;
            float a = texture2D(uMap, clamp(uv, vec2(0.0), vec2(1.0))).a;
            a *= uOpacity * (0.86 + 0.14 * sin(uTime * 12.7 + uv.y * 9.0 + uPhase * 5.0)) * uFlicker;
            vec3 col = mix(uColorA, uColorB, smoothstep(0.05, 0.75, uv.y));
            gl_FragColor = vec4(col * (1.15 + uFlicker * 0.2), a);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      })
      mats.push(mat)
      const geo = new THREE.PlaneGeometry(w, h)
      for (const rotY of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.y = y
        mesh.rotation.y = rotY
        geoms.push(geo)
        site.add(mesh)
      }
      flameLayers.push({ mat, base: y, sway: 1, speed: 1 })
    }
    layer(0.92, 1.28, 0.55, '#ff8a2c', '#ff4d18', 0.9, 0)
    layer(0.5, 0.78, 0.42, '#ffe8ac', '#ffab3d', 0.96, 2.4)
  }
  // Halo bloom over the fire.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: '#ffb060', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }))
  halo.position.y = 0.5
  halo.scale.setScalar(2.4)
  mats.push(halo.material as THREE.Material)
  site.add(halo)

  // — Firelight: the flicker lives here now (random-walk composite sines). —
  const fire = new THREE.PointLight(FIRE_LIGHT, 34, 19, 1.7)
  fire.position.set(0, 0.72, 0)
  fire.castShadow = false
  site.add(fire)
  const fillFire = new THREE.PointLight('#ff7130', 8, 8, 2)
  fillFire.position.set(0, 0.3, 0)
  site.add(fillFire)

  // — Tripod with a hanging pot. —
  {
    const iron = std({ color: '#2c2a28', metalness: 0.72, roughness: 0.52 })
    mats.push(iron)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.85
      const geo = new THREE.CylinderGeometry(0.026, 0.032, 1.72, 7)
      geoms.push(geo)
      const pole = new THREE.Mesh(geo, iron)
      pole.position.set(Math.cos(a) * 0.52, 0.76, Math.sin(a) * 0.52)
      pole.rotation.set(Math.sin(a) * 0.56, 0, -Math.cos(a) * 0.56)
      track(pole)
    }
    const geo = new THREE.LatheGeometry([new THREE.Vector2(0.02, 0), new THREE.Vector2(0.13, 0.02), new THREE.Vector2(0.16, 0.1), new THREE.Vector2(0.15, 0.16)], 14)
    geoms.push(geo)
    const pot = new THREE.Mesh(geo, iron)
    pot.position.set(0, 0.92, 0)
    pot.rotation.set(0, 0.4, 0.02 * Math.PI)
    track(pot)
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.44, 4), iron)
    chain.position.set(0, 1.24, 0)
    geoms.push(chain.geometry); mats.push(iron)
    site.add(chain)
  }

  // — Log benches (flat-faced) and a split stump — seating around the fire. —
  {
    const benchMat = std({ map: barkTex ?? undefined, color: barkTex ? '#cabfa4' : '#5d4a33', roughness: 0.96 })
    mats.push(benchMat)
    for (const [bx, bz, rot] of [[-1.55, 0.72, 0.42], [1.5, -1.05, -0.5]] as const) {
      const geo = new THREE.CylinderGeometry(0.17, 0.17, 1.6, 10, 1, false, Math.PI / 2, Math.PI)
      geoms.push(geo)
      const bench = new THREE.Mesh(geo, benchMat)
      bench.position.set(bx, 0.165, bz)
      bench.rotation.set(0, rot + Math.PI / 2, Math.PI / 2)
      track(bench)
      for (const sign of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6), benchMat)
        leg.position.set(bx + Math.cos(rot) * 0.6 * sign, 0.08, bz - Math.sin(rot) * 0.6 * sign)
        geoms.push(leg.geometry)
        track(leg)
        collision.add({ x: leg.position.x + x, z: leg.position.z + z, radius: 0.16, bottom: y, top: y + 0.5 })
      }
    }
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.42, 11), benchMat)
    stump.position.set(0.3, 0.21, 1.45)
    geoms.push(stump.geometry)
    track(stump)
    collision.add({ x: 0.3 + x, z: 1.45 + z, radius: 0.32, bottom: y, top: y + 0.44 })
  }

  // — Bedroll, pack, and a supply crate (the delivery rest). —
  {
    const woolMat = std({ map: woolTex ?? undefined, color: woolTex ? '#cfd3d6' : '#4a5a6e', roughness: 1 })
    mats.push(woolMat)
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.82, 12), woolMat)
    roll.position.set(-0.55, 0.12, 1.6)
    roll.rotation.set(Math.PI / 2, 0, 0.5)
    geoms.push(roll.geometry)
    track(roll)
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.05, 0.52), woolMat)
    blanket.position.set(-0.1, 0.035, 1.55)
    blanket.rotation.y = 0.5
    geoms.push(blanket.geometry)
    track(blanket, false, true)
    const leatherMat = std({ color: '#4d3a26', roughness: 0.9 })
    mats.push(leatherMat)
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.2), leatherMat)
    pack.position.set(-0.86, 0.2, 1.1)
    pack.rotation.set(0.12, 0.7, 0.06)
    geoms.push(pack.geometry)
    track(pack)
    const crateWood = std({ color: '#6e5638', roughness: 0.92, map: barkTex ?? undefined })
    mats.push(crateWood)
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.5, 0.5), crateWood)
    crate.position.set(1.28, 0.25, 0.85)
    crate.rotation.y = -0.35
    geoms.push(crate.geometry)
    track(crate)
    collision.add({ x: 1.28 + x, z: 0.85 + z, radius: 0.42, bottom: y, top: y + 0.52 })
  }

  // — A lantern on a forked stake: warm amber glass for the night hours. —
  {
    const stakeMat = std({ color: '#4c3c2a', roughness: 1 })
    const glassMat = std({ color: '#ffcf8e', emissive: new THREE.Color('#ffb45e'), emissiveIntensity: 1.8, roughness: 0.4, transparent: true, opacity: 0.92 })
    const brassMat = std({ color: '#96763c', metalness: 0.85, roughness: 0.42 })
    mats.push(stakeMat, glassMat, brassMat)
    const stakeGeo = new THREE.CylinderGeometry(0.035, 0.05, 1.5, 7)
    const stake = new THREE.Mesh(stakeGeo, stakeMat)
    stake.position.set(-1.9, 0.75, -0.55)
    stake.rotation.z = 0.05
    geoms.push(stakeGeo)
    track(stake)
    const armGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.34, 5)
    const arm = new THREE.Mesh(armGeo, stakeMat)
    arm.position.set(-1.78, 1.44, -0.55)
    arm.rotation.z = Math.PI / 2.6
    geoms.push(armGeo)
    track(arm)
    const cageGeo = new THREE.CylinderGeometry(0.085, 0.1, 0.17, 6)
    const cage = new THREE.Mesh(cageGeo, brassMat)
    cage.position.set(-1.66, 1.28, -0.55)
    geoms.push(cageGeo)
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.13, 8), glassMat)
    glass.position.copy(cage.position)
    geoms.push(glass.geometry)
    site.add(cage, glass)
    const lanternLight = new THREE.PointLight('#ffbd6c', 3.2, 5, 1.8)
    lanternLight.position.copy(glass.position)
    site.add(lanternLight)
    const lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: '#ffca84', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }))
    lanternGlow.position.copy(glass.position)
    lanternGlow.scale.setScalar(0.55)
    mats.push(lanternGlow.material as THREE.Material)
    site.add(lanternGlow)
    collision.add({ x: -1.9 + x, z: -0.55 + z, radius: 0.14, bottom: y, top: y + 1.5 })
  }

  collision.add({ x, z, radius: 0.62, bottom: y, top: y + 1 })

  const dispose = (): void => {
    scene.remove(site)
    geoms.forEach(g => g.dispose())
    mats.forEach(m => m.dispose())
    textures.forEach(t => t.dispose())
    fire.dispose(); fillFire.dispose()
  }
  const update = (elapsed: number): void => {
    // Composite-sine random walk: never a visible beat, always alive.
    const f = 0.55 + 0.3 * Math.sin(elapsed * 8.3 + 0.7) * Math.sin(elapsed * 3.1) + 0.22 * Math.sin(elapsed * 19.7 + 1.3) + 0.12 * Math.sin(elapsed * 31.3)
    const flicker = Math.max(0.45, Math.min(1.5, f))
    for (const layer of flameLayers) {
      layer.mat.uniforms.uTime.value = elapsed
      layer.mat.uniforms.uFlicker.value = flicker
    }
    coalMat.emissiveIntensity = 0.85 + flicker * 0.35
    fire.intensity = 28 + flicker * 9
    fillFire.intensity = 6 + flicker * 4
    halo.scale.setScalar(2.2 + flicker * 0.35)
    ;(halo.material as THREE.SpriteMaterial).opacity = 0.34 + flicker * 0.2
  }
  return { position: new THREE.Vector3(x, y, z), update, dispose }
}
