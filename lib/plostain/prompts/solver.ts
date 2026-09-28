import type { Question } from "../types.ts";
import type { Prompt } from "../llm.ts";

export const VERSION = "solver_v1";

const SYSTEM = `你是一位认真的解题者。你会拿到一组练习题（只有题干和选项，没有答案）。请独立把每道题做一遍。

你的答案会被拿去和出题人的标准答案对比，用来发现题目本身的问题：答案错了、有歧义、能被绕过。所以：
- 按题面字面意思作答，不要猜出题人“想考什么”；
- 如果你觉得一道题有两种合理读法，在 reasoning 里明确说出来，再给出你认为最合理的答案；
- 如果你是靠排除法、关键词或题目之间的暗示做出来的，而不是靠真正理解，也请在 reasoning 里说出来——这正是审核要找的问题；
- 代码题请在脑中逐行执行，不要凭印象。

答案格式：单选题只写选项字母；短答题只写答案本身；简述题写你的解释（2～4 句）。

只输出一个 JSON 对象，不要任何其他文字：
{"answers": [{"label": "Q1", "answer": "", "reasoning": "简短的解题过程"}]}`;

/** solver 只看题干和选项——答案和设计卡在这里被刻意拿掉。 */
export function build(questions: Question[]): Prompt {
  const blind = questions.map((q) => ({
    label: q.label,
    type: q.type,
    stem: q.stem,
    ...(q.type === "single_choice" ? { options: q.options } : {}),
  }));
  return { version: VERSION, system: SYSTEM, user: JSON.stringify(blind, null, 1) };
}
