import * as THREE from 'three';

/**
 * The physically based material set for creatures, arms and encounter props.
 *
 * Every map is an image-derived albedo with a matching derived normal and a
 * cavity-biased roughness map, prepared by `scripts/prepare-combat-assets.mjs`.
 * Metals are real metals (metalness 1 with a roughness map) rather than a grey
 * colour with a specular fudge, which is what makes steel read as steel under
 * the scene's HDRI.
 */
export interface CombatMaterials {
  creatureSkin: THREE.MeshStandardMaterial;
  /** Human skin, for the hero body. */
  humanSkin: THREE.MeshStandardMaterial;
  creatureCloth: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  chainmail: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  caveRock: THREE.MeshStandardMaterial;
  parchment: THREE.MeshStandardMaterial;
  eye: THREE.MeshPhysicalMaterial;
  woodShaft: THREE.MeshStandardMaterial;
  fletching: THREE.MeshStandardMaterial;
  bowstring: THREE.MeshBasicMaterial;
  blood: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
}

export async function loadCombatMaterials(renderer: THREE.WebGLRenderer): Promise<CombatMaterials> {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const all: THREE.Texture[] = [];

  const load = async (name: string, colour: boolean) => {
    const t = await loader.loadAsync(`/textures/${name}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (colour) t.colorSpace = THREE.SRGBColorSpace;
    all.push(t);
    return t;
  };
  /** Albedo + normal + roughness for one prepared plate. */
  const set = async (name: string) => ({
    map: await load(name, true),
    normalMap: await load(`${name}-normal`, false),
    roughnessMap: await load(`${name}-rough`, false),
  });

  const [skin, human, cloth, leatherSet, mail, steelSet, rock, vellum] = await Promise.all([
    set('goblin-skin'), set('human-skin'), set('goblin-cloth'), set('leather-armor'),
    set('chainmail'), set('forged-steel'), set('cave-rock'), set('parchment'),
  ]);

  // Skin: a dielectric with a little forward scatter faked through a warm
  // sheen, so the thin ears and snout do not read as painted cardboard.
  const creatureSkin = new THREE.MeshStandardMaterial({
    ...skin, normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.92, metalness: 0,
    color: '#8b9660', vertexColors: true,
  });
  creatureSkin.map!.repeat.set(1.6, 1.6);
  creatureSkin.normalMap!.repeat.copy(creatureSkin.map!.repeat);
  creatureSkin.roughnessMap!.repeat.copy(creatureSkin.map!.repeat);

  // Human skin for the hero: finer pores, warmer tone, calmer normal detail.
  const humanSkin = new THREE.MeshStandardMaterial({
    ...human, normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.68, metalness: 0,
    color: '#d9a887', vertexColors: true,
  });
  humanSkin.map!.repeat.set(1.4, 1.4);
  humanSkin.normalMap!.repeat.copy(humanSkin.map!.repeat);
  humanSkin.roughnessMap!.repeat.copy(humanSkin.map!.repeat);

  const creatureCloth = new THREE.MeshStandardMaterial({
    ...cloth, normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1, metalness: 0, color: '#7a6748', side: THREE.DoubleSide,
  });
  cloth.map.repeat.set(2.2, 2.2);
  cloth.normalMap.repeat.copy(cloth.map.repeat);
  cloth.roughnessMap.repeat.copy(cloth.map.repeat);

  const leather = new THREE.MeshStandardMaterial({
    ...leatherSet, normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: 0.78, metalness: 0.03, color: '#8c7458',
  });

  // Real metal: metalness 1, detail entirely in the roughness and normal maps.
  const chainmail = new THREE.MeshStandardMaterial({
    ...mail, normalScale: new THREE.Vector2(1.35, 1.35),
    metalness: 1, roughness: 0.62, color: '#9aa0a4',
  });
  mail.map.repeat.set(3.2, 3.2);
  mail.normalMap.repeat.copy(mail.map.repeat);
  mail.roughnessMap.repeat.copy(mail.map.repeat);

  const steel = new THREE.MeshStandardMaterial({
    ...steelSet, normalScale: new THREE.Vector2(0.55, 0.55),
    metalness: 1, roughness: 0.34, color: '#b9bfc4',
  });

  const bronze = steel.clone();
  bronze.color = new THREE.Color('#9d7a3f');
  bronze.roughness = 0.46;

  const caveRock = new THREE.MeshStandardMaterial({
    ...rock, normalScale: new THREE.Vector2(1.25, 1.25),
    roughness: 0.94, metalness: 0, color: '#8d8b85',
  });
  rock.map.repeat.set(3, 3);
  rock.normalMap.repeat.copy(rock.map.repeat);
  rock.roughnessMap.repeat.copy(rock.map.repeat);

  const parchment = new THREE.MeshStandardMaterial({
    ...vellum, normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.88, metalness: 0, color: '#d8cba8', side: THREE.DoubleSide,
  });

  // A wet, clear-coated eye: the single strongest cue that something is alive.
  const eye = new THREE.MeshPhysicalMaterial({
    color: '#1a1206', roughness: 0.08, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03,
  });

  const woodShaft = new THREE.MeshStandardMaterial({ color: '#7a6242', roughness: 0.86, metalness: 0 });
  const fletching = new THREE.MeshStandardMaterial({ color: '#1f2420', roughness: 1, side: THREE.DoubleSide });
  const bowstring = new THREE.MeshBasicMaterial({ color: '#d8d2bc' });
  const blood = new THREE.MeshStandardMaterial({ color: '#4a0f0c', roughness: 0.35, metalness: 0, transparent: true, opacity: 0.9 });

  return {
    creatureSkin, humanSkin, creatureCloth, leather, chainmail, steel, bronze, caveRock,
    parchment, eye, woodShaft, fletching, bowstring, blood, textures: all,
  };
}

// ---------------------------------------------------------------------------
// Weapon props
// ---------------------------------------------------------------------------

/**
 * Hand-held weapons, built to real proportions and oriented so that the grip
 * sits at the origin with the blade running down -Y. That lets a weapon be
 * parented straight to a hand bone with no per-weapon offset table.
 */
export function buildWeapon(kind: 'scimitar' | 'shortbow' | 'club' | 'spear' | 'longsword' | 'dagger', m: CombatMaterials, scale = 1) {
  const group = new THREE.Group();
  const s = scale;

  const grip = (length: number, radius: number) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, length, 8), m.leather);
    mesh.castShadow = true;
    return mesh;
  };

  if (kind === 'scimitar' || kind === 'longsword') {
    const curved = kind === 'scimitar';
    const bladeLength = (curved ? 0.62 : 0.86) * s;
    // A tapered, curved blade built from a lathe of the cross-section.
    const points: THREE.Vector2[] = [];
    const segments = 14;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const width = (0.030 - t * 0.017) * s;
      points.push(new THREE.Vector2(Math.max(0.002, width), -0.06 * s - t * bladeLength));
    }
    const shape = new THREE.Shape();
    shape.moveTo(0.006 * s, 0.010 * s);
    shape.lineTo(0.030 * s, 0);
    shape.lineTo(0.013 * s, -bladeLength);
    shape.lineTo(-0.004 * s, -bladeLength);
    shape.lineTo(-0.020 * s, 0);
    shape.lineTo(-0.006 * s, 0.010 * s);
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
      depth: 0.009 * s, bevelEnabled: true, bevelSize: 0.0035 * s, bevelThickness: 0.0025 * s, bevelSegments: 2,
      steps: curved ? 8 : 1,
      extrudePath: curved ? new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.05 * s, -bladeLength * 0.5, 0),
        new THREE.Vector3(0.16 * s, -bladeLength, 0),
      ]) : undefined,
    }), m.steel);
    blade.position.y = -0.055 * s;
    blade.castShadow = true;
    group.add(blade);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.016 * s, 0.022 * s), m.bronze);
    guard.position.y = -0.048 * s; guard.castShadow = true;
    group.add(guard);

    const handle = grip(0.11 * s, 0.013 * s);
    handle.position.y = 0.005 * s;
    group.add(handle);

    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.019 * s, 10, 8), m.bronze);
    pommel.position.y = 0.062 * s;
    group.add(pommel);
    points.length = 0;
  } else if (kind === 'club') {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.017 * s, 0.021 * s, 0.44 * s, 9), m.woodShaft);
    haft.position.y = -0.16 * s; haft.castShadow = true;
    group.add(haft);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.062 * s, 1), m.woodShaft);
    head.position.y = -0.36 * s; head.scale.y = 1.35; head.castShadow = true;
    group.add(head);
    // Iron studs hammered into the head.
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      const stud = new THREE.Mesh(new THREE.ConeGeometry(0.010 * s, 0.020 * s, 5), m.steel);
      stud.position.set(Math.cos(a) * 0.058 * s, -0.36 * s + Math.sin(i * 2.3) * 0.03 * s, Math.sin(a) * 0.058 * s);
      stud.rotation.z = -Math.PI / 2; stud.rotation.y = -a;
      group.add(stud);
    }
  } else if (kind === 'spear') {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * s, 0.016 * s, 1.35 * s, 8), m.woodShaft);
    haft.position.y = -0.45 * s; haft.castShadow = true;
    group.add(haft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.028 * s, 0.20 * s, 4), m.steel);
    head.position.y = -1.20 * s; head.castShadow = true;
    group.add(head);
  } else if (kind === 'dagger') {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.019 * s, 0.22 * s, 4), m.steel);
    blade.position.y = -0.14 * s; blade.castShadow = true;
    group.add(blade);
    const handle = grip(0.075 * s, 0.011 * s);
    group.add(handle);
  } else if (kind === 'shortbow') {
    // A recurve limb traced as a tube along a curve, plus a taut string.
    const limb = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.46 * s, 0.05 * s),
      new THREE.Vector3(0, -0.28 * s, -0.02 * s),
      new THREE.Vector3(0, 0, -0.045 * s),
      new THREE.Vector3(0, 0.28 * s, -0.02 * s),
      new THREE.Vector3(0, 0.46 * s, 0.05 * s),
    ]);
    const bow = new THREE.Mesh(new THREE.TubeGeometry(limb, 24, 0.011 * s, 6, false), m.woodShaft);
    bow.castShadow = true;
    group.add(bow);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0022 * s, 0.0022 * s, 0.92 * s, 3), m.bowstring);
    string.position.z = 0.05 * s;
    group.add(string);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.017 * s, 0.017 * s, 0.10 * s, 8), m.leather);
    group.add(wrap);
  }

  group.name = `weapon:${kind}`;
  return group;
}

/** A single loosed arrow, used for the ranged attack tracer. */
export function buildArrow(m: CombatMaterials, scale = 1) {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045 * scale, 0.0045 * scale, 0.62 * scale, 5), m.woodShaft);
  shaft.rotation.x = Math.PI / 2;
  group.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.011 * scale, 0.045 * scale, 4), m.steel);
  head.rotation.x = -Math.PI / 2; head.position.z = -0.33 * scale;
  group.add(head);
  for (const a of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.055 * scale, 0.016 * scale), m.fletching);
    vane.position.z = 0.26 * scale;
    vane.rotation.set(0, Math.PI / 2, a);
    group.add(vane);
  }
  group.name = 'arrow';
  return group;
}
