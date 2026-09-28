import { route } from "@/lib/plostain/server";
import { getSetView } from "@/lib/plostain/pipeline";

// ?as=meta 只看状态；?as=student 作答视图（只有题干）；?as=teacher 审题视图；?as=result 结果页。
export const GET = route<{ id: string }>((ctx, req, { id }) => {
  const as = new URL(req.url).searchParams.get("as");
  return getSetView(ctx, id, as === "meta" || as === "teacher" || as === "result" ? as : "student");
});
