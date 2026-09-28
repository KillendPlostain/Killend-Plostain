import { body, route } from "@/lib/plostain/server";
import { generateSet } from "@/lib/plostain/pipeline";

// 生成练习卷（出题并封存设计卡）。审核是下一步，单独调用，便于前端显示进度。
export const POST = route(async (ctx, req) => {
  const b = await body<{ materialId: string; mapId?: string; objective?: string; parentSetId?: string }>(req);
  return { set: await generateSet(ctx, b) };
});
