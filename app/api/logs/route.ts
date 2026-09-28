import { route } from "@/lib/plostain/server";
import { ROLES } from "@/lib/plostain/types";
import { resolveRole } from "@/lib/plostain/config";

// 当前角色 → 模型映射（不含密钥）和最近的调用日志。
export const GET = route(async (ctx, req) => {
  const setId = new URL(req.url).searchParams.get("set") ?? undefined;
  const roles = ROLES.map((role) => {
    const { name, provider, model } = resolveRole(ctx.config, role, ctx.env);
    const keyEnv = "apiKeyEnv" in provider ? provider.apiKeyEnv : null;
    return { role, provider: name, kind: provider.kind, model: model.model, keyConfigured: keyEnv ? !!ctx.env[keyEnv] : true };
  });
  return { roles, calls: await ctx.store.listCalls(200, setId) };
});
