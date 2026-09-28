// 用 plostain.config.ts 里配置的真实模型，把需求说明第 16 节的示例材料完整跑一遍（会花 token）。
// 运行：node --env-file=.env tests/manual/real-run.ts
import { DatabaseSync } from "node:sqlite";
import config from "../../plostain.config.ts";
import { Store, type Sql } from "../../lib/plostain/store.ts";
import * as pipeline from "../../lib/plostain/pipeline.ts";
import { SAMPLE_MATERIAL } from "../../lib/plostain/mock.ts";

const db = new DatabaseSync(":memory:");
const sql: Sql = {
  async run(q, ps = []) {
    db.prepare(q).run(...(ps as never[]));
  },
  async all<T>(q: string, ps: unknown[] = []) {
    return db.prepare(q).all(...(ps as never[])) as T[];
  },
};
const ctx: pipeline.Ctx = { config, env: process.env as Record<string, string>, store: new Store(sql) };
const t0 = Date.now();
const lap = (label: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${label}`);

try {
  const { material, map } = await pipeline.createMaterial(ctx, { title: "浅拷贝（第 16 节示例）", text: SAMPLE_MATERIAL, mode: "teacher", objective: "quick_diagnosis" });
  lap(`地图：${map.data.knowledge_points.length} 个知识点，${map.data.misconceptions.length} 条易错处`);
  const set = await pipeline.generateSet(ctx, { materialId: material.id });
  lap(`出题：${(await ctx.store.getQuestions(set.id)).length} 道`);
  const reviewed = await pipeline.reviewSet(ctx, set.id);
  const qs = (await ctx.store.getQuestions(set.id)).filter((q) => q.status !== "dropped");
  lap(`审核后：${qs.length} 道；提示：${reviewed.warnings.join(" | ") || "无"}`);
  for (const r of await ctx.store.getReviews(set.id)) console.log(`   审核 r${r.round} ${qs.find((q) => q.id === r.question_id)?.label ?? "(已删)"}: ${r.data.verdict} ${r.data.issues.map((i) => i.kind).join(",")}`);
  for (const q of qs) console.log(`   ${q.label} [${q.type}/${q.role}] ${q.stem.replace(/\s+/g, " ").slice(0, 70)} → ${q.answer}`);
  await pipeline.publishSet(ctx, set.id);
  // 模拟一个“有 M2 误解”的学生：浅拷贝题故意按错答押注作答，其余答对。
  const answers = qs.map((q, i) => ({
    question_id: q.id,
    answer: q.kp_ids.includes("K3") && q.error_map[0] ? q.error_map[0].wrong_answer : q.answer,
    confidence: (["sure", "unsure", "guess"] as const)[i % 3],
  }));
  const d = await pipeline.submitSet(ctx, set.id, { answers, total_minutes: 10 });
  lap(`诊断：${d.inferences.length} 条推测，命中率 ${d.error_map_check.hit_rate}`);
  for (const inf of d.inferences) console.log(`   [${inf.confidence}] ${inf.claim} ← ${inf.question_labels.join(",")}`);
  if (d.rule_adjustments.length) console.log("   规则修正：", d.rule_adjustments);
} catch (e) {
  console.error("失败：", e instanceof Error ? e.message : e);
}
const calls = await ctx.store.listCalls();
console.log(`\n调用 ${calls.length} 次，解析失败 ${calls.filter((c) => !c.parsed_ok).length} 次，tokens ${calls.reduce((s, c) => s + (c.tokens_in ?? 0), 0)} / ${calls.reduce((s, c) => s + (c.tokens_out ?? 0), 0)}`);
for (const c of calls.filter((c) => !c.parsed_ok)) console.log(`   ✗ ${c.role} ${c.prompt_version}: ${c.error.slice(0, 300)}`);
