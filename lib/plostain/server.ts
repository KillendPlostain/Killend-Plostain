// 网站后端的入口：从 Cloudflare 环境里拿 D1 数据库和环境变量，组装成流水线需要的 ctx。
// 只在 API 路由里使用；API key 只在服务端读取，永远不会发到浏览器。
import { env as workerEnv } from "cloudflare:workers";
import config from "../../plostain.config.ts";
import type { Env } from "./config.ts";
import { LLMOutputError } from "./llm.ts";
import { UserError, type Ctx } from "./pipeline.ts";
import { SealedError, Store, d1Sql } from "./store.ts";

let store: Store | null = null;

export function getCtx(): Ctx {
  const bindings = workerEnv as unknown as Record<string, unknown>;
  const db = bindings.DB as D1Database | undefined;
  if (!db) throw new Error("没有找到 D1 数据库绑定 DB（检查 .openai/hosting.json 里的 d1 字段）。");
  store ??= new Store(d1Sql(db));
  const env: Env = {};
  for (const [k, v] of Object.entries(bindings)) if (typeof v === "string") env[k] = v;
  // 某些运行方式下 .env 只进 process.env，这里也读一遍。
  if (typeof process !== "undefined" && process.env) {
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && env[k] === undefined) env[k] = v;
  }
  return { config, env, store };
}

type Handler<P> = (ctx: Ctx, req: Request, params: P) => Promise<unknown>;

/** 包一层：统一 JSON 返回和错误处理。 */
export function route<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: Request, context?: { params?: P | Promise<P> }) => {
    try {
      const params = (await context?.params) ?? ({} as P);
      const result = await handler(getCtx(), req, params);
      return Response.json(result ?? { ok: true });
    } catch (error) {
      if (error instanceof UserError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof SealedError) return Response.json({ error: error.message }, { status: 409 });
      const message = error instanceof Error ? error.message : String(error);
      console.error("[plostain]", error);
      return Response.json(
        { error: message, raw: error instanceof LLMOutputError ? error.raw.slice(0, 4000) : undefined },
        { status: 500 },
      );
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
