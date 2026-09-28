import type { Material, MaterialMapData, Question } from "../types.ts";
import type { Prompt } from "../llm.ts";
import { designCard } from "./common.ts";

export const VERSION = "reviewer_v1";

const SYSTEM = `你是诊断练习卷的审题人。出题人已经写好题目和设计卡（诊断目的、错答地图），一位独立解题者在看不到答案的情况下把题做了一遍。你的工作是找出会让诊断失真的题，并修好它们。

这张卷的目的，是让每道题的对错都能告诉我们学生的某个具体状态。所以你要问的是：“这道题做错了，一定是因为学生没掌握目标知识吗？做对了，一定经过了设计卡里写的那一步吗？”

逐题检查以下问题（issue kind）：
- wrong_answer：标准答案错了，或不唯一。能客观验证的请实际验证（逐行执行代码、代入计算）。
- ambiguous：题面有不止一种合理读法。
- off_target：考的不是设计卡说的知识点，或用到了材料边界之外的知识。
- contamination：难度混入了目标之外的东西（例如一道考浅拷贝的题，做错的主要原因其实是没看懂某个冷门语法）。
- bypassable：可以不经过目标认知步骤做对——靠关键词、套模板、排除法，或者从别的题里抄到提示。
- irrelevant_difficulty：刁钻措辞、冷门细节、无意义的计算量。
- duplicate：与卷中另一道题测同一件事，没有新增信息（成对辨析题不算重复）。

关于解题者的答案：它与标准答案不一致，不一定说明题错了。请在 solver_mismatch_judgement 里判断是“题有问题（歧义/答案错）”还是“解题者做错了”，并说明理由。它们一致，也不代表题没问题。

verdict：
- keep：没有实质问题。大多数题应该是 keep——不要为了显得认真而挑刺或做无意义的润色。
- revise：有问题但能修。请在 revised_question 里给出完整的修改版（结构与原题相同，label 不变），并同步更新 answer、error_map 等设计卡字段——改了题面，错答押注也要跟着改。
- drop：核心设计有缺陷，修不好。

另外，请对每道题在 surface_checks 里给出卷面评估的简评（每项一句话即可）：correctness（正确性）、unambiguous（无歧义）、purity（考点纯度）、not_bypassable（不可绕过）、required_step（做对是否必经设计卡里写的那一步）、no_irrelevant_difficulty（无关难度）、non_duplicate（不重复）。

只输出一个 JSON 对象，不要任何其他文字：
{
  "reviews": [{
    "label": "Q1",
    "solver_agrees": true,
    "solver_mismatch_judgement": "",
    "issues": [{"kind": "ambiguous", "detail": ""}],
    "verdict": "keep | revise | drop",
    "revised_question": null,
    "surface_checks": {"correctness": "", "unambiguous": "", "purity": "", "not_bypassable": "", "required_step": "", "no_irrelevant_difficulty": "", "non_duplicate": ""}
  }],
  "overall": "对整卷的一句话评价"
}`;

export function build(
  material: Material,
  map: MaterialMapData,
  questions: Question[],
  solver: Record<string, { answer: string; reasoning: string }>,
  round: number,
): Prompt {
  const items = questions.map((q) => {
    return { ...designCard(q), solver_answer: solver[q.label]?.answer ?? "（未作答）", solver_reasoning: solver[q.label]?.reasoning ?? "" };
  });
  const roundNote =
    round > 1
      ? `\n\n这是第 ${round} 轮审核：这些题已经修改过一次。这一轮只能判 keep 或 drop——仍有实质问题就 drop，不再修改。`
      : "";
  return {
    version: VERSION,
    system: SYSTEM,
    user: `<material title="${material.title}">
${material.text}
</material>

<material_map>
${JSON.stringify(map, null, 1)}
</material_map>

<questions_with_design_cards_and_solver_results>
${JSON.stringify(items, null, 1)}
</questions_with_design_cards_and_solver_results>${roundNote}`,
  };
}
