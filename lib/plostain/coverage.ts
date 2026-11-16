// 覆盖检查：用代码核对“地图有没有读到材料后半段”“题目有没有测到每个主干知识点”，
// 不靠模型自觉。全部是纯计算，不调用模型。
import type { MaterialMapData, Question, QuestionDraft } from "./types.ts";

/**
 * 去掉空白、引号和 Markdown 格式符号，让锚点在 PDF 换行、空格不一致，
 * 或原文带 **加粗**、`代码` 标记而模型摘录时去掉了它们时，也能对上。两边用同一规则，不会误配。
 */
function squash(s: string): string {
  return s.replace(/[\s"'“”‘’`「」『』*_#>~|]/g, "");
}

/**
 * 每个知识点的原文锚点在材料里的相对位置（0 = 开头，1 = 结尾）。找不到时为 null。
 * 先整句匹配；对不上就用锚点的前 12 个字、后 12 个字再试（模型摘录时常改动一两个字）。
 */
export function anchorPositions(materialText: string, map: MaterialMapData): Map<string, number | null> {
  const text = squash(materialText);
  const result = new Map<string, number | null>();
  for (const kp of map.knowledge_points) {
    const a = squash(kp.anchor);
    let idx = a.length >= 4 ? text.indexOf(a) : -1;
    if (idx < 0 && a.length >= 16) idx = text.indexOf(a.slice(0, 12));
    if (idx < 0 && a.length >= 16) idx = text.indexOf(a.slice(-12));
    result.set(kp.id, idx < 0 || !text.length ? null : idx / text.length);
  }
  return result;
}

const SEGMENTS = ["前段", "中段", "后段"] as const;
const segmentOf = (pos: number) => SEGMENTS[Math.min(2, Math.floor(pos * 3))];

/** 地图是否只读了材料前面：材料够长，而后三分之一一个知识点都没有。 */
export function mapSpreadProblem(materialText: string, map: MaterialMapData): string | null {
  if (materialText.length < 3000) return null;
  const positions = [...anchorPositions(materialText, map).values()].filter((p): p is number => p !== null);
  if (positions.length < 3) return null; // 锚点大多对不上原文时无法判断，不误报
  const max = Math.max(...positions);
  if (max >= 2 / 3) return null;
  return `材料地图的知识点全部来自材料前 ${Math.round(max * 100) || 1}% 的内容，后面的部分可能没读到。`;
}

/** 还没有任何题测到的主干知识点。 */
export function uncoveredCore(map: MaterialMapData, questions: Pick<QuestionDraft, "kp_ids">[]): string[] {
  const tested = new Set(questions.flatMap((q) => q.kp_ids));
  return map.knowledge_points.filter((k) => k.tier === "core" && !tested.has(k.id)).map((k) => k.id);
}

export interface CoverageReport {
  core_total: number;
  core_covered: number;
  uncovered: { kp_id: string; name: string }[];
  segments: { name: string; kp_total: number; kp_covered: number; questions: number }[];
  unlocated: number; // 锚点在原文里找不到的知识点数（这些不计入分段统计）
}

/** 审题页、结果页显示的覆盖情况（只统计未删除的题）。 */
export function coverageReport(materialText: string, map: MaterialMapData, questions: Question[]): CoverageReport {
  const positions = anchorPositions(materialText, map);
  const byKp = new Map<string, number>();
  for (const q of questions) for (const id of new Set(q.kp_ids)) byKp.set(id, (byKp.get(id) ?? 0) + 1);
  const core = map.knowledge_points.filter((k) => k.tier === "core");
  const segments = SEGMENTS.map((name) => ({ name, kp_total: 0, kp_covered: 0, questions: 0 }));
  let unlocated = 0;
  for (const kp of map.knowledge_points) {
    const pos = positions.get(kp.id);
    if (pos == null) {
      unlocated++;
      continue;
    }
    const seg = segments[SEGMENTS.indexOf(segmentOf(pos))];
    seg.kp_total++;
    if (byKp.has(kp.id)) seg.kp_covered++;
  }
  // 每道题在每一段只算一次（一道题常同时测几个知识点）；跨段的题在各段都算。
  for (const q of questions) {
    const touched = new Set(
      q.kp_ids.map((id) => positions.get(id)).filter((p): p is number => p != null).map((p) => SEGMENTS.indexOf(segmentOf(p))),
    );
    for (const i of touched) segments[i].questions++;
  }
  return {
    core_total: core.length,
    core_covered: core.filter((k) => byKp.has(k.id)).length,
    uncovered: core.filter((k) => !byKp.has(k.id)).map((k) => ({ kp_id: k.id, name: k.name })),
    segments,
    unlocated,
  };
}

// “从易到难”的梯度：按题目分工排。同一档内保持出题模型给的顺序（它已经把不同知识点交错开）。
const DIFFICULTY: Record<string, number> = {
  basic_check: 0,
  sentinel: 0,
  unlabeled_recognition: 1,
  confusable_pair: 2,
  transfer: 3,
  synthesis: 4,
};

/** 按从易到难重排，并把题号重新编成 Q1、Q2……（配对题 paired_with 同步改）。 */
export function orderEasyToHard<T extends QuestionDraft>(questions: T[]): T[] {
  const sorted = questions
    .map((q, i) => ({ q, i }))
    .sort((a, b) => (DIFFICULTY[a.q.role] ?? 2) - (DIFFICULTY[b.q.role] ?? 2) || a.i - b.i)
    .map(({ q }) => q);
  return relabel(sorted);
}

/** 题号按当前顺序重编为 Q1…Qn，并同步配对关系。 */
export function relabel<T extends QuestionDraft>(questions: T[]): T[] {
  const rename = new Map(questions.map((q, i) => [q.label, `Q${i + 1}`]));
  return questions.map((q, i) => ({
    ...q,
    label: `Q${i + 1}`,
    paired_with: q.paired_with.map((l) => rename.get(l)).filter((l): l is string => !!l),
  }));
}
