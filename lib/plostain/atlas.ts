// 知识体系图：整理模型画的图（normalizeAtlas）、没有体系图时用材料地图凑一张（fallbackAtlas）、
// 以及把树排成左右展开的脑图（layoutAtlas）。全是纯函数，服务端和网页都用。
import type { KnowledgeAtlas, MaterialMapData } from "./types.ts";

export type AtlasNode = KnowledgeAtlas["nodes"][number];

const MAX_NODES = 60;
const MAX_DEPTH = 4;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * 模型画的图不能直接用：编号可能重复、上级可能不存在、可能漏放知识点。这里统一修好：
 * - 每个材料知识点恰好挂在一个节点上；模型漏掉的，按依赖关系补一个同名节点
 * - 上级不存在、成环、层级太深的，往上挂
 * - 节点太多时，从后往前删“材料之外的叶子”
 */
export function normalizeAtlas(raw: KnowledgeAtlas, map: MaterialMapData, fallbackTitle: string): KnowledgeAtlas {
  const kps = new Map(map.knowledge_points.map((k) => [k.id, k]));
  const placed = new Set<string>();
  let nodes: AtlasNode[] = [];
  const seen = new Set<string>();
  for (const n of raw.nodes) {
    const id = n.id.trim();
    const name = n.name.trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const kp_ids = n.kp_ids.filter((k) => kps.has(k) && !placed.has(k));
    kp_ids.forEach((k) => placed.add(k));
    nodes.push({ ...n, id, name: clip(name, 24), note: clip(n.note.trim(), 80), parent: n.parent.trim(), kp_ids });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.parent === n.id || !byId.has(n.parent)) n.parent = "";
    // 成环：顺着上级走，走回自己就断开
    const walked = new Set([n.id]);
    for (let p = n.parent; p; p = byId.get(p)?.parent ?? "") {
      if (walked.has(p)) {
        n.parent = "";
        break;
      }
      walked.add(p);
    }
  }
  let title = raw.title.trim() || fallbackTitle;
  // 模型有时会把主题本身也画成一个节点：只有一个第一层节点时，把它提成主题
  const tops = nodes.filter((n) => !n.parent);
  if (tops.length === 1 && !tops[0].kp_ids.length && nodes.length > 1) {
    const top = tops[0];
    if (!raw.title.trim()) title = top.name;
    nodes = nodes.filter((n) => n !== top);
    for (const n of nodes) if (n.parent === top.id) n.parent = "";
    byId.delete(top.id);
  }

  const depthOf = (n: AtlasNode): number => (n.parent ? depthOf(byId.get(n.parent)!) + 1 : 1);
  for (const n of nodes) while (depthOf(n) > MAX_DEPTH) n.parent = byId.get(n.parent)!.parent;

  // 漏放的知识点：挂在它依赖的知识点所在的节点下；没有依赖就直接挂在主题下
  const nodeOfKp = new Map<string, string>();
  for (const n of nodes) for (const k of n.kp_ids) nodeOfKp.set(k, n.id);
  for (const k of map.knowledge_points) {
    if (placed.has(k.id)) continue;
    const dep = map.dependencies.find((d) => d.to_kp === k.id && nodeOfKp.has(d.from_kp));
    let parent = dep ? nodeOfKp.get(dep.from_kp)! : "";
    if (parent && depthOf(byId.get(parent)!) >= MAX_DEPTH) parent = byId.get(parent)!.parent;
    const node: AtlasNode = { id: `kp-${k.id}`, parent, name: clip(k.name, 24), note: clip(k.summary, 80), kp_ids: [k.id], kind: "topic" };
    nodes.push(node);
    byId.set(node.id, node);
    nodeOfKp.set(k.id, node.id);
    placed.add(k.id);
  }

  while (nodes.length > MAX_NODES) {
    const hasChild = new Set(nodes.map((n) => n.parent));
    const i = nodes.findLastIndex((n) => !n.kp_ids.length && !hasChild.has(n.id));
    if (i < 0) break;
    nodes.splice(i, 1);
  }

  const sources = raw.sources
    .filter((s) => /^https?:\/\//i.test(s.url.trim()))
    .slice(0, 6)
    .map((s) => ({ title: clip(s.title.trim() || s.url.trim(), 60), url: s.url.trim() }));
  return { title: clip(title, 28), nodes, sources };
}

/** 还没有体系图时：只用材料地图里的知识点和依赖关系画一张小图。 */
export function fallbackAtlas(map: MaterialMapData, title: string): KnowledgeAtlas {
  return normalizeAtlas({ title, nodes: [], sources: [] }, map, title);
}

// ---------------------------------------------------------------- 排版

export interface LaidNode extends AtlasNode {
  x: number; // 左上角
  y: number;
  w: number;
  h: number;
  depth: number; // 第一层分支 = 1
  side: 1 | -1; // 1 = 主题右边，-1 = 左边
  lines: string[];
  fs: number;
  order: number; // 出场顺序（动画用）
}
export interface Layout {
  width: number;
  height: number;
  root: { x: number; y: number; w: number; h: number; lines: string[]; fs: number };
  nodes: LaidNode[];
  links: { to: string; d: string }[];
}

const charW = (ch: string, fs: number) => (/[⺀-鿿豈-﫿＀-￯]/.test(ch) ? fs : fs * 0.58);
const textW = (s: string, fs: number) => [...s].reduce((w, ch) => w + charW(ch, fs), 0);

/** 按宽度折成最多两行，放不下的用省略号。 */
function wrap(text: string, fs: number, maxW: number): string[] {
  if (textW(text, fs) <= maxW) return [text];
  // 英文单词、数字、代码片段不从中间断开；在所有能断的位置里，挑两行最均匀的那个
  const tokens = text.match(/[A-Za-z0-9_.+\-*/=()[\]'"]+|\s+|./gu) ?? [text];
  let best: [string, string] | null = null;
  for (let i = 1; i < tokens.length; i++) {
    const a = tokens.slice(0, i).join("").trim();
    const b = tokens.slice(i).join("").trim();
    if (!a || !b || textW(a, fs) > maxW || /^[，、。：；！？）》」』,.:;!?)]/.test(b)) continue; // 第二行不以标点开头
    if (!best || Math.max(textW(a, fs), textW(b, fs)) < Math.max(textW(best[0], fs), textW(best[1], fs))) best = [a, b];
  }
  let [first, second] = best ?? [text, ""];
  if (!best) {
    // 一个很长的单词：只能硬断
    first = "";
    for (const ch of text) {
      if (textW(first + ch, fs) > maxW) break;
      first += ch;
    }
    second = text.slice(first.length);
  }
  if (textW(second, fs) > maxW) {
    while (second && textW(second + "…", fs) > maxW) second = second.slice(0, -1);
    second += "…";
  }
  return second ? [first, second] : [first];
}

const GAP_X = 58; // 相邻两层之间的横向间距
const GAP_Y = 14; // 兄弟节点之间
const GAP_BRANCH = 30; // 第一层分支之间
const PAD = 28;

export function layoutAtlas(atlas: KnowledgeAtlas): Layout {
  const children = new Map<string, AtlasNode[]>();
  for (const n of atlas.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const kids = (id: string) => children.get(id) ?? [];

  const box = (n: AtlasNode, depth: number) => {
    const fs = depth === 1 ? 18 : 16;
    const lines = wrap(n.name, fs, fs * 10);
    return { fs, lines, w: Math.ceil(Math.max(...lines.map((l) => textW(l, fs))) + 40), h: Math.ceil(lines.length * fs * 1.36 + 20) };
  };
  const boxes = new Map<string, ReturnType<typeof box>>();
  const depths = new Map<string, number>();
  const span = new Map<string, number>(); // 整棵子树占的高度
  const measure = (n: AtlasNode, depth: number): number => {
    const b = box(n, depth);
    boxes.set(n.id, b);
    depths.set(n.id, depth);
    const cs = kids(n.id);
    const inner = cs.reduce((s, c) => s + measure(c, depth + 1), 0) + GAP_Y * Math.max(0, cs.length - 1);
    const h = Math.max(b.h, inner);
    span.set(n.id, h);
    return h;
  };
  const tops = kids("");
  tops.forEach((t) => measure(t, 1));

  // 第一层分支分到左右两边：按顺序往右边放，放到一半高度后其余放左边
  const total = tops.reduce((s, t) => s + span.get(t.id)!, 0);
  const right: AtlasNode[] = [];
  const left: AtlasNode[] = [];
  let acc = 0;
  for (const t of tops) {
    const h = span.get(t.id)!;
    if (tops.length < 3 || acc + h / 2 <= total / 2 || !right.length) right.push(t);
    else left.push(t);
    acc += h;
  }

  const rootFs = 22;
  const rootLines = wrap(atlas.title, rootFs, rootFs * 11);
  const root = { w: Math.ceil(Math.max(...rootLines.map((l) => textW(l, rootFs))) + 56), h: Math.ceil(rootLines.length * rootFs * 1.36 + 30), lines: rootLines, fs: rootFs };

  const laid: LaidNode[] = [];
  const place = (side: 1 | -1, list: AtlasNode[]) => {
    // 每一层的列宽 = 这一侧该层最宽的节点
    const colW: number[] = [];
    const scan = (n: AtlasNode) => {
      const d = depths.get(n.id)!;
      colW[d] = Math.max(colW[d] ?? 0, boxes.get(n.id)!.w);
      kids(n.id).forEach(scan);
    };
    list.forEach(scan);
    const colX: number[] = [];
    let x = root.w / 2 + GAP_X;
    for (let d = 1; d < colW.length; d++) {
      colX[d] = x;
      x += colW[d] + GAP_X;
    }
    const height = list.reduce((s, t) => s + span.get(t.id)!, 0) + GAP_BRANCH * Math.max(0, list.length - 1);
    const put = (n: AtlasNode, top: number) => {
      const b = boxes.get(n.id)!;
      const d = depths.get(n.id)!;
      const h = span.get(n.id)!;
      const cy = top + h / 2;
      laid.push({ ...n, ...b, depth: d, side, x: side === 1 ? colX[d] : -colX[d] - b.w, y: cy - b.h / 2, order: 0 });
      const cs = kids(n.id);
      let t = top + (h - (cs.reduce((s, c) => s + span.get(c.id)!, 0) + GAP_Y * Math.max(0, cs.length - 1))) / 2;
      for (const c of cs) {
        put(c, t);
        t += span.get(c.id)! + GAP_Y;
      }
    };
    let top = -height / 2;
    for (const t of list) {
      put(t, top);
      top += span.get(t.id)! + GAP_BRANCH;
    }
  };
  place(1, right);
  place(-1, left);

  // 平移到正坐标
  const minX = Math.min(-root.w / 2, ...laid.map((n) => n.x)) - PAD;
  const maxX = Math.max(root.w / 2, ...laid.map((n) => n.x + n.w)) + PAD;
  const minY = Math.min(-root.h / 2, ...laid.map((n) => n.y)) - PAD;
  const maxY = Math.max(root.h / 2, ...laid.map((n) => n.y + n.h)) + PAD;
  for (const n of laid) {
    n.x -= minX;
    n.y -= minY;
  }
  const rootBox = { ...root, x: -root.w / 2 - minX, y: -root.h / 2 - minY };

  // 出场顺序：先近后远，同一层从上到下
  [...laid].sort((a, b) => a.depth - b.depth || a.y - b.y).forEach((n, i) => (n.order = i));

  const byId = new Map(laid.map((n) => [n.id, n]));
  const links = laid.map((n) => {
    const p = n.parent ? byId.get(n.parent)! : null;
    const x1 = p ? (n.side === 1 ? p.x + p.w : p.x) : rootBox.x + rootBox.w / 2 + (n.side * rootBox.w) / 2;
    const y1 = p ? p.y + p.h / 2 : rootBox.y + rootBox.h / 2;
    const x2 = n.side === 1 ? n.x : n.x + n.w;
    const y2 = n.y + n.h / 2;
    const mid = (x1 + x2) / 2;
    return { to: n.id, d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}` };
  });
  return { width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY), root: rootBox, nodes: laid, links };
}
