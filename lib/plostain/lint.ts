// 程序检查：不靠模型自觉、用代码就能判断的硬约束。
// 结果会交给审核模型（让它修题），也显示在审题页上。
import type { ObjectiveMode, QuestionDraft } from "./types.ts";

export interface LintResult {
  perQuestion: Record<string, string[]>; // key 是题号（Q1…）
  setLevel: string[];
}

export const RELATION_TEXT: Record<string, string> = {
  same_surface: "看似相同、实则不同",
  same_principle: "看似不同、实则相同",
};

/** 去掉数字、空白、LaTeX 和标点，只剩“题目的样子”。两道题这样处理后一样，就只是换了数字。 */
function shape(stem: string): string {
  return stem
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[0-9０-９.]+/g, "#")
    .replace(/[\s$^{}()（）[\]，。,:：;；、？?!！'"“”`*_]/g, "")
    .toLowerCase();
}

const SUPERSCRIPT = /[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿᵐᵏ⁺⁻]/;

function withoutCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

export function lintQuestions(questions: QuestionDraft[], mode: ObjectiveMode): LintResult {
  const perQuestion: Record<string, string[]> = {};
  const add = (label: string, msg: string) => (perQuestion[label] ??= []).push(msg);
  const setLevel: string[] = [];

  // 1. 单选题的选项数一致
  const choice = questions.filter((q) => q.type === "single_choice");
  const counts = new Set(choice.map((q) => q.options.length));
  if (counts.size > 1) {
    const common = [...counts].sort((a, b) => choice.filter((q) => q.options.length === b).length - choice.filter((q) => q.options.length === a).length)[0];
    setLevel.push(`单选题的选项数不一致（${[...counts].sort().join(" / ")} 个都有），印成试卷不整齐。`);
    for (const q of choice) if (q.options.length !== common) add(q.label, `有 ${q.options.length} 个选项，卷中其他单选题大多是 ${common} 个。`);
  }

  // 2. 公式写法：要用 LaTeX，不要用上标字符或 a^(…)
  for (const q of questions) {
    const text = withoutCode([q.stem, ...q.options.map((o) => o.text), q.explanation].join("\n"));
    if (SUPERSCRIPT.test(text)) add(q.label, "用了 ³、ⁿ 这类上标字符，导出 PDF 时可能显示不全，应改成 LaTeX 公式（如 $x^{3}$）。");
    const outside = text.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, "");
    if (/[A-Za-z0-9)]\^\(?[A-Za-z0-9]/.test(outside)) add(q.label, "有写在公式外面的指数（如 a^(2m+3n)），应放进 $…$ 里。");
    if ((text.match(/(?<!\\)\$/g) ?? []).length % 2 === 1) add(q.label, "公式符号 $ 没有成对，公式会显示错乱。");
  }

  // 3. 对照组
  const groups = new Map<string, QuestionDraft[]>();
  for (const q of questions) if (q.pair_group.trim()) groups.set(q.pair_group.trim(), [...(groups.get(q.pair_group.trim()) ?? []), q]);
  for (const [g, members] of groups) {
    if (members.length < 2) {
      add(members[0].label, `对照组 ${g} 只有这一道题，对照不成立。`);
      continue;
    }
    const relation = members[0].pair_relation;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        if (shape(a.stem) === shape(b.stem) && sameSet(a.kp_ids, b.kp_ids)) {
          add(b.label, `和 ${a.label} 只差几个数字，像“只换数字”的伪变式，测不出新东西。`);
        }
        const misA = a.error_map.map((e) => e.misconception_id).filter(Boolean);
        const misB = b.error_map.map((e) => e.misconception_id).filter(Boolean);
        if (relation === "same_surface" && sameSet(a.kp_ids, b.kp_ids) && misA.length && sameSet(misA, misB)) {
          add(b.label, `和 ${a.label} 是“看似相同、实则不同”的对照，但两题测的知识点和押注的误解完全一样——其实没有“不同”。`);
        }
        if (relation === "same_principle" && !a.kp_ids.some((k) => b.kp_ids.includes(k))) {
          add(b.label, `和 ${a.label} 是“看似不同、实则相同”的对照，但两题的知识点没有交集——看不出是同一个原理。`);
        }
      }
    }
    if (members.some((m) => m.pair_relation !== relation)) add(members[0].label, `对照组 ${g} 里各题标的对照关系不一致。`);
  }
  // 整卷至少要有的对照组数：全面 / 完整练习 2 组，综合迁移 1 组，快速诊断不要求
  const need = mode === "comprehensive" || mode === "complete" ? 2 : mode === "transfer" ? 1 : 0;
  const realGroups = [...groups.values()].filter((m) => m.length >= 2).length;
  if (questions.length >= 5 && realGroups < need) setLevel.push(`对照组只有 ${realGroups} 组，这类卷子建议至少 ${need} 组（同貌不同构、同构不同貌）。`);

  return { perQuestion, setLevel };
}

function sameSet(a: string[], b: string[]): boolean {
  const A = new Set(a);
  const B = new Set(b);
  return A.size === B.size && [...A].every((x) => B.has(x));
}

/** 题目没写 paired_with 时，用对照组补上（诊断时会把同组题合起来读）。 */
export function fillPairedWith<T extends QuestionDraft>(questions: T[]): T[] {
  return questions.map((q) => {
    if (!q.pair_group.trim()) return q;
    const others = questions.filter((o) => o !== q && o.pair_group.trim() === q.pair_group.trim()).map((o) => o.label);
    return { ...q, paired_with: [...new Set([...q.paired_with, ...others])] };
  });
}
