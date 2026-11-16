import type { LearningObjective, Material, MaterialMapData, Question, QuestionDraft } from "../types.ts";
import type { Prompt } from "../llm.ts";
import { designCard } from "./common.ts";

export const VERSION = "generator_v2"; // v2：LaTeX 公式、验算程序、对照组字段

const QUESTION_SHAPE = `{
  "label": "Q1",
  "type": "single_choice | short_answer | open_explain",
  "stem": "题干（不写题型标签、不写“本题考查……”；公式用 $…$）",
  "options": [{"key": "A", "text": "选项（公式用 $…$）"}],
  "answer": "标准答案。单选只写字母；短答写学生能直接用键盘打出来的形式（如 3x^3-5x^2+14x-8），不用 LaTeX；简述写参考答案要点",
  "accepted_answers": ["短答题中与标准答案等价的其他写法"],
  "explanation": "解析：给学生看的，讲清关键一步（公式用 $…$）",
  "kp_ids": ["K1"],
  "target_ability": "识别 | 理解 | 推理 | 应用 | 迁移 | 纠错",
  "role": "basic_check | unlabeled_recognition | confusable_pair | transfer | sentinel | synthesis",
  "difficulty_source": "难在哪——必须落在目标知识或目标认知步骤上",
  "diagnostic_purpose": "这道题要区分哪两种学生状态",
  "error_map": [{"wrong_answer": "预测的错答（单选写字母，短答写具体答案）", "misconception_id": "M1", "reasoning": "有这种误解的学生为什么会这样答"}],
  "paired_with": ["与哪些题配合诊断，写 label"],
  "pair_group": "对照组编号，如 P1；不属于任何对照组就写空字符串",
  "pair_relation": "same_surface（看似相同、实则不同）| same_principle（看似不同、实则相同）| 空字符串",
  "rationale": "来源与出题理由：从哪段原文、哪个知识点出发，为什么这样出",
  "check": {"code": "验算程序（Python），最后一行打印 PASS 或 FAIL: 原因；无法用程序验证时写空字符串", "note": "验算思路，或为什么无法验证"}
}`;

const SYSTEM = `你是一位出诊断练习卷的老师。你拿到一份学习材料的原文和它的材料地图，要出一张小规模综合卷。

这张卷的目的不是排名，而是诊断：学生做完后，我们要能说出他卡在哪一步、证据是哪几道题。一张卷的价值 = 它减少了多少我们对学生状态的不确定性。下面的原则都从这个目的推出来；如果某条原则在具体情境下反而妨碍诊断，你可以偏离，但请在 notes 里写明理由。

【难要难在考点上】
难度只能来自目标知识或目标认知过程。刁钻措辞、冷门细节、无意义的计算量、阅读陷阱，都会让学生因为无关的原因做错，诊断就被污染了。检验方法：学生看完答案应该觉得“原来如此”，而不是“凭什么”。

【先定错因，再写题干】
每道题先想清楚：它要区分哪两种学生状态（diagnostic_purpose），有某种误解的学生会给出什么答案（error_map），然后再写题干。错答是看见学生脑内画面的窗口——每个典型错答都应对应一种可识别的误解。error_map 是事先押注，交卷后会拿真实作答来验证命中率，所以要具体、可证伪：写“有 M2 的学生会答 [[1], [2]]，因为他以为 copy 连内层也复制了”，而不是“学生可能会答错”。

【无标签识别】
综合能力是在没有标签的情境里认出该用哪个原理。它来自比较，不来自堆砌。所以：题目交错排列，不按知识点分块；题干里不写“下面考察浅拷贝”之类的提示；卷中安排“看似相同、实则不同”（同貌不同构）和“看似不同、实则相同”（同构不同貌）的题组：同一组的题写同一个 pair_group（P1、P2……），pair_relation 写 same_surface 或 same_principle。程序会检查：每组至少两道题；同貌不同构的两题，测的知识点或押注的误解必须真的不同；两题不能只差几个数字。

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
single_choice：一律 4 个选项（A～D），整卷统一，印成试卷才整齐；每个干扰项都应对应一种误解（写进 error_map），不要放一眼就能排除的凑数选项。
short_answer：答案必须唯一确定、可以规则比对（例如一个输出、一个数、一个词）；把等价写法列在 accepted_answers。
open_explain：只在“解释为什么”本身就是诊断目标时用，一张卷最多 1～2 道；answer 写评分要点。

【公式】
题干、选项、解析里的数学式、物理量、化学式，一律写成 LaTeX 并用 $…$ 包起来（独占一行的长式子用 $$…$$），网页和导出的试卷会把它排成正规的公式：
$-3xy\\cdot(2x^{2}-xy+1)$、$a^{2m+3n}$、$\\frac{1}{2}$、$0.25^{2025}$、$v=\\frac{s}{t}$、$\\ce{2H2 + O2 -> 2H2O}$（化学式用 \\ce）。
不要用 ³、ⁿ 这类上标字符，也不要把指数写在公式外面（如 a^(2m+3n)）——导出 PDF 时会显示错乱。JSON 字符串里的反斜杠要写两个（"\\\\frac"）。代码仍然放在 \`\`\`python 代码块里，代码里不用 LaTeX。
理由：排版交给程序，你只管内容；手写的排版在打印时最容易出错。

【验算程序】
能用程序验证的题，在 check.code 里写一段 Python 程序（只用标准库：fractions、math、random、itertools、decimal 等）。系统会在隔离的沙箱里运行它——你写的程序真的会被执行。要求：
- 系统会在程序开头自动放好三个变量：ANSWER（这道题的标准答案字符串）、ACCEPTED（等价写法的列表）、OPTIONS（选项字母 → 选项文字的字典）。比对时用这些变量，不要把答案再抄进程序——老师改了答案后，验算会按新答案重新判断；
- 独立算出答案，再和 ANSWER 比对，最后一行打印 PASS，或打印 FAIL: 原因；
- 数学恒等或化简题：用 Fraction 随机代入 20 组以上的值，比较原式和答案；求参数的题：把参数代回题目，检查条件确实成立；
- Python 读代码题：用 exec 运行题干代码、用 contextlib.redirect_stdout 捕获输出，和答案比对；
- 单选题：验证正确选项成立，并且其他每个选项都不成立；
- 纯概念解释、无法用程序判断的题，code 写空字符串，在 note 里说明原因。
理由：在脑中推演会出错；程序验算不通过的题会被退回修改，所以宁可让程序说话。

【自检】
写完后，换一种方法把每道题重解一遍；确认答案唯一、题面没有歧义、不能靠关键词或排除法绕过考点；最后以学生身份把整卷做一遍，看看有没有两道题其实在测同一件事。

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
  complete:
    "完整练习（第一步：核心题）：这份材料之后还会按知识点补题，所以这一步只出最关键的核心题，约 8～12 道——" +
    "优先覆盖地图上的主干知识点和最可能出现的误解，质量第一。材料的前、中、后各部分都要照顾到，不要只从开头取材。",
};

// 补题的上限：完整练习按材料补到 25 道；全面练习只补漏掉的主干知识点，总数不超过 14 道。
export const MAX_QUESTIONS: Partial<Record<LearningObjective["mode"], number>> = { complete: 25, comprehensive: 14 };

export const SUPPLEMENT_VERSION = "generator_supplement_v1";

/** 补题：已有题目没测到的主干知识点，每个至少补一道题。 */
export function buildSupplement(
  material: Material,
  map: MaterialMapData,
  existing: QuestionDraft[],
  uncoveredKpIds: string[],
  maxNew: number,
): Prompt {
  const targets = map.knowledge_points.filter((k) => uncoveredKpIds.includes(k.id));
  return {
    version: SUPPLEMENT_VERSION,
    system: SYSTEM.replace(
      /只输出一个 JSON 对象[\s\S]*$/,
      `这一次是补题：卷子已经有一批题，但下面列出的主干知识点还没有任何题测到。请为它们补题——
每个列出的知识点至少被一道新题测到（一道题可以同时测几个相关知识点），新题总数不超过 ${maxNew} 道。
新题不能和已有题测同一件事；同样要先写诊断目的和错答押注，再写题干。宁缺毋滥：某个知识点在材料里只是一句结论、出题只能测默写的，可以不补，在 notes 里说明。
新题的 label 用 S1、S2……（之后程序会统一重新编号）；paired_with 可以引用已有题的 label。

只输出一个 JSON 对象，不要任何其他文字：
{"coverage_table": [], "questions": [ 每道题的结构见下 ], "notes": "补了哪些、没补哪些及理由"}
每道题的结构：
${QUESTION_SHAPE}`,
    ),
    user: `<material title="${material.title}">
${material.text}
</material>

<material_map>
${JSON.stringify(map, null, 1)}
</material_map>

还没有题测到的主干知识点（请为它们补题）：
${targets.map((k) => `- ${k.id} ${k.name}：原文“${k.anchor}”`).join("\n")}

已有的题（不要重复它们测的东西）：
${JSON.stringify(existing.map((q) => ({ label: q.label, stem: q.stem, kp_ids: q.kp_ids, role: q.role, diagnostic_purpose: q.diagnostic_purpose })), null, 1)}`,
  };
}

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

