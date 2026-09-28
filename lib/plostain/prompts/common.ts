import type { Question } from "../types.ts";

const DB_FIELDS = new Set(["id", "set_id", "status", "sealed_at", "order", "drop_reason"]);

/** 题目 + 设计卡，去掉数据库内部字段后交给模型。 */
export function designCard(q: Question): Record<string, unknown> {
  return Object.fromEntries(Object.entries(q).filter(([k]) => !DB_FIELDS.has(k)));
}
