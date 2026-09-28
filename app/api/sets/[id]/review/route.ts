import { route } from "@/lib/plostain/server";
import { reviewSet } from "@/lib/plostain/pipeline";

// 盲解 + 审核 + 一轮修订。自测模式审核完自动发布。
export const POST = route<{ id: string }>(async (ctx, _req, { id }) => ({ set: await reviewSet(ctx, id) }));
