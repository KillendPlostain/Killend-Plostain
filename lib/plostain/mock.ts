// mock provider 的固定输出：基于需求说明第 16 节的 Python 浅拷贝示例。
// 生成器故意埋了一个错（Q3 用了 y += [3]），用来检验审核能否发现并修改它。
import type {
  DiagnosisOutput,
  ErrorMapCheck,
  Grading,
  GeneratorOutput,
  MaterialMapData,
  Question,
  QuestionDraft,
  ResponseRecord,
  ReviewItem,
} from "./types.ts";

export const SAMPLE_MATERIAL = `在 Python 里，b = a 不会复制列表，它只是让名字 b 也指向 a 所指的同一个列表对象。所以通过 b 原地修改（比如 b.append(3)），用 a 也能看到变化。

如果想要一个新的列表，可以用 a.copy()。它会创建一个新的外层列表，但这是浅拷贝：如果列表里还装着列表，里面那些内层列表仍然是共享的。

is 判断两个名字是不是指向同一个对象，== 判断两个对象的值是否相等。`;

export function mockMap(): MaterialMapData {
  return {
    knowledge_points: [
      { id: "K1", name: "赋值是名字绑定对象，不复制", summary: "b = a 让 b 指向同一个列表对象。", anchor: "b = a 不会复制列表", tier: "core" },
      { id: "K2", name: "原地修改对所有指向它的名字可见", summary: "通过任一名字原地修改，其他名字都能看到。", anchor: "通过 b 原地修改（比如 b.append(3)），用 a 也能看到变化", tier: "core" },
      { id: "K3", name: "copy() 是浅拷贝：新外层、共享内层", summary: "a.copy() 创建新的外层列表，内层对象仍共享。", anchor: "这是浅拷贝：如果列表里还装着列表，里面那些内层列表仍然是共享的", tier: "core" },
      { id: "K4", name: "is 比较身份，== 比较值", summary: "is 看是否同一对象，== 看值是否相等。", anchor: "is 判断两个名字是不是指向同一个对象，== 判断两个对象的值是否相等", tier: "minor" },
    ],
    dependencies: [
      { from_kp: "K1", to_kp: "K2", note: "先理解名字指向同一对象，才能理解原地修改为何两边可见。" },
      { from_kp: "K1", to_kp: "K3", note: "浅拷贝的“共享内层”是名字绑定在嵌套结构里的延伸。" },
      { from_kp: "K2", to_kp: "K3", note: "要通过原地修改内层列表才能观察到共享。" },
    ],
    implicit_prereqs: [{ name: "列表、append、下标访问", note: "材料默认学生已会。" }],
    misconceptions: [
      { id: "M1", kp_ids: ["K1"], description: "学生以为赋值就是复制", source: "material" },
      { id: "M2", kp_ids: ["K3"], description: "学生以为 copy() 得到完全独立的副本（连内层也复制）", source: "material" },
      { id: "M3", kp_ids: ["K2"], description: "学生把“重新赋值”当成“原地修改”", source: "model" },
      { id: "M4", kp_ids: ["K4"], description: "学生混用 is 和 ==", source: "model" },
    ],
    boundaries: [
      { description: "没讲深拷贝", kind: "adjacent_absent" },
      { description: "没讲 += 对列表的行为（避免出题）", kind: "adjacent_absent" },
      { description: "小整数缓存等依赖实现的细节", kind: "adjacent_absent" },
    ],
    verifiability: ["K1", "K2", "K3", "K4"].map((kp_id) => ({ kp_id, how: "run" as const })),
    suitability: {
      good_for: "短代码预测输出、成对辨析。",
      bad_for: "写长程序。",
      why: "材料讲的是对象模型的几个关键区分，最适合用“预测输出”直接暴露学生脑中的画面。",
    },
  };
}

const q = (d: Partial<QuestionDraft> & Pick<QuestionDraft, "label" | "stem" | "answer">): QuestionDraft => ({
  type: "short_answer",
  options: [],
  accepted_answers: [],
  explanation: "",
  kp_ids: [],
  target_ability: "理解",
  role: "basic_check",
  difficulty_source: "",
  diagnostic_purpose: "",
  error_map: [],
  paired_with: [],
  rationale: "",
  ...d,
});

export function mockGenerate(): GeneratorOutput {
  return {
    coverage_table: [
      { kp_id: "K1", abilities: ["理解", "迁移"] },
      { kp_id: "K2", abilities: ["理解", "推理"] },
      { kp_id: "K3", abilities: ["推理", "应用"] },
      { kp_id: "K4", abilities: ["应用"] },
    ],
    questions: [
      q({
        label: "Q1",
        stem: "下面的代码输出什么？\n\na = [1, 2]\nb = a\nb.append(3)\nprint(a)",
        answer: "[1, 2, 3]",
        explanation: "b = a 不复制，a 和 b 指向同一个列表；通过 b 原地 append，a 也看得到。",
        kp_ids: ["K1", "K2"],
        role: "basic_check",
        difficulty_source: "需要把“赋值”理解为贴标签而不是复制。",
        diagnostic_purpose: "区分“懂赋值是绑定” vs “以为赋值就是复制”。",
        error_map: [{ wrong_answer: "[1, 2]", misconception_id: "M1", reasoning: "以为 b 是 a 的副本，改 b 不影响 a。" }],
        paired_with: ["Q3"],
        rationale: "对应原文第一段；作为基础确认，与 Q3 构成同貌不同构。",
      }),
      q({
        label: "Q2",
        type: "single_choice",
        stem: 'scores = {"A": [90]}\nview = scores\nview["A"].append(80)\nprint(scores["A"])\n\n输出是？',
        options: [
          { key: "A", text: "[90]" },
          { key: "B", text: "[90, 80]" },
          { key: "C", text: "[80]" },
          { key: "D", text: "报错" },
        ],
        answer: "B",
        explanation: "view 和 scores 是同一个字典，字典里的列表也是同一个；原地 append 两边可见。",
        kp_ids: ["K1", "K2"],
        target_ability: "迁移",
        role: "unlabeled_recognition",
        difficulty_source: "情境从列表换成字典里装列表，需要自己认出是同一原理。",
        diagnostic_purpose: "同构不同貌：检验 K1 是否只在列表上被纠正过。",
        error_map: [
          { wrong_answer: "A", misconception_id: "M1", reasoning: "以为 view 是 scores 的副本。" },
          { wrong_answer: "C", misconception_id: "M3", reasoning: "以为 append 会替换原列表内容。" },
        ],
        paired_with: ["Q1"],
        rationale: "原文只讲了列表；换成字典考迁移，积木仍在材料内。",
      }),
      q({
        label: "Q3",
        stem: "下面的代码输出什么？\n\nx = [1, 2]\ny = x\ny += [3]\nprint(x)",
        answer: "[1, 2]",
        explanation: "y 被重新绑定到新列表，x 仍指向旧列表。",
        kp_ids: ["K1", "K2"],
        target_ability: "推理",
        role: "confusable_pair",
        difficulty_source: "区分原地修改与重新绑定。",
        diagnostic_purpose: "区分“懂原地修改 vs 重新绑定” 与 “把重新赋值当成原地修改”。",
        error_map: [{ wrong_answer: "[1, 2, 3]", misconception_id: "M3", reasoning: "以为 y 的改动会反映到 x。" }],
        paired_with: ["Q1"],
        rationale: "与 Q1 长得几乎一样，原理不同。",
      }),
      q({
        label: "Q4",
        stem: "下面的代码输出什么？\n\na = [[1], [2]]\nb = a.copy()\nb[0].append(9)\nprint(a)",
        answer: "[[1, 9], [2]]",
        accepted_answers: ["[[1,9],[2]]"],
        explanation: "copy() 只复制外层；b[0] 和 a[0] 是同一个内层列表。",
        kp_ids: ["K3"],
        target_ability: "推理",
        role: "sentinel",
        difficulty_source: "要看穿 copy() 只复制一层。",
        diagnostic_purpose: "哨兵：检验“浅拷贝共享内层”是否真的成立。",
        error_map: [{ wrong_answer: "[[1], [2]]", misconception_id: "M2", reasoning: "以为 copy() 连内层也复制了。" }],
        paired_with: ["Q5"],
        rationale: "原文第二段的核心句。",
      }),
      q({
        label: "Q5",
        stem: "下面的代码输出什么？\n\na = [[1], [2]]\nb = a.copy()\nb.append([3])\nprint(len(a))",
        answer: "2",
        explanation: "外层是新列表，往 b 的外层 append 不影响 a。",
        kp_ids: ["K3"],
        target_ability: "推理",
        role: "confusable_pair",
        difficulty_source: "要区分外层（新的）与内层（共享的）。",
        diagnostic_purpose: "与 Q4 配对：两题合起来区分 M1 / M2 / 掌握。",
        error_map: [{ wrong_answer: "3", misconception_id: "M1", reasoning: "以为 copy() 返回的还是同一个对象。" }],
        paired_with: ["Q4"],
        rationale: "Q4 错、Q5 对 → M2；两题都错 → M1。",
      }),
      q({
        label: "Q6",
        stem: "下面的代码输出什么？\n\na = [[0]]\nb = a.copy()\nprint(a is b, a[0] is b[0])",
        answer: "False True",
        accepted_answers: ["False, True", "(False, True)"],
        explanation: "外层是新对象（False），内层是同一个对象（True）。",
        kp_ids: ["K3", "K4"],
        target_ability: "应用",
        role: "synthesis",
        difficulty_source: "同时运用浅拷贝和 is 的含义。",
        diagnostic_purpose: "综合 K3 + K4。",
        error_map: [
          { wrong_answer: "False False", misconception_id: "M2", reasoning: "以为内层也复制了。" },
          { wrong_answer: "True True", misconception_id: "M1", reasoning: "以为 copy() 返回同一个对象。" },
        ],
        paired_with: ["Q4"],
        rationale: "把 K3 和 K4 放进同一个情境。",
      }),
      q({
        label: "Q7",
        type: "open_explain",
        stem: "有人说：“用了 a.copy() 之后，a 和 b 就完全没关系了。”用一两句话指出这句话哪里对、哪里不对。",
        answer: "外层列表确实是新的（对外层增删互不影响）；但内层对象仍然共享，改内层列表两边都会变。",
        explanation: "浅拷贝 = 新外层 + 共享内层。",
        kp_ids: ["K3"],
        target_ability: "纠错",
        role: "transfer",
        difficulty_source: "要能把浅拷贝的两面说清楚。",
        diagnostic_purpose: "区分“能说清新外层/共享内层” 与 “以为完全独立”。",
        error_map: [{ wrong_answer: "这句话是对的，copy 之后完全独立", misconception_id: "M2", reasoning: "以为 copy 是完全独立的副本。" }],
        paired_with: [],
        rationale: "纠错题：让学生直接面对这个误解的说法。",
      }),
    ],
    notes: "（mock）Q6 把两个判断放在一个答案里，前半对后半错时只能判错——真实出题时应拆开。",
  };
}

const REVISED_Q3: QuestionDraft = {
  ...mockGenerate().questions[2],
  stem: "下面的代码输出什么？\n\nx = [1, 2]\ny = x\ny = y + [3]\nprint(x)",
  explanation: "y + [3] 先造了一个新列表，再让 y 这张标签贴过去；x 还贴在旧列表上。",
};

export function mockSolve(questions: Question[]) {
  return {
    answers: questions.map((item) =>
      item.stem.includes("+=")
        ? { label: item.label, answer: "[1, 2, 3]", reasoning: "列表的 += 会原地扩展 y 指向的同一个列表，所以 x 也变了。" }
        : { label: item.label, answer: item.answer, reasoning: "（mock）逐行执行得到。" },
    ),
  };
}

export function mockReview(questions: Question[], round: number): { reviews: ReviewItem[]; overall: string } {
  return {
    reviews: questions.map((item) =>
      round === 1 && item.stem.includes("+=")
        ? {
            label: item.label,
            solver_agrees: false,
            solver_mismatch_judgement: "题有问题：列表的 += 是原地修改（等价于 extend），标准答案 [1, 2] 是错的，solver 的 [1, 2, 3] 才对。",
            issues: [
              { kind: "wrong_answer", detail: "对列表，y += [3] 原地修改，x 会变成 [1, 2, 3]。" },
              { kind: "off_target", detail: "+= 对列表的行为在材料边界之外（地图已标注避免出题）。" },
            ],
            verdict: "revise",
            revised_question: REVISED_Q3,
            surface_checks: { correctness: "原答案错误", purity: "混入了材料外的 += 行为" },
          }
        : {
            label: item.label,
            solver_agrees: true,
            solver_mismatch_judgement: "",
            issues: [],
            verdict: "keep",
            revised_question: null,
            surface_checks: { correctness: "已按代码逐行验证", unambiguous: "无歧义" },
          },
    ),
    overall: "（mock）整体可用；Q3 已修正。",
  };
}

export function mockGrade(items: { question: Question; answer: string }[]) {
  return {
    gradings: items.map(({ question, answer }) => {
      const ok = /内层|共享|shared|inner/i.test(answer) && question.type === "open_explain";
      const matched = !ok && /完全|独立|没关系/.test(answer) ? question.error_map[0]?.wrong_answer ?? "" : "";
      return {
        label: question.label,
        correct: ok ? "true" : "false",
        rationale: ok ? "（mock）提到了内层共享。" : "（mock）没有抓住“内层共享”这一要点。",
        matched_wrong_answer: matched,
      };
    }),
  };
}

/** mock 诊断：用简单规则从作答数据推出诊断，保证整条流程不花钱也能走通。 */
export function mockDiagnose(
  map: MaterialMapData,
  questions: Question[],
  responses: ResponseRecord[],
  gradings: Grading[],
  check: ErrorMapCheck,
): DiagnosisOutput {
  const rByQ = new Map(responses.map((r) => [r.question_id, r]));
  const gByQ = new Map(gradings.map((g) => [g.question_id, g]));
  const right = questions.filter((x) => gByQ.get(x.id)?.correct === "true");
  const wrong = questions.filter((x) => gByQ.get(x.id)?.correct !== "true");
  const byMis = new Map<string, string[]>();
  for (const h of check.hit) byMis.set(h.misconception_id, [...(byMis.get(h.misconception_id) ?? []), h.label]);
  const misText = (id: string) => map.misconceptions.find((m) => m.id === id)?.description ?? id;
  const rank = { sure: 0, unsure: 1, guess: 2 } as const;
  return {
    observations: [
      { text: `答对：${right.map((x) => x.label).join("、") || "无"}；答错：${wrong.map((x) => x.label).join("、") || "无"}。`, question_labels: questions.map((x) => x.label) },
      ...wrong
        .filter((x) => rByQ.get(x.id)?.confidence === "sure")
        .map((x) => ({ text: `${x.label} 错且标“稳”。`, question_labels: [x.label] })),
    ],
    inferences: [...byMis.entries()].map(([mid, labels]) => ({
      claim: `目前看来存在 ${mid}：${misText(mid)}`,
      kp_ids: map.misconceptions.find((m) => m.id === mid)?.kp_ids ?? [],
      misconception_id: mid,
      question_labels: labels,
      confidence: labels.length >= 2 ? "high" : "mid",
      confidence_reason: labels.length >= 2 ? `${labels.length} 道题互相印证。` : "仅一道题支持。",
      ruled_out: "",
    })),
    insufficient: check.unexpected.map((u) => ({ what: `${u.label} 的错答“${u.answer}”`, why: "不在错答地图里，原因未知，需要追问或补题。" })),
    error_map_commentary: check.unexpected.length ? "出现了预测外的错答，说明出题时对学生的理解有盲区。" : "没有预测外的错答。",
    lecture: wrong
      .slice()
      .sort((a, b) => rank[rByQ.get(a.id)?.confidence ?? "guess"] - rank[rByQ.get(b.id)?.confidence ?? "guess"])
      .map((x) => ({ question_label: x.label, old_picture: "（mock）旧画面在关键一步失效。", new_picture: x.explanation, walkthrough: `正确答案：${x.answer}` })),
    connections: "（mock）Q1 与 Q3 长得像、原理不同；Q1 与 Q2 情境不同、原理相同。",
    next_round: [...byMis.keys()].map((mid) => ({ focus: `换情境复测 ${mid}`, reason: misText(mid) })),
    student_state: map.knowledge_points.map((kp) => {
      const related = questions.filter((x) => x.kp_ids.includes(kp.id));
      const allRight = related.length > 0 && related.every((x) => gByQ.get(x.id)?.correct === "true");
      const anyWrong = related.some((x) => gByQ.get(x.id)?.correct !== "true");
      return {
        kp_id: kp.id,
        estimate: related.length === 0 ? "unknown" : allRight ? "mastered" : anyWrong && related.some((x) => gByQ.get(x.id)?.correct === "true") ? "shaky" : "not_mastered",
        evidence_question_labels: related.map((x) => x.label),
      };
    }),
    developer_notes: "（mock 诊断，由规则生成，不代表模型判断）",
  };
}
