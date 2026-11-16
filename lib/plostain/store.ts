// SQLite 读写。网站里跑在 Cloudflare D1（本机开发时是 .wrangler/state 里的一个 SQLite 文件），
// 测试里跑在 Node 自带的 node:sqlite 内存库。两者都实现下面这个很小的 Sql 接口。
import type {
  Diagnosis,
  ExerciseSet,
  Grading,
  JournalEntry,
  LLMCall,
  Material,
  MaterialMap,
  Question,
  ResponseRecord,
  Review,
} from "./types.ts";

export interface Sql {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS material_maps (id TEXT PRIMARY KEY, material_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS exercise_sets (id TEXT PRIMARY KEY, material_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, ord INTEGER NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, question_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS responses (question_id TEXT PRIMARY KEY, set_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS gradings (question_id TEXT PRIMARY KEY, set_id TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS diagnoses (set_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS llm_calls (id TEXT PRIMARY KEY, set_id TEXT, role TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS journal (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_questions_set ON questions(set_id, ord)`,
  `CREATE INDEX IF NOT EXISTS idx_calls_created ON llm_calls(created_at)`,
];

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

type Row = { data: string };
const parse = <T>(rows: Row[]): T[] => rows.map((r) => JSON.parse(r.data) as T);

export class SealedError extends Error {}

/** 早期存的题没有后来新增的字段（验算程序、对照组），读出来时补上默认值。 */
function withQuestionDefaults(q: Question): Question {
  return { ...q, pair_group: q.pair_group ?? "", pair_relation: q.pair_relation ?? "", check: q.check ?? { code: "", note: "" } };
}

export class Store {
  private sql: Sql;
  private ready: Promise<void> | null = null;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  /** 第一次访问时自动建表，不需要手动跑迁移。 */
  private init(): Promise<void> {
    this.ready ??= (async () => {
      for (const stmt of SCHEMA) await this.sql.run(stmt);
    })();
    return this.ready;
  }

  private async all<T>(query: string, params: unknown[] = []): Promise<T[]> {
    await this.init();
    return parse<T>(await this.sql.all<Row>(query, params));
  }

  private async one<T>(query: string, params: unknown[]): Promise<T | null> {
    return (await this.all<T>(query, params))[0] ?? null;
  }

  private async write(query: string, params: unknown[]): Promise<void> {
    await this.init();
    await this.sql.run(query, params);
  }

  // ---------- 材料与地图 ----------
  async createMaterial(m: Omit<Material, "id" | "created_at">): Promise<Material> {
    const material: Material = { ...m, id: newId(), created_at: now() };
    await this.write(`INSERT INTO materials (id, created_at, data) VALUES (?, ?, ?)`, [material.id, material.created_at, JSON.stringify(material)]);
    return material;
  }

  getMaterial(id: string) {
    return this.one<Material>(`SELECT data FROM materials WHERE id = ?`, [id]);
  }

  async saveMap(m: Omit<MaterialMap, "id" | "created_at">): Promise<MaterialMap> {
    const map: MaterialMap = { ...m, id: newId(), created_at: now() };
    await this.write(`INSERT INTO material_maps (id, material_id, created_at, data) VALUES (?, ?, ?, ?)`, [
      map.id,
      map.material_id,
      map.created_at,
      JSON.stringify(map),
    ]);
    return map;
  }

  /** 给已有的地图补上知识体系图等字段。 */
  async updateMap(map: MaterialMap): Promise<MaterialMap> {
    await this.write(`UPDATE material_maps SET data = ? WHERE id = ?`, [JSON.stringify(map), map.id]);
    return map;
  }

  getMap(id: string) {
    return this.one<MaterialMap>(`SELECT data FROM material_maps WHERE id = ?`, [id]);
  }

  latestMap(materialId: string) {
    return this.one<MaterialMap>(`SELECT data FROM material_maps WHERE material_id = ? ORDER BY created_at DESC LIMIT 1`, [materialId]);
  }

  // ---------- 学习日志（手动记下的条目；交卷的记录是从练习卷现算的） ----------
  async addJournal(e: Omit<JournalEntry, "id" | "at">): Promise<JournalEntry> {
    const entry: JournalEntry = { ...e, id: newId(), at: now() };
    await this.write(`INSERT INTO journal (id, created_at, data) VALUES (?, ?, ?)`, [entry.id, entry.at, JSON.stringify(entry)]);
    return entry;
  }

  listJournal() {
    return this.all<JournalEntry>(`SELECT data FROM journal ORDER BY created_at DESC LIMIT 200`);
  }

  // ---------- 练习卷 ----------
  async createSet(s: Omit<ExerciseSet, "id" | "created_at">): Promise<ExerciseSet> {
    const set: ExerciseSet = { ...s, id: newId(), created_at: now() };
    await this.write(`INSERT INTO exercise_sets (id, material_id, created_at, data) VALUES (?, ?, ?, ?)`, [
      set.id,
      set.material_id,
      set.created_at,
      JSON.stringify(set),
    ]);
    return set;
  }

  getSet(id: string) {
    return this.one<ExerciseSet>(`SELECT data FROM exercise_sets WHERE id = ?`, [id]);
  }

  async updateSet(id: string, patch: Partial<ExerciseSet>): Promise<ExerciseSet> {
    const set = await this.getSet(id);
    if (!set) throw new Error("练习卷不存在");
    const next = { ...set, ...patch, id };
    await this.write(`UPDATE exercise_sets SET data = ? WHERE id = ?`, [JSON.stringify(next), id]);
    return next;
  }

  /** 只用于删除出题失败、一道题都没有的空卷。 */
  async deleteSet(id: string): Promise<void> {
    await this.write(`DELETE FROM questions WHERE set_id = ?`, [id]);
    await this.write(`DELETE FROM exercise_sets WHERE id = ?`, [id]);
  }

  listSets() {
    return this.all<ExerciseSet>(`SELECT data FROM exercise_sets ORDER BY created_at DESC LIMIT 200`);
  }

  listSetsForMaterial(materialId: string) {
    return this.all<ExerciseSet>(`SELECT data FROM exercise_sets WHERE material_id = ? ORDER BY created_at DESC`, [materialId]);
  }

  // ---------- 题目（设计卡封存） ----------
  async insertQuestion(q: Question): Promise<void> {
    await this.write(`INSERT INTO questions (id, set_id, ord, data) VALUES (?, ?, ?, ?)`, [q.id, q.set_id, q.order, JSON.stringify(q)]);
  }

  /** 已有作答的卷，设计卡只读：这是“封存先于作答”的最后一道闸。 */
  async updateQuestion(q: Question): Promise<void> {
    if ((await this.getResponses(q.set_id)).length > 0) throw new SealedError("这张卷已经有作答记录，题目和设计卡已封存，不能再修改。");
    await this.write(`UPDATE questions SET ord = ?, data = ? WHERE id = ?`, [q.order, JSON.stringify(q), q.id]);
  }

  async getQuestions(setId: string) {
    return (await this.all<Question>(`SELECT data FROM questions WHERE set_id = ? ORDER BY ord, rowid`, [setId])).map(withQuestionDefaults);
  }

  async getQuestion(id: string) {
    const q = await this.one<Question>(`SELECT data FROM questions WHERE id = ?`, [id]);
    return q ? withQuestionDefaults(q) : null;
  }

  // ---------- 审核 ----------
  async addReview(r: Omit<Review, "id" | "created_at">): Promise<void> {
    const review: Review = { ...r, id: newId(), created_at: now() };
    await this.write(`INSERT INTO reviews (id, set_id, question_id, created_at, data) VALUES (?, ?, ?, ?, ?)`, [
      review.id,
      review.set_id,
      review.question_id,
      review.created_at,
      JSON.stringify(review),
    ]);
  }

  getReviews(setId: string) {
    return this.all<Review>(`SELECT data FROM reviews WHERE set_id = ? ORDER BY created_at, rowid`, [setId]);
  }

  // ---------- 作答、批改、诊断 ----------
  async saveResponses(setId: string, responses: ResponseRecord[]): Promise<void> {
    for (const r of responses) {
      await this.write(`INSERT INTO responses (question_id, set_id, data) VALUES (?, ?, ?)`, [r.question_id, setId, JSON.stringify(r)]);
    }
  }

  getResponses(setId: string) {
    return this.all<ResponseRecord>(`SELECT data FROM responses WHERE set_id = ?`, [setId]);
  }

  async saveGradings(setId: string, gradings: Grading[]): Promise<void> {
    for (const g of gradings) {
      await this.write(`INSERT OR REPLACE INTO gradings (question_id, set_id, data) VALUES (?, ?, ?)`, [g.question_id, setId, JSON.stringify(g)]);
    }
  }

  getGradings(setId: string) {
    return this.all<Grading>(`SELECT data FROM gradings WHERE set_id = ?`, [setId]);
  }

  async saveDiagnosis(d: Diagnosis): Promise<void> {
    await this.write(`INSERT OR REPLACE INTO diagnoses (set_id, created_at, data) VALUES (?, ?, ?)`, [d.set_id, d.created_at, JSON.stringify(d)]);
  }

  getDiagnosis(setId: string) {
    return this.one<Diagnosis>(`SELECT data FROM diagnoses WHERE set_id = ?`, [setId]);
  }

  // ---------- 调用日志 ----------
  async logCall(c: Omit<LLMCall, "id" | "created_at">): Promise<void> {
    const call: LLMCall = { ...c, id: newId(), created_at: now() };
    await this.write(`INSERT INTO llm_calls (id, set_id, role, created_at, data) VALUES (?, ?, ?, ?, ?)`, [
      call.id,
      call.set_id,
      call.role,
      call.created_at,
      JSON.stringify(call),
    ]);
  }

  listCalls(limit = 100, setId?: string) {
    return setId
      ? this.all<LLMCall>(`SELECT data FROM llm_calls WHERE set_id = ? ORDER BY created_at DESC LIMIT ?`, [setId, limit])
      : this.all<LLMCall>(`SELECT data FROM llm_calls ORDER BY created_at DESC LIMIT ?`, [limit]);
  }
}

/** Cloudflare D1 → Sql */
export function d1Sql(db: D1Database): Sql {
  return {
    async run(query, params = []) {
      await db.prepare(query).bind(...params).run();
    },
    async all<T>(query: string, params: unknown[] = []) {
      const { results } = await db.prepare(query).bind(...params).all<T>();
      return results;
    },
  };
}
