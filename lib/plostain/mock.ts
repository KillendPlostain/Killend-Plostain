// mock provider 的固定输出：基于需求说明第 16 节的 Python 浅拷贝示例。
// 生成器故意埋了一个错（Q3 用了 y += [3]），用来检验审核能否发现并修改它。
import type {
  DiagnosisOutput,
  ErrorMapCheck,
  Grading,
  GeneratorOutput,
  KnowledgeAtlas,
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

/** 筑城者的固定对话：问三轮，第三轮复述目标，学生再回一句就收尾。 */
export function mockBuilder(messages: { role: "agent" | "user"; text: string }[]) {
  const turns = messages.filter((m) => m.role === "user").length;
  const first = messages.find((m) => m.role === "user")?.text.slice(0, 16) ?? "这件事";
  const script = [
    { reply: `（mock）你说想学“${first}”。学完以后，你想用它做成一件什么具体的事？`, move: "澄清" },
    { reply: "（mock）现在让你动手做这件事，你会先卡在哪一步？", move: "证据" },
    { reply: "（mock）我听到的是：你想能独立做出一个小作品，现在卡在第一步怎么开始。怎样算做到了——做出来给谁看？是这样吗？", move: "复述" },
  ];
  if (turns <= script.length) return { ...script[turns - 1], goal: null };
  return {
    reply: "（mock）好，目标记下了。",
    move: "收尾",
    goal: { topic: first, destination: "独立做出一个小作品", start: "不知道第一步怎么开始", evidence: "做出来并能讲清楚每一步", scope_out: "先不追求完美", first_step: "今天先照着例子做一遍" },
  };
}

/** 示例材料所在的主题全貌。map 里有、这里没提到的知识点，系统会自动补进图里。 */
export function mockAtlas(map: MaterialMapData): KnowledgeAtlas {
  const has = (id: string) => (map.knowledge_points.some((k) => k.id === id) ? [id] : []);
  const n = (id: string, parent: string, name: string, note: string, kp_ids: string[] = [], kind: "topic" | "prereq" | "extension" = "topic") => ({ id, parent, name, note, kp_ids, kind });
  return {
    title: "Python 的对象与引用",
    nodes: [
      n("N1", "", "列表基础", "学这份材料前应该已经会的。", [], "prereq"),
      n("N2", "N1", "创建与下标", "用下标读写列表元素。", [], "prereq"),
      n("N3", "N1", "append 等方法", "在原列表上增删元素。", [], "prereq"),
      n("N4", "N1", "嵌套列表", "列表里再装列表。", [], "prereq"),
      n("N5", "", "名字与对象", "变量名只是贴在对象上的标签。"),
      n("N6", "N5", "赋值是绑定", "b = a 让两个名字指向同一个对象。", has("K1")),
      n("N7", "N5", "身份与相等", "is 看是不是同一个对象，== 看值。", has("K4")),
      n("N8", "N5", "可变与不可变", "列表能原地改，整数和字符串不能。"),
      n("N9", "", "共享与修改", "多个名字指向同一个对象时会发生什么。"),
      n("N10", "N9", "原地修改", "通过任一名字修改，其他名字都看得到。", has("K2")),
      n("N11", "N9", "重新赋值", "让名字改指别的对象，原对象不变。"),
      n("N12", "N9", "函数传参", "参数也是绑定，函数里能改到外面的列表。", [], "extension"),
      n("N13", "", "复制", "怎样得到一个独立的副本。"),
      n("N14", "N13", "浅拷贝 copy()", "新的外层，内层仍然共享。", has("K3")),
      n("N15", "N13", "切片复制", "a[:] 也是浅拷贝。"),
      n("N16", "N13", "深拷贝 deepcopy", "连内层一起复制。", [], "extension"),
      n("N17", "", "延伸", "学完之后会遇到的相关问题。", [], "extension"),
      n("N18", "N17", "默认参数陷阱", "可变对象作默认值会被多次调用共享。", [], "extension"),
      n("N19", "N17", "引用计数", "没有名字指向的对象会被回收。", [], "extension"),
    ],
    sources: [],
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
  pair_group: "",
  pair_relation: "",
  rationale: "",
  check: { code: "", note: "" },
  ...d,
});

/** mock 的验算程序：运行题干里的代码，比对最后一行输出和标准答案。 */
function withOutputCheck(x: QuestionDraft): QuestionDraft {
  const code = x.stem.split(/\n\s*\n/)[1];
  if (x.type !== "short_answer" || !code) return x;
  return {
    ...x,
    check: {
      note: "运行题干代码，比对最后一行输出",
      code: [
        "import io, contextlib",
        "buf = io.StringIO()",
        "with contextlib.redirect_stdout(buf):",
        `    exec(${JSON.stringify(code)})`,
        "out = buf.getvalue().strip().splitlines()[-1]",
        "expected = ANSWER  # 系统自动提供的当前标准答案",
        'print("PASS" if out == expected else f"FAIL: 程序输出 {out!r}，标准答案是 {expected!r}")',
      ].join("\n"),
    },
  };
}

export function mockGenerate(): GeneratorOutput {
  const out: GeneratorOutput = {
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
        pair_group: "P1",
        pair_relation: "same_surface",
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
        pair_group: "P1",
        pair_relation: "same_surface",
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
        pair_group: "P2",
        pair_relation: "same_surface",
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
        pair_group: "P2",
        pair_relation: "same_surface",
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
  return { ...out, questions: out.questions.map(withOutputCheck) };
}

const REVISED_Q3: QuestionDraft = withOutputCheck({
  ...mockGenerate().questions[2],
  stem: "下面的代码输出什么？\n\nx = [1, 2]\ny = x\ny = y + [3]\nprint(x)",
  explanation: "y + [3] 先造了一个新列表，再让 y 这张标签贴过去；x 还贴在旧列表上。",
});

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
    headline: wrong.length ? `你有 ${wrong.length} 道题答错，最要紧的是：${misText(check.hit[0]?.misconception_id ?? "") || "错因还看不出"}` : "这一卷没有发现明显的缺口。",
    observations: [
      { text: `答对：${right.map((x) => x.label).join("、") || "无"}；答错：${wrong.map((x) => x.label).join("、") || "无"}。`, question_labels: questions.map((x) => x.label) },
      ...wrong
        .filter((x) => rByQ.get(x.id)?.confidence === "sure")
        .map((x) => ({ text: `${x.label} 错且标“稳”。`, question_labels: [x.label] })),
    ],
    inferences: [...byMis.entries()].map(([mid, labels]) => ({
      title: misText(mid).replace(/^学生/, ""),
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

/** mock 补题：每个没覆盖的知识点出一道简单的短答题。 */
export function mockSupplement(map: MaterialMapData, uncoveredKpIds: string[]): GeneratorOutput {
  return {
    coverage_table: [],
    questions: uncoveredKpIds.map((id, i) =>
      q({
        label: `S${i + 1}`,
        stem: `（mock 补题）请用一句话说明：${map.knowledge_points.find((k) => k.id === id)?.name ?? id}`,
        answer: "（见材料）",
        type: "open_explain",
        kp_ids: [id],
        role: "basic_check",
        diagnostic_purpose: "补齐覆盖",
        rationale: `补题：${id} 原来没有题测到`,
      }),
    ),
    notes: "（mock）补题",
  };
}
