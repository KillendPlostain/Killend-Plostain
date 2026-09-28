// 给配置里的某几个 provider 各发一个很小的请求，确认能连通。
// 运行：node --env-file=.env tests/manual/ping.ts fable opus glm:glm-5.3-flash claude_cli:claude-fable-5-1
import { z } from "zod";
import config from "../../plostain.config.ts";
import { callRole } from "../../lib/plostain/llm.ts";
import type { Store } from "../../lib/plostain/store.ts";

const logs: { error: string; latency_ms: number; tokens_in: number | null; tokens_out: number | null }[] = [];
const store = { logCall: async (c: never) => void logs.push(c) } as unknown as Store;

for (const arg of process.argv.slice(2)) {
  const [provider, modelName = ""] = arg.split(":"); // 例如 claude_cli:claude-fable-5-1
  const cfg = { ...config, roles: { ...config.roles, solver: { provider, model: modelName, effort: "low" as const, maxTokens: 2000 } } };
  logs.length = 0;
  try {
    const { data, model } = await callRole(
      { config: cfg, env: process.env as Record<string, string>, store },
      {
        role: "solver",
        prompt: { version: "ping", system: "只输出 JSON。", user: '输出 {"answer": "2"}，其中 answer 是 1+1 的结果。' },
        schema: z.object({ answer: z.coerce.string() }),
        mock: () => ({ answer: "2" }),
      },
    );
    const l = logs.at(-1)!;
    console.log(`✔ ${provider}（${model}）通了：answer=${data.answer}，${(l.latency_ms / 1000).toFixed(1)} 秒，tokens ${l.tokens_in}/${l.tokens_out}`);
  } catch (e) {
    console.log(`✘ ${provider} 失败：${e instanceof Error ? e.message : e}`);
    for (const l of logs) if (l.error) console.log("   ", l.error.slice(0, 400));
  }
}
