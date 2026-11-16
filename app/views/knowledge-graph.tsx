"use client";
// 知识体系图：用 SVG 画的脑图，主题在中间，分支向左右展开。
// 排版在 lib/plostain/atlas.ts；这里只管画，以及每个节点的状态（tone）长什么样。
import { useMemo, type CSSProperties, type KeyboardEvent } from "react";
import type { KnowledgeAtlas } from "@/lib/plostain/types";
import { layoutAtlas } from "@/lib/plostain/atlas";

/**
 * 节点状态：
 * out = 材料之外（淡显）；branch = 分支本身不是知识点，但下面有材料讲到的内容；in = 材料讲到；lit = 这张卷考到（点亮）
 * mastered / shaky / weak / unknown = 诊断页：稳 / 不稳 / 没掌握 / 还看不出
 */
export type Tone = "out" | "branch" | "in" | "lit" | "mastered" | "shaky" | "weak" | "unknown";

// 状态不只靠颜色区分：诊断页的四种状态各带一个小记号
const GLYPH: Partial<Record<Tone, string>> = { mastered: "✓", shaky: "~", weak: "!", unknown: "?" };
export const TONE_TEXT: Record<Tone, string> = {
  out: "材料之外",
  branch: "分支",
  in: "材料讲到",
  lit: "本卷考到",
  mastered: "目前看来稳",
  shaky: "目前看来不稳",
  weak: "目前看来没掌握",
  unknown: "还看不出",
};

/** 每个节点的底色：材料讲到 / 通向材料内容的分支 / 材料之外。页面再在上面叠“点亮”或掌握情况。 */
export function structureTones(atlas: KnowledgeAtlas): Record<string, Tone> {
  const onPath = new Set<string>();
  const byId = new Map(atlas.nodes.map((n) => [n.id, n]));
  for (const n of atlas.nodes) {
    if (!n.kp_ids.length) continue;
    for (let p = n.parent; p && !onPath.has(p); p = byId.get(p)?.parent ?? "") onPath.add(p);
  }
  return Object.fromEntries(atlas.nodes.map((n) => [n.id, n.kp_ids.length ? "in" : onPath.has(n.id) ? "branch" : "out"]));
}

export function KnowledgeGraph({
  atlas,
  tones,
  selected,
  onSelect,
}: {
  atlas: KnowledgeAtlas;
  tones: Record<string, Tone>;
  selected: string | null;
  onSelect: (id: string | null, side?: 1 | -1) => void; // side：节点在主题的哪一边（说明卡放到另一边，不挡住它）
}) {
  const layout = useMemo(() => layoutAtlas(atlas), [atlas]);
  const toneOf = (id: string) => tones[id] ?? "out";
  const toggle = (id: string, side: 1 | -1) => onSelect(selected === id ? null : id, side);
  const key = (e: KeyboardEvent, id: string, side: 1 | -1) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(id, side);
    }
  };

  return (
    <div className="kg-wrap">
      <svg
        className="kg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ maxWidth: layout.width }}
        role="group"
        aria-label={`${atlas.title} 的知识体系图，共 ${layout.nodes.length} 个节点`}
      >
        <defs>
          <linearGradient id="kg-half" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--glow)" />
            <stop offset="0.45" stopColor="var(--glow)" />
            <stop offset="1" stopColor="var(--surface)" />
          </linearGradient>
        </defs>
        <g>
          {layout.links.map((l) => (
            <path key={l.to} className={`kg-link tone-${toneOf(l.to)}`} d={l.d} style={{ "--i": layout.nodes.find((n) => n.id === l.to)?.order ?? 0 } as CSSProperties} />
          ))}
        </g>
        <g className="kg-root" transform={`translate(${layout.root.x} ${layout.root.y})`}>
          <rect width={layout.root.w} height={layout.root.h} rx={layout.root.h / 2} />
          {layout.root.lines.map((line, i) => (
            <text key={i} x={layout.root.w / 2} y={15 + layout.root.fs * 1.36 * (i + 0.5)} fontSize={layout.root.fs}>
              {line}
            </text>
          ))}
        </g>
        {layout.nodes.map((n) => {
          const tone = toneOf(n.id);
          const rx = n.lines.length > 1 ? 18 : n.h / 2;
          return (
            <g
              key={n.id}
              className={`kg-node tone-${tone}${selected === n.id ? " selected" : ""}`}
              transform={`translate(${n.x} ${n.y})`}
              style={{ "--i": n.order } as CSSProperties}
              role="button"
              tabIndex={0}
              aria-pressed={selected === n.id}
              aria-label={`${n.name}：${TONE_TEXT[tone]}`}
              onClick={() => toggle(n.id, n.side)}
              onKeyDown={(e) => key(e, n.id, n.side)}
            >
              <rect className="kg-halo" x={-6} y={-6} width={n.w + 12} height={n.h + 12} rx={rx + 6} />
              <rect className="kg-box" width={n.w} height={n.h} rx={rx} />
              {n.lines.map((line, i) => (
                <text key={i} x={n.w / 2} y={10 + n.fs * 1.36 * (i + 0.5)} fontSize={n.fs}>
                  {line}
                </text>
              ))}
              {GLYPH[tone] && (
                <g className="kg-glyph" transform={`translate(${n.side === 1 ? n.w - 4 : 4} 2)`}>
                  <circle r={10} />
                  <text fontSize={13}>{GLYPH[tone]}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 图例里的一小格：和图上的节点用同一套样式。 */
export function ToneSwatch({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="kg-legend-item">
      <svg width="30" height="18" viewBox="0 0 30 18" className={`kg-node tone-${tone} still`} aria-hidden>
        <rect className="kg-box" x="1.5" y="1.5" width="27" height="15" rx="7.5" />
      </svg>
      {children}
    </span>
  );
}
