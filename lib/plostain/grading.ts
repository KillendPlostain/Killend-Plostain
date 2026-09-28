// 规则批改与错答地图对照。能用规则判的不交给模型：可复现、不花钱、不会“看心情”。
import type { ErrorMapCheck, Grading, Question, ResponseRecord } from "./types.ts";

const FULL_TO_HALF: Record<string, string> = {
  "，": ",", "：": ":", "；": ";", "（": "(", "）": ")", "［": "[", "］": "]", "｛": "{", "｝": "}", "＝": "=", "！": "!", "？": "?",
};

/** 答案归一化：去空白、去引号、全角标点转半角、去句末句号、忽略大小写。逗号保留（[1,2] 和 [12] 不能混）。 */
export function normalizeAnswer(s: string): string {
  return s
    .trim()
    .replace(/[，：；（）［］｛｝＝！？]/g, (c) => FULL_TO_HALF[c] ?? c)
    .replace(/[\s'"`“”‘’]/g, "")
    .replace(/[。.]+$/, "")
    .toLowerCase();
}

/** 选择题只看选项字母。 */
export function choiceKey(s: string): string {
  const m = s.trim().toUpperCase().match(/[A-H]/);
  return m ? m[0] : normalizeAnswer(s);
}

function sameAnswer(q: Question, a: string, b: string): boolean {
  if (q.type === "single_choice") return choiceKey(a) === choiceKey(b);
  return normalizeAnswer(a) === normalizeAnswer(b);
}

/**
 * 规则批改。返回：已判定的，以及需要交给模型判的题。
 * 单选：规则判。短答：先规则比对标准答案和可接受答案；对不上的交给模型（避免因写法不同误判为错）。
 * 简述：一律模型判。
 */
export function ruleGrade(questions: Question[], responses: ResponseRecord[]): { graded: Grading[]; needModel: Question[] } {
  const byQ = new Map(responses.map((r) => [r.question_id, r]));
  const graded: Grading[] = [];
  const needModel: Question[] = [];
  for (const q of questions) {
    const answer = byQ.get(q.id)?.answer ?? "";
    if (!answer.trim()) {
      graded.push({ question_id: q.id, correct: "false", method: "rule", rationale: "未作答。", matched_wrong_answer: "" });
      continue;
    }
    if (q.type === "open_explain") {
      needModel.push(q);
      continue;
    }
    const accepted = [q.answer, ...q.accepted_answers];
    if (accepted.some((a) => sameAnswer(q, a, answer))) {
      graded.push({ question_id: q.id, correct: "true", method: "rule", rationale: "与标准答案一致。", matched_wrong_answer: "" });
    } else if (q.type === "single_choice") {
      const hit = q.error_map.find((e) => sameAnswer(q, e.wrong_answer, answer));
      graded.push({
        question_id: q.id,
        correct: "false",
        method: "rule",
        rationale: `选了 ${choiceKey(answer)}，正确答案是 ${choiceKey(q.answer)}。`,
        matched_wrong_answer: hit?.wrong_answer ?? "",
      });
    } else {
      const hit = q.error_map.find((e) => sameAnswer(q, e.wrong_answer, answer));
      if (hit) {
        // 精确命中一个预测错答，不必再问模型。
        graded.push({ question_id: q.id, correct: "false", method: "rule", rationale: "与错答地图中预测的错答一致。", matched_wrong_answer: hit.wrong_answer });
      } else {
        needModel.push(q);
      }
    }
  }
  return { graded, needModel };
}

/** 对照封存区：预测命中了哪些、哪些预测没出现、出现了哪些预测外的错答。 */
export function checkErrorMap(questions: Question[], responses: ResponseRecord[], gradings: Grading[]): ErrorMapCheck {
  const byQ = new Map(responses.map((r) => [r.question_id, r]));
  const gradeByQ = new Map(gradings.map((g) => [g.question_id, g]));
  const check: ErrorMapCheck = { hit: [], missed: [], unexpected: [], hit_rate: null };
  for (const q of questions) {
    const g = gradeByQ.get(q.id);
    const answer = byQ.get(q.id)?.answer ?? "";
    const wrong = g && g.correct !== "true";
    const matched = wrong && g.matched_wrong_answer ? q.error_map.find((e) => sameAnswer(q, e.wrong_answer, g.matched_wrong_answer)) ?? null : null;
    if (wrong) {
      if (matched) check.hit.push({ label: q.label, misconception_id: matched.misconception_id, answer });
      else if (answer.trim()) check.unexpected.push({ label: q.label, answer });
    }
    for (const e of q.error_map) {
      if (e !== matched) check.missed.push({ label: q.label, misconception_id: e.misconception_id, wrong_answer: e.wrong_answer });
    }
  }
  const denom = check.hit.length + check.unexpected.length;
  check.hit_rate = denom ? check.hit.length / denom : null;
  return check;
}
