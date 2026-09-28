import { body, route } from "@/lib/plostain/server";
import { regenerateQuestion } from "@/lib/plostain/pipeline";

// 单题重出（新题同样过盲解 + 审核）。
export const POST = route<{ id: string; qid: string }>(async (ctx, req, { id, qid }) => {
  const { note } = await body<{ note?: string }>(req);
  return { question: await regenerateQuestion(ctx, id, qid, note ?? "") };
});
