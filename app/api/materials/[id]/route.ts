import { route } from "@/lib/plostain/server";
import { getMaterialView } from "@/lib/plostain/pipeline";

export const GET = route<{ id: string }>((ctx, _req, { id }) => getMaterialView(ctx, id));
