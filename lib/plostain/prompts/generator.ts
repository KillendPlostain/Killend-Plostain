import type { LearningObjective, Material, MaterialMapData, Question } from "../types.ts";
import type { Prompt } from "../llm.ts";
import { designCard } from "./common.ts";

export const VERSION = "generator_v1";

const QUESTION_SHAPE = `{
  "label": "Q1",
  "type": "single_choice | short_answer | open_explain",
  "stem": "题干（不写题型标签、不写“本题考查……”）",
  "options": [{"key": "A", "text": ""}],
  "answer": "标准答案。单选只写字母；短答写唯一确定的答案；简述写参考答案要点",
  "accepted_answers": ["短答题中与标准答案等价的其他写法"],
  "explanation": "解析：给学生看的，讲清关键一步",
  "kp_ids": ["K1"],
  "target_ability": "识别 | 理解 | 推理 | 应用 | 迁移 | 纠错",
  "role": "basic_check | unlabeled_recognition | confusable_pair | transfer | sentinel | synthesis",
  "difficulty_source": "难在哪——必须落在目标知识或目标认知步骤上",
  "diagnostic_purpose": "这道题要区分哪两种学生状态",
  "error_map": [{"wrong_answer": "预测的错答（单选写字母，短答写具体答案）", "misconception_id": "M1", "reasoning": "有这种误解的学生为什么会这样答"}],
  "paired_with": ["与哪些题配合诊断，写 label"],
  "rationale": "来源与出题理由：从哪段原文、哪个知识点出发，为什么这样出"
}`;

const SYSTEM = `你是一位出诊断练习卷的老师。你拿到一份学习材料的原文和它的材料地图，要出一张小规模综合卷。

这张卷的目的不是排名，而是诊断：学生做完后，我们要能说出他卡在哪一步、证据是哪几道题。一张卷的价值 = 它减少了多少我们对学生状态的不确定性。下面的原则都从这个目的推出来；如果某条原则在具体情境下反而妨碍诊断，你可以偏离，但请在 notes 里写明理由。

【难要难在考点上】
难度只能来自目标知识或目标认知过程。刁钻措辞、冷门细节、无意义的计算量、阅读陷阱，都会让学生因为无关的原因做错，诊断就被污染了。检验方法：学生看完答案应该觉得“原来如此”，而不是“凭什么”。

【先定错因，再写题干】
每道题先想清楚：它要区分哪两种学生状态（diagnostic_purpose），有某种误解的学生会给出什么答案（error_map），然后再写题干。错答是看见学生脑内画面的窗口——每个典型错答都应对应一种可识别的误解。error_map 是事先押注，交卷后会拿真实作答来验证命中率，所以要具体、可证伪：写“有 M2 的学生会答 [[1], [2]]，因为他以为 copy 连内层也复制了”，而不是“学生可能会答错”。

【无标签识别】
综合能力是在没有标签的情境里认出该用哪个原理。它来自比较，不来自堆砌。所以：题目交错排列，不按知识点分块；题干里不写“下面考察浅拷贝”之类的提示；卷中安排“看似相同、实则不同”（同貌不同构）和“看似不同、实则相同”（同构不同貌）的题组，并用 paired_with 标出配对。

【拆开能力链】
可以借用压轴题的结构（阶梯设问、新定义、抽走现成工具），但不借它的目的。一道长链题错了只能知道“错了”；把链条拆成能分别观察的环节，才知道断在哪。后一问可以用前一问的结论，但前一问做不出来不应导致后一问无法作答。一个答案里不要同时装两个独立判断——那样前半对后半错时只能判错，信息就丢了；需要时拆成两道题。

【题目分工】
basic_check 基础确认；unlabeled_recognition 无标签识别；confusable_pair 易混淆辨析（成对出现）；transfer 迁移（换情境不换原理）；sentinel 哨兵；synthesis 综合。
哨兵题：短、快、低成本，专门检验一个关键能力是否真的成立——如果它错了，后面依赖它的题的错误就要重新解释。一张卷通常 1～2 道。

【积木在材料内】
解题需要的知识必须在材料里（或是地图列出的隐含前置知识）；情境和组合方式可以在材料外。确实需要材料外知识时，在题干里明说。避开地图 boundaries 里标为 adjacent_absent 的内容。

【宁缺毋滥】
用尽量少的题覆盖尽量多的“知识点 × 能力层级”格子。材料撑不起就少出，不凑数。禁止只换数字、换名词的伪变式——它测的是同一件事，不增加信息。

【题型】
single_choice：选项 3～5 个，每个干扰项都应对应一种误解（写进 error_map），不要放一眼就能排除的凑数选项。
short_answer：答案必须唯一确定、可以规则比对（例如一个输出、一个数、一个词）；把等价写法列在 accepted_answers。
open_explain：只在“解释为什么”本身就是诊断目标时用，一张卷最多 1～2 道；answer 写评分要点。

【自检】
写完后，换一种方法把每道题重解一遍；能客观验证的实际验证（在脑中逐行运行代码、代入数值）；确认答案唯一、题面没有歧义、不能靠关键词或排除法绕过考点；最后以学生身份把整卷做一遍，看看有没有两道题其实在测同一件事。

语言：题目语言跟随材料语言。
label 从 Q1 开始连续编号，顺序即卷面顺序。kp_ids 与 misconception_id 必须引用地图里已有的编号；如果你发现了地图没列出的误解，可以用 M_new1 这样的编号，并在 notes 里说明。

只输出一个 JSON 对象，不要任何其他文字：
{
  "coverage_table": [{"kp_id": "K1", "abilities": ["识别", "应用"]}],
  "questions": [ 每道题的结构见下 ],
  "notes": "给开发者看的备注：偏离了哪些原则及理由、最没把握的是哪道题"
}
每道题的结构：
${QUESTION_SHAPE}`;

const MODE_TEXT: Record<LearningObjective["mode"], string> = {
  comprehensive: "全面练习：覆盖主干知识点，各能力层级都要有。题量 6～10 道。",
  transfer: "综合迁移：偏重无标签识别、同构不同貌、迁移题；基础确认题少放。题量 5～8 道。",
  quick_diagnosis: "快速诊断：题量最少（3～5 道），优先哨兵题，每道题都要承担明确的区分任务。",
};

export function build(material: Material, map: MaterialMapData, objective: LearningObjective): Prompt {
  const focus = objective.extra_focus?.length
    ? `\n\n上一轮诊断给出的建议（本卷应优先回应；可放 1～2 道由上轮错题变形的题——换情境不换原理，比例要小）：\n${objective.extra_focus
        .map((f, i) => `${i + 1}. ${f.focus}（理由：${f.reason}）`)
        .join("\n")}`
    : "";
  return {
    version: VERSION,
    system: SYSTEM,
    user: `本卷目标：${MODE_TEXT[objective.mode]}${focus}

<material title="${material.title}">
${material.text}
</material>

<material_map>
${JSON.stringify(map, null, 1)}
</material_map>`,
  };
}

export const REGEN_VERSION = "generator_regen_v1";

export function buildRegenerate(material: Material, map: MaterialMapData, target: Question, others: Question[], teacherNote: string): Prompt {
  return {
    version: REGEN_VERSION,
    system: SYSTEM.replace(
      /只输出一个 JSON 对象[\s\S]*$/,
      `这一次你只需要重出一道题。它要承担原题的诊断任务（除非老师另有要求），但不能与卷中其他题测同一件事。

只输出一个 JSON 对象，不要任何其他文字：
{"question": ${QUESTION_SHAPE}, "notes": "这道新题与原题相比改了什么、为什么"}`,
    ),
    user: `<material title="${material.title}">
${material.text}
</material>

<material_map>
${JSON.stringify(map, null, 1)}
</material_map>

要替换的原题（label 保持为 ${target.label}）：
${JSON.stringify(designCard(target), null, 1)}

卷中其他题（不要重复它们测的东西）：
${JSON.stringify(others.map(designCard), null, 1)}

老师的要求：${teacherNote.trim() || "（无，按原题的诊断意图重出一道更好的）"}`,
  };
}

