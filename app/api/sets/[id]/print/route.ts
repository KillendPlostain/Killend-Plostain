import { route } from "@/lib/plostain/server";
import { getPrintView } from "@/lib/plostain/pipeline";

// 导出试卷 / 答案解析用：只有题目、答案、解析。
export const GET = route<{ id: string }>((ctx, _req, { id }) => getPrintView(ctx, id));
