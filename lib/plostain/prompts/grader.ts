import type { Question } from "../types.ts";
import type { Prompt } from "../llm.ts";

export const VERSION = "grader_v1";

const SYSTEM = `你是阅卷老师。你会拿到若干道题的标准答案、解析、错答地图（出题人事先预测的典型错答及其对应误解），以及学生的答案。请逐题判定。

判定标准是“学生是否真正表达了正确的理解”，不是“措辞是否和标准答案一样”：
- 短答题：与标准答案等价的写法（格式、空格、引号、大小写不同）判 true；
- 简述题：抓住了参考答案里的关键要点判 true；抓住一部分、缺了关键的一环判 partial；核心理解错误判 false；
- 不要因为学生答得简短就扣分，也不要因为答得长就给分。

matched_wrong_answer：如果学生的答案（在实质上）对应错答地图里的某一条，原样填入那一条的 wrong_answer 文本；对应不上，或答对了，填空字符串。这个字段用来检验出题人的错答押注是否命中，请严格判断，不要牵强附会。

rationale 用一两句话说明判定理由。

只输出一个 JSON 对象，不要任何其他文字：
{"gradings": [{"label": "Q1", "correct": "true | false | partial", "rationale": "", "matched_wrong_answer": ""}]}`;

export function build(items: { question: Question; answer: string }[]): Prompt {
  const payload = items.map(({ question: q, answer }) => ({
    label: q.label,
    type: q.type,
    stem: q.stem,
    options: q.options,
    standard_answer: q.answer,
    accepted_answers: q.accepted_answers,
    explanation: q.explanation,
    error_map: q.error_map.map((e) => ({ wrong_answer: e.wrong_answer, misconception: e.reasoning })),
    student_answer: answer,
  }));
  return { version: VERSION, system: SYSTEM, user: JSON.stringify(payload, null, 1) };
}
