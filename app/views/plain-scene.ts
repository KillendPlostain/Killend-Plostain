// “平原”的画面：全部用 canvas 2D 现画，没有任何图片。
// 远景时把画布分辨率压得很低再放大，自然就是像素风；镜头拉近时分辨率逐级升高，像素“化开”成清晰的画面。
// 坐标用一套虚拟的“世界单位”（1600 × 900），镜头决定看世界的哪一块、放多大。
// 现在它是 3D 版（plain-scene3d.ts）带不动时的后备画法。
import type { PlainRenderer } from "./plain-types";

export const WORLD = { w: 1600, h: 900 };
export const GIRL = { x: 800, y: 668 }; // 脚底
export const STONE = { x: 572, y: 716, w: 196, h: 104 }; // 底边中点
const HAND_UP = [80, -262]; // 举灯那只手相对脚底的位置
export const HAND_BOOK = [-98, -176]; // 托书那只手（伸出去时）相对脚底的位置
export const CARVED = ["left a light on", "for whoever i was"]; // 石头上刻的字

export interface Camera {
  x: number;
  y: number;
  z: number;
}
export interface Frame {
  t: number; // 秒
  cam: Camera;
  q: number; // 画布分辨率 ÷ 屏幕分辨率（0.2 = 每个“像素”占屏幕 5px）
  turn: number; // 0 = 正面，1 = 侧过身（朝石头那边）
  hold: number; // 0 = 右手垂着，1 = 右手伸出去托着书
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** 固定种子的随机数：每次打开，草和石头的纹理都长在同一个地方。 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 提灯在世界里的位置（会轻轻晃）。 */
export function lanternAt(t: number) {
  const sway = Math.sin(t * 1.25) * 0.09 + Math.sin(t * 0.53 + 1) * 0.04;
  return { x: GIRL.x + HAND_UP[0] + Math.sin(sway) * 32, y: GIRL.y + HAND_UP[1] + Math.cos(sway) * 32, sway };
}

const flicker = (t: number) => 0.92 + 0.05 * Math.sin(t * 7.3) + 0.03 * Math.sin(t * 13.1 + 1.7);

type Ctx = CanvasRenderingContext2D;

export function createScene() {
  const rand = rng(20261116);

  // ---- 一次性生成的东西 ----
  const tufts = Array.from({ length: 620 }, () => {
    const depth = Math.pow(rand(), 0.7); // 0 = 远，1 = 近
    return { x: rand() * WORLD.w * 1.5 - WORLD.w * 0.25, y: lerp(566, 930, depth), h: lerp(5, 34, depth) * (0.6 + rand() * 0.8), lean: rand() * 2 - 1, phase: rand() * 6.28, blades: 2 + Math.floor(rand() * 3), tone: rand() };
  })
    // 石头正前方不长草，免得挡住刻的字
    .filter((tf) => !(Math.abs(tf.x - STONE.x) < STONE.w * 0.56 && tf.y > STONE.y - 8 && tf.y < STONE.y + 70))
    .sort((a, b) => a.y - b.y);

  const ridges = [0, 1, 2].map((i) => ({
    y: 470 + i * 36,
    amp: 46 - i * 12,
    k1: 0.0031 + i * 0.0013,
    k2: 0.011 + i * 0.004,
    p: rand() * 6,
    color: ["#0e1d1a", "#10231d", "#122920"][i],
  }));
  const trees = Array.from({ length: 46 }, () => ({ x: rand() * WORLD.w * 1.4 - WORLD.w * 0.2, h: 18 + rand() * 46, w: 9 + rand() * 14 }));

  const mists = Array.from({ length: 11 }, (_, i) => ({ x: rand() * WORLD.w, y: 500 + rand() * 330, rx: 260 + rand() * 360, ry: 34 + rand() * 60, v: (6 + rand() * 12) * (i % 2 ? 1 : -1), a: 0.05 + rand() * 0.06, front: i > 6 }));

  // 光的笔触：绕着提灯转，再加两个飘在天上的小漩涡（《星空》那种一圈一圈的笔触）
  const PALETTE = ["#fff3c4", "#ffe08a", "#ffc65c", "#f2a53c", "#cfe8c9", "#9ad0c2", "#6fb0b6"];
  const strokes = Array.from({ length: 150 }, (_, i) => {
    const hub = i < 96 ? 0 : i < 126 ? 1 : 2;
    const maxR = [250, 120, 86][hub];
    const r = (hub === 0 ? 26 : 14) + Math.pow(rand(), 0.8) * maxR;
    return { hub, r, a: rand() * 6.283, w: (0.5 + rand() * 0.5) * (hub === 0 ? 1 : 0.6), len: 0.18 + rand() * 0.5, width: 2.2 + rand() * 4.2, color: PALETTE[Math.floor(rand() * PALETTE.length)], wob: rand() * 6.28 };
  });
  const motes = Array.from({ length: 26 }, () => ({ a: rand() * 6.283, r: 30 + rand() * 210, v: 0.1 + rand() * 0.25, bob: rand() * 6.28 }));

  // 石头：轮廓、斑点、裂纹、苔
  const stonePts = [
    [-0.5, 0], [-0.47, -0.42], [-0.33, -0.78], [-0.1, -0.96], [0.14, -1], [0.34, -0.84], [0.47, -0.5], [0.5, -0.12], [0.44, 0],
  ].map(([x, y]) => [x * STONE.w, y * STONE.h]);
  const specks = Array.from({ length: 420 }, () => ({ x: (rand() - 0.5) * STONE.w, y: -rand() * STONE.h, r: 0.5 + rand() * 1.9, light: rand() > 0.45, a: 0.08 + rand() * 0.2 }));
  const cracks = [
    [[-0.36, -0.7], [-0.27, -0.52], [-0.3, -0.36], [-0.2, -0.2]],
    [[0.3, -0.8], [0.24, -0.62], [0.32, -0.46]],
    [[0.02, -0.22], [0.12, -0.14], [0.26, -0.16], [0.36, -0.06]],
  ].map((line) => line.map(([x, y]) => [x * STONE.w, y * STONE.h]));
  const moss = Array.from({ length: 30 }, () => ({ x: (rand() - 0.62) * STONE.w * 0.8, y: -STONE.h * (0.72 + rand() * 0.26), r: 4 + rand() * 9 }));
  const letterJitter = Array.from({ length: 48 }, () => ({ rot: (rand() - 0.5) * 0.16, dy: (rand() - 0.5) * 1.6, sx: 0.92 + rand() * 0.18 }));

  let sprite: HTMLCanvasElement | null = null;

  // ---- 背景：天、远山、树线 ----
  function drawBackdrop(c: Ctx, x0: number, x1: number, t: number) {
    const sky = c.createLinearGradient(0, 0, 0, 600);
    sky.addColorStop(0, "#050b0b");
    sky.addColorStop(0.55, "#0b1917");
    sky.addColorStop(1, "#16302a");
    c.fillStyle = sky;
    c.fillRect(x0, -400, x1 - x0, 1000);
    ridges.forEach((r, i) => {
      c.fillStyle = r.color;
      c.beginPath();
      c.moveTo(x0, 620);
      for (let x = x0; x <= x1 + 16; x += 16) c.lineTo(x, r.y - r.amp * (0.6 * Math.sin(x * r.k1 + r.p) + 0.4 * Math.sin(x * r.k2 + r.p * 2)));
      c.lineTo(x1, 620);
      c.fill();
      // 山和山之间的雾
      const band = c.createLinearGradient(0, r.y - 30, 0, r.y + 50);
      band.addColorStop(0, "rgba(150,185,170,0)");
      band.addColorStop(0.6, `rgba(150,185,170,${0.07 + i * 0.02})`);
      band.addColorStop(1, "rgba(150,185,170,0)");
      c.fillStyle = band;
      c.fillRect(x0, r.y - 30, x1 - x0, 80);
    });
    c.fillStyle = "#0b1a16";
    for (const tr of trees) {
      if (tr.x < x0 - 30 || tr.x > x1 + 30) continue;
      const sway = Math.sin(t * 0.6 + tr.x) * 1.2;
      c.beginPath();
      c.moveTo(tr.x - tr.w / 2, 572);
      c.lineTo(tr.x + sway, 572 - tr.h);
      c.lineTo(tr.x + tr.w / 2, 572);
      c.fill();
    }
  }

  function drawGround(c: Ctx, x0: number, x1: number) {
    const g = c.createLinearGradient(0, 560, 0, 940);
    g.addColorStop(0, "#132a21");
    g.addColorStop(0.35, "#17301f");
    g.addColorStop(1, "#0c1a12");
    c.fillStyle = g;
    c.fillRect(x0, 560, x1 - x0, 500);
  }

  function drawTufts(c: Ctx, x0: number, x1: number, y0: number, y1: number, t: number, lx: number, ly: number, fl: number, from: number, to: number) {
    c.lineCap = "round";
    for (const tf of tufts) {
      if (tf.y < from || tf.y >= to || tf.x < x0 - 40 || tf.x > x1 + 40 || tf.y < y0 - 40 || tf.y - tf.h > y1 + 40) continue;
      // 离灯越近越亮、越暖
      const d = Math.hypot(tf.x - lx, (tf.y - (ly + 250)) * 2.2);
      const light = clamp(1 - d / 520) ** 1.6 * fl;
      const r = Math.round(lerp(lerp(22, 34, tf.tone), 196, light * 0.8));
      const g = Math.round(lerp(lerp(52, 74, tf.tone), 190, light * 0.8));
      const b = Math.round(lerp(lerp(36, 44, tf.tone), 96, light * 0.6));
      c.strokeStyle = `rgb(${r},${g},${b})`;
      c.lineWidth = Math.max(1.4, tf.h * 0.1);
      const sway = Math.sin(t * 1.1 + tf.phase + tf.x * 0.01) * tf.h * 0.16;
      for (let i = 0; i < tf.blades; i++) {
        const off = (i - (tf.blades - 1) / 2) * tf.h * 0.22;
        c.beginPath();
        c.moveTo(tf.x + off, tf.y);
        c.quadraticCurveTo(tf.x + off + tf.lean * 2, tf.y - tf.h * 0.6, tf.x + off * 1.6 + tf.lean * tf.h * 0.3 + sway, tf.y - tf.h * (0.8 + 0.2 * (i % 2)));
        c.stroke();
      }
    }
  }

  // ---- 石头 ----
  function stonePath(c: Ctx) {
    c.beginPath();
    stonePts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
  }
  function drawStone(c: Ctx, lx: number, ly: number, fl: number, detail: number) {
    c.save();
    c.translate(STONE.x, STONE.y);
    // 影子
    c.fillStyle = "rgba(2,8,6,0.5)";
    c.beginPath();
    c.ellipse(-22, 2, STONE.w * 0.6, 12, 0, 0, 6.283);
    c.fill();
    stonePath(c);
    const body = c.createLinearGradient(-STONE.w / 2, -STONE.h, STONE.w / 2, 0);
    body.addColorStop(0, "#39433f");
    body.addColorStop(0.5, "#58625c");
    body.addColorStop(1, "#2b3431");
    c.fillStyle = body;
    c.fill();
    c.save();
    stonePath(c);
    c.clip();
    // 肌理：深浅斑点
    for (const s of specks) {
      c.fillStyle = s.light ? `rgba(215,225,215,${s.a})` : `rgba(10,16,14,${s.a + 0.08})`;
      c.fillRect(s.x, s.y, s.r, s.r * 0.8);
    }
    // 底部压暗
    const shade = c.createLinearGradient(0, -STONE.h * 0.5, 0, 0);
    shade.addColorStop(0, "rgba(6,12,10,0)");
    shade.addColorStop(1, "rgba(6,12,10,0.6)");
    c.fillStyle = shade;
    c.fillRect(-STONE.w / 2, -STONE.h, STONE.w, STONE.h);
    // 苔
    for (const m of moss) {
      c.fillStyle = "rgba(58,92,52,0.5)";
      c.beginPath();
      c.ellipse(m.x, m.y, m.r, m.r * 0.6, 0, 0, 6.283);
      c.fill();
    }
    // 裂纹：一道暗线 + 旁边一道亮边，看起来有深度
    c.lineJoin = "round";
    for (const line of cracks) {
      for (const [dx, dy, color, w] of [[0.9, 0.9, "rgba(225,232,222,0.2)", 1], [0, 0, "rgba(8,12,11,0.8)", 1.3]] as const) {
        c.strokeStyle = color;
        c.lineWidth = w;
        c.beginPath();
        line.forEach(([x, y], i) => (i ? c.lineTo(x + dx, y + dy) : c.moveTo(x + dx, y + dy)));
        c.stroke();
      }
    }
    // 刻字：像用刀划出来的——每个字母歪一点、深浅不一，右下有一道亮边
    if (detail > 0.05) {
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = 'italic 600 15px "Cormorant Garamond", Georgia, serif';
      let j = 0;
      CARVED.forEach((text, row) => {
        const widths = [...text].map((ch) => c.measureText(ch).width + 0.6);
        let x = -widths.reduce((a, b) => a + b, 0) / 2 - 6 + row * 9;
        const y = -STONE.h * 0.6 + row * 21;
        [...text].forEach((ch, i) => {
          const jit = letterJitter[j++ % letterJitter.length];
          c.save();
          c.translate(x + widths[i] / 2, y + jit.dy + i * 0.12);
          c.rotate(jit.rot - 0.03);
          c.scale(jit.sx, 1);
          c.fillStyle = `rgba(232,238,228,${0.26 * detail})`;
          c.fillText(ch, 0.8, 0.9);
          c.fillStyle = `rgba(9,13,12,${0.86 * detail})`;
          c.fillText(ch, 0, 0);
          c.restore();
          x += widths[i];
        });
      });
    }
    // 灯光照到的一面
    const lit = c.createRadialGradient(lx - STONE.x, ly - STONE.y + 180, 20, lx - STONE.x, ly - STONE.y + 180, 420);
    lit.addColorStop(0, `rgba(255,206,130,${0.42 * fl})`);
    lit.addColorStop(1, "rgba(255,206,130,0)");
    c.fillStyle = lit;
    c.fillRect(-STONE.w / 2, -STONE.h, STONE.w, STONE.h);
    c.restore();
    c.strokeStyle = "rgba(12,18,16,0.7)";
    c.lineWidth = 1.2;
    stonePath(c);
    c.stroke();
    c.restore();
  }

  // ---- 女孩（原创形象：淡金长发、深色水手领外套、小挎包；画在自己的小画布上再打光） ----
  const SKIN = "#f4dfcd";
  const SKIN_SH = "#dcbca6";
  const HAIR = "#dccb9d";
  const HAIR_SH = "#b39c69";
  const HAIR_HI = "#f8efcf";
  const COAT = "#1d2331";
  const COAT_HI = "#2f394d";
  const COLLAR = "#ecebe4";
  const RIBBON = "#a3343c";
  const BOOT = "#11141b";

  function limb(c: Ctx, pts: number[][], w: number, color: string) {
    c.strokeStyle = color;
    c.lineWidth = w;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  }

  function drawGirl(c: Ctx, f: Frame, lx: number, ly: number, fl: number) {
    // lx, ly：提灯相对脚底的位置
    const t = f.t;
    const turn = f.turn;
    const sway = Math.sin(t * 0.9) * 2.4;
    const breathe = Math.sin(t * 1.6) * 0.8;
    const squeeze = 1 - 0.26 * turn; // 侧身时身体变窄
    const fx = -11 * turn; // 脸上五官往她面对的方向挪

    // 后面的长发
    c.fillStyle = HAIR_SH;
    c.beginPath();
    c.moveTo(-30 * squeeze, -262);
    c.bezierCurveTo(-44, -220, -40 + sway, -160, -33 + sway * 1.6, -118);
    c.lineTo(-20 + sway * 1.4, -132);
    c.lineTo(-8 + sway * 1.2, -114);
    c.lineTo(6 + sway * 1.2, -130);
    c.lineTo(20 + sway * 1.4, -116);
    c.lineTo(33 + sway * 1.6, -124);
    c.bezierCurveTo(40 + sway, -160, 44, -220, 30 * squeeze, -262);
    c.closePath();
    c.fill();

    // 腿、袜子、靴子
    for (const side of [-1, 1]) {
      const x = side * 12 * squeeze;
      limb(c, [[x, -98], [x, -30]], 12, SKIN_SH);
      limb(c, [[x, -74], [x, -26]], 12.6, "#1a1e29");
      c.fillStyle = BOOT;
      c.beginPath();
      c.roundRect(x - 8, -32, 16 + (side > 0 ? 4 : 0), 32, 4);
      c.fill();
      c.fillStyle = "#2a2f3b";
      c.fillRect(x - 8, -32, 16, 3);
    }

    // 外套下摆
    c.fillStyle = COAT;
    c.beginPath();
    c.moveTo(-20 * squeeze, -160);
    c.lineTo(20 * squeeze, -160);
    c.quadraticCurveTo(34 * squeeze, -128, 42 * squeeze + sway * 0.7, -90);
    c.quadraticCurveTo(0, -80, -42 * squeeze + sway * 0.7, -90);
    c.quadraticCurveTo(-34 * squeeze, -128, -20 * squeeze, -160);
    c.fill();
    c.strokeStyle = COAT_HI;
    c.lineWidth = 1.6;
    for (const k of [-0.5, 0, 0.5]) {
      c.beginPath();
      c.moveTo(k * 20 * squeeze, -156);
      c.lineTo(k * 62 * squeeze + sway * 0.6, -89);
      c.stroke();
    }
    c.strokeStyle = COLLAR;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-40 * squeeze + sway * 0.7, -95);
    c.quadraticCurveTo(0, -85, 40 * squeeze + sway * 0.7, -95);
    c.stroke();

    // 右手（画面左边）：平时垂着拿一本合上的小书；托书时伸向左边
    const elbowR = [lerp(-32, -52, f.hold), lerp(-172, -184, f.hold)];
    const handR = [lerp(-30, HAND_BOOK[0], f.hold), lerp(-140, HAND_BOOK[1], f.hold)];
    if (f.hold < 0.5) {
      c.fillStyle = "#6b4a2e";
      c.save();
      c.translate(handR[0] - 2, handR[1] + 8);
      c.rotate(0.12);
      c.fillRect(-8, -12, 15, 22);
      c.fillStyle = "#e7dcc0";
      c.fillRect(5, -11, 2, 20);
      c.restore();
    }
    limb(c, [[-24 * squeeze, -204], elbowR, handR], 12, COAT);
    limb(c, [handR, [handR[0] + (handR[0] - elbowR[0]) * 0.12, handR[1] + (handR[1] - elbowR[1]) * 0.12]], 12.4, COLLAR);
    c.fillStyle = SKIN;
    c.beginPath();
    c.arc(handR[0] + (handR[0] - elbowR[0]) * 0.2, handR[1] + (handR[1] - elbowR[1]) * 0.2, 6.2, 0, 6.283);
    c.fill();

    // 上身
    c.fillStyle = COAT;
    c.beginPath();
    c.moveTo(-28 * squeeze, -208 + breathe);
    c.quadraticCurveTo(0, -216 + breathe, 28 * squeeze, -208 + breathe);
    c.lineTo(21 * squeeze, -158);
    c.lineTo(-21 * squeeze, -158);
    c.closePath();
    c.fill();
    // 挎包的带子和包
    c.strokeStyle = "#5c4630";
    c.lineWidth = 3.2;
    c.beginPath();
    c.moveTo(20 * squeeze, -208);
    c.lineTo(-24 * squeeze, -150);
    c.stroke();
    c.fillStyle = "#6f5539";
    c.beginPath();
    c.roundRect(-36 * squeeze, -152, 22, 20, 4);
    c.fill();
    c.fillStyle = "#c9a35c";
    c.fillRect(-27 * squeeze, -143, 4, 4);
    // 水手领 + 蝴蝶结
    c.fillStyle = COLLAR;
    c.beginPath();
    c.moveTo(-25 * squeeze, -210 + breathe);
    c.lineTo(0 + fx * 0.4, -184 + breathe);
    c.lineTo(25 * squeeze, -210 + breathe);
    c.lineTo(11, -216 + breathe);
    c.lineTo(0 + fx * 0.4, -200 + breathe);
    c.lineTo(-11, -216 + breathe);
    c.closePath();
    c.fill();
    c.fillStyle = RIBBON;
    c.beginPath();
    c.moveTo(fx * 0.4, -188 + breathe);
    c.lineTo(fx * 0.4 - 10, -194 + breathe);
    c.lineTo(fx * 0.4 - 9, -181 + breathe);
    c.lineTo(fx * 0.4, -186 + breathe);
    c.lineTo(fx * 0.4 + 9, -181 + breathe);
    c.lineTo(fx * 0.4 + 10, -194 + breathe);
    c.closePath();
    c.fill();
    c.fillRect(fx * 0.4 - 2, -187 + breathe, 4, 11);

    // 脖子、脸
    c.fillStyle = SKIN_SH;
    c.fillRect(-6 + fx * 0.3, -228, 12, 18);
    c.fillStyle = SKIN;
    c.beginPath();
    c.moveTo(-27 * (1 - 0.1 * turn) + fx * 0.5, -262);
    c.bezierCurveTo(-29 + fx * 0.5, -238, -18 + fx, -222, fx * 1.1, -220);
    c.bezierCurveTo(18 + fx, -222, 28 + fx * 0.5, -238, 27 + fx * 0.5, -262);
    c.bezierCurveTo(26, -288, -26, -288, -27 * (1 - 0.1 * turn) + fx * 0.5, -262);
    c.fill();
    // 腮红
    c.fillStyle = "rgba(232,140,130,0.32)";
    for (const side of [-1, 1]) {
      c.beginPath();
      c.ellipse(fx + side * 16, -238, 5.5, 3, 0, 0, 6.283);
      c.fill();
    }

    // 眼睛（会眨）
    const blinkPhase = (t * 0.27) % 1;
    const blink = blinkPhase > 0.96 ? Math.abs(Math.cos(((blinkPhase - 0.96) / 0.04) * Math.PI)) : 1;
    for (const side of [-1, 1]) {
      const far = side < 0 ? 1 - 0.6 * turn : 1 - 0.08 * turn;
      const ex = fx + side * 11.5 * (1 - 0.12 * turn);
      const ey = -249;
      const ew = 7.4 * far;
      const eh = 9.6 * blink;
      c.save();
      c.beginPath();
      c.ellipse(ex, ey, ew, Math.max(0.6, eh), 0, 0, 6.283);
      c.fillStyle = "#fbfaf6";
      c.fill();
      c.clip();
      const iris = c.createLinearGradient(0, ey - 8, 0, ey + 8);
      iris.addColorStop(0, "#1f3f6e");
      iris.addColorStop(0.55, "#3f7cc0");
      iris.addColorStop(1, "#9fd0ee");
      c.fillStyle = iris;
      c.beginPath();
      c.ellipse(ex + fx * 0.06, ey + 0.8, ew * 0.84, 8.6, 0, 0, 6.283);
      c.fill();
      c.fillStyle = "#10203c";
      c.beginPath();
      c.ellipse(ex + fx * 0.06, ey + 0.8, ew * 0.4, 4.2, 0, 0, 6.283);
      c.fill();
      // 眼里映着灯光
      c.fillStyle = `rgba(255,236,190,${0.95 * fl})`;
      c.beginPath();
      c.ellipse(ex + ew * 0.34, ey - 3.4, 2, 2.4, 0, 0, 6.283);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.8)";
      c.beginPath();
      c.arc(ex - ew * 0.3, ey + 3, 0.9, 0, 6.283);
      c.fill();
      c.restore();
      // 上眼线、睫毛、眉毛
      c.strokeStyle = "#2a2024";
      c.lineWidth = 1.9;
      c.lineCap = "round";
      // 两只眼睛左右对称着画：内眼角略高、外眼角略垂，眉毛内高外低——看起来安静，不凶
      c.beginPath();
      c.moveTo(ex - side * (ew + 0.2), ey - eh * 0.5);
      c.quadraticCurveTo(ex, ey - eh - 1.8, ex + side * (ew + 1.6), ey - eh * 0.12);
      c.stroke();
      c.lineWidth = 1.1;
      c.beginPath();
      c.moveTo(ex + side * (ew + 1.2), ey - eh * 0.2);
      c.lineTo(ex + side * (ew + 3.4), ey - eh * 0.5);
      c.stroke();
      c.strokeStyle = HAIR_SH;
      c.lineWidth = 1.3;
      c.beginPath();
      c.moveTo(ex - side * ew * 0.8, ey - 15.4);
      c.quadraticCurveTo(ex + side * ew * 0.2, ey - 16.2, ex + side * (ew + 0.6), ey - 13.4);
      c.stroke();
    }
    // 鼻子、嘴
    c.strokeStyle = "rgba(170,118,104,0.9)";
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(fx * 1.3, -238);
    c.lineTo(fx * 1.3 - 1.2 - turn, -235.5);
    c.stroke();
    c.beginPath();
    c.moveTo(fx * 1.2 - 3.4, -229.5);
    c.quadraticCurveTo(fx * 1.2, -227.6, fx * 1.2 + 3.4, -229.5);
    c.stroke();

    // 刘海和两侧的头发
    c.fillStyle = HAIR;
    c.beginPath();
    c.moveTo(-30 * squeeze, -256);
    c.bezierCurveTo(-34, -300, 34, -300, 30 * squeeze, -256);
    c.lineTo(27, -250);
    c.lineTo(22 + fx * 0.3, -262);
    c.lineTo(17 + fx * 0.5, -248);
    c.lineTo(10 + fx * 0.6, -263);
    c.lineTo(3 + fx * 0.7, -247);
    c.lineTo(-4 + fx * 0.7, -264);
    c.lineTo(-11 + fx * 0.6, -248);
    c.lineTo(-18 + fx * 0.5, -263);
    c.lineTo(-24 + fx * 0.3, -249);
    c.closePath();
    c.fill();
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(side * 30 * squeeze, -262);
      c.bezierCurveTo(side * 36, -236, side * 31 + sway * 0.5, -206, side * 27 + sway, -180);
      c.lineTo(side * 21 + sway * 0.8, -196);
      c.bezierCurveTo(side * 24, -216, side * 24, -238, side * 23, -256);
      c.closePath();
      c.fill();
    }
    // 头发的高光和发丝
    c.strokeStyle = HAIR_HI;
    c.lineWidth = 2.6;
    c.beginPath();
    c.arc(0, -262, 25, Math.PI * 1.18, Math.PI * 1.82);
    c.stroke();
    c.strokeStyle = "rgba(150,128,82,0.55)";
    c.lineWidth = 0.9;
    for (const k of [-0.7, -0.35, 0.05, 0.4, 0.75]) {
      c.beginPath();
      c.moveTo(k * 20, -288);
      c.quadraticCurveTo(k * 28, -276, k * 27 + fx * 0.4, -262);
      c.stroke();
    }
    // 头顶一撮翘起来的头发
    c.strokeStyle = HAIR;
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(1, -289);
    c.quadraticCurveTo(8, -300, 14 + sway * 0.5, -296);
    c.stroke();

    // 打光：背灯的一侧压上冷色的暗，朝灯的一侧染上暖光（只染在已经画出来的人身上）
    c.globalCompositeOperation = "source-atop";
    const cool = c.createLinearGradient(-70, 0, 60, 0);
    cool.addColorStop(0, "rgba(6,20,24,0.5)");
    cool.addColorStop(0.75, "rgba(6,20,24,0.12)");
    cool.addColorStop(1, "rgba(6,20,24,0)");
    c.fillStyle = cool;
    c.fillRect(-130, -340, 300, 370);
    const warm = c.createRadialGradient(lx, ly, 4, lx, ly, 190);
    warm.addColorStop(0, `rgba(255,214,138,${0.6 * fl})`);
    warm.addColorStop(0.45, `rgba(255,190,104,${0.2 * fl})`);
    warm.addColorStop(1, "rgba(255,190,104,0)");
    c.fillStyle = warm;
    c.fillRect(-130, -340, 300, 370);
    c.globalCompositeOperation = "source-over";

    // 左手（画面右边）举着灯：手臂、袖口、手
    const hand = HAND_UP;
    limb(c, [[24 * squeeze, -204], [52, -212], hand], 12, COAT);
    limb(c, [[74, -251], [76.5, -256]], 12.6, COLLAR);
    c.fillStyle = "#f6e3cf";
    c.beginPath();
    c.arc(hand[0] + 0.4, hand[1] - 1.5, 6.2, 0, 6.283);
    c.fill();
    // 提灯：提环、铁盖、玻璃罩、火
    c.strokeStyle = "#2b2620";
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(hand[0], hand[1]);
    c.lineTo(lx, ly - 15);
    c.stroke();
    c.save();
    c.translate(lx, ly);
    c.fillStyle = "#2b2620";
    c.beginPath();
    c.moveTo(-6, -15);
    c.lineTo(6, -15);
    c.lineTo(10, -10);
    c.lineTo(-10, -10);
    c.closePath();
    c.fill();
    const glass = c.createRadialGradient(0, 1, 1, 0, 1, 13);
    glass.addColorStop(0, "#fffbe6");
    glass.addColorStop(0.5, "#ffd97a");
    glass.addColorStop(1, "#f29a2e");
    c.fillStyle = glass;
    c.beginPath();
    c.roundRect(-8.5, -10, 17, 22, 3);
    c.fill();
    c.strokeStyle = "#2b2620";
    c.lineWidth = 1.4;
    c.strokeRect(-8.5, -10, 17, 22);
    c.beginPath();
    c.moveTo(0, -10);
    c.lineTo(0, 12);
    c.stroke();
    c.fillStyle = "#2b2620";
    c.fillRect(-10.5, 11, 21, 4);
    c.restore();
  }

  // ---- 光：一圈一圈的笔触 ----
  function drawSwirls(c: Ctx, t: number, lx: number, ly: number, fl: number, detail: number, layer: "back" | "front") {
    const hubs = [
      { x: lx, y: ly },
      { x: lx - 340 + Math.sin(t * 0.11) * 30, y: ly - 190 + Math.cos(t * 0.13) * 16 },
      { x: lx + 360 + Math.cos(t * 0.09) * 26, y: ly - 150 + Math.sin(t * 0.12) * 18 },
    ];
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    for (const s of strokes) {
      if ((s.hub === 0) !== (layer === "back")) continue;
      const hub = hubs[s.hub];
      const r = s.r + Math.sin(t * 0.7 + s.wob) * 5;
      const a = s.a + (t * s.w * 26) / (r + 30);
      const fade = s.hub === 0 ? clamp(1.08 - r / 280) : 0.55 * clamp(1.1 - r / 130);
      c.globalAlpha = fade * (0.22 + 0.22 * Math.sin(t * 2 + s.wob) ** 2) * fl * lerp(1, 0.7, detail);
      c.strokeStyle = s.color;
      c.lineWidth = s.width * lerp(1, 0.34, detail);
      c.beginPath();
      c.ellipse(hub.x, hub.y, r, r * 0.86, 0.12, a, a + s.len);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.fillStyle = "#fff0c2";
    for (const m of layer === "front" ? motes : []) {
      const a = m.a + t * m.v;
      c.globalAlpha = 0.5 * (0.5 + 0.5 * Math.sin(t * 1.7 + m.bob));
      c.fillRect(lx + Math.cos(a) * m.r, ly + Math.sin(a) * m.r * 0.7 + Math.sin(t + m.bob) * 5, 2.2, 2.2);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
  }

  function drawMist(c: Ctx, t: number, front: boolean, x0: number, x1: number) {
    for (const m of mists) {
      if (m.front !== front) continue;
      const span = WORLD.w + 900;
      const x = ((((m.x + t * m.v) % span) + span) % span) - 450;
      if (x + m.rx < x0 || x - m.rx > x1) continue;
      const g = c.createRadialGradient(x, m.y, 0, x, m.y, m.rx);
      g.addColorStop(0, `rgba(176,206,192,${m.a})`);
      g.addColorStop(1, "rgba(176,206,192,0)");
      c.fillStyle = g;
      c.save();
      c.translate(x, m.y);
      c.scale(1, m.ry / m.rx);
      c.translate(-x, -m.y);
      c.beginPath();
      c.arc(x, m.y, m.rx, 0, 6.283);
      c.fill();
      c.restore();
    }
  }

  /** 画一帧。canvas 的宽高由这里按 q 设置；CSS 负责把它铺满并保持“像素”边缘锐利。 */
  function draw(canvas: HTMLCanvasElement, vw: number, vh: number, f: Frame) {
    const bw = Math.max(2, Math.round(vw * f.q));
    const bh = Math.max(2, Math.round(vh * f.q));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const c = canvas.getContext("2d")!;
    const s = Math.max(vw / WORLD.w, vh / WORLD.h);
    const k = s * f.cam.z * f.q;
    const x0 = f.cam.x - bw / 2 / k;
    const x1 = f.cam.x + bw / 2 / k;
    const y0 = f.cam.y - bh / 2 / k;
    const y1 = f.cam.y + bh / 2 / k;
    const detail = clamp((f.cam.z - 1.4) / 1.6);
    const fl = flicker(f.t);
    const L = lanternAt(f.t);

    c.setTransform(k, 0, 0, k, bw / 2 - f.cam.x * k, bh / 2 - f.cam.y * k);
    drawBackdrop(c, x0, x1, f.t);
    drawMist(c, f.t, false, x0, x1);
    drawGround(c, x0, x1);
    // 灯下地面上的一汪光
    c.globalCompositeOperation = "lighter";
    const pool = c.createRadialGradient(GIRL.x + 24, GIRL.y + 8, 10, GIRL.x + 24, GIRL.y + 8, 380);
    pool.addColorStop(0, `rgba(255,196,104,${0.3 * fl})`);
    pool.addColorStop(1, "rgba(255,196,104,0)");
    c.fillStyle = pool;
    c.save();
    c.translate(0, GIRL.y + 8);
    c.scale(1, 0.26);
    c.translate(0, -(GIRL.y + 8));
    c.beginPath();
    c.arc(GIRL.x + 24, GIRL.y + 8, 380, 0, 6.283);
    c.fill();
    c.restore();
    c.globalCompositeOperation = "source-over";

    drawTufts(c, x0, x1, y0, y1, f.t, L.x, L.y, fl, 0, GIRL.y - 2);
    // 人的影子（背着灯，朝左后方拖出去）
    c.fillStyle = "rgba(2,8,6,0.5)";
    c.beginPath();
    c.ellipse(GIRL.x - 40, GIRL.y + 2, 74, 9, -0.04, 0, 6.283);
    c.fill();
    drawStone(c, L.x, L.y, fl, detail);
    // 灯的光晕和绕着灯转的笔触：画在人后面，这样不会把她的脸冲白
    c.globalCompositeOperation = "lighter";
    const glow = c.createRadialGradient(L.x, L.y, 2, L.x, L.y, 300 * fl);
    glow.addColorStop(0, `rgba(255,226,160,${0.62 * fl})`);
    glow.addColorStop(0.18, `rgba(255,196,110,${0.3 * fl})`);
    glow.addColorStop(1, "rgba(255,180,90,0)");
    c.fillStyle = glow;
    c.fillRect(L.x - 320, L.y - 320, 640, 640);
    c.globalCompositeOperation = "source-over";
    drawSwirls(c, f.t, L.x, L.y, fl, detail, "back");

    // 女孩：先画在自己的小画布上（这样打光只落在她身上），再贴进来
    const box = { x: -130, y: -340, w: 300, h: 370 };
    const sk = Math.min(k, 6);
    sprite ??= document.createElement("canvas");
    const sw = Math.ceil(box.w * sk);
    const sh = Math.ceil(box.h * sk);
    if (sprite.width !== sw || sprite.height !== sh) {
      sprite.width = sw;
      sprite.height = sh;
    }
    const g = sprite.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, sw, sh);
    g.setTransform(sk, 0, 0, sk, -box.x * sk, -box.y * sk);
    drawGirl(g, f, L.x - GIRL.x, L.y - GIRL.y, fl);
    c.imageSmoothingEnabled = k >= 1;
    c.drawImage(sprite, GIRL.x + box.x, GIRL.y + box.y, box.w, box.h);

    drawTufts(c, x0, x1, y0, y1, f.t, L.x, L.y, fl, GIRL.y - 2, 2000);

    // 夜色：离灯越远越暗
    const dark = c.createRadialGradient(L.x, L.y + 40, 50, L.x, L.y + 40, 640);
    dark.addColorStop(0, "rgba(3,9,8,0)");
    dark.addColorStop(0.45, "rgba(3,9,8,0.5)");
    dark.addColorStop(1, "rgba(3,9,8,0.86)");
    c.fillStyle = dark;
    c.fillRect(x0 - 10, y0 - 10, x1 - x0 + 20, y1 - y0 + 20);

    // 人前面：灯芯周围的一小团光、天上的两个小漩涡、飘着的光点
    c.globalCompositeOperation = "lighter";
    const core = c.createRadialGradient(L.x, L.y, 1, L.x, L.y, 56 * fl);
    core.addColorStop(0, `rgba(255,236,180,${0.7 * fl})`);
    core.addColorStop(1, "rgba(255,200,110,0)");
    c.fillStyle = core;
    c.fillRect(L.x - 60, L.y - 60, 120, 120);
    c.globalCompositeOperation = "source-over";
    drawSwirls(c, f.t, L.x, L.y, fl, detail, "front");
    drawMist(c, f.t, true, x0, x1);
  }

  return { draw };
}

/** 世界坐标 → 屏幕坐标（CSS 像素）。页面上的文字标签靠它贴在提灯、石头旁边。 */
export function project(vw: number, vh: number, cam: Camera, x: number, y: number) {
  const s = Math.max(vw / WORLD.w, vh / WORLD.h) * cam.z;
  return { x: vw / 2 + (x - cam.x) * s, y: vh / 2 + (y - cam.y) * s, s };
}

/** 2D 画法，包成和 3D 一样的接口。机位 = [x, y, 缩放]。 */
export function createRenderer2D(canvas: HTMLCanvasElement): PlainRenderer {
  const scene = createScene();
  return {
    kind: "2d",
    shots: {
      far: [800, 468, 1],
      builder: [GIRL.x - 62, GIRL.y - 206, 3.1],
      beside: [GIRL.x - 70, GIRL.y - 160, 2.1],
      journal: [STONE.x + 4, STONE.y - 52, 4.7],
    },
    draw(vw, vh, f) {
      const cam = { x: f.shot[0], y: f.shot[1], z: f.shot[2] };
      scene.draw(canvas, vw, vh, { t: f.t, cam, q: f.q, turn: f.turn, hold: f.hold });
      const L = lanternAt(f.t);
      const sp = project(vw, vh, cam, STONE.x, STONE.y - STONE.h);
      return {
        lantern: project(vw, vh, cam, L.x, L.y),
        stone: { x: sp.x, y: sp.y, w: STONE.w * sp.s, h: STONE.h * sp.s },
        hand: project(vw, vh, cam, GIRL.x + HAND_BOOK[0], GIRL.y + HAND_BOOK[1]),
      };
    },
    dispose() {},
  };
}
