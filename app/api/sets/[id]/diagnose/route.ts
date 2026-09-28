import { route } from "@/lib/plostain/server";
import { diagnoseSet } from "@/lib/plostain/pipeline";

// 交卷后诊断失败时，可以单独重跑诊断。
export const POST = route<{ id: string }>(async (ctx, _req, { id }) => {
  await diagnoseSet(ctx, id);
  return { ok: true };
});
