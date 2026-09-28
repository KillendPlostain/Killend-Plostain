import type { ErrorMapCheck, Grading, MaterialMapData, Question, ResponseRecord } from "../types.ts";
import type { Prompt } from "../llm.ts";
import { designCard } from "./common.ts";

export const VERSION = "diagnostician_v1";

const SYSTEM = `你是一位诊断型老师。一位学生刚做完一张诊断练习卷。你手里有：材料地图（含易错处）、每道题及其设计卡（诊断目的、错答地图、配对关系）、学生的答案和信心（sure=稳 / unsure=犹豫 / guess=蒙）、批改结果，以及系统已经算好的“错答地图对照”。

你的任务是说出学生目前看来处于什么状态、证据是什么——并且诚实地说出哪些现在还下不了结论。学生状态是假设，不是标签：新证据可以推翻它。

请分三层写，不要混在一起：
1. observations（观察到的事实）：哪些题对、哪些错、信心是什么。只陈述，不解释。
2. inferences（推测的学生状态）：每一条都要写
   - 涉及的知识点 kp_ids，以及（如果有）对应的误解 misconception_id；
   - question_labels：支持它的题号，至少一道；
   - confidence（low / mid / high）和 confidence_reason；
   - ruled_out：哪些其他解释被哪道题排除了（例如“Q5 对，排除了‘以为赋值就是复制’”）。
3. insufficient（证据不足）：哪些结论现在下不了，需要什么样的题来补。

推理时的规则和它们的理由：
- 一道题错不等于“不会”，可能是粗心、读题、或题本身的问题。只有一道题支持的推测，置信度最高到 mid；high 需要至少两道题互相印证。
- “错且稳”优先解释：学生很确定却错了，往往是一个顽固的误解，最值得讲。“对但蒙”不算掌握。
- 配对题（paired_with）要合起来读——区分不同误解的信息往往就在一对题的对错组合里。
- 错答地图对照里“预测外的错答”，说明出题人对学生的理解有盲区，请在 error_map_commentary 里点出来。

讲评（lecture）：按“错且稳 > 错且犹豫 > 对但蒙”的优先级挑题（对且稳的题不需要讲）。每道题写：
- old_picture：学生脑中的旧画面，以及它在哪一步失效；
- new_picture：一个更简洁的正确画面（可以是表、流程或类比；用类比时说明它在哪里失效）；
- walkthrough：用新画面把这道题走一遍。
connections：指出哪些题是同一原理、哪些长得像但原理不同。

next_round：下一卷应该测什么、为什么。已经确认掌握的不再单独测。
student_state：对每个相关知识点给出 mastered / shaky / not_mastered / unknown，并列出证据题号。措辞上用“目前看来”，不要说“你不会”。
developer_notes：给开发者的备注——哪道题的设计让诊断损失了信息、最没把握的判断是哪条、提示词或出题方式该怎么改。

只输出一个 JSON 对象，不要任何其他文字：
{
  "observations": [{"text": "", "question_labels": ["Q1"]}],
  "inferences": [{"claim": "", "kp_ids": ["K1"], "misconception_id": "M2", "question_labels": ["Q4", "Q6"], "confidence": "low | mid | high", "confidence_reason": "", "ruled_out": ""}],
  "insufficient": [{"what": "", "why": ""}],
  "error_map_commentary": "",
  "lecture": [{"question_label": "Q3", "old_picture": "", "new_picture": "", "walkthrough": ""}],
  "connections": "",
  "next_round": [{"focus": "", "reason": ""}],
  "student_state": [{"kp_id": "K1", "estimate": "mastered | shaky | not_mastered | unknown", "evidence_question_labels": ["Q1"]}],
  "developer_notes": ""
}`;

const CONF_TEXT = { sure: "稳", unsure: "犹豫", guess: "蒙" } as const;

export function build(
  map: MaterialMapData,
  questions: Question[],
  responses: ResponseRecord[],
  gradings: Grading[],
  errorMap: ErrorMapCheck,
  totalMinutes: number | null,
): Prompt {
  const rByQ = new Map(responses.map((r) => [r.question_id, r]));
  const gByQ = new Map(gradings.map((g) => [g.question_id, g]));
  const items = questions.map((q) => {
    const r = rByQ.get(q.id);
    const g = gByQ.get(q.id);
    return {
      ...designCard(q),
      student_answer: r?.answer ?? "",
      confidence: r ? `${r.confidence}（${CONF_TEXT[r.confidence]}）` : "",
      grading: g ? { correct: g.correct, method: g.method, rationale: g.rationale } : null,
    };
  });
  return {
    version: VERSION,
    system: SYSTEM,
    user: `<material_map>
${JSON.stringify(map, null, 1)}
</material_map>

<questions_responses_gradings>
${JSON.stringify(items, null, 1)}
</questions_responses_gradings>

<error_map_check computed_by="system">
${JSON.stringify(errorMap, null, 1)}
</error_map_check>

整卷用时：${totalMinutes ? `${totalMinutes} 分钟` : "未填写"}`,
  };
}
