// 用 mock provider 跑完整流程：材料 → 地图 → 出题 → 审核 → 编辑 → 作答 → 批改 → 诊断。
// 运行：npm test（Node 自带测试器 + 内存 SQLite，不花钱、不联网）
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { PlostainConfig } from "../lib/plostain/config.ts";
import { Store, type Sql } from "../lib/plostain/store.ts";
import * as pipeline from "../lib/plostain/pipeline.ts";
import { SAMPLE_MATERIAL } from "../lib/plostain/mock.ts";
import { checkErrorMap, normalizeAnswer } from "../lib/plostain/grading.ts";
import { resolveRole } from "../lib/plostain/config.ts";
import realConfig from "../plostain.config.ts";

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

function makeCtx(): pipeline.Ctx {
  return { config: mockConfig, env: {}, store: new Store(memorySql()) };
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
      observations: [],
      inferences: [
        { claim: "A", kp_ids: [], misconception_id: "", question_labels: ["Q9"], confidence: "high", confidence_reason: "", ruled_out: "" },
        { claim: "B", kp_ids: [], misconception_id: "", question_labels: ["Q1"], confidence: "high", confidence_reason: "", ruled_out: "" },
        { claim: "C", kp_ids: [], misconception_id: "", question_labels: ["Q1", "Q2"], confidence: "high", confidence_reason: "", ruled_out: "" },
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
