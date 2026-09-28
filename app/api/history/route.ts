import { route } from "@/lib/plostain/server";
import { getHistory } from "@/lib/plostain/pipeline";

export const GET = route((ctx) => getHistory(ctx));
