// “平原”3D 版里的人物和她手里的书。都是用几何体拼出来、程序画贴图的，没有外部模型。
// 人物是二次元画法：卡通着色（明暗分成几档）+ 一圈描边 + 画上去的脸。
import * as THREE from "three";

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, color = true) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 描边：把模型沿法线撑大一点点、只画背面，就是一圈深色的轮廓线
const OUTLINE = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  vertexShader: `void main() { vec3 n = length(normal) > 0.0001 ? normalize(normal) : vec3(0.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position + n * 0.0045, 1.0); }`,
  fragmentShader: `void main() { gl_FragColor = vec4(0.03, 0.035, 0.045, 1.0); }`,
});

const DOWN = new THREE.Vector3(0, -1, 0);
/** 两节手臂够到一个点：给出肩和肘该怎么转（肘朝 pole 的方向弯）。 */
function reach(shoulder: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3) {
  const d = target.clone().sub(shoulder);
  const dist = Math.min(Math.max(d.length(), 0.06), l1 + l2 - 0.002);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = shoulder.clone().addScaledVector(dir, a).addScaledVector(perp, h);
  const q1 = new THREE.Quaternion().setFromUnitVectors(DOWN, elbow.clone().sub(shoulder).normalize());
  const q2 = new THREE.Quaternion().setFromUnitVectors(DOWN, shoulder.clone().addScaledVector(dir, dist).sub(elbow).normalize());
  return { shoulder: q1, elbow: q1.clone().invert().multiply(q2) };
}

// ---------------------------------------------------------------- 人物

function faceTexture() {
  // 一张透明的“脸贴纸”：眼睛、眉毛、鼻子、嘴、腮红，贴在头的正面
  return canvasTexture(512, 512, (c) => {
    c.lineCap = "round";
    for (const side of [-1, 1]) {
      const ex = 256 + side * 70;
      const ey = 262;
      c.save();
      c.beginPath();
      c.ellipse(ex, ey, 31, 40, 0, 0, 6.283);
      c.fillStyle = "#fdfcf8";
      c.fill();
      c.clip();
      // 上眼皮投下来的影子
      c.fillStyle = "rgba(120,130,160,0.28)";
      c.fillRect(ex - 40, ey - 44, 80, 18);
      const iris = c.createLinearGradient(0, ey - 36, 0, ey + 40);
      iris.addColorStop(0, "#1a2f63");
      iris.addColorStop(0.5, "#3c78c4");
      iris.addColorStop(1, "#b4e0f6");
      c.fillStyle = iris;
      c.beginPath();
      c.ellipse(ex, ey + 4, 26, 36, 0, 0, 6.283);
      c.fill();
      c.strokeStyle = "rgba(16,28,60,0.75)";
      c.lineWidth = 3;
      c.stroke();
      c.fillStyle = "#0d1a36";
      c.beginPath();
      c.ellipse(ex, ey + 2, 11, 17, 0, 0, 6.283);
      c.fill();
      // 眼底的一弯亮色 + 映着灯的高光
      c.strokeStyle = "rgba(210,240,255,0.7)";
      c.lineWidth = 5;
      c.beginPath();
      c.arc(ex, ey + 4, 22, 0.25 * Math.PI, 0.75 * Math.PI);
      c.stroke();
      c.fillStyle = "rgba(255,240,205,0.97)";
      c.beginPath();
      c.ellipse(ex + 11, ey - 15, 9, 11, -0.3, 0, 6.283);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath();
      c.arc(ex - 11, ey + 16, 4, 0, 6.283);
      c.fill();
      c.restore();
      // 上眼线（外眼角略垂）、睫毛、双眼皮、眉毛
      c.strokeStyle = "#231a20";
      c.lineWidth = 8.5;
      c.beginPath();
      c.moveTo(ex - side * 33, ey - 22);
      c.quadraticCurveTo(ex - side * 2, ey - 50, ex + side * 38, ey - 8);
      c.stroke();
      c.lineWidth = 4.5;
      c.beginPath();
      c.moveTo(ex + side * 35, ey - 11);
      c.lineTo(ex + side * 47, ey - 22);
      c.moveTo(ex + side * 30, ey - 22);
      c.lineTo(ex + side * 39, ey - 36);
      c.stroke();
      c.strokeStyle = "rgba(150,110,100,0.5)";
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(ex - side * 26, ey - 46);
      c.quadraticCurveTo(ex, ey - 62, ex + side * 28, ey - 36);
      c.stroke();
      c.strokeStyle = "rgba(60,36,30,0.5)";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(ex - side * 20, ey + 40);
      c.quadraticCurveTo(ex + side * 4, ey + 46, ex + side * 24, ey + 34);
      c.stroke();
      c.strokeStyle = "#b9b4c0";
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(ex - side * 28, ey - 72);
      c.quadraticCurveTo(ex + side * 4, ey - 78, ex + side * 34, ey - 64);
      c.stroke();
      const blush = c.createRadialGradient(256 + side * 108, 330, 0, 256 + side * 108, 330, 34);
      blush.addColorStop(0, "rgba(240,140,132,0.36)");
      blush.addColorStop(1, "rgba(240,140,132,0)");
      c.fillStyle = blush;
      c.fillRect(256 + side * 108 - 36, 296, 72, 68);
    }
    c.strokeStyle = "rgba(190,130,116,0.8)";
    c.lineWidth = 3.5;
    c.beginPath();
    c.moveTo(256, 334);
    c.lineTo(252, 342);
    c.stroke();
    c.strokeStyle = "rgba(160,96,88,0.95)";
    c.lineWidth = 4.5;
    c.beginPath();
    c.moveTo(244, 386);
    c.quadraticCurveTo(256, 394, 268, 386);
    c.stroke();
  });
}

export function buildGirl() {
  const gradient = new THREE.DataTexture(new Uint8Array([96, 170, 255]), 3, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  const toon = (color: string, side: THREE.Side = THREE.FrontSide) => {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: gradient, side });
    // 人离灯很近：受光先减半，再把过亮的部分逐渐压平（最高约 0.95），不然白头发和皮肤会被照成一片死白
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `outgoingLight *= 0.5;
        float peak = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
        if (peak > 0.55) outgoingLight *= (0.55 + 0.4 * (1.0 - exp(-(peak - 0.55) / 0.4))) / peak;
        #include <opaque_fragment>`,
      );
    };
    return m;
  };
  const skin = toon("#f6d3c0");
  const hair = toon("#eef2fb"); // 白发，略带一点冷色，和暖色的皮肤分开
  const hair2 = toon("#eef2fb", THREE.DoubleSide);
  const coat = toon("#222a3e");
  const coat2 = toon("#222a3e", THREE.DoubleSide);
  const white = toon("#f2f0ea");
  const red = toon("#b0353f");
  const dark = toon("#14171f");
  const leather = toon("#6f5539");
  const gold = new THREE.MeshStandardMaterial({ color: "#d8b060", roughness: 0.35, metalness: 0.8 });

  const root = new THREE.Group();
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, outline = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    if (outline) m.add(new THREE.Mesh(geo, OUTLINE));
    parent.add(m);
    return m;
  };

  // ---- 腿、袜、靴
  for (const side of [-1, 1]) {
    add(root, new THREE.CylinderGeometry(0.047, 0.041, 0.2, 14), skin, side * 0.062, 0.62);
    add(root, new THREE.CylinderGeometry(0.046, 0.04, 0.4, 14), dark, side * 0.062, 0.34);
    add(root, new THREE.CylinderGeometry(0.048, 0.048, 0.012, 14), white, side * 0.062, 0.545, 0, false);
    add(root, new THREE.CapsuleGeometry(0.052, 0.09, 4, 10), dark, side * 0.062, 0.075, 0.035).rotation.x = Math.PI / 2;
    add(root, new THREE.CylinderGeometry(0.054, 0.05, 0.11, 12), dark, side * 0.062, 0.13);
  }

  // ---- 裙子：带褶，下摆一圈白边
  const pleat = (geo: THREE.BufferGeometry, top: number, height: number) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const k = 1 + 0.045 * ((top - p.getY(i)) / height) * Math.sin(Math.atan2(z, x) * 15);
      p.setXYZ(i, x * k, p.getY(i), z * k);
    }
    geo.computeVertexNormals();
    return geo;
  };
  add(root, pleat(new THREE.CylinderGeometry(0.118, 0.3, 0.38, 60, 8, true), 0.19, 0.38), coat2, 0, 0.81);
  add(root, pleat(new THREE.CylinderGeometry(0.2905, 0.302, 0.024, 60, 1, true), 0.012 + 0.356, 0.38), toon("#f2f0ea", THREE.DoubleSide), 0, 0.632, 0, false);

  // ---- 上身：有腰线的外套、肩、腰带、扣子、水手领、蝴蝶结
  const torso = new THREE.LatheGeometry(
    [
      [0.001, 0.955], [0.122, 0.96], [0.118, 1.0], [0.103, 1.07], [0.108, 1.15], [0.116, 1.215], [0.085, 1.258], [0.04, 1.28], [0.001, 1.282],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    28,
  );
  add(root, torso, coat);
  add(root, new THREE.TorusGeometry(0.119, 0.011, 8, 32), leather, 0, 0.988, 0, false).rotation.x = Math.PI / 2;
  add(root, new THREE.BoxGeometry(0.03, 0.026, 0.012), gold, 0, 0.988, 0.126, false);
  for (const y of [1.06, 1.105]) add(root, new THREE.SphereGeometry(0.008, 10, 8), gold, 0, y, 0.108, false);
  add(root, new THREE.CylinderGeometry(0.046, 0.168, 0.062, 28), white, 0, 1.246);
  for (const side of [-1, 1]) add(root, new THREE.BoxGeometry(0.064, 0.036, 0.022), red, side * 0.036, 1.176, 0.118).rotation.z = side * 0.4;
  add(root, new THREE.SphereGeometry(0.014, 10, 8), red, 0, 1.178, 0.124);
  for (const side of [-1, 1]) add(root, new THREE.BoxGeometry(0.02, 0.085, 0.018), red, side * 0.016, 1.13, 0.117).rotation.z = side * -0.18;
  add(root, new THREE.BoxGeometry(0.105, 0.09, 0.05), leather, -0.175, 0.91, 0.07);
  add(root, new THREE.BoxGeometry(0.109, 0.03, 0.054), toon("#5a4430"), -0.175, 0.945, 0.07, false);
  add(root, new THREE.CylinderGeometry(0.034, 0.038, 0.07, 14), skin, 0, 1.285);

  // ---- 头：下巴收尖的脸、脸贴纸
  const head = new THREE.Group();
  head.position.set(0, 1.41, 0);
  root.add(head);
  const jaw = (geo: THREE.BufferGeometry, r: number) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y >= 0) continue;
      const k = Math.pow(-y / r, 1.7);
      p.setXYZ(i, p.getX(i) * (1 - 0.3 * k), y * 1.05, p.getZ(i) * (1 - 0.16 * k));
    }
    geo.computeVertexNormals();
    const n = geo.attributes.normal;
    for (let i = 0; i < n.count; i++) if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < 1e-6) n.setXYZ(i, 0, Math.sign(p.getY(i)) || 1, 0);
    return geo;
  };
  add(head, jaw(new THREE.SphereGeometry(0.155, 40, 28), 0.155), skin);
  const face = new THREE.Mesh(
    jaw(new THREE.SphereGeometry(0.1562, 40, 20, Math.PI * 0.05, Math.PI * 0.9, Math.PI * 0.25, Math.PI * 0.55), 0.1562),
    new THREE.MeshBasicMaterial({ map: faceTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  head.add(face);
  for (const side of [-1, 1]) add(head, new THREE.SphereGeometry(0.022, 10, 8), skin, side * 0.152, -0.015, 0, false).scale.set(0.5, 1, 0.8);

  // ---- 头发（白）：后脑的壳、垂到腰的长发（发梢剪成一绺一绺）、刘海、鬓发、呆毛、发带
  add(head, new THREE.SphereGeometry(0.17, 36, 22, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, 0, 0.012, -0.016);
  const longHair = new THREE.Group();
  longHair.position.set(0, 0.03, -0.07);
  head.add(longHair);
  const fall = new THREE.CylinderGeometry(0.17, 0.155, 0.84, 30, 6, true);
  {
    const p = fall.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > -0.41) continue; // 只动最下面一圈
      const a = Math.atan2(p.getZ(i), p.getX(i));
      p.setY(i, p.getY(i) - 0.05 * Math.abs(Math.sin(a * 7.5)) - 0.03 * Math.max(0, -Math.sin(a)));
    }
    fall.computeVertexNormals();
  }
  add(longHair, fall, hair2, 0, -0.42, 0).scale.set(1, 1, 0.52);
  const fringe = new THREE.SphereGeometry(0.1655, 18, 6, Math.PI * 0.06, Math.PI * 0.88, Math.PI * 0.15, Math.PI * 0.25);
  {
    const p = fringe.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const row = Math.floor(i / 19);
      const col = i % 19;
      if (row === 6) p.setY(i, p.getY(i) - (col % 3 === 1 ? 0.046 : col % 3 === 2 ? 0.02 : 0.002) - Math.abs(col - 9) * 0.0045);
    }
    fringe.computeVertexNormals();
  }
  add(head, fringe, hair2, 0, 0.014, 0.004).scale.set(1, 1.04, 0.99);
  const locks: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const lock = add(head, new THREE.CylinderGeometry(0.027, 0.006, 0.5, 10), hair, side * 0.158, -0.22, 0.02);
    lock.scale.z = 0.7;
    lock.rotation.z = side * 0.03;
    locks.push(lock);
    const wisp = add(head, new THREE.CylinderGeometry(0.016, 0.004, 0.26, 8), hair, side * 0.136, -0.1, 0.07);
    wisp.rotation.z = side * 0.1;
    locks.push(wisp);
  }
  add(head, new THREE.ConeGeometry(0.011, 0.12, 6), hair, 0.02, 0.205, 0).rotation.z = -0.55;
  const band = add(head, new THREE.TorusGeometry(0.172, 0.008, 8, 30, Math.PI), dark, 0, 0.0, 0.02, false);
  band.rotation.x = -0.12;
  for (const side of [-1, 1]) add(head, new THREE.BoxGeometry(0.04, 0.03, 0.012), red, -0.165 + side * 0.016, 0.07, 0.03, false).rotation.set(0, Math.PI / 2, side * 0.5);

  // ---- 手臂：肩 → 肘 → 手
  const arm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.135, 1.222, 0);
    root.add(shoulder);
    add(shoulder, new THREE.SphereGeometry(0.052, 14, 10), coat, 0, 0, 0);
    add(shoulder, new THREE.CapsuleGeometry(0.04, 0.2, 4, 12), coat, 0, -0.12, 0);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.24, 0);
    shoulder.add(elbow);
    add(elbow, new THREE.CapsuleGeometry(0.036, 0.17, 4, 12), coat, 0, -0.105, 0);
    add(elbow, new THREE.CylinderGeometry(0.041, 0.041, 0.04, 14), white, 0, -0.2, 0);
    const hand = add(elbow, new THREE.SphereGeometry(0.04, 16, 12), skin, 0, -0.25, 0);
    hand.scale.set(1, 1.15, 0.82);
    return { shoulder, elbow, hand, at: shoulder.position.clone() };
  };
  const left = arm(1); // 她的左手，在画面右边：举灯
  const right = arm(-1); // 她的右手，在画面左边：托书

  // ---- 提灯：铁架、发光的玻璃罩
  const lantern = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: "#1b1713", roughness: 0.7, metalness: 0.6 });
  lantern.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.105, 0.075), new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 2.5, 1.0) }))); // 很亮：辉光会让它发出光晕
  const capTop = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.05, 4), iron);
  capTop.position.y = 0.078;
  capTop.rotation.y = Math.PI / 4;
  const capBottom = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.016, 0.095), iron);
  capBottom.position.y = -0.06;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 6, 16), iron);
  ring.position.y = 0.12;
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 5), iron);
  chain.position.y = 0.19;
  lantern.add(capTop, capBottom, ring, chain);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.11, 0.008), iron);
    bar.position.set(x * 0.04, 0, z * 0.04);
    lantern.add(bar);
  }

  const book = buildBook();
  root.add(book.group);

  // 每帧调用：摆姿势。turn = 侧身程度，hold = 把书托起来翻开的程度
  const pole = new THREE.Vector3();
  const poleHeld = new THREE.Vector3(-0.6, -1, -0.2);
  const bookRest = { pos: new THREE.Vector3(-0.19, 0.79, 0.05), rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, Math.PI / 2, Math.PI)) };
  const bookHeld = { pos: new THREE.Vector3(-0.29, 1.06, 0.42), rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.86, 0.42, 0.03, "YXZ")) };
  const lampHand = new THREE.Vector3();
  const grip = new THREE.Vector3();
  function pose(t: number, turn: number, hold: number) {
    root.rotation.y = -turn * 1.15;
    root.scale.y = 1 + Math.sin(t * 1.6) * 0.004;
    head.rotation.set(Math.sin(t * 0.5) * 0.03 + 0.1 * hold, Math.sin(t * 0.33) * 0.05 - turn * 0.2 - 0.16 * hold, 0);
    longHair.rotation.x = 0.05 + Math.sin(t * 0.9) * 0.03;
    locks.forEach((l, i) => (l.rotation.x = Math.sin(t * 1.1 + i) * 0.04));
    // 左手举灯：手的位置轻轻浮动
    const hh = hold * hold * (3 - 2 * hold);
    lampHand.set(0.27 - 0.1 * hh + Math.sin(t * 0.7) * 0.008, 1.6 - 0.1 * hh + Math.sin(t * 0.8) * 0.01, 0.2 + 0.3 * hh);
    const up = reach(left.at, lampHand, 0.24, 0.25, new THREE.Vector3(1, -0.4, -0.3));
    left.shoulder.quaternion.copy(up.shoulder);
    left.elbow.quaternion.copy(up.elbow);
    // 书：从身侧合着提着，到胸前翻开
    const h = hold * hold * (3 - 2 * hold);
    book.group.position.lerpVectors(bookRest.pos, bookHeld.pos, h);
    book.group.position.y += Math.sin(t * 1.3) * 0.004 * h;
    book.group.quaternion.slerpQuaternions(bookRest.rot, bookHeld.rot, h);
    book.open(h);
    book.caret.visible = h > 0.9 && t % 1.1 < 0.6;
    // 右手始终拿着书：垂着时握在书脊上，翻开时托在书脊下面
    book.group.updateMatrix();
    grip.set(0, -0.03, 0.05).applyMatrix4(book.group.matrix);
    pole.set(-1, 0, -0.3).lerp(poleHeld, h);
    const under = reach(right.at, grip, 0.24, 0.25, pole);
    right.shoulder.quaternion.copy(under.shoulder);
    right.elbow.quaternion.copy(under.elbow);
  }

  return { root, lantern, left, right, book, pose };
}

// ---------------------------------------------------------------- 书

const PAGE_W = 0.172;
const PAGE_H = 0.238;
const INK = "#3a2716";
const KAI = '"STKaiti", "KaiTi", "Kaiti SC", "楷体", "Noto Serif SC", serif';
/** 右页上“写在这里”的那一格，在书页上的位置（0～1，左上角为原点）。点击区域和贴图都用它。 */
const FIELD = { x0: 0.11, x1: 0.89, y0: 0.4, y1: 0.63 };

/** 一页旧纸：泛黄、边缘发暗、水渍、霉点、纸纤维。inner = 靠书脊的是哪一边。 */
function parchment(c: CanvasRenderingContext2D, w: number, h: number, seed: number, inner: "left" | "right") {
  const r = rng(seed);
  const base = c.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, "#ecdcb4");
  base.addColorStop(0.55, "#e3cf9f");
  base.addColorStop(1, "#d4bb86");
  c.fillStyle = base;
  c.fillRect(0, 0, w, h);
  // 大块的深浅不匀
  for (let i = 0; i < 26; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 60 + r() * 220;
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() > 0.4;
    g.addColorStop(0, dark ? `rgba(128,92,44,${0.05 + r() * 0.08})` : `rgba(255,246,214,${0.06 + r() * 0.08})`);
    g.addColorStop(1, "rgba(128,92,44,0)");
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // 一圈水渍
  for (let i = 0; i < 2; i++) {
    const x = w * (0.2 + r() * 0.6);
    const y = h * (0.15 + r() * 0.7);
    const rad = 70 + r() * 90;
    c.strokeStyle = `rgba(120,84,40,${0.1 + r() * 0.07})`;
    c.lineWidth = 3 + r() * 3;
    c.beginPath();
    for (let a = 0; a <= 6.4; a += 0.2) c.lineTo(x + Math.cos(a) * rad * (1 + 0.12 * Math.sin(a * 3 + i)), y + Math.sin(a) * rad * 0.8 * (1 + 0.1 * Math.cos(a * 2)));
    c.stroke();
  }
  // 纸纤维、霉点
  for (let i = 0; i < 1500; i++) {
    const x = r() * w;
    const y = r() * h;
    c.strokeStyle = r() > 0.5 ? `rgba(110,80,40,${0.04 + r() * 0.07})` : `rgba(255,250,228,${0.05 + r() * 0.08})`;
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (r() - 0.5) * 16, y + (r() - 0.5) * 5);
    c.stroke();
  }
  for (let i = 0; i < 170; i++) {
    c.fillStyle = `rgba(112,72,30,${0.1 + r() * 0.26})`;
    c.beginPath();
    c.arc(r() * w, r() * h, 0.6 + r() * r() * 3.4, 0, 6.283);
    c.fill();
  }
  // 四边发暗（摸旧了），靠书脊的一边压一道阴影
  const edge = (x0: number, y0: number, x1: number, y1: number, a: number) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(96,62,24,${a})`);
    g.addColorStop(1, "rgba(96,62,24,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  };
  edge(0, 0, 0, h * 0.09, 0.32);
  edge(0, h, 0, h * 0.91, 0.36);
  edge(inner === "left" ? w : 0, 0, inner === "left" ? w * 0.9 : w * 0.1, 0, 0.34);
  edge(inner === "left" ? 0 : w, 0, inner === "left" ? w * 0.2 : w * 0.8, 0, 0.62);
}

/** 墨迹：写两遍，第二遍略偏一点、淡一点，像蘸水笔写的。 */
function ink(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, alpha = 0.9) {
  c.font = `${size}px ${KAI}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = INK;
  c.globalAlpha = alpha * 0.5;
  c.fillText(text, x + 1.2, y + 1);
  c.globalAlpha = alpha;
  c.fillText(text, x, y);
  c.globalAlpha = 1;
}

function buildBook() {
  const W = 768;
  const H = Math.round((W * PAGE_H) / PAGE_W);
  const leftTex = canvasTexture(W, H, (c, w, h) => {
    parchment(c, w, h, 41, "right");
    // 一个小人，正往墙上垒一块砖
    c.save();
    c.translate(w * 0.2, h * 0.14);
    c.scale(w / 330, w / 330);
    c.strokeStyle = INK;
    c.lineWidth = 3.6;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.globalAlpha = 0.88;
    const stroke = (d: string) => c.stroke(new Path2D(d));
    c.beginPath();
    c.arc(64, 52, 13, 0, 6.283);
    c.stroke();
    stroke("M64 65 L64 112 M64 112 L48 148 M64 112 L80 148 M64 80 L42 96 M64 80 L96 70");
    stroke("M96 60 h26 v16 h-26 z");
    stroke("M108 150 h30 v-16 h-30 z M138 150 h30 v-16 h-30 z M123 134 h30 v-16 h-30 z M153 134 h15 v-16 h-15 z M138 118 h30 v-16 h-30 z");
    stroke("M30 150 H178");
    stroke("M59 50 h1 M68 50 h1 M60 57 q4 3 8 0");
    c.restore();
    ink(c, "筑 城 者", w * 0.5, h * 0.62, w * 0.135);
    ink(c, "一块一块来。", w * 0.5, h * 0.76, w * 0.052, 0.62);
  });
  const rightTex = canvasTexture(W, H, (c, w, h) => {
    parchment(c, w, h, 59, "left");
    ink(c, "你想学会什么？", w * 0.5, h * 0.27, w * 0.094);
    // “写在这里”的那一格：颜色浅一点，下面一道线
    c.fillStyle = "rgba(255,250,232,0.4)";
    c.fillRect(w * FIELD.x0, h * FIELD.y0, w * (FIELD.x1 - FIELD.x0), h * (FIELD.y1 - FIELD.y0));
    c.strokeStyle = "rgba(58,39,22,0.7)";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(w * FIELD.x0, h * FIELD.y1);
    c.lineTo(w * FIELD.x1, h * FIELD.y1);
    c.stroke();
    c.textAlign = "left";
    c.font = `${w * 0.06}px ${KAI}`;
    c.fillStyle = "rgba(58,39,22,0.6)";
    c.textBaseline = "middle";
    c.fillText("写在这里……", w * (FIELD.x0 + 0.03), h * (FIELD.y0 + 0.05));
    ink(c, "她不会替你回答，", w * 0.5, h * 0.75, w * 0.05, 0.62);
    ink(c, "只会接着问。", w * 0.5, h * 0.805, w * 0.05, 0.62);
  });
  const fiber = canvasTexture(
    256,
    256,
    (c, w, h) => {
      const r = rng(3);
      c.fillStyle = "#808080";
      c.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const v = Math.round(90 + r() * 90);
        c.strokeStyle = `rgb(${v},${v},${v})`;
        c.lineWidth = 1;
        const x = r() * w;
        const y = r() * h;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + (r() - 0.5) * 14, y + (r() - 0.5) * 4);
        c.stroke();
      }
    },
    false,
  );
  // 书口：一层一层纸叠出来的细线
  const edges = canvasTexture(64, 64, (c, w, h) => {
    c.fillStyle = "#d9c493";
    c.fillRect(0, 0, w, h);
    const r = rng(9);
    for (let y = 0; y < h; y += 2) {
      c.fillStyle = `rgba(110,78,36,${0.18 + r() * 0.3})`;
      c.fillRect(0, y, w, 1);
    }
  });
  const edgeMat = new THREE.MeshStandardMaterial({ map: edges, roughness: 1 });
  const cover = new THREE.MeshStandardMaterial({ color: "#3a2314", roughness: 0.78, bumpMap: fiber, bumpScale: 1.4 });
  const gilt = new THREE.MeshStandardMaterial({ color: "#c9a25a", roughness: 0.4, metalness: 0.7 });

  const group = new THREE.Group();
  const half = (side: 1 | -1, tex: THREE.Texture) => {
    const g = new THREE.Group();
    // 一叠书页：顶面微微鼓起（翻开的书靠书脊处低、中间高、书口处又落下去）
    const block = new THREE.BoxGeometry(PAGE_W, 0.016, PAGE_H, 16, 1, 1);
    const p = block.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < 0) continue;
      const u = p.getX(i) / PAGE_W + 0.5; // 0 = 这一块的左边
      const fromSpine = Math.min(1, Math.max(0, side === 1 ? u : 1 - u));
      p.setY(i, p.getY(i) + 0.011 * Math.sin(Math.PI * Math.pow(fromSpine, 0.7)) - 0.004 * (1 - fromSpine));
    }
    block.computeVertexNormals();
    const page = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, bumpMap: fiber, bumpScale: 0.6 });
    const mesh = new THREE.Mesh(block, [edgeMat, edgeMat, page, edgeMat, edgeMat, edgeMat]);
    mesh.position.set((side * PAGE_W) / 2, 0.008, 0);
    mesh.castShadow = mesh.receiveShadow = true;
    const board = new THREE.Mesh(new THREE.BoxGeometry(PAGE_W + 0.008, 0.006, PAGE_H + 0.014), cover);
    board.position.set(side * (PAGE_W / 2 + 0.003), -0.003, 0);
    board.castShadow = true;
    // 封面四角包的铜角
    for (const z of [-1, 1]) {
      const corner = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.0075, 0.024), gilt);
      corner.position.set(side * (PAGE_W + 0.007 - 0.012), -0.003, z * (PAGE_H / 2 + 0.007 - 0.012));
      g.add(corner);
    }
    g.add(mesh, board);
    group.add(g);
    return g;
  };
  const leftHalf = half(-1, leftTex);
  const rightHalf = half(1, rightTex);
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, PAGE_H + 0.014, 10), cover);
  spine.rotation.x = Math.PI / 2;
  spine.position.y = -0.004;
  group.add(spine);
  // 一条书签带
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.001, 0.07), new THREE.MeshStandardMaterial({ color: "#8e2c34", roughness: 0.8 }));
  ribbon.position.set(0.004, 0.012, PAGE_H / 2 + 0.03);
  ribbon.rotation.x = 0.5;
  group.add(ribbon);
  // 压在书页上的拇指（手掌托在书脊下面，由手臂带着）
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.03, 4, 10), new THREE.MeshStandardMaterial({ color: "#d9a98f", roughness: 0.8 }));
  thumb.position.set(-0.004, 0.022, PAGE_H / 2 - 0.012);
  thumb.rotation.set(Math.PI / 2 - 0.25, 0, 0.3);
  thumb.castShadow = true;
  group.add(thumb);
  // 输入格里闪动的光标
  const caret = new THREE.Mesh(new THREE.PlaneGeometry(0.0016, 0.017), new THREE.MeshBasicMaterial({ color: "#2a1c10" }));
  caret.rotation.x = -Math.PI / 2;
  caret.position.set(PAGE_W * (FIELD.x0 + 0.42), 0.0235, PAGE_H * (FIELD.y0 + 0.05 - 0.5));
  rightHalf.add(caret);

  /** 翻开的程度：0 = 合着，1 = 摊开（两页略呈 V 形）。 */
  function open(k: number) {
    const a = THREE.MathUtils.lerp(Math.PI / 2 - 0.02, 0.15, k);
    rightHalf.rotation.z = a;
    leftHalf.rotation.z = -a;
    thumb.visible = k > 0.6;
    ribbon.visible = k > 0.6;
  }
  open(0);

  /** “写在这里”那一格的四个角（世界坐标）：页面上盖一块透明按钮用。 */
  const corners = [
    [FIELD.x0, FIELD.y0], [FIELD.x1, FIELD.y0], [FIELD.x1, FIELD.y1], [FIELD.x0, FIELD.y1],
  ].map(([u, v]) => new THREE.Vector3(PAGE_W * u, 0.02, PAGE_H * (v - 0.5)));
  const fieldCorners = () => corners.map((c) => rightHalf.localToWorld(c.clone()));

  return { group, open, caret, fieldCorners };
}
