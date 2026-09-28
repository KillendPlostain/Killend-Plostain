import { body, route } from "@/lib/plostain/server";
import { submitSet } from "@/lib/plostain/pipeline";

// 交卷：保存作答 → 批改 → 诊断。
export const POST = route<{ id: string }>(async (ctx, req, { id }) => {
  await submitSet(ctx, id, await body(req));
  return { ok: true };
});
