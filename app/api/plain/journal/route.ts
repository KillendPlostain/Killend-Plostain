import { body, route } from "@/lib/plostain/server";
import { addGoalToJournal, getJournal } from "@/lib/plostain/pipeline";

// 学习日志：读取全部条目；POST 把一个确认过的学习目标记进去。
export const GET = route(async (ctx) => ({ entries: await getJournal(ctx) }));
export const POST = route(async (ctx, req) => {
  const { goal } = await body<{ goal?: unknown }>(req);
  return { entry: await addGoalToJournal(ctx, goal) };
});
