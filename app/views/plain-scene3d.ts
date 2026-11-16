// “平原”的 3D 版：用 three.js 实时渲染。地形、草、雾、石头、人物全部由程序生成，没有外部素材。
// 电影感来自：只有提灯一个主光源 + 冷色的逆光、雾、景深、辉光、调色、颗粒和宽银幕黑边。
// 单位是米；女孩站在原点，面朝 +Z（镜头在 +Z 这一侧）。
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { TexturePass } from "three/addons/postprocessing/TexturePass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Anchors, DrawInput, PlainRenderer, Shot } from "./plain-types";
import { CARVED } from "./plain-scene";
import { buildGirl } from "./plain-figure3d";

const FOG = new THREE.Color("#0b1815");
const LAMP = new THREE.Color("#ffb45e");
const LAMP_POWER = 1.5;
const STONE_AT = new THREE.Vector3(-1.6, 0, 0.6);
const STONE_TURN = Math.PI / 4; // 刻字的一面朝向右前方
const STONE_FACE = new THREE.Vector3(Math.sin(STONE_TURN), 0, Math.cos(STONE_TURN));

// 机位：相机位置(3) + 看向(3) + 视角 + 焦点距离
const SHOTS: Record<"far" | "builder" | "beside" | "journal", Shot> = {
  far: [0.5, 1.4, 7.6, -0.3, 1.1, 0, 33, 7.6],
  builder: [-0.14, 1.27, 1.62, -0.1, 1.2, 0.1, 31, 1.36],
  beside: [-1.1, 1.05, 4.6, -0.6, 0.9, 0, 32, 4.6],
  journal: [0.02, 0.56, 2.22, -1.6, 0.38, 0.6, 30, 1.92],
};

// ---------------------------------------------------------------- 小工具

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function noise2(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number) => 0.5 * noise2(x, y) + 0.25 * noise2(x * 2.1, y * 2.1) + 0.125 * noise2(x * 4.3, y * 4.3) + 0.0625 * noise2(x * 8.7, y * 8.7);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** 地面高度：脚下是平的，越远起伏越大，最远处隆起成山影。 */
function groundY(x: number, z: number) {
  const d = Math.hypot(x, z);
  return (fbm(x * 0.07 + 3, z * 0.07 + 7) - 0.47) * 2.2 * smooth(3.5, 20, d) + smooth(24, 46, d) * (2 + 5 * fbm(x * 0.03, z * 0.03));
}

function canvasTexture(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void, color = true) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!, size);
  const tex = new THREE.CanvasTexture(canvas);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- 着色器

// 草、雾片共用的雾：离镜头越远越融进雾里
const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor; uniform float uFogDensity;
  vec3 applyFog(vec3 col, vec3 world) { float d = length(cameraPosition - world); return mix(col, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * d * d)); }
`;

const GRASS_VERT = /* glsl */ `
  attribute vec3 aOffset; attribute vec2 aScale; attribute float aRot; attribute float aPhase; attribute float aTone;
  uniform float uTime;
  varying float vH; varying float vTone; varying vec3 vWorld;
  void main() {
    float h = position.y;
    vec3 p = vec3(position.x * aScale.x * (1.0 - h * 0.82), h * aScale.y, h * h * (0.18 + aTone * 0.3) * aScale.y);
    float c = cos(aRot), s = sin(aRot);
    p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    // 风：一阵一阵地扫过去，草尖摆得比草根多
    float gust = 0.5 + 0.5 * sin(uTime * 0.55 + aOffset.x * 0.13 + aOffset.z * 0.09);
    vec2 wind = vec2(sin(uTime * 1.3 + aOffset.x * 0.4 + aPhase) + 0.4 * sin(uTime * 2.9 + aOffset.z * 0.9), 0.6 * cos(uTime * 1.1 + aOffset.z * 0.35 + aPhase));
    p.xz += wind * h * h * aScale.y * 0.2 * (0.35 + gust);
    vec3 world = aOffset + p;
    vH = h; vTone = aTone; vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;
const GRASS_FRAG = /* glsl */ `
  uniform vec3 uLamp; uniform vec3 uLampColor; uniform float uLampPower; uniform vec3 uMoonColor; uniform vec2 uGirl; uniform vec3 uStone;
  varying float vH; varying float vTone; varying vec3 vWorld;
  ${FOG_GLSL}
  // 人和石头挡住灯光：在地面上投一道柔和的影子（按“这根草到灯的连线离遮挡物多近”来算）
  float occlude(vec2 p, vec2 l, vec2 c, float r) {
    vec2 d = l - p; float t = clamp(dot(c - p, d) / dot(d, d), 0.0, 1.0);
    return mix(1.0, smoothstep(r * 0.55, r * 1.7, length(p + d * t - c)), step(0.03, t));
  }
  void main() {
    vec3 base = mix(vec3(0.012, 0.03, 0.016), vec3(0.11, 0.2, 0.075), vH) * (0.7 + 0.6 * vTone);
    vec3 L = uLamp - vWorld; float d = length(L);
    float att = uLampPower / (1.0 + d * d * 0.9) * smoothstep(13.0, 2.0, d);
    float shadow = occlude(vWorld.xz, uLamp.xz, uGirl, 0.2) * occlude(vWorld.xz, uLamp.xz, uStone.xy, uStone.z);
    vec3 V = normalize(cameraPosition - vWorld);
    // 逆光时草叶透光：镜头朝着灯看过去，草尖会亮起来
    float through = pow(max(dot(-V, normalize(L)), 0.0), 3.0) * vH;
    vec3 col = base * uMoonColor;
    col += base * uLampColor * att * shadow * (0.5 + 0.9 * vH);
    col += vec3(0.5, 0.52, 0.14) * uLampColor * att * shadow * through * 0.9;
    gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
  }
`;

const MIST_VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vWorld;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const MIST_FRAG = /* glsl */ `
  uniform sampler2D uTex; uniform vec3 uLamp; uniform vec3 uLampColor; uniform float uLampPower; uniform float uAlpha;
  varying vec2 vUv; varying vec3 vWorld;
  ${FOG_GLSL}
  void main() {
    float a = texture2D(uTex, vUv).r * uAlpha;
    float d = length(uLamp - vWorld);
    // 雾被灯照亮：靠近灯的雾是暖的，远处的雾是冷的
    vec3 col = vec3(0.16, 0.24, 0.21) + uLampColor * uLampPower * 0.5 / (1.0 + d * d * 0.55);
    float near = smoothstep(0.6, 3.0, length(cameraPosition - vWorld)); // 贴到镜头上的雾片淡出，免得糊一脸
    gl_FragColor = vec4(applyFog(col, vWorld), a * near);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(vec3(0.043, 0.094, 0.082), vec3(0.008, 0.018, 0.02), pow(up, 0.55));
    // 云后面的月亮：左后方一团冷光，给画面一个纵深
    float moon = pow(max(dot(d, normalize(vec3(-0.55, 0.42, -0.72))), 0.0), 24.0);
    col += vec3(0.1, 0.16, 0.17) * moon;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// 景深：按深度算每个像素该虚化多少，再在一个小圆盘里取样
const DOF_SHADER = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tDepth: { value: null as THREE.Texture | null }, uNear: { value: 0.1 }, uFar: { value: 120 }, uFocus: { value: 8 }, uRange: { value: 1 }, uMaxBlur: { value: 0.012 }, uAspect: { value: 1.6 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform float uNear, uFar, uFocus, uRange, uMaxBlur, uAspect;
    varying vec2 vUv;
    float viewZ(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
    void main() {
      float z = viewZ(vUv);
      float coc = clamp((abs(z - uFocus) - uRange) / max(uFocus, 1.0), 0.0, 1.0) * uMaxBlur;
      vec3 sum = texture2D(tDiffuse, vUv).rgb; float n = 1.0;
      if (coc > 0.0006) {
        for (int i = 1; i <= 28; i++) {
          float fi = float(i); float r = sqrt(fi / 28.0) * coc; float a = fi * 2.39996;
          sum += texture2D(tDiffuse, vUv + vec2(cos(a) / uAspect, sin(a)) * r).rgb; n += 1.0;
        }
      }
      gl_FragColor = vec4(sum / n, 1.0);
    }`,
};

// 调色 + 暗角 + 胶片颗粒 + 宽银幕黑边（在色调映射之后做）
const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uBars: { value: 0 } }, // uBars > 0 时上下加宽银幕黑边（现在不用）
  vertexShader: DOF_SHADER.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uBars;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // 暗部偏青绿，亮部偏琥珀
      col += (1.0 - smoothstep(0.0, 0.35, l)) * vec3(-0.006, 0.012, 0.01) + smoothstep(0.35, 1.0, l) * vec3(0.035, 0.012, -0.03);
      col = mix(vec3(l), col, 1.08);
      col = (col - 0.5) * 1.06 + 0.5;
      vec2 q = vUv - 0.5;
      col *= 1.0 - dot(q, q) * 0.95;
      col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7) - 0.5) * 0.045;
      col *= step(uBars, vUv.y) * step(vUv.y, 1.0 - uBars);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// ---------------------------------------------------------------- 场景里的各样东西

function buildGround() {
  const geo = new THREE.PlaneGeometry(110, 110, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundY(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const map = canvasTexture(512, (c, s) => {
    c.fillStyle = "#10180f";
    c.fillRect(0, 0, s, s);
    const r = rng(7);
    for (let i = 0; i < 5200; i++) {
      c.fillStyle = r() > 0.5 ? `rgba(34,52,26,${0.25 + r() * 0.4})` : `rgba(6,9,6,${0.25 + r() * 0.4})`;
      c.fillRect(r() * s, r() * s, 1 + r() * 5, 1 + r() * 5);
    }
  });
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(26, 26);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildGrass(count: number, uniforms: Record<string, THREE.IUniform>) {
  // 一片草叶：细长的三角带，根宽尖窄
  const SEG = 4;
  const verts: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEG; i++) verts.push(-0.5, i / SEG, 0, 0.5, i / SEG, 0);
  for (let i = 0; i < SEG; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  const r = rng(11);
  const offset = new Float32Array(count * 3);
  const scale = new Float32Array(count * 2);
  const rot = new Float32Array(count);
  const phase = new Float32Array(count);
  const tone = new Float32Array(count);
  let n = 0;
  while (n < count) {
    const d = 0.25 + Math.pow(r(), 0.62) * 34; // 近处密、远处疏
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    // 脚下、石头底下不长草；镜头在近景时站的那一小块也留空
    if (Math.hypot(x, z) < 0.16 || Math.hypot(x - STONE_AT.x, z - STONE_AT.z) < 0.7) continue;
    // 石头刻字那一面的正前方也不长草，免得挡住字
    const along = (x - STONE_AT.x) * STONE_FACE.x + (z - STONE_AT.z) * STONE_FACE.z;
    const across = Math.abs((x - STONE_AT.x) * STONE_FACE.z - (z - STONE_AT.z) * STONE_FACE.x);
    const inFront = along > 0.2 && along < 2 && across < 0.62;
    const patch = noise2(x * 0.5 + 9, z * 0.5 + 4); // 一丛一丛的，有高有矮
    if (patch < 0.24 && r() < 0.7) continue;
    offset.set([x, groundY(x, z), z], n * 3);
    const h = (0.16 + patch * 0.42) * (0.7 + r() * 0.6) * (inFront ? 0.2 : 1);
    scale.set([(0.016 + r() * 0.012) * (1 + d * 0.085), h], n * 2);
    rot[n] = r() * 6.283;
    phase[n] = r() * 6.283;
    tone[n] = r();
    n++;
  }
  geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offset, 3));
  geo.setAttribute("aScale", new THREE.InstancedBufferAttribute(scale, 2));
  geo.setAttribute("aRot", new THREE.InstancedBufferAttribute(rot, 1));
  geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute("aTone", new THREE.InstancedBufferAttribute(tone, 1));
  geo.instanceCount = count;
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  return mesh;
}

function buildTrees() {
  const r = rng(23);
  const geo = new THREE.ConeGeometry(1, 1, 7);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: "#07100d", roughness: 1 }), 170);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 170; i++) {
    const a = r() * Math.PI * 2;
    const d = 27 + r() * 22;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = 1.6 + r() * r() * 5.5;
    m.compose(new THREE.Vector3(x, groundY(x, z) - 0.3, z), new THREE.Quaternion(), new THREE.Vector3(0.6 + r() * 1.3, h, 0.6 + r() * 1.3));
    mesh.setMatrixAt(i, m);
  }
  return mesh;
}

function buildMist(uniforms: Record<string, THREE.IUniform>) {
  const tex = canvasTexture(
    256,
    (c, s) => {
      const img = c.createImageData(s, s);
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const dx = x / s - 0.5;
          const dy = y / s - 0.5;
          const fall = Math.max(0, 1 - Math.hypot(dx, dy) * 2.05);
          const v = fall * fall * (0.35 + 0.65 * fbm(x * 0.03 + 5, y * 0.03 + 2)) * 255;
          img.data.set([v, v, v, 255], (y * s + x) * 4);
        }
      }
      c.putImageData(img, 0, 0);
    },
    false,
  );
  const r = rng(31);
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1);
  const cards: { mesh: THREE.Mesh; v: number; x0: number }[] = [];
  for (let i = 0; i < 46; i++) {
    const mat = new THREE.ShaderMaterial({ uniforms: { ...uniforms, uTex: { value: tex }, uAlpha: { value: 0.1 + r() * 0.16 } }, vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    const a = r() * Math.PI * 2;
    const d = 2.5 + r() * 26;
    const size = 5 + r() * 11;
    mesh.scale.set(size * 1.7, size * 0.55, 1);
    mesh.position.set(Math.cos(a) * d, 0.5 + r() * 1.5 + smooth(14, 30, d) * 2, Math.sin(a) * d * 0.9 - 4);
    mesh.renderOrder = 2;
    group.add(mesh);
    cards.push({ mesh, v: (0.08 + r() * 0.16) * (i % 2 ? 1 : -1), x0: mesh.position.x });
  }
  return { group, cards };
}

function buildStone() {
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 6));
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 1.6 + 2, v.y * 1.6 + v.z * 1.3) * 0.34 + noise2(v.x * 6 + v.z * 5, v.y * 6) * 0.045;
    v.multiplyScalar(0.84 + n);
    v.set(v.x * 0.8, Math.max(v.y * 0.5, -0.16), v.z * 0.5); // 压扁、削平底面
    // 朝镜头的一面磨平一些，好刻字
    if (v.z > 0.3) v.z = 0.3 + (v.z - 0.3) * 0.35;
    pos.setXYZ(i, v.x, v.y, v.z);
    // 顶上长苔
    const moss = smooth(0.2, 0.42, v.y) * smooth(0.35, 0.65, noise2(v.x * 3 + 1, v.z * 3));
    colors.set([0.43 - moss * 0.3, 0.46 - moss * 0.14, 0.44 - moss * 0.33], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const bump = canvasTexture(
    256,
    (c, s) => {
      const img = c.createImageData(s, s);
      const r = rng(5);
      for (let i = 0; i < s * s; i++) {
        const g = 120 + (fbm((i % s) * 0.09, Math.floor(i / s) * 0.09) - 0.5) * 170 + (r() - 0.5) * 70;
        img.data.set([g, g, g, 255], i * 4);
      }
      c.putImageData(img, 0, 0);
    },
    false,
  );
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(5, 3);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, bumpMap: bump, bumpScale: 0.7 }));
  mesh.position.copy(STONE_AT).add(new THREE.Vector3(0, 0.16, 0));
  mesh.rotation.y = STONE_TURN;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.updateMatrixWorld(true);

  // 刻字：先把字画成一张“深度图”，再算出法线贴图——灯光斜着照过来，刻痕就有了明暗
  const W = 1024;
  const H = 512;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#fff";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = 'italic 600 118px "Cormorant Garamond", Georgia, serif';
  const jr = rng(77);
  CARVED.forEach((line, row) => {
    const widths = [...line].map((ch) => c.measureText(ch).width + 3);
    let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2 + (row ? 46 : -30);
    [...line].forEach((ch, i) => {
      c.save();
      c.translate(x + widths[i] / 2, H * (0.34 + row * 0.33) + (jr() - 0.5) * 12 + i * 0.9);
      c.rotate((jr() - 0.5) * 0.14 - 0.03);
      c.fillText(ch, 0, 0);
      c.restore();
      x += widths[i];
    });
  });
  c.filter = "blur(2.5px)";
  c.drawImage(cv, 0, 0);
  c.filter = "none";
  const height = c.getImageData(0, 0, W, H).data;
  const at = (x: number, y: number) => height[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4] / 255;
  const colorImg = c.createImageData(W, H);
  const normalImg = c.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 3.2;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      const a = at(x, y);
      normalImg.data.set([(dx / len) * 127 + 128, (-dy / len) * 127 + 128, (1 / len) * 127 + 128, Math.min(255, a * 900)], i);
      colorImg.data.set([14, 17, 16, a * 235], i); // 刻痕里是暗的
    }
  }
  const toTex = (img: ImageData, color: boolean) => {
    const cc = document.createElement("canvas");
    cc.width = W;
    cc.height = H;
    cc.getContext("2d")!.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cc);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  // 把字“贴”在石头朝镜头那一面的表面上
  const from = new THREE.Vector3(STONE_AT.x, 0.38, STONE_AT.z).addScaledVector(STONE_FACE, 5);
  const hit = new THREE.Raycaster(from, STONE_FACE.clone().negate()).intersectObject(mesh)[0];
  const decalGeo = new DecalGeometry(mesh, hit ? hit.point : new THREE.Vector3(STONE_AT.x, 0.38, STONE_AT.z).addScaledVector(STONE_FACE, 0.3), new THREE.Euler(0, STONE_TURN, -0.02), new THREE.Vector3(1.0, 0.5, 0.7));
  const decal = new THREE.Mesh(
    decalGeo,
    new THREE.MeshStandardMaterial({ map: toTex(colorImg, true), normalMap: toTex(normalImg, false), normalScale: new THREE.Vector2(1.6, 1.6), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 }),
  );
  decal.renderOrder = 1;
  return { mesh, decal };
}

// ---------------------------------------------------------------- 组装

export function createRenderer3D(canvas: HTMLCanvasElement): PlainRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  if (!renderer.capabilities.isWebGL2) throw new Error("需要 WebGL2");
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG, 0.062);
  const camera = new THREE.PerspectiveCamera(33, 1.6, 0.1, 120);

  // 天
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(100, 24, 16),
    new THREE.ShaderMaterial({ vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  scene.add(sky);

  // 光：月光（冷，从左后方来，勾出轮廓）+ 一点天光 + 提灯
  const moon = new THREE.DirectionalLight("#7fa3b4", 0.5);
  moon.position.set(-6, 7, -7);
  const fill = new THREE.DirectionalLight("#b9c6c2", 0.22);
  fill.position.set(0.5, 1.5, 6);
  scene.add(moon, fill, new THREE.HemisphereLight("#33504a", "#070b08", 0.4));
  const lamp = new THREE.PointLight("#ffd3a1", LAMP_POWER, 18, 1.2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.004;
  lamp.shadow.camera.near = 0.08;
  scene.add(lamp);

  const shared = {
    uTime: { value: 0 },
    uLamp: { value: new THREE.Vector3() },
    uLampColor: { value: LAMP },
    uLampPower: { value: 1 },
    uMoonColor: { value: new THREE.Vector3(0.5, 0.72, 0.74) },
    uGirl: { value: new THREE.Vector2(0, 0) },
    uStone: { value: new THREE.Vector3(STONE_AT.x, STONE_AT.z, 0.62) },
    uFogColor: { value: FOG },
    uFogDensity: { value: 0.062 },
  };

  scene.add(buildGround(), buildTrees());
  const grass = buildGrass(110000, shared);
  scene.add(grass);
  const stone = buildStone();
  scene.add(stone.mesh, stone.decal);
  const mist = buildMist(shared);
  scene.add(mist.group);
  const girl = buildGirl();
  scene.add(girl.root, girl.lantern);

  // 灯周围的一团光晕（雾里的灯总是带着一圈光）
  const haloTex = canvasTexture(
    128,
    (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,215,150,1)");
      g.addColorStop(0.25, "rgba(255,180,90,0.35)");
      g.addColorStop(1, "rgba(255,160,70,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    },
    true,
  );
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, fog: false }));
  halo.scale.setScalar(2.1);
  halo.renderOrder = 3;
  scene.add(halo);

  // 绕着灯打转的光点（飞虫、尘埃）
  const MOTES = 90;
  const moteSeed = Array.from({ length: MOTES }, (_, i) => ({ a: hash2(i, 1) * 6.283, r: 0.25 + hash2(i, 2) * 2.4, y: (hash2(i, 3) - 0.5) * 1.6, v: 0.15 + hash2(i, 4) * 0.5, tilt: hash2(i, 5) * 0.8 }));
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ map: haloTex, color: new THREE.Color(3, 2.2, 1), size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  motes.frustumCulled = false;
  scene.add(motes);

  // 后期：场景先画到一张带深度的图上 → 辉光 → 景深 → 色调映射 → 调色、颗粒、黑边
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(4, 4), samples: 4 });
  const composer = new EffectComposer(renderer);
  composer.addPass(new TexturePass(target.texture));
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.42, 0.8, 1.0);
  composer.addPass(bloom);
  const dof = new ShaderPass(DOF_SHADER);
  dof.uniforms.tDepth.value = target.depthTexture;
  composer.addPass(dof);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GRADE_SHADER);
  composer.addPass(grade);

  let size = { w: 0, h: 0, ratio: 0 };
  let ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  let slow = 0;
  let last = 0;

  const tmp = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  const toScreen = (v: THREE.Vector3, vw: number, vh: number) => {
    tmp.copy(v).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * vw, y: (-tmp.y * 0.5 + 0.5) * vh };
  };

  function draw(vw: number, vh: number, f: DrawInput): Anchors {
    // 画面卡的话自动降一档分辨率
    const dt = f.t - last;
    last = f.t;
    slow = dt > 0.045 && dt < 0.5 ? slow + 1 : Math.max(0, slow - 1); // 低于约 22 帧才算卡；切到后台再回来的那一下不算
    if (slow > 50 && ratio > 0.75) {
      ratio = Math.max(0.75, ratio - 0.25);
      slow = 0;
    }
    if (size.w !== vw || size.h !== vh || size.ratio !== ratio) {
      size = { w: vw, h: vh, ratio };
      renderer.setPixelRatio(ratio);
      renderer.setSize(vw, vh, false);
      composer.setPixelRatio(ratio);
      composer.setSize(vw, vh);
      target.setSize(Math.round(vw * ratio), Math.round(vh * ratio));
      camera.aspect = vw / vh;
      dof.uniforms.uAspect.value = vw / vh;
    }
    const t = f.t;
    const [px, py, pz, lx, ly, lz, fov, focus] = f.shot;
    // 一点点手持的晃动
    camera.position.set(px + Math.sin(t * 0.43) * 0.035, py + Math.sin(t * 0.31 + 1) * 0.022, pz);
    camera.fov = fov;
    camera.lookAt(lx + Math.sin(t * 0.27) * 0.012, ly, lz);
    camera.updateProjectionMatrix();

    // 人：呼吸、头发和提灯轻轻晃；侧身；右手伸出去托书
    const g = girl;
    g.pose(t, f.turn, f.hold);
    g.root.updateMatrixWorld(true);
    g.left.hand.getWorldPosition(handPos);
    const swing = Math.sin(t * 1.25) * 0.1 + Math.sin(t * 0.53 + 1) * 0.05;
    g.lantern.position.set(handPos.x + Math.sin(swing) * 0.25, handPos.y - Math.cos(swing) * 0.25, handPos.z + 0.01);
    g.lantern.rotation.z = swing;

    // 灯：火苗在跳
    const flick = 0.92 + 0.05 * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 13.1 + 1.7);
    lamp.position.copy(g.lantern.position);
    lamp.intensity = LAMP_POWER * flick;
    halo.position.copy(g.lantern.position);
    halo.material.opacity = 0.3 * flick;
    shared.uTime.value = t;
    shared.uLamp.value.copy(g.lantern.position);
    shared.uLampPower.value = flick;
    grade.uniforms.uTime.value = t;

    const mp = moteGeo.attributes.position as THREE.BufferAttribute;
    moteSeed.forEach((m, i) => {
      const a = m.a + t * m.v;
      mp.setXYZ(i, lamp.position.x + Math.cos(a) * m.r, lamp.position.y + m.y * 0.6 + Math.sin(a * 1.7 + m.tilt) * 0.18, lamp.position.z + Math.sin(a) * m.r * 0.8);
    });
    mp.needsUpdate = true;
    for (const c of mist.cards) {
      c.mesh.position.x = c.x0 + (((t * c.v + 40) % 80) - 40) * 0.25;
      c.mesh.quaternion.copy(camera.quaternion);
    }

    dof.uniforms.uFocus.value = focus;
    dof.uniforms.uRange.value = focus * 0.22;
    dof.uniforms.uMaxBlur.value = ratio < 1 ? 0 : 0.011;

    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    composer.render();

    // 文字标签用的几个屏幕位置
    const side = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(0.74); // 镜头的“右”方向
    const stoneTop = toScreen(new THREE.Vector3(STONE_AT.x, 0.7, STONE_AT.z), vw, vh);
    const stoneL = toScreen(new THREE.Vector3(STONE_AT.x, 0, STONE_AT.z).sub(side), vw, vh);
    const stoneR = toScreen(new THREE.Vector3(STONE_AT.x, 0, STONE_AT.z).add(side), vw, vh);
    g.right.hand.getWorldPosition(handPos);
    // 书上“写在这里”那一格在屏幕上的范围
    const fc = g.book.fieldCorners().map((c) => toScreen(c, vw, vh));
    const fx = fc.map((c) => c.x);
    const fy = fc.map((c) => c.y);
    return {
      field: { x: Math.min(...fx), y: Math.min(...fy), w: Math.max(...fx) - Math.min(...fx), h: Math.max(...fy) - Math.min(...fy) },
      lantern: toScreen(g.lantern.position, vw, vh),
      stone: { x: stoneTop.x, y: stoneTop.y, w: stoneR.x - stoneL.x, h: Math.max(stoneL.y, stoneR.y) - stoneTop.y },
      hand: toScreen(handPos, vw, vh),
    };
  }

  function dispose() {
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) {
        o.geometry?.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    target.dispose();
    composer.dispose();
    renderer.dispose();
  }

  return { kind: "3d", shots: SHOTS, draw, dispose };
}
