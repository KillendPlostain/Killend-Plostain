// 流水线编排：材料 → 地图 → 出题（封存）→ 盲解 + 审核 → 作答 → 批改 → 诊断。
// 这里不依赖网页框架：网站的 API 路由和测试都直接调用这些函数。
import { callRole, type LLMContext } from "./llm.ts";
import { checkErrorMap, ruleGrade } from "./grading.ts";
import { newId, now } from "./store.ts";
import * as mock from "./mock.ts";
import * as mapperPrompt from "./prompts/mapper.ts";
import * as generatorPrompt from "./prompts/generator.ts";
import * as solverPrompt from "./prompts/solver.ts";
import * as reviewerPrompt from "./prompts/reviewer.ts";
import * as graderPrompt from "./prompts/grader.ts";
import * as diagnosticianPrompt from "./prompts/diagnostician.ts";
import {
  DiagnosisOutput,
  GeneratorOutput,
  GraderOutput,
  MaterialMapData,
  OBJECTIVE_MODES,
  QuestionDraft,
  RegenerateOutput,
  ReviewerOutput,
  SOURCE_TYPES,
  SolverOutput,
  WORK_MODES,
  CONFIDENCES,
  type Confidence,
  type Diagnosis,
  type ExerciseSet,
  type Grading,
  type LearningObjective,
  type Material,
  type MaterialMap,
  type ObjectiveMode,
  type Question,
  type ResponseRecord,
  type SourceType,
  type WorkMode,
} from "./types.ts";

export type Ctx = LLMContext;

/** 给用户看的错误（参数不对、状态不对），API 返回 400 而不是 500。 */
export class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const active = (qs: Question[]) => qs.filter((q) => q.status !== "dropped");

// ---------------------------------------------------------------- 材料与地图

export async function createMaterial(
  ctx: Ctx,
  input: { title?: string; text?: string; source_type?: string; mode?: string; objective?: string },
): Promise<{ material: Material; map: MaterialMap }> {
  const text = (input.text ?? "").trim();
  const max = ctx.config.limits.materialMaxChars;
  if (text.length < 80) throw new UserError("材料太短（少于 80 字），撑不起一张诊断卷。");
  if (text.length > max) throw new UserError(`材料有 ${text.length} 字，超过上限 ${max} 字。请拆成几段分别出卷——这里不做静默截断。`);
  const material = await ctx.store.createMaterial({
    title: (input.title ?? "").trim() || text.slice(0, 20).replace(/\s+/g, " "),
    text,
    source_type: pick(input.source_type, SOURCE_TYPES, "notes") as SourceType,
    mode: pick(input.mode, WORK_MODES, "self") as WorkMode,
    objective: pick(input.objective, OBJECTIVE_MODES, "comprehensive") as ObjectiveMode,
  });
  const map = await buildMap(ctx, material);
  return { material, map };
}

export async function buildMap(ctx: Ctx, material: Material): Promise<MaterialMap> {
  const prompt = mapperPrompt.build(material);
  const { data, model } = await callRole(ctx, { role: "mapper", prompt, schema: MaterialMapData, mock: mock.mockMap });
  return ctx.store.saveMap({ material_id: material.id, prompt_version: prompt.version, model, data });
}

export async function regenerateMap(ctx: Ctx, materialId: string): Promise<MaterialMap> {
  return buildMap(ctx, await mustMaterial(ctx, materialId));
}

// ---------------------------------------------------------------- 出题

export async function generateSet(
  ctx: Ctx,
  input: { materialId: string; mapId?: string; mode?: string; objective?: string; parentSetId?: string },
): Promise<ExerciseSet> {
  const material = await mustMaterial(ctx, input.materialId);
  const map = input.mapId ? await ctx.store.getMap(input.mapId) : await ctx.store.latestMap(material.id);
  if (!map || map.material_id !== material.id) throw new UserError("找不到这份材料的地图，请先生成材料地图。");

  const objective: LearningObjective = { mode: pick(input.objective, OBJECTIVE_MODES, material.objective) as ObjectiveMode };
  let parent: ExerciseSet | null = null;
  if (input.parentSetId) {
    parent = await ctx.store.getSet(input.parentSetId);
    const diag = parent ? await ctx.store.getDiagnosis(parent.id) : null;
    if (diag?.next_round.length) objective.extra_focus = diag.next_round;
  }

  const set = await ctx.store.createSet({
    material_id: material.id,
    map_id: map.id,
    objective,
    mode: pick(input.mode, WORK_MODES, material.mode) as WorkMode,
    pipeline_variant: "A",
    prompt_versions: {},
    coverage_table: [],
    generator_notes: "",
    status: "generated",
    warnings: [],
    parent_set_id: parent?.id ?? null,
    total_minutes: null,
    published_at: null,
    submitted_at: null,
  });

  const prompt = generatorPrompt.build(material, map.data, objective);
  const { data } = await callRole(ctx, { role: "generator", prompt, schema: GeneratorOutput, mock: mock.mockGenerate, setId: set.id });

  // 设计卡在这一刻写库并打上封存时间戳——早于任何作答。
  const sealedAt = now();
  const seen = new Set<string>();
  let order = 0;
  for (const draft of data.questions) {
    let label = draft.label.trim() || `Q${order + 1}`;
    if (seen.has(label)) label = `Q${order + 1}`;
    seen.add(label);
    await ctx.store.insertQuestion({ ...draft, label, id: newId(), set_id: set.id, order: order++, status: "draft", sealed_at: sealedAt });
  }
  return ctx.store.updateSet(set.id, {
    coverage_table: data.coverage_table,
    generator_notes: data.notes,
    prompt_versions: { mapper: map.prompt_version, generator: prompt.version },
  });
}

// ---------------------------------------------------------------- 盲解 + 审核

export async function reviewSet(ctx: Ctx, setId: string): Promise<ExerciseSet> {
  const set = await mustSet(ctx, setId);
  if (set.status !== "generated") throw new UserError("这张卷已经审核过了。");
  const { material, map } = await setContext(ctx, set);
  const questions = active(await ctx.store.getQuestions(set.id)).filter((q) => q.status === "draft");
  const warnings = [...set.warnings, ...(await reviewQuestions(ctx, set, material, map.data, questions))];

  const remaining = active(await ctx.store.getQuestions(set.id));
  const min = set.objective.mode === "quick_diagnosis" ? 3 : ctx.config.limits.minQuestions;
  if (remaining.length < min) {
    warnings.push(`审核后只剩 ${remaining.length} 道题，低于下限 ${min}：这份材料可能撑不起这张卷。宁缺毋滥，没有凑数。`);
  }
  const reviewed = await ctx.store.updateSet(set.id, {
    status: "reviewed",
    warnings,
    prompt_versions: { ...set.prompt_versions, solver: solverPrompt.VERSION, reviewer: reviewerPrompt.VERSION },
  });
  // 自测模式跳过审题页：自动审核后直接发布，避免自己看到答案。
  return reviewed.mode === "self" ? publishSet(ctx, set.id) : reviewed;
}

/**
 * 对一组题做“盲解 → 审核 → 至多一轮修订 → 修订稿再盲解再审核”。
 * 返回需要在卷首说明的提示（例如删掉了哪道题）。
 */
async function reviewQuestions(ctx: Ctx, set: ExerciseSet, material: Material, map: MaterialMapData, questions: Question[]): Promise<string[]> {
  const warnings: string[] = [];
  let batch = questions;
  for (let round = 1; round <= 2 && batch.length; round++) {
    const solverP = solverPrompt.build(batch);
    const solved = await callRole(ctx, { role: "solver", prompt: solverP, schema: SolverOutput, mock: () => mock.mockSolve(batch), setId: set.id });
    const solver = Object.fromEntries(solved.data.answers.map((a) => [a.label, a]));

    const reviewP = reviewerPrompt.build(material, map, batch, solver, round);
    const reviewed = await callRole(ctx, { role: "reviewer", prompt: reviewP, schema: ReviewerOutput, mock: () => mock.mockReview(batch, round), setId: set.id });
    const byLabel = new Map(reviewed.data.reviews.map((r) => [r.label, r]));

    const next: Question[] = [];
    for (const q of batch) {
      const item = byLabel.get(q.label);
      await ctx.store.addReview({
        set_id: set.id,
        question_id: q.id,
        round,
        solver_answer: solver[q.label]?.answer ?? "",
        solver_reasoning: solver[q.label]?.reasoning ?? "",
        data: item ?? { label: q.label, issues: [], verdict: "keep", solver_mismatch_judgement: "审核没有返回这道题的结果，按保留处理。" },
      });
      if (!item) {
        warnings.push(`${q.label}：审核没有返回结果，按保留处理，请留意。`);
        await ctx.store.updateQuestion({ ...q, status: round === 1 ? "reviewed" : q.status });
      } else if (item.verdict === "keep") {
        await ctx.store.updateQuestion({ ...q, status: round === 1 ? "reviewed" : q.status });
      } else if (item.verdict === "revise" && round === 1 && item.revised_question) {
        // 修订稿更新设计卡（含错答地图）并重新封存。
        const revised: Question = { ...q, ...item.revised_question, label: q.label, status: "revised", sealed_at: now() };
        await ctx.store.updateQuestion(revised);
        next.push(revised);
      } else {
        const reason = item.issues.map((i) => i.detail).filter(Boolean).join("；") || "审核判定无法修好";
        await ctx.store.updateQuestion({ ...q, status: "dropped", drop_reason: `审核删除（第 ${round} 轮）：${reason}` });
        warnings.push(`审核删去了 ${q.label}：${reason}`);
      }
    }
    batch = next;
  }
  return warnings;
}

export async function publishSet(ctx: Ctx, setId: string): Promise<ExerciseSet> {
  const set = await mustSet(ctx, setId);
  if (set.status === "generated") throw new UserError("还没审核，不能发布。");
  if (set.status !== "reviewed") return set;
  if (!active(await ctx.store.getQuestions(set.id)).length) throw new UserError("卷里一道题都没有了。");
  return ctx.store.updateSet(set.id, { status: "published", published_at: now() });
}

// ---------------------------------------------------------------- 教师编辑

const EDITABLE = [
  "stem", "options", "answer", "accepted_answers", "explanation", "difficulty_source", "diagnostic_purpose", "error_map", "type",
] as const;

export async function editQuestion(ctx: Ctx, setId: string, questionId: string, patch: Partial<QuestionDraft>): Promise<Question> {
  const { set, question } = await mustEditable(ctx, setId, questionId);
  const next: Question = { ...question };
  for (const key of EDITABLE) if (patch[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = patch[key];
  const parsed = QuestionDraft.safeParse(next);
  if (!parsed.success) throw new UserError("修改后的题目格式不对：" + parsed.error.issues[0]?.message);
  const saved: Question = { ...question, ...parsed.data, status: "teacher_edited", sealed_at: now() };
  await ctx.store.updateQuestion(saved);
  await touchSet(ctx, set);
  return saved;
}

export async function dropQuestion(ctx: Ctx, setId: string, questionId: string): Promise<void> {
  const { set, question } = await mustEditable(ctx, setId, questionId);
  await ctx.store.updateQuestion({ ...question, status: "dropped", drop_reason: "教师删除" });
  await touchSet(ctx, set);
}

/** 单题重出：新题同样要过盲解 + 审核；旧题保留为 dropped 以便追溯。 */
export async function regenerateQuestion(ctx: Ctx, setId: string, questionId: string, note = ""): Promise<Question | null> {
  const { set, question } = await mustEditable(ctx, setId, questionId);
  const { material, map } = await setContext(ctx, set);
  const others = active(await ctx.store.getQuestions(set.id)).filter((q) => q.id !== question.id);
  const prompt = generatorPrompt.buildRegenerate(material, map.data, question, others, note);
  const { data } = await callRole(ctx, {
    role: "generator",
    prompt,
    schema: RegenerateOutput,
    mock: () => ({ question: { ...mock.mockGenerate().questions.find((q) => q.label === question.label) ?? mock.mockGenerate().questions[0], label: question.label }, notes: "（mock）重出" }),
    setId: set.id,
  });
  await ctx.store.updateQuestion({ ...question, status: "dropped", drop_reason: "被单题重出替换" });
  const fresh: Question = { ...data.question, label: question.label, id: newId(), set_id: set.id, order: question.order, status: "draft", sealed_at: now() };
  await ctx.store.insertQuestion(fresh);
  const warnings = await reviewQuestions(ctx, set, material, map.data, [fresh]);
  if (warnings.length) await ctx.store.updateSet(set.id, { warnings: [...set.warnings, ...warnings] });
  await touchSet(ctx, set);
  return ctx.store.getQuestion(fresh.id);
}

async function touchSet(ctx: Ctx, set: ExerciseSet) {
  // 教师改动后需要重新点“发布”。
  if (set.status === "published") await ctx.store.updateSet(set.id, { status: "reviewed", published_at: null });
}

// ---------------------------------------------------------------- 作答、批改、诊断

export async function submitSet(
  ctx: Ctx,
  setId: string,
  input: { answers?: { question_id: string; answer?: string; confidence?: string }[]; total_minutes?: number | string | null },
): Promise<Diagnosis> {
  const set = await mustSet(ctx, setId);
  if (set.status !== "published") throw new UserError(set.status === "diagnosed" ? "这张卷已经交过了。" : "这张卷还没发布，不能作答。");
  if ((await ctx.store.getResponses(set.id)).length) throw new UserError("这张卷已经有作答记录。");
  const questions = active(await ctx.store.getQuestions(set.id));
  const given = new Map((input.answers ?? []).map((a) => [a.question_id, a]));

  const submittedAt = now();
  const responses: ResponseRecord[] = [];
  for (const q of questions) {
    const a = given.get(q.id);
    if (!a || !(CONFIDENCES as readonly string[]).includes(a.confidence ?? "")) {
      throw new UserError(`${q.label} 还没标信心（稳 / 犹豫 / 蒙）。`);
    }
    responses.push({ question_id: q.id, answer: (a.answer ?? "").trim(), confidence: a.confidence as Confidence, submitted_at: submittedAt });
  }
  // 封存检查：所有设计卡都必须早于作答。
  for (const q of questions) {
    if (q.sealed_at > submittedAt) throw new Error(`${q.label} 的设计卡封存时间晚于作答，数据异常。`);
  }
  const minutes = Number(input.total_minutes);
  await ctx.store.saveResponses(set.id, responses);
  await ctx.store.updateSet(set.id, { submitted_at: submittedAt, total_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null });

  const gradings = await gradeSet(ctx, set, questions, responses);
  return diagnoseSet(ctx, set.id, gradings);
}

async function gradeSet(ctx: Ctx, set: ExerciseSet, questions: Question[], responses: ResponseRecord[]): Promise<Grading[]> {
  const { graded, needModel } = ruleGrade(questions, responses);
  if (needModel.length) {
    const byQ = new Map(responses.map((r) => [r.question_id, r.answer]));
    const items = needModel.map((question) => ({ question, answer: byQ.get(question.id) ?? "" }));
    const { data } = await callRole(ctx, {
      role: "grader",
      prompt: graderPrompt.build(items),
      schema: GraderOutput,
      mock: () => mock.mockGrade(items),
      setId: set.id,
    });
    const byLabel = new Map(data.gradings.map((g) => [g.label, g]));
    for (const q of needModel) {
      const g = byLabel.get(q.label);
      graded.push({
        question_id: q.id,
        correct: g?.correct ?? "false",
        method: "model",
        rationale: g?.rationale ?? "批改模型没有返回这道题的结果，暂判为错，请人工复核。",
        matched_wrong_answer: g?.matched_wrong_answer ?? "",
      });
    }
  }
  await ctx.store.saveGradings(set.id, graded);
  return graded;
}

/** 诊断（交卷时自动调用；诊断失败时也可以单独重跑）。 */
export async function diagnoseSet(ctx: Ctx, setId: string, gradingsIn?: Grading[]): Promise<Diagnosis> {
  const set = await mustSet(ctx, setId);
  const map = await ctx.store.getMap(set.map_id);
  if (!map) throw new Error("地图丢失");
  const questions = active(await ctx.store.getQuestions(set.id));
  const responses = await ctx.store.getResponses(set.id);
  if (!responses.length) throw new UserError("还没有作答，无法诊断。");
  // 交卷时批改若中途失败，这里补批改一次。
  const stored = gradingsIn ?? (await ctx.store.getGradings(set.id));
  const gradings = stored.length ? stored : await gradeSet(ctx, set, questions, responses);
  const check = checkErrorMap(questions, responses, gradings);

  const prompt = diagnosticianPrompt.build(map.data, questions, responses, gradings, check, set.total_minutes);
  const { data } = await callRole(ctx, {
    role: "diagnostician",
    prompt,
    schema: DiagnosisOutput,
    mock: () => mock.mockDiagnose(map.data, questions, responses, gradings, check),
    setId: set.id,
  });
  const diagnosis = enforceDiagnosisRules(data, questions);
  const saved: Diagnosis = { ...diagnosis, set_id: set.id, error_map_check: check, created_at: now() };
  await ctx.store.saveDiagnosis(saved);
  await ctx.store.updateSet(set.id, {
    status: "diagnosed",
    prompt_versions: { ...set.prompt_versions, grader: graderPrompt.VERSION, diagnostician: prompt.version },
  });
  return saved;
}

/**
 * 诊断规则由代码兜底，而不是只靠提示词：
 * 每条推测至少引用一道卷中真实存在的题；只有一道题支持的，置信度不得高于“中”。
 */
export function enforceDiagnosisRules(d: DiagnosisOutput, questions: Question[]): DiagnosisOutput & { rule_adjustments: string[] } {
  const labels = new Set(questions.map((q) => q.label));
  const keep = (ls: string[]) => ls.filter((l) => labels.has(l));
  const adjustments: string[] = [];
  const insufficient = [...d.insufficient];
  const inferences = [];
  for (const inf of d.inferences) {
    const cited = keep(inf.question_labels);
    if (!cited.length) {
      adjustments.push(`推测“${inf.claim}”没有引用任何有效题号，已移入“证据不足”。`);
      insufficient.push({ what: inf.claim, why: "诊断没有给出支持它的题目。" });
      continue;
    }
    let confidence = inf.confidence;
    if (cited.length === 1 && confidence === "high") {
      confidence = "mid";
      adjustments.push(`推测“${inf.claim}”只有 ${cited[0]} 一道题支持，置信度由“高”降为“中”。`);
    }
    inferences.push({ ...inf, question_labels: cited, confidence });
  }
  return {
    ...d,
    observations: d.observations.map((o) => ({ ...o, question_labels: keep(o.question_labels) })),
    inferences,
    insufficient,
    lecture: d.lecture.filter((l) => labels.has(l.question_label)),
    student_state: d.student_state.map((s) => ({ ...s, evidence_question_labels: keep(s.evidence_question_labels) })),
    rule_adjustments: adjustments,
  };
}

// ---------------------------------------------------------------- 读取视图

/** 学生视图：只有题干和选项。答案、解析、设计卡、审核记录一律不出现。 */
export function studentQuestion(q: Question) {
  return { id: q.id, label: q.label, order: q.order, type: q.type, stem: q.stem, options: q.options };
}

/** 自测模式下，学生看的地图里“易错处”在交卷前隐藏。 */
export function mapForViewer(map: MaterialMap, reveal: boolean) {
  if (reveal) return { ...map, misconceptions_hidden: 0 };
  return { ...map, data: { ...map.data, misconceptions: [] }, misconceptions_hidden: map.data.misconceptions.length };
}

export async function getMaterialView(ctx: Ctx, materialId: string) {
  const material = await mustMaterial(ctx, materialId);
  const map = await ctx.store.latestMap(material.id);
  const sets = await ctx.store.listSetsForMaterial(material.id);
  return { material, map: map ? mapForViewer(map, material.mode === "teacher") : null, sets };
}

export async function getSetView(ctx: Ctx, setId: string, as: "meta" | "student" | "teacher" | "result") {
  const set = await mustSet(ctx, setId);
  const material = await mustMaterial(ctx, set.material_id);
  const submitted = set.status === "diagnosed" || !!set.submitted_at;
  const locked = set.mode === "self" && !submitted;
  // 自测模式交卷前，出题备注和覆盖表也不给看（备注里常会提到具体题目的设计）。
  const visibleSet = locked ? { ...set, generator_notes: "", coverage_table: [] } : set;
  const base = { set: visibleSet, material: { id: material.id, title: material.title, mode: material.mode } };
  if (as === "meta") return base;
  const all = await ctx.store.getQuestions(set.id);

  if (as === "student") {
    if (set.status === "diagnosed" || set.submitted_at) throw new UserError("这张卷已经交过了，请看结果页。", 409);
    if (set.status !== "published") throw new UserError("这张卷还没发布。", 409);
    return { ...base, set: { ...set, generator_notes: "", coverage_table: [] }, questions: active(all).map(studentQuestion) };
  }
  if (as === "teacher") {
    if (locked) throw new UserError("自测模式：答案和设计卡在交卷后才解锁。", 403);
    const map = await ctx.store.getMap(set.map_id);
    return { ...base, questions: all, reviews: await ctx.store.getReviews(set.id), map };
  }
  if (!submitted) throw new UserError("还没交卷。", 409);
  const map = await ctx.store.getMap(set.map_id);
  return {
    ...base,
    materialText: material.text,
    questions: active(all),
    dropped: all.filter((q) => q.status === "dropped"),
    reviews: await ctx.store.getReviews(set.id),
    responses: await ctx.store.getResponses(set.id),
    gradings: await ctx.store.getGradings(set.id),
    diagnosis: await ctx.store.getDiagnosis(set.id),
    map,
  };
}

export async function getHistory(ctx: Ctx) {
  const sets = await ctx.store.listSets();
  const titles = new Map<string, string>();
  const rows = [];
  for (const s of sets) {
    if (!titles.has(s.material_id)) titles.set(s.material_id, (await ctx.store.getMaterial(s.material_id))?.title ?? "（材料已删除）");
    const qs = active(await ctx.store.getQuestions(s.id));
    const gradings = s.status === "diagnosed" ? await ctx.store.getGradings(s.id) : [];
    const diag = s.status === "diagnosed" ? await ctx.store.getDiagnosis(s.id) : null;
    rows.push({
      id: s.id,
      material_id: s.material_id,
      material_title: titles.get(s.material_id),
      objective: s.objective.mode,
      mode: s.mode,
      status: s.status,
      created_at: s.created_at,
      question_count: qs.length,
      correct_count: gradings.filter((g) => g.correct === "true").length,
      hit_rate: diag?.error_map_check.hit_rate ?? null,
      is_followup: !!s.parent_set_id,
    });
  }
  return rows;
}

// ---------------------------------------------------------------- 工具函数

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

async function mustMaterial(ctx: Ctx, id: string) {
  const m = await ctx.store.getMaterial(id);
  if (!m) throw new UserError("找不到这份材料。", 404);
  return m;
}

async function mustSet(ctx: Ctx, id: string) {
  const s = await ctx.store.getSet(id);
  if (!s) throw new UserError("找不到这张练习卷。", 404);
  return s;
}

async function setContext(ctx: Ctx, set: ExerciseSet) {
  const material = await mustMaterial(ctx, set.material_id);
  const map = await ctx.store.getMap(set.map_id);
  if (!map) throw new Error("地图丢失");
  return { material, map };
}

async function mustEditable(ctx: Ctx, setId: string, questionId: string) {
  const set = await mustSet(ctx, setId);
  if (set.mode === "self") throw new UserError("自测模式没有审题环节；如需改题，请用教师模式出卷。", 403);
  if (set.status === "generated") throw new UserError("请等自动审核完成后再修改。");
  if (set.status === "diagnosed" || set.submitted_at) throw new UserError("这张卷已经有作答记录，题目和设计卡已封存。", 409);
  const question = await ctx.store.getQuestion(questionId);
  if (!question || question.set_id !== set.id) throw new UserError("找不到这道题。", 404);
  if (question.status === "dropped") throw new UserError("这道题已经删除了。");
  return { set, question };
}
