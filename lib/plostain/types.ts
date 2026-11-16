// Plostain 核心数据对象（需求说明第 8 节）。
// 模型输出一律先过这里的 zod schema，再进数据库。
import { z } from "zod";

export const ROLES = ["mapper", "cartographer", "generator", "solver", "reviewer", "grader", "diagnostician", "builder"] as const;
export type Role = (typeof ROLES)[number];

export const SOURCE_TYPES = ["textbook", "notes", "dialogue", "errors", "other"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const OBJECTIVE_MODES = ["comprehensive", "transfer", "quick_diagnosis", "complete"] as const;
export type ObjectiveMode = (typeof OBJECTIVE_MODES)[number];

export const WORK_MODES = ["self", "teacher"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

// 能力层级：合并旧提示词（识别/理解/应用/迁移/纠错）与本次需求（识别/理解/推理/应用/迁移），取并集六个。
export const ABILITIES = ["识别", "理解", "推理", "应用", "迁移", "纠错"] as const;
export const QUESTION_ROLES = [
  "basic_check",
  "unlabeled_recognition",
  "confusable_pair",
  "transfer",
  "sentinel",
  "synthesis",
] as const;
export const QUESTION_TYPES = ["single_choice", "short_answer", "open_explain"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CONFIDENCES = ["sure", "unsure", "guess"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

// 模型偶尔会把枚举写成中文或大小写不一；这里宽松接收、统一成标准值。
const looseEnum = <T extends readonly [string, ...string[]]>(values: T, aliases: Record<string, T[number]> = {}) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const s = v.trim();
    if (aliases[s]) return aliases[s];
    const lower = s.toLowerCase();
    return (values as readonly string[]).includes(lower) ? lower : s;
  }, z.enum(values));

const str = z.preprocess((v) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)), z.string());
const strArr = z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.coerce.string()));

// ---------- 材料地图 ----------
export const MaterialMapData = z.object({
  knowledge_points: z
    .array(
      z.object({
        id: z.coerce.string(),
        name: str,
        summary: str,
        anchor: str,
        tier: looseEnum(["core", "minor"] as const, { 主干: "core", 次级: "minor", 顺带: "minor" }),
      }),
    )
    .min(1),
  dependencies: z.array(z.object({ from_kp: z.coerce.string(), to_kp: z.coerce.string(), note: str })).default([]),
  implicit_prereqs: z.array(z.object({ name: str, note: str })).default([]),
  misconceptions: z
    .array(
      z.object({
        id: z.coerce.string(),
        kp_ids: strArr,
        description: str,
        source: looseEnum(["material", "model"] as const, { 材料明示: "material", 模型判断: "model" }),
      }),
    )
    .default([]),
  boundaries: z
    .array(z.object({ description: str, kind: looseEnum(["not_deep", "adjacent_absent"] as const) }))
    .default([]),
  verifiability: z
    .array(z.object({ kp_id: z.coerce.string(), how: looseEnum(["run", "substitute", "lookup", "argument_only"] as const) }))
    .default([]),
  suitability: z.object({ good_for: str, bad_for: str, why: str }),
});
export type MaterialMapData = z.infer<typeof MaterialMapData>;

// ---------- 知识体系图 ----------
// 材料地图只管“材料里讲了什么”；体系图把它放回整个主题里看：材料讲到的节点挂着 kp_ids，没讲到的节点 kp_ids 为空。
// 体系图只用来画图，不参与出题——题目的积木仍然必须在材料内。
export const KnowledgeAtlas = z.object({
  title: str, // 这张图的主题，画在正中间
  nodes: z
    .array(
      z.object({
        id: z.coerce.string(),
        parent: z.preprocess((v) => (v == null ? "" : v), z.coerce.string()), // 空 = 直接挂在主题下
        name: str,
        note: str.default(""),
        kp_ids: strArr.default([]),
        kind: z.preprocess(
          (v) => (typeof v === "string" && ["topic", "prereq", "extension"].includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : "topic"),
          z.enum(["topic", "prereq", "extension"]),
        ),
      }),
    )
    .min(1),
  sources: z.array(z.object({ title: str, url: str })).default([]),
});
export type KnowledgeAtlas = z.infer<typeof KnowledgeAtlas>;

// ---------- 题目与设计卡 ----------
export const ErrorMapEntry = z.object({
  wrong_answer: str,
  misconception_id: z.preprocess((v) => (v == null ? "" : v), z.coerce.string()),
  reasoning: str,
});
export type ErrorMapEntry = z.infer<typeof ErrorMapEntry>;

export const QuestionDraft = z.object({
  label: z.coerce.string(), // Q1、Q2……卷内编号，paired_with 与诊断证据都引用它
  type: looseEnum(QUESTION_TYPES, { 单选: "single_choice", 短答: "short_answer", 简述: "open_explain" }),
  stem: str,
  options: z
    .array(z.object({ key: z.coerce.string(), text: str }))
    .nullish()
    .transform((v) => v ?? []),
  answer: str,
  accepted_answers: strArr.default([]),
  explanation: str,
  kp_ids: strArr,
  target_ability: looseEnum(ABILITIES),
  role: looseEnum(QUESTION_ROLES, {
    基础确认: "basic_check",
    无标签识别: "unlabeled_recognition",
    易混淆辨析: "confusable_pair",
    迁移: "transfer",
    哨兵: "sentinel",
    综合: "synthesis",
  }),
  difficulty_source: str,
  diagnostic_purpose: str,
  error_map: z.array(ErrorMapEntry).default([]),
  paired_with: strArr.default([]),
  // 对照组：同一组的题要放在一起读。same_surface = 看似相同、实则不同；same_principle = 看似不同、实则相同
  pair_group: str.default(""),
  pair_relation: looseEnum(["same_surface", "same_principle", ""] as const, {
    同貌不同构: "same_surface",
    同构不同貌: "same_principle",
  }).default(""),
  rationale: str.default(""), // 来源与出题理由：为什么从这个知识点、这段原文出这道题
  // 验算程序：系统在沙箱里运行，最后一行打印 PASS 或 FAIL: 原因。无法用程序验证时 code 为空、note 说明原因
  check: z
    .object({ code: str.default(""), note: str.default("") })
    .nullish()
    .transform((v) => v ?? { code: "", note: "" }),
});
export type QuestionDraft = z.infer<typeof QuestionDraft>;

export const GeneratorOutput = z.object({
  coverage_table: z
    .array(z.object({ kp_id: z.coerce.string(), abilities: strArr }))
    .default([]),
  questions: z.array(QuestionDraft).min(1),
  notes: str.default(""),
});
export type GeneratorOutput = z.infer<typeof GeneratorOutput>;

export const RegenerateOutput = z.object({ question: QuestionDraft, notes: str.default("") });

// ---------- 盲解与审核 ----------
export const SolverOutput = z.object({
  answers: z.array(z.object({ label: z.coerce.string(), answer: str, reasoning: str })),
});
export type SolverOutput = z.infer<typeof SolverOutput>;

export const ISSUE_KINDS = [
  "wrong_answer",
  "ambiguous",
  "off_target",
  "contamination",
  "bypassable",
  "irrelevant_difficulty",
  "duplicate",
] as const;

export const ReviewItem = z.object({
  label: z.coerce.string(),
  solver_agrees: z.boolean().nullish(),
  solver_mismatch_judgement: str.default(""), // solver 与标准答案不一致时：题有问题，还是 solver 错
  issues: z.array(z.object({ kind: looseEnum(ISSUE_KINDS), detail: str })).default([]),
  verdict: looseEnum(["keep", "revise", "drop"] as const),
  revised_question: QuestionDraft.nullish(),
  surface_checks: z.record(z.string(), z.unknown()).nullish(), // 卷面评估各维度的简评（第 12 节）
});
export type ReviewItem = z.infer<typeof ReviewItem>;

export const ReviewerOutput = z.object({ reviews: z.array(ReviewItem), overall: str.default("") });

// ---------- 批改 ----------
export const GradeValue = looseEnum(["true", "false", "partial"] as const, { 对: "true", 错: "false", 部分: "partial" });
export const GraderOutput = z.object({
  gradings: z.array(
    z.object({
      label: z.coerce.string(),
      correct: z.preprocess((v) => (typeof v === "boolean" ? String(v) : v), GradeValue),
      rationale: str,
      matched_wrong_answer: z.preprocess((v) => (v == null ? "" : v), z.coerce.string()).default(""),
    }),
  ),
});

// ---------- 诊断 ----------
export const CONF_LEVELS = ["low", "mid", "high"] as const;
export const DiagnosisOutput = z.object({
  headline: str.default(""), // 一句话结论，放在结果页最上面（旧数据没有，页面会从推测里截一句）
  observations: z.array(z.object({ text: str, question_labels: strArr })).default([]),
  inferences: z
    .array(
      z.object({
        title: str.default(""), // 这条推测的短标题
        claim: str,
        kp_ids: strArr.default([]),
        misconception_id: z.preprocess((v) => (v == null ? "" : v), z.coerce.string()).default(""),
        question_labels: strArr,
        confidence: looseEnum(CONF_LEVELS, { 低: "low", 中: "mid", 高: "high", medium: "mid" }),
        confidence_reason: str.default(""),
        ruled_out: str.default(""),
      }),
    )
    .default([]),
  insufficient: z.array(z.object({ what: str, why: str })).default([]),
  error_map_commentary: str.default(""),
  lecture: z
    .array(
      z.object({
        question_label: z.coerce.string(),
        old_picture: str,
        new_picture: str,
        walkthrough: str,
      }),
    )
    .default([]),
  connections: str.default(""),
  next_round: z.array(z.object({ focus: str, reason: str })).default([]),
  student_state: z
    .array(
      z.object({
        kp_id: z.coerce.string(),
        estimate: looseEnum(["mastered", "shaky", "not_mastered", "unknown"] as const),
        evidence_question_labels: strArr.default([]),
      }),
    )
    .default([]),
  developer_notes: str.default(""),
});
export type DiagnosisOutput = z.infer<typeof DiagnosisOutput>;

// ---------- 平原：筑城者对话、学习日志 ----------
export const LearningGoal = z.object({
  topic: str,
  destination: str,
  start: str.default(""),
  evidence: str.default(""),
  scope_out: str.default(""),
  first_step: str.default(""),
});
export type LearningGoal = z.infer<typeof LearningGoal>;

export const BuilderOutput = z.object({
  reply: str,
  move: str.default(""),
  goal: LearningGoal.nullish().transform((v) => v ?? null),
});
export type BuilderOutput = z.infer<typeof BuilderOutput>;

/** 学习日志的一条：像 AI 的长期记忆那样的文本记录。study = 交卷后自动生成；goal = 在筑城者那里确认的学习目标。 */
export interface JournalEntry {
  id: string;
  at: string;
  kind: "study" | "goal";
  title: string;
  lines: { key: string; text: string }[];
  set_id?: string;
}

// ---------- 数据库里的记录 ----------
export interface Material {
  id: string;
  title: string;
  text: string;
  source_type: SourceType;
  mode: WorkMode;
  objective: ObjectiveMode;
  created_at: string;
}

export interface MaterialMap {
  id: string;
  material_id: string;
  prompt_version: string;
  model: string;
  data: MaterialMapData;
  created_at: string;
  warnings?: string[]; // 代码检查发现的问题，例如地图只覆盖了材料前半部分
  atlas?: KnowledgeAtlas | null; // 知识体系图（另一次模型调用画的，可能还没有）
  atlas_meta?: { model: string; prompt_version: string; searched: boolean; created_at: string };
}

export interface LearningObjective {
  mode: ObjectiveMode;
  extra_focus?: { focus: string; reason: string }[];
}

export type QuestionStatus = "draft" | "reviewed" | "revised" | "dropped" | "teacher_edited";

export interface Question extends QuestionDraft {
  id: string;
  set_id: string;
  order: number;
  status: QuestionStatus;
  sealed_at: string;
  drop_reason?: string;
  verification?: Verification;
}

export type SetStatus = "generated" | "reviewed" | "published" | "diagnosed";

export interface ExerciseSet {
  id: string;
  material_id: string;
  map_id: string;
  objective: LearningObjective;
  mode: WorkMode;
  pipeline_variant: "A" | "B";
  prompt_versions: Record<string, string>;
  coverage_table: GeneratorOutput["coverage_table"];
  generator_notes: string;
  status: SetStatus;
  warnings: string[];
  parent_set_id: string | null;
  total_minutes: number | null;
  created_at: string;
  published_at: string | null;
  submitted_at: string | null;
}

export interface Review {
  id: string;
  set_id: string;
  question_id: string;
  round: number;
  solver_answer: string;
  solver_reasoning: string;
  data: ReviewItem;
  created_at: string;
}

export interface ResponseRecord {
  question_id: string;
  answer: string;
  confidence: Confidence;
  submitted_at: string;
}

export interface Grading {
  question_id: string;
  correct: "true" | "false" | "partial";
  method: "rule" | "model";
  rationale: string;
  matched_wrong_answer: string;
}

export interface ErrorMapCheck {
  hit: { label: string; misconception_id: string; answer: string }[];
  missed: { label: string; misconception_id: string; wrong_answer: string }[];
  unexpected: { label: string; answer: string }[];
  hit_rate: number | null; // 命中 / (命中 + 预测外)；没有错题时为 null
}

export interface Diagnosis extends Omit<DiagnosisOutput, "student_state"> {
  set_id: string;
  error_map_check: ErrorMapCheck;
  rule_adjustments: string[]; // 系统按规则对模型输出做的修正，照实展示
  student_state: DiagnosisOutput["student_state"];
  created_at: string;
}

export interface LLMCall {
  id: string;
  role: Role;
  provider: string;
  model: string;
  prompt_version: string;
  input_hash: string;
  output_raw: string;
  parsed_ok: boolean;
  error: string;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number;
  set_id: string | null;
  created_at: string;
}

/** 验算结果：pass / fail 来自验算程序的输出；error = 程序本身出错或超时；none = 这道题没有验算程序；skipped = 没能运行（桥没开等）。 */
export interface Verification {
  status: "pass" | "fail" | "error" | "none" | "skipped";
  detail: string;
  output: string;
  at: string;
}
