import { body, route } from "@/lib/plostain/server";
import { createMaterial, mapForViewer } from "@/lib/plostain/pipeline";

// 新建练习：保存材料并生成材料地图。
export const POST = route(async (ctx, req) => {
  const { material, map } = await createMaterial(ctx, await body(req));
  return { material, map: mapForViewer(map, material.mode === "teacher") };
});
