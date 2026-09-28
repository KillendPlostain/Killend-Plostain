import { body, route } from "@/lib/plostain/server";
import { dropQuestion, editQuestion } from "@/lib/plostain/pipeline";

// 教师编辑单题。
export const PATCH = route<{ id: string; qid: string }>(async (ctx, req, { id, qid }) => ({
  question: await editQuestion(ctx, id, qid, await body(req)),
}));

// 教师删除单题。
export const DELETE = route<{ id: string; qid: string }>(async (ctx, _req, { id, qid }) => {
  await dropQuestion(ctx, id, qid);
  return { ok: true };
});
