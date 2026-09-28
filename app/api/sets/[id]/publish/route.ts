import { route } from "@/lib/plostain/server";
import { publishSet } from "@/lib/plostain/pipeline";

export const POST = route<{ id: string }>(async (ctx, _req, { id }) => ({ set: await publishSet(ctx, id) }));
