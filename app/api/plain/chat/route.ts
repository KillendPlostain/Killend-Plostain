import { body, route } from "@/lib/plostain/server";
import { builderChat } from "@/lib/plostain/pipeline";

// 筑城者：带上到目前为止的对话，返回它的下一句话（以及确认后的学习目标）。
export const POST = route(async (ctx, req) => builderChat(ctx, await body(req)));
