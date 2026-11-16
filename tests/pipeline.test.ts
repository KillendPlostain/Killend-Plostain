// 用 mock provider 跑完整流程：材料 → 地图 → 出题 → 审核 → 编辑 → 作答 → 批改 → 诊断。
// 运行：npm test（Node 自带测试器 + 内存 SQLite，不花钱、不联网）
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { PlostainConfig } from "../lib/plostain/config.ts";
import { Store, type Sql } from "../lib/plostain/store.ts";
import * as pipeline from "../lib/plostain/pipeline.ts";
import { SAMPLE_MATERIAL, mockAtlas, mockMap } from "../lib/plostain/mock.ts";
import { fallbackAtlas, layoutAtlas, normalizeAtlas } from "../lib/plostain/atlas.ts";
import { checkErrorMap, normalizeAnswer } from "../lib/plostain/grading.ts";
import { resolveRole } from "../lib/plostain/config.ts";
import realConfig from "../plostain.config.ts";
import { runChecks } from "../scripts/verify-runner.mjs";
import { lintQuestions } from "../lib/plostain/lint.ts";
import { splitMath } from "../app/views/math-text.ts";

function memorySql(): Sql {
  const db = new DatabaseSync(":memory:");
  const norm = (ps: unknown[]) => ps.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : p)) as never[];
  return {
    async run(q, ps = []) {
      db.prepare(q).run(...norm(ps));
    },
    async all<T>(q: string, ps: unknown[] = []) {
      return db.prepare(q).all(...norm(ps)) as T[];
    },
  };
}

const mockConfig: PlostainConfig = {
  ...realConfig,
  roles: Object.fromEntries(Object.keys(realConfig.roles).map((r) => [r, { provider: "mock", model: "mock" }])) as PlostainConfig["roles"],
};

// 验算用真实的沙箱 Python（Pyodide）运行，不经过本机桥
function makeCtx(): pipeline.Ctx {
  return { config: mockConfig, env: {}, store: new Store(memorySql()), runChecks };
}

async function answerSheet(ctx: pipeline.Ctx, setId: string, answers: Record<string, [string, "sure" | "unsure" | "guess"]>) {
  const view = (await pipeline.getSetView(ctx, setId, "student")) as { questions: { id: string; label: string }[] };
  return view.questions.map((q) => ({ question_id: q.id, answer: answers[q.label]?.[0] ?? "", confidence: answers[q.label]?.[1] ?? "guess" }));
}

test("自测模式：从粘贴材料走到诊断结果", async () => {
  const ctx = makeCtx();
  const { material, map } = await pipeline.createMaterial(ctx, { title: "浅拷贝", text: SAMPLE_MATERIAL, mode: "self", objective: "quick_diagnosis" });
  assert.equal(map.data.knowledge_points.length, 4);

  // 自测模式：学生看的地图不含易错处
  const mv = await pipeline.getMaterialView(ctx, material.id);
  assert.equal(mv.map?.data.misconceptions.length, 0);
  assert.equal(mv.map?.misconceptions_hidden, 4);

  const set = await pipeline.generateSet(ctx, { materialId: material.id });
  assert.equal(set.status, "generated");
  const reviewed = await pipeline.reviewSet(ctx, set.id);
  assert.equal(reviewed.status, "published", "自测模式审核后自动发布");

  // 审核发现了埋下的错误（Q3 的 +=）并修改
  const reviews = await ctx.store.getReviews(set.id);
  assert.ok(reviews.some((r) => r.round === 1 && r.data.verdict === "revise" && r.data.issues.some((i) => i.kind === "wrong_answer")));
  const q3 = (await ctx.store.getQuestions(set.id)).find((q) => q.label === "Q3")!;
  assert.equal(q3.status, "revised");
  assert.ok(q3.stem.includes("y = y + [3]") && !q3.stem.includes("+="));
  assert.ok(reviews.some((r) => r.round === 2 && r.question_id === q3.id), "修订稿再过一轮审核");

  // 学生视图不含答案和设计卡；教师视图在自测模式交卷前被拒绝
  const student = await pipeline.getSetView(ctx, set.id, "student");
  const leaked = JSON.stringify(student);
  for (const secret of ["answer", "error_map", "diagnostic_purpose", "explanation"]) assert.ok(!leaked.includes(`"${secret}"`), `学生视图泄露了 ${secret}`);
  await assert.rejects(pipeline.getSetView(ctx, set.id, "teacher"), /交卷后才解锁/);

  // 缺信心标记不能交卷
  const sheet = await answerSheet(ctx, set.id, {
    Q1: ["[1, 2, 3]", "sure"],
    Q2: ["B", "unsure"],
    Q3: ["[1, 2, 3]", "sure"], // 命中 M3
    Q4: ["[[1], [2]]", "unsure"], // 命中 M2
    Q5: ["2", "sure"],
    Q6: ["False False", "guess"], // 命中 M2
    Q7: ["copy 之后外层是新的，但内层列表还是共享的", "sure"],
  });
  await assert.rejects(pipeline.submitSet(ctx, set.id, { answers: sheet.map((a, i) => (i === 0 ? { ...a, confidence: "" } : a)) }), /信心/);

  const diagnosis = await pipeline.submitSet(ctx, set.id, { answers: sheet, total_minutes: 12 });
  const gradings = await ctx.store.getGradings(set.id);
  assert.equal(gradings.filter((g) => g.correct === "true").length, 4);
  assert.ok(gradings.some((g) => g.method === "model"), "简述题走模型批改");

  // 错答地图对照
  assert.deepEqual(diagnosis.error_map_check.hit.map((h) => h.label).sort(), ["Q3", "Q4", "Q6"]);
  assert.equal(diagnosis.error_map_check.unexpected.length, 0);
  assert.equal(diagnosis.error_map_check.hit_rate, 1);
  // 每条推测都有证据题；单题支持的不超过“中”
  for (const inf of diagnosis.inferences) {
    assert.ok(inf.question_labels.length >= 1);
    if (inf.question_labels.length === 1) assert.notEqual(inf.confidence, "high");
  }
  assert.ok(diagnosis.inferences.some((i) => i.misconception_id === "M2" && i.confidence === "high"));

  // 交卷后：结果视图可看；设计卡只读；不能再次作答
  const result = (await pipeline.getSetView(ctx, set.id, "result")) as { diagnosis: unknown; responses: unknown[] };
  assert.ok(result.diagnosis);
  assert.equal(result.responses.length, 7);
  const q1 = (await ctx.store.getQuestions(set.id))[0];
  await assert.rejects(ctx.store.updateQuestion({ ...q1, answer: "改答案" }), /封存/);
  await assert.rejects(pipeline.submitSet(ctx, set.id, { answers: sheet }), /交过/);

  // 调用日志：每个角色都有记录
  const roles = new Set((await ctx.store.listCalls()).map((c) => c.role));
  for (const r of ["mapper", "generator", "solver", "reviewer", "grader", "diagnostician"]) assert.ok(roles.has(r as never), `缺少 ${r} 的日志`);

  // 按建议再出一卷：上一轮建议作为额外输入
  const next = await pipeline.generateSet(ctx, { materialId: material.id, parentSetId: set.id });
  assert.equal(next.parent_set_id, set.id);
  assert.ok(next.objective.extra_focus?.length);

  // 历史列表
  const history = await pipeline.getHistory(ctx);
  assert.equal(history.length, 2);
});

test("教师模式：审题、编辑、删除、单题重出，改动被保存", async () => {
  const ctx = makeCtx();
  const { material, map } = await pipeline.createMaterial(ctx, { text: SAMPLE_MATERIAL, mode: "teacher" });
  assert.equal(map.data.misconceptions.length, 4, "教师模式看得到易错处");
  const set = await pipeline.generateSet(ctx, { materialId: material.id });
  const reviewed = await pipeline.reviewSet(ctx, set.id);
  assert.equal(reviewed.status, "reviewed", "教师模式审核后停在审题页");
  await assert.rejects(pipeline.getSetView(ctx, set.id, "student"), /还没发布/);

  const teacher = (await pipeline.getSetView(ctx, set.id, "teacher")) as { questions: { id: string; label: string; status: string }[] };
  const q1 = teacher.questions.find((q) => q.label === "Q1")!;
  const q2 = teacher.questions.find((q) => q.label === "Q2")!;
  const q6 = teacher.questions.find((q) => q.label === "Q6")!;

  const edited = await pipeline.editQuestion(ctx, set.id, q1.id, { stem: "改过的题干：\na = [1]\nb = a\nb.append(2)\nprint(a)", answer: "[1, 2]" });
  assert.equal(edited.status, "teacher_edited");
  assert.equal((await ctx.store.getQuestion(q1.id))?.answer, "[1, 2]");

  await pipeline.dropQuestion(ctx, set.id, q2.id);
  assert.equal((await ctx.store.getQuestion(q2.id))?.status, "dropped");

  const fresh = await pipeline.regenerateQuestion(ctx, set.id, q6.id, "拆成两问");
  assert.ok(fresh && fresh.id !== q6.id && fresh.label === "Q6");
  assert.equal((await ctx.store.getQuestion(q6.id))?.status, "dropped");
  assert.ok((await ctx.store.getReviews(set.id)).some((r) => r.question_id === fresh!.id), "重出的题也过了审核");

  await pipeline.publishSet(ctx, set.id);
  const student = (await pipeline.getSetView(ctx, set.id, "student")) as { questions: unknown[] };
  assert.equal(student.questions.length, 6);
});

test("材料过长直接拒绝，不截断", async () => {
  const ctx = makeCtx();
  await assert.rejects(pipeline.createMaterial(ctx, { text: "字".repeat(mockConfig.limits.materialMaxChars + 1) }), /超过上限/);
  await assert.rejects(pipeline.createMaterial(ctx, { text: "太短" }), /太短/);
});

test("诊断规则兜底：无证据移入证据不足，单题高置信度降为中", () => {
  const qs = [{ label: "Q1" }, { label: "Q2" }] as never[];
  const out = pipeline.enforceDiagnosisRules(
    {
      headline: "",
      observations: [],
      inferences: [
        { title: "", claim: "A", kp_ids: [], misconception_id: "", question_labels: ["Q9"], confidence: "high", confidence_reason: "", ruled_out: "" },
        { title: "", claim: "B", kp_ids: [], misconception_id: "", question_labels: ["Q1"], confidence: "high", confidence_reason: "", ruled_out: "" },
        { title: "", claim: "C", kp_ids: [], misconception_id: "", question_labels: ["Q1", "Q2"], confidence: "high", confidence_reason: "", ruled_out: "" },
      ],
      insufficient: [],
      error_map_commentary: "",
      lecture: [],
      connections: "",
      next_round: [],
      student_state: [],
      developer_notes: "",
    },
    qs,
  );
  assert.deepEqual(out.inferences.map((i) => [i.claim, i.confidence]), [["B", "mid"], ["C", "high"]]);
  assert.equal(out.insufficient[0].what, "A");
  assert.equal(out.rule_adjustments.length, 2);
});

test("答案归一化与错答对照", () => {
  assert.equal(normalizeAnswer(" [1, 2, 3]。"), normalizeAnswer("[1,2,3]"));
  assert.notEqual(normalizeAnswer("[1,2]"), normalizeAnswer("[12]"));
  const q = { id: "x", label: "Q1", type: "short_answer", answer: "2", accepted_answers: [], error_map: [{ wrong_answer: "3", misconception_id: "M1", reasoning: "" }] } as never;
  const check = checkErrorMap([q], [{ question_id: "x", answer: "5", confidence: "sure", submitted_at: "" }], [
    { question_id: "x", correct: "false", method: "model", rationale: "", matched_wrong_answer: "" },
  ]);
  assert.deepEqual(check.unexpected, [{ label: "Q1", answer: "5" }]);
  assert.equal(check.missed.length, 1);
});

test("只改配置就能换模型", () => {
  const cfg: PlostainConfig = { ...realConfig, roles: { ...realConfig.roles, solver: { provider: "fable", model: "claude-sonnet-5" } } };
  const r = resolveRole(cfg, "solver", {});
  assert.equal(r.provider.kind, "anthropic_api");
  assert.equal(r.model.model, "claude-sonnet-5");
  assert.equal(resolveRole(cfg, "solver", { PLOSTAIN_PROVIDER: "mock" }).provider.kind, "mock");
});

test("主模型失败时改用备用模型；出题失败不留空卷", async () => {
  // 主模型用一个缺密钥的 provider（必定失败），备用用 mock
  const cfg: PlostainConfig = {
    ...mockConfig,
    roles: { ...mockConfig.roles, generator: { provider: "glm", model: "x", fallback: { provider: "mock", model: "mock" } } },
  };
  const ctx: pipeline.Ctx = { config: cfg, env: {}, store: new Store(memorySql()) };
  const { material } = await pipeline.createMaterial(ctx, { text: SAMPLE_MATERIAL });
  const set = await pipeline.generateSet(ctx, { materialId: material.id });
  assert.ok((await ctx.store.getQuestions(set.id)).length > 0, "备用模型出了题");
  const versions = (await ctx.store.listCalls()).filter((c) => c.role === "generator").map((c) => c.prompt_version);
  assert.ok(versions.some((v) => v.includes("fallback")), "日志里有备用模型的记录");

  // 没有备用、主模型失败 → 报错，并且不留下空卷
  const noFallback: pipeline.Ctx = { ...ctx, config: { ...cfg, roles: { ...cfg.roles, generator: { provider: "glm", model: "x" } } } };
  await assert.rejects(pipeline.generateSet(noFallback, { materialId: material.id }), /模型调用失败/);
  assert.equal((await ctx.store.listSetsForMaterial(material.id)).length, 1);
});

test("能从夹杂代码块的输出里读出 JSON", async () => {
  const { extractJson } = await import("../lib/plostain/llm.ts");
  // 模拟模型输出：JSON 字符串里的换行是转义的 \n，里面夹着 ```python 代码块
  const withCode = JSON.stringify({ q: "下面代码打印什么？\n```python\nprint(1)\n```" });
  assert.deepEqual(extractJson(withCode), { q: "下面代码打印什么？\n```python\nprint(1)\n```" });
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('好的，结果如下：\n{"a": 2}'), { a: 2 });
  assert.throws(() => extractJson(""), /空内容/);
});

test("导出：教师模式带答案解析；自测模式交卷前只给题目", async () => {
  const ctx = makeCtx();
  const t = await pipeline.createMaterial(ctx, { text: SAMPLE_MATERIAL, mode: "teacher" });
  const ts = await pipeline.generateSet(ctx, { materialId: t.material.id });
  await assert.rejects(pipeline.getPrintView(ctx, ts.id), /还没审核完/);
  await pipeline.reviewSet(ctx, ts.id);
  const tv = await pipeline.getPrintView(ctx, ts.id);
  assert.equal(tv.answersAllowed, true);
  assert.ok(tv.questions.every((q) => "answer" in q && "explanation" in q));
  assert.ok(!JSON.stringify(tv).includes("error_map"), "导出不含设计卡");

  const s = await pipeline.createMaterial(ctx, { text: SAMPLE_MATERIAL, mode: "self" });
  const ss = await pipeline.generateSet(ctx, { materialId: s.material.id });
  await pipeline.reviewSet(ctx, ss.id);
  const sv = await pipeline.getPrintView(ctx, ss.id);
  assert.equal(sv.answersAllowed, false);
  assert.ok(sv.questions.every((q) => !("answer" in q)), "自测模式交卷前不泄露答案");
});

test("覆盖检查：地图只读了前面会自动重画；漏掉的主干知识点会自动补题", async () => {
  const { anchorPositions, coverageReport } = await import("../lib/plostain/coverage.ts");
  const ctx = makeCtx();
  // 材料后面接一大段新内容，而 mock 地图的锚点全在开头 → 触发“只读了前面”
  const tail = "\n\n后半部分：文件读取。open(\"data.txt\", \"r\", encoding=\"utf-8\") 打开文件，for line in f 逐行读，split() 按空格切开。".repeat(40) + "\n\n最后：文件用完要调用 f.close() 关闭。";
  const { material, map } = await pipeline.createMaterial(ctx, { text: SAMPLE_MATERIAL + tail, mode: "teacher" });
  const mapperCalls = (await ctx.store.listCalls()).filter((c) => c.role === "mapper");
  assert.equal(mapperCalls.length, 2, "自动重画了一次");
  assert.ok(map.warnings?.some((w) => w.includes("前")), "重画后仍不完整，留下提示");

  // 给地图加一个后半段的主干知识点 K5，原卷没有题测它 → 全面练习会自动补题
  const k5 = { id: "K5", name: "关闭文件", summary: "", anchor: "文件用完要调用 f.close() 关闭", tier: "core" as const };
  const map2 = await ctx.store.saveMap({ ...map, data: { ...map.data, knowledge_points: [...map.data.knowledge_points, k5] } });
  const pos = anchorPositions(material.text, map2.data);
  assert.ok((pos.get("K5") ?? 0) > 0.9, "能在原文末尾定位到 K5");
  const set = await pipeline.generateSet(ctx, { materialId: material.id, mapId: map2.id, objective: "comprehensive" });
  const qs = await ctx.store.getQuestions(set.id);
  assert.ok(qs.some((q) => q.kp_ids.includes("K5")), "补出了测 K5 的题");
  assert.deepEqual(qs.map((q) => q.label), qs.map((_, i) => `Q${i + 1}`), "题号连续");
  assert.ok(set.prompt_versions.supplement, "记录了补题提示词版本");
  const report = coverageReport(material.text, map2.data, qs);
  assert.equal(report.core_covered, report.core_total);
  assert.ok(report.segments[2].questions > 0, "材料后段有题");
});

test("完整练习：从易到难排序，题号和配对关系同步", async () => {
  const ctx = makeCtx();
  const { material } = await pipeline.createMaterial(ctx, { text: SAMPLE_MATERIAL, mode: "teacher" });
  const set = await pipeline.generateSet(ctx, { materialId: material.id, objective: "complete" });
  const qs = await ctx.store.getQuestions(set.id);
  const rank: Record<string, number> = { basic_check: 0, sentinel: 0, unlabeled_recognition: 1, confusable_pair: 2, transfer: 3, synthesis: 4 };
  const ranks = qs.map((q) => rank[q.role]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "难度不递减");
  const labels = new Set(qs.map((q) => q.label));
  assert.ok(qs.every((q) => q.paired_with.every((l) => labels.has(l))), "配对题号都还有效");
  // mock 的 Q3（易混淆）原本和 Q1（基础确认）配对：重排后仍指向同一道题
  const pairQ = qs.find((q) => q.stem.includes("y = x") || q.stem.includes("y += [3]"))!;
  const partner = qs.find((q) => q.label === pairQ.paired_with[0])!;
  assert.ok(partner.stem.includes("b.append(3)"), "配对关系没被打乱");
});

test("程序验算：沙箱里运行验算程序，发现埋下的错误答案；修订后重新验算通过", async () => {
  const ctx = makeCtx();
  const { material } = await pipeline.createMaterial(ctx, { text: SAMPLE_MATERIAL, mode: "teacher" });
  const set = await pipeline.generateSet(ctx, { materialId: material.id });
  await pipeline.reviewSet(ctx, set.id);
  const qs = await ctx.store.getQuestions(set.id);
  const byLabel = Object.fromEntries(qs.map((q) => [q.label, q]));
  // Q3 原稿用了 y += [3]，答案写成 [1, 2]：验算程序会算出 [1, 2, 3] → FAIL。审核修订后再验算 → PASS
  const reviews = await ctx.store.getReviews(set.id);
  assert.equal(byLabel.Q3.status, "revised");
  assert.equal(byLabel.Q3.verification?.status, "pass", "修订后的 Q3 验算通过");
  assert.ok(reviews.some((r) => r.question_id === byLabel.Q3.id && r.round === 2), "修订稿重新审核过");
  assert.equal(byLabel.Q1.verification?.status, "pass");
  assert.equal(byLabel.Q2.verification?.status, "none", "单选题 mock 没写验算程序");
  // 教师改了答案 → 自动重新验算，并且发现改错了
  const edited = await pipeline.editQuestion(ctx, set.id, byLabel.Q1.id, { answer: "[1, 2]" });
  assert.equal(edited.verification?.status, "fail");
  assert.match(edited.verification?.detail ?? "", /\[1, 2, 3\]/);
});

test("程序检查：选项数、伪变式、对照组、公式写法", () => {
  const base = {
    type: "short_answer" as const, options: [], answer: "1", accepted_answers: [], explanation: "", kp_ids: ["K1"],
    target_ability: "理解" as const, role: "basic_check" as const, difficulty_source: "", diagnostic_purpose: "",
    error_map: [], paired_with: [], pair_group: "", pair_relation: "" as const, rationale: "", check: { code: "", note: "" },
  };
  const opt = (n: number) => Array.from({ length: n }, (_, i) => ({ key: "ABCDE"[i], text: String(i) }));
  const r = lintQuestions(
    [
      { ...base, label: "Q1", stem: "计算 $2^3$", pair_group: "P1", pair_relation: "same_surface" },
      { ...base, label: "Q2", stem: "计算 $5^7$", pair_group: "P1", pair_relation: "same_surface" }, // 只换数字
      { ...base, label: "Q3", stem: "计算 x³ + x³", pair_group: "P2", pair_relation: "same_principle" }, // 上标字符；组里只有一题
      { ...base, label: "Q4", type: "single_choice", stem: "选一个", options: opt(4) },
      { ...base, label: "Q5", type: "single_choice", stem: "再选一个", options: opt(5) },
      { ...base, label: "Q6", stem: "求 a^(2m+3n) 的值" },
    ],
    "comprehensive",
  );
  assert.ok(r.perQuestion.Q2?.some((m) => m.includes("伪变式")));
  assert.ok(r.perQuestion.Q3?.some((m) => m.includes("上标字符")));
  assert.ok(r.perQuestion.Q3?.some((m) => m.includes("只有这一道题")));
  assert.ok(r.perQuestion.Q5?.some((m) => m.includes("5 个选项")));
  assert.ok(r.perQuestion.Q6?.some((m) => m.includes("公式外面")));
  assert.ok(r.setLevel.some((m) => m.includes("选项数不一致")));
  assert.ok(r.setLevel.some((m) => m.includes("对照组只有")));
  assert.equal(r.perQuestion.Q1, undefined, "正常的题不报");
});

test("公式切分：$…$ 行内、$$…$$ 独占一行、\$ 是普通美元符号", () => {
  const parts = splitMath("计算 $x^{2}$，再看 $$\frac{1}{2}$$ 价格 \$5");
  assert.deepEqual(parts, [
    { math: false, text: "计算 " },
    { math: true, display: false, text: "x^{2}" },
    { math: false, text: "，再看 " },
    { math: true, display: true, text: "\frac{1}{2}" },
    { math: false, text: " 价格 $5" },
  ]);
});

test("知识体系图：每个材料知识点恰好挂在一个节点上，材料之外的节点不带知识点", async () => {
  const ctx = makeCtx();
  const { material, map } = await pipeline.createMaterial(ctx, { title: "浅拷贝", text: SAMPLE_MATERIAL, mode: "self" });
  assert.equal(map.atlas, undefined, "地图刚生成时还没有体系图");
  const withAtlas = await pipeline.buildAtlas(ctx, material.id);
  const atlas = withAtlas.atlas!;
  const placed = atlas.nodes.flatMap((n) => n.kp_ids).sort();
  assert.deepEqual(placed, ["K1", "K2", "K3", "K4"]);
  assert.ok(atlas.nodes.some((n) => !n.kp_ids.length), "有材料之外的节点");
  assert.equal(withAtlas.atlas_meta?.searched, false, "mock 不联网");
  assert.ok((await ctx.store.listCalls()).some((c) => c.role === "cartographer"));
  // 已经有图：不再调用模型
  await pipeline.buildAtlas(ctx, material.id);
  assert.equal((await ctx.store.listCalls()).filter((c) => c.role === "cartographer").length, 1);
  // 出卷后，材料视图里带着“这张卷考到了哪些知识点”
  const set = await pipeline.generateSet(ctx, { materialId: material.id });
  const view = await pipeline.getMaterialView(ctx, material.id);
  assert.ok(view.lit[set.id].length > 0);
});

test("平原：筑城者问到目标确认后才给出目标；日志里有交卷记录和记下的目标", async () => {
  const ctx = makeCtx();
  await assert.rejects(() => pipeline.builderChat(ctx, { messages: [{ role: "agent", text: "你想学会什么？" }] }), /先说点什么/);
  const messages: { role: "agent" | "user"; text: string }[] = [{ role: "agent", text: "你想学会什么？" }];
  let goal = null;
  for (const text of ["我想学 Python", "做个小工具", "不知道从哪开始", "是的"]) {
    messages.push({ role: "user", text });
    const out = await pipeline.builderChat(ctx, { messages });
    messages.push({ role: "agent", text: out.reply });
    if (text !== "是的") assert.equal(out.goal, null, "学生确认之前不给目标");
    goal = out.goal;
  }
  assert.ok(goal?.topic);
  await pipeline.addGoalToJournal(ctx, goal);
  await assert.rejects(() => pipeline.addGoalToJournal(ctx, { topic: "" }), /不完整/);

  // 做完一张卷，日志里多一条交卷记录
  const { material } = await pipeline.createMaterial(ctx, { title: "浅拷贝", text: SAMPLE_MATERIAL, mode: "self", objective: "quick_diagnosis" });
  const set = await pipeline.generateSet(ctx, { materialId: material.id });
  await pipeline.reviewSet(ctx, set.id);
  await pipeline.submitSet(ctx, set.id, { answers: await answerSheet(ctx, set.id, {}), total_minutes: 5 });
  const journal = await pipeline.getJournal(ctx);
  assert.deepEqual(journal.map((e) => e.kind).sort(), ["goal", "study"]);
  const study = journal.find((e) => e.kind === "study")!;
  assert.equal(study.title, "浅拷贝");
  assert.equal(study.set_id, set.id);
  assert.ok(study.lines.some((l) => l.key === "做了"));
});

test("知识体系图：模型画错的地方会被修好，排版后节点互不重叠", () => {
  const map = mockMap();
  const raw = {
    title: "",
    nodes: [
      { id: "A", parent: "B", name: "甲", note: "", kp_ids: ["K1", "K9"], kind: "topic" as const }, // 和 B 互为上级（成环）；K9 不存在
      { id: "B", parent: "A", name: "乙", note: "", kp_ids: ["K1"], kind: "topic" as const }, // K1 重复
      { id: "B", parent: "", name: "重复编号", note: "", kp_ids: [], kind: "topic" as const },
      { id: "C", parent: "不存在", name: "丙", note: "", kp_ids: [], kind: "extension" as const },
      { id: "D", parent: "C", name: "", note: "", kp_ids: ["K2"], kind: "topic" as const }, // 没有名字
    ],
    sources: [{ title: "x", url: "javascript:alert(1)" }, { title: "", url: "https://example.com/a" }],
  };
  const atlas = normalizeAtlas(raw, map, "浅拷贝");
  assert.equal(atlas.title, "浅拷贝");
  assert.deepEqual(atlas.nodes.flatMap((n) => n.kp_ids).sort(), ["K1", "K2", "K3", "K4"], "漏掉的知识点自动补上，重复和不存在的去掉");
  const ids = new Set(atlas.nodes.map((n) => n.id));
  assert.equal(ids.size, atlas.nodes.length);
  for (const n of atlas.nodes) assert.ok(n.parent === "" || ids.has(n.parent));
  // 没有环：顺着上级一定能走到头
  for (const n of atlas.nodes) {
    let steps = 0;
    for (let p = n.parent; p; p = atlas.nodes.find((x) => x.id === p)!.parent) assert.ok(++steps < 10);
  }
  assert.deepEqual(atlas.sources.map((s) => s.url), ["https://example.com/a"], "只保留 http(s) 网址");

  for (const a of [atlas, mockAtlas(map), fallbackAtlas(map, "浅拷贝")]) {
    const layout = layoutAtlas(normalizeAtlas(a, map, "浅拷贝"));
    const boxes = [layout.root, ...layout.nodes];
    for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= layout.width && b.y + b.h <= layout.height);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i], boxes[j]];
        assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, "节点重叠");
      }
    }
  }
});
