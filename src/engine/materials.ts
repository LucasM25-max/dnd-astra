import * as THREE from 'three';

export interface Materials {
  ground: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  leaves: THREE.MeshStandardMaterial;
  leafDepth: THREE.MeshDepthMaterial;
  stone: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  fern: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  coniferDark: THREE.MeshStandardMaterial;
  wind: { value: number };
  textures: THREE.Texture[];
}
export async function loadMaterials(renderer: THREE.WebGLRenderer, progress: (s: string) => void): Promise<Materials> {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = async (name: string, normal = false) => {
    const t = await loader.loadAsync(`/textures/${name}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (!normal) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  progress('Unfolding the leaf-litter floor');
  const [litter, litterN, path, pathN, bark, barkN, rock, rockN, leaf] = await Promise.all([
    tex('ground-leaf-litter.webp'), tex('ground-leaf-litter-normal.webp', true), tex('earth-path.webp'),
    tex('earth-path-normal.webp', true), tex('bark-moss.webp'), tex('bark-moss-normal.webp', true),
    tex('rock.webp'), tex('rock-normal.webp', true), tex('oak-leaves.webp'),
  ]);
  bark.repeat.set(2, 3.5); barkN.repeat.copy(bark.repeat);
  leaf.wrapS = leaf.wrapT = THREE.ClampToEdgeWrapping;
  const wind = { value: 0 };
  // The forest floor is the leaf-litter sheet itself; the trail (earth path)
  // and stony banks (rock) are blended in per-vertex with a dithered edge so
  // the surfaces stay organic rather than checkered.
  const ground = new THREE.MeshStandardMaterial({ map: litter, normalMap: litterN, normalScale: new THREE.Vector2(.72, .72), roughness: .97, vertexColors: true });
  ground.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uRoad: { value: path }, uRoadN: { value: pathN }, uStone: { value: rock }, uStoneN: { value: rockN } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nattribute vec2 aBlend; varying vec2 vBlend;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBlend = aBlend;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform sampler2D uRoad, uRoadN, uStone, uStoneN; varying vec2 vBlend;\nfloat groundHash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}`)
      .replace('#include <map_fragment>', `
        // Dither the per-vertex blend at fragment scale so path/bank edges stay organic, not checkered.
        vec2 gb = vBlend + (vec2(groundHash(vMapUv * 317.7), groundHash(vMapUv * 281.3)) - .5) * .22;
        gb.x = clamp(gb.x, 0., 1.); gb.y = clamp(gb.y, 0., .8);
        vec4 litterCol = texture2D(map, vMapUv);
        vec4 road = texture2D(uRoad, vMapUv * 1.25) * vec4(.90, .80, .66, 1.);
        vec4 stone = texture2D(uStone, vMapUv * .84);
        vec4 blended = mix(litterCol, stone * vec4(.80, .86, .66, 1.), gb.y * .5);
        diffuseColor *= mix(blended, road, gb.x);
      `)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
        vec3 litterNormal = texture2D(normalMap, vNormalMapUv).xyz;
        vec3 stoneNormal = texture2D(uStoneN, vNormalMapUv * .84).xyz;
        vec3 roadNormal = texture2D(uRoadN, vNormalMapUv * 1.25).xyz;
        vec3 mapN = mix(mix(litterNormal, stoneNormal, vBlend.y), roadNormal, vBlend.x) * 2.0 - 1.0;
      `);
  };
  const barkMat = new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, normalScale: new THREE.Vector2(1.05, 1.05), color: '#e6e2d0', roughness: .98 });
  const leaves = new THREE.MeshStandardMaterial({ map: leaf, alphaTest: .46, side: THREE.DoubleSide, roughness: .83, vertexColors: true, color: '#b6c88f' });
  leaves.shadowSide = THREE.DoubleSide;
  const leafDepth = new THREE.MeshDepthMaterial({ map: leaf, alphaTest: .46, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking });
  leaves.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wpos = vec4(position,1.);
        #ifdef USE_INSTANCING
          wpos = instanceMatrix * wpos;
        #endif
        float sway = sin(uWindTime * .75 + wpos.x * .62 + wpos.z * .44);
        transformed.x += sway * .052 * smoothstep(2.,9.,position.y);
        transformed.z += cos(uWindTime * .64 + wpos.z * .5) * .028;
      `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(.11, .13, .055);
    `);
  };
  const stone = new THREE.MeshStandardMaterial({ map: rock, normalMap: rockN, normalScale: new THREE.Vector2(.62, .62), roughness: .95, vertexColors: true });
  const grass = new THREE.MeshStandardMaterial({ color: '#d4dcb4', side: THREE.DoubleSide, roughness: 1, vertexColors: true });
  grass.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wpos = vec4(position,1.);
        #ifdef USE_INSTANCING
          wpos = instanceMatrix * wpos;
        #endif
        transformed.x += sin(uWindTime * 1.3 + wpos.x * .75 + wpos.z * .61) * position.y * .15;
        transformed.z += cos(uWindTime + wpos.z * .8) * position.y * .07;
      `);
  };
  const fern = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, side: THREE.DoubleSide });
  // Distant-ring conifers: dark, no wind, no shadow cost.
  const coniferDark = new THREE.MeshStandardMaterial({ map: leaf, alphaTest: .46, side: THREE.DoubleSide, roughness: .95, vertexColors: true, color: '#5c7355' });
  const wood = new THREE.MeshStandardMaterial({ color: '#74634c', map: bark, roughness: .95 });
  return { ground, bark: barkMat, leaves, leafDepth, stone, grass, fern, wood, coniferDark, wind, textures: [litter, litterN, path, pathN, bark, barkN, rock, rockN, leaf] };
}
