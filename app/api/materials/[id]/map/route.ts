import { route } from "@/lib/plostain/server";
import { getMaterialView, regenerateMap } from "@/lib/plostain/pipeline";

// 重新生成材料地图。
export const POST = route<{ id: string }>(async (ctx, _req, { id }) => {
  await regenerateMap(ctx, id);
  return getMaterialView(ctx, id);
});
