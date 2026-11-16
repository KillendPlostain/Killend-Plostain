import { body, route } from "@/lib/plostain/server";
import { buildAtlas, getMaterialView } from "@/lib/plostain/pipeline";

// 画（或重画）知识体系图。已经有图时默认直接返回，body 里带 force: true 才重画。
export const POST = route<{ id: string }>(async (ctx, req, { id }) => {
  const { force } = await body<{ force?: boolean }>(req);
  await buildAtlas(ctx, id, force === true);
  return getMaterialView(ctx, id);
});
