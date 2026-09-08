import * as THREE from 'three';

export interface Materials {
  ground: THREE.MeshStandardMaterial;
  leafLitter: THREE.Texture;
  bark: THREE.MeshStandardMaterial;
  leaves: THREE.MeshStandardMaterial;
  leafDepth: THREE.MeshDepthMaterial;
  stone: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  fern: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  coniferDark: THREE.MeshStandardMaterial;
  water: THREE.ShaderMaterial;
  streamBed: THREE.MeshStandardMaterial;
  wind: { value: number };
  textures: THREE.Texture[];
}

export async function loadMaterials(renderer: THREE.WebGLRenderer, progress: (s: string) => void): Promise<Materials> {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = async (name: string, normal = false, repeat?: number) => {
    try {
      const t = await loader.loadAsync(`/textures/${name}`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = anisotropy;
      if (!normal) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.repeat.set(repeat, repeat);
      return t;
    } catch {
      // Fallback to 1x1 if missing
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = normal ? '#8080ff' : '#ffffff';
      ctx.fillRect(0,0,2,2);
      const fallback = new THREE.CanvasTexture(canvas);
      fallback.wrapS = fallback.wrapT = THREE.RepeatWrapping;
      return fallback;
    }
  };

  progress('Unfolding the forest floor');
  const [
    forest, forestN,
    path, pathN,
    bark, barkN,
    rock, rockN,
    leaf, leafLitter,
    streamWater, streamWaterN,
    streamBed, streamBedN
  ] = await Promise.all([
    tex('forest-floor.webp'), tex('forest-floor-normal.webp', true),
    tex('earth-path.webp'), tex('earth-path-normal.webp', true),
    tex('bark.webp'), tex('bark-normal.webp', true),
    tex('rock.webp'), tex('rock-normal.webp', true),
    tex('oak-leaves.webp'), tex('leaf-litter.webp'),
    tex('stream-water.webp'), tex('stream-water-normal.webp', true),
    tex('stream-bed.webp'), tex('stream-bed-normal.webp', true),
  ]);

  bark.repeat.set(2, 3.5); barkN.repeat.copy(bark.repeat);
  leaf.wrapS = leaf.wrapT = THREE.ClampToEdgeWrapping;

  const wind = { value: 0 };
  const timeUniform = { value: 0 };

  // Ground material with tri-planar blend: forest floor, path, stone, leaf litter, stream bed
  const ground = new THREE.MeshStandardMaterial({
    map: forest,
    normalMap: forestN,
    normalScale: new THREE.Vector2(.68, .68),
    roughness: .97,
    metalness: 0.02,
    vertexColors: true
  });

  ground.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uRoad: { value: path },
      uRoadN: { value: pathN },
      uStone: { value: rock },
      uStoneN: { value: rockN },
      uLeafLitter: { value: leafLitter },
      uStreamBed: { value: streamBed },
      uStreamBedN: { value: streamBedN },
      uStreamMask: { value: 0 } // will be driven by vertex color? we use aBlend.z for stream
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aBlend; varying vec3 vBlend;\n varying vec2 vWorldXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBlend = aBlend;\n vWorldXZ = vec2(position.x, position.z);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uRoad, uRoadN, uStone, uStoneN, uLeafLitter, uStreamBed, uStreamBedN;
        varying vec3 vBlend;
        varying vec2 vWorldXZ;
        float groundHash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      `)
      .replace('#include <map_fragment>', `
        // vBlend.x = road, y = stone/slope, z = stream bed
        vec2 gb = vBlend.xy + (vec2(groundHash(vMapUv * 317.7), groundHash(vMapUv * 281.3)) - .5) * .18;
        gb.x = clamp(gb.x, 0., 1.);
        gb.y = clamp(gb.y, 0., .75);
        float streamBlend = clamp(vBlend.z, 0., 1.);

        vec4 earth = texture2D(map, vMapUv);
        vec4 road = texture2D(uRoad, vMapUv * 1.15) * vec4(.94, .82, .66, 1.);
        vec4 stone = texture2D(uStone, vMapUv * .78);
        vec4 sBed = texture2D(uStreamBed, vMapUv * 1.4);

        // Base mix: forest floor + stone variation on slopes
        vec4 blended = mix(earth, stone * vec4(.78,.88,.58,1.), gb.y * .42);
        // Leaf litter breaks repetition
        vec3 litter = texture2D(uLeafLitter, vMapUv * .38).rgb;
        float litterMask = (1. - gb.x) * (1. - streamBlend) * smoothstep(.35, .78, groundHash(vMapUv * 3.9));
        blended.rgb = mix(blended.rgb, blended.rgb * mix(vec3(.88,.80,.62), litter, .58), litterMask * .32);

        // Stream bed dark damp earth near water
        blended = mix(blended, sBed * vec4(.72,.68,.62,1.), streamBlend * .85);

        // Road on top
        diffuseColor *= mix(blended, road, gb.x);
      `)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
        vec3 forestNormal = texture2D(normalMap, vNormalMapUv).xyz;
        vec3 stoneNormal = texture2D(uStoneN, vNormalMapUv * .78).xyz;
        vec3 roadNormal = texture2D(uRoadN, vNormalMapUv * 1.15).xyz;
        vec3 bedNormal = texture2D(uStreamBedN, vNormalMapUv * 1.4).xyz;
        vec3 baseN = mix(mix(forestNormal, stoneNormal, vBlend.y), bedNormal, vBlend.z);
        vec3 mapN = mix(baseN, roadNormal, vBlend.x) * 2.0 - 1.0;
      `);
  };

  const barkMat = new THREE.MeshStandardMaterial({
    map: bark,
    normalMap: barkN,
    normalScale: new THREE.Vector2(.95, .95),
    color: '#d6cdb9',
    roughness: .92,
    metalness: 0.02
  });

  const leaves = new THREE.MeshStandardMaterial({
    map: leaf,
    alphaTest: .46,
    side: THREE.DoubleSide,
    roughness: .83,
    vertexColors: true,
    color: '#b6c88f'
  });
  leaves.shadowSide = THREE.DoubleSide;
  const leafDepth = new THREE.MeshDepthMaterial({
    map: leaf,
    alphaTest: .46,
    side: THREE.DoubleSide,
    depthPacking: THREE.RGBADepthPacking
  });

  leaves.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
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

  const stone = new THREE.MeshStandardMaterial({
    map: rock,
    normalMap: rockN,
    normalScale: new THREE.Vector2(.62, .62),
    roughness: .92,
    metalness: 0.05,
    vertexColors: true
  });

  const grass = new THREE.MeshStandardMaterial({
    color: '#d4dcb4',
    side: THREE.DoubleSide,
    roughness: 1,
    vertexColors: true
  });
  grass.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
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
  const coniferDark = new THREE.MeshStandardMaterial({
    map: leaf,
    alphaTest: .46,
    side: THREE.DoubleSide,
    roughness: .95,
    vertexColors: true,
    color: '#5c7355'
  });
  const wood = new THREE.MeshStandardMaterial({ color: '#74634c', map: bark, roughness: .95 });

  // Stream bed material - wet sand/pebbles
  const streamBedMat = new THREE.MeshStandardMaterial({
    map: streamBed,
    normalMap: streamBedN,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.85,
    metalness: 0.02,
    color: '#6b6052'
  });

  // Photorealistic water shader with flow, refraction, foam, depth
  const water = new THREE.ShaderMaterial({
    uniforms: {
      time: timeUniform,
      uWaterNormal: { value: streamWaterN },
      uWaterColor: { value: streamWater },
      uStreamBed: { value: streamBed },
      uDepthColor: { value: new THREE.Color('#1e3a4a') },
      uShallowColor: { value: new THREE.Color('#4a8fa8') },
      uOpacity: { value: 0.92 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vFlow;
      varying vec3 vNormalW;
      uniform float time;
      void main(){
        vUv = uv;
        vec3 pos = position;
        // Gentle wave displacement along stream flow (assume flow along +Z or -Z, use world Z for flow)
        float flow = uv.y * 12.0 + time * 0.6;
        vFlow = flow;
        // Small vertical displacement for waves
        pos.y += sin(flow * 1.2 + uv.x * 8.0) * 0.04 + sin(flow * 0.7) * 0.02;
        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D uWaterNormal;
      uniform sampler2D uWaterColor;
      uniform sampler2D uStreamBed;
      uniform vec3 uDepthColor;
      uniform vec3 uShallowColor;
      uniform float time;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying float vFlow;
      varying vec3 vNormalW;

      // Hash for foam
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a, b, u.x) + (c - a)*u.y*(1.0-u.x) + (d - b)*u.x*u.y;
      }

      void main(){
        // Flow UVs - two layers scrolling at different speeds for parallax
        vec2 flowUv1 = vUv * vec2(1.2, 3.0) + vec2(0.0, time * 0.12);
        vec2 flowUv2 = vUv * vec2(0.9, 2.2) + vec2(0.07, time * 0.07 + 0.3);

        vec3 n1 = texture2D(uWaterNormal, flowUv1).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(uWaterNormal, flowUv2 * 1.3 + vec2(0.1, 0.0)).xyz * 2.0 - 1.0;
        vec3 normal = normalize(n1 * 0.6 + n2 * 0.4);
        normal.xy *= 0.8;
        normal = normalize(normal);

        // Depth based on distance to edge (vUv.x) - center deeper
        float edgeDist = min(vUv.x, 1.0 - vUv.x) * 2.0; // 0 at edge, 1 at center
        float depthFactor = smoothstep(0.0, 0.7, edgeDist);
        // Vary depth along stream with noise
        float depthNoise = noise(vWorldPos.xz * 0.08 + time * 0.02) * 0.15;
        depthFactor = clamp(depthFactor + depthNoise, 0.0, 1.0);

        // Water color mixing shallow to deep
        vec3 waterCol = mix(uShallowColor, uDepthColor, depthFactor * 0.7);
        // Add subtle bed visibility in shallow areas
        vec3 bed = texture2D(uStreamBed, vUv * 2.5).rgb;
        waterCol = mix(waterCol, waterCol * bed * 1.2, (1.0 - depthFactor) * 0.35);

        // Specular - sun reflection
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 lightDir = normalize(vec3(-0.5, 1.0, -0.3));
        vec3 halfDir = normalize(lightDir + viewDir);
        float spec = pow(max(dot(halfDir, normal), 0.0), 128.0) * 1.8;
        spec += pow(max(dot(halfDir, normal), 0.0), 32.0) * 0.4;

        // Fresnel
        float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0,1.0,0.0)), 0.0), 3.5) * 0.6 + 0.15;

        // Foam at edges and where water hits rocks (based on edgeDist and noise)
        float foamEdge = smoothstep(0.15, 0.0, edgeDist) * 0.9;
        float foamNoise = noise(vUv * 8.0 + time * 0.15) * 0.5 + 0.5;
        float foam = foamEdge * foamNoise;
        // Add foam in shallow rapids
        float rapidFoam = (1.0 - depthFactor) * noise(vUv * 12.0 + time * 0.2) * 0.25;
        foam = max(foam, rapidFoam);

        // Final color
        vec3 color = waterCol;
        color += spec * vec3(1.0, 0.95, 0.85) * 0.9;
        color = mix(color, vec3(0.95, 0.96, 0.92), foam * 0.85);
        color += fresnel * vec3(0.6, 0.8, 0.95) * 0.25;

        // Subtle flow streaks
        float streak = sin(vFlow * 2.0 + vUv.x * 12.0) * 0.04 + 1.0;
        color *= streak;

        float alpha = uOpacity * (0.75 + depthFactor * 0.25);
        alpha = mix(alpha, 1.0, foam * 0.3);

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  // Water time follows wind time - both driven by elapsed
  Object.defineProperty(wind, 'value', {
    get() { return timeUniform.value; },
    set(v) { timeUniform.value = v; }
  });

  return {
    ground,
    leafLitter,
    bark: barkMat,
    leaves,
    leafDepth,
    stone,
    grass,
    fern,
    wood,
    coniferDark,
    water,
    streamBed: streamBedMat,
    wind,
    textures: [forest, forestN, path, pathN, bark, barkN, rock, rockN, leaf, leafLitter, streamWater, streamWaterN, streamBed, streamBedN]
  };
}
