// 模型调用层：角色 → provider → 原始文本 → 抽 JSON → schema 校验 → 失败重试一次 → 写 LLMCall 日志。
import type { z } from "zod";
import type { Env, PlostainConfig, ProviderConfig, RoleModel } from "./config.ts";
import { resolveRole } from "./config.ts";
import type { Role } from "./types.ts";
import type { Store } from "./store.ts";

export interface Prompt {
  version: string; // 例如 "generator_v1"
  system: string;
  user: string;
}

interface RawResult {
  text: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface LLMContext {
  config: PlostainConfig;
  env: Env;
  store: Store;
}

class ConfigError extends Error {}

export class LLMOutputError extends Error {
  raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.raw = raw;
  }
}

export async function callRole<S extends z.ZodTypeAny>(
  ctx: LLMContext,
  opts: { role: Role; prompt: Prompt; schema: S; mock: () => unknown; setId?: string | null },
): Promise<{ data: z.infer<S>; model: string }> {
  const { name, provider, model } = resolveRole(ctx.config, opts.role, ctx.env);
  const inputHash = await sha256(opts.prompt.system + "\n\n" + opts.prompt.user);
  let user = opts.prompt.user;
  let lastError = "";
  let lastRaw = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    let raw: RawResult | null = null;
    let error = "";
    let parsed: z.infer<S> | undefined;
    let configError = false;
    try {
      raw = await runProvider(provider, model, { system: opts.prompt.system, user }, ctx.env, opts.mock);
      const result = opts.schema.safeParse(extractJson(raw.text));
      if (result.success) parsed = result.data;
      else error = formatZodError(result.error);
    } catch (e) {
      error = e instanceof Error ? e.message + (e.cause instanceof Error ? `（${e.cause.message}）` : "") : String(e);
      configError = e instanceof ConfigError;
    }
    await ctx.store.logCall({
      role: opts.role,
      provider: name,
      model: model.model,
      prompt_version: opts.prompt.version + (attempt ? " (retry)" : ""),
      input_hash: inputHash,
      output_raw: raw?.text ?? "",
      parsed_ok: parsed !== undefined,
      error,
      tokens_in: raw?.tokensIn ?? null,
      tokens_out: raw?.tokensOut ?? null,
      latency_ms: Date.now() - started,
      set_id: opts.setId ?? null,
    });
    if (parsed !== undefined) return { data: parsed, model: `${name}/${model.model}` };
    lastError = error;
    // 网络错误等调用失败：原样重试一次；配置错误（缺密钥）重试也没用，直接报。
    if (!raw) {
      if (attempt === 1 || configError) throw new Error(`[${opts.role}] 模型调用失败：${error}`);
      continue;
    }
    lastRaw = raw.text;
    user =
      opts.prompt.user +
      `\n\n---\n你上一次的输出没有通过结构校验：\n${error}\n请重新输出完整的 JSON（只输出 JSON，不要任何其他文字）。`;
  }
  throw new LLMOutputError(`[${opts.role}] 输出两次都没有通过校验：${lastError}`, lastRaw);
}

async function runProvider(
  provider: ProviderConfig,
  model: RoleModel,
  prompt: { system: string; user: string },
  env: Env,
  mock: () => unknown,
): Promise<RawResult> {
  switch (provider.kind) {
    case "mock":
      return { text: JSON.stringify(mock()), tokensIn: 0, tokensOut: 0 };
    case "openai_compatible":
      return callOpenAICompatible(provider, model, prompt, env);
    case "anthropic_api":
      return callAnthropic(provider, model, prompt, env);
    case "claude_cli":
      return callClaudeBridge(provider, model, prompt);
  }
}

async function callOpenAICompatible(
  provider: Extract<ProviderConfig, { kind: "openai_compatible" }>,
  model: RoleModel,
  prompt: { system: string; user: string },
  env: Env,
): Promise<RawResult> {
  const endpoint = env[provider.endpointEnv];
  const apiKey = env[provider.apiKeyEnv];
  if (!endpoint || !apiKey) throw new ConfigError(`缺少环境变量 ${provider.endpointEnv} / ${provider.apiKeyEnv}（请在 .env 中配置）`);
  // 用流式：会“先想很久再回答”的模型可能几分钟不返回响应头，非流式请求会被 fetch 超时掐断。
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model.model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      response_format: { type: "json_object" },
      max_tokens: model.maxTokens ?? 32000,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(`HTTP ${res.status}：${body?.error?.message ?? "未知错误"}`);
  }
  let text = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  let buffer = "";
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!line.trim().startsWith("data:") || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message?: string };
        };
        if (chunk.error) throw new Error(chunk.error.message ?? "模型返回错误");
        text += chunk.choices?.[0]?.delta?.content ?? "";
        if (chunk.usage) usage = chunk.usage;
      } catch (e) {
        if (e instanceof SyntaxError) continue; // 不完整的行，跳过
        throw e;
      }
    }
  }
  return { text, tokensIn: usage?.prompt_tokens ?? null, tokensOut: usage?.completion_tokens ?? null };
}

async function callAnthropic(
  provider: Extract<ProviderConfig, { kind: "anthropic_api" }>,
  model: RoleModel,
  prompt: { system: string; user: string },
  env: Env,
): Promise<RawResult> {
  const apiKey = env[provider.apiKeyEnv];
  if (!apiKey) throw new ConfigError(`缺少环境变量 ${provider.apiKeyEnv}（请在 .env 中配置）`);
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // SDK 会自己在地址后拼 /v1/messages；中转站常给完整地址，这里去掉重复的部分。
  const baseURL = (provider.baseUrlEnv ? env[provider.baseUrlEnv]?.trim() ?? "" : "").replace(/\/+$/, "").replace(/\/v1(\/messages)?$/, "");
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  // Fable 5.1 / Opus 5 可能因安全分类器拒答：开启服务端 fallback，拒答时自动换模型重跑。
  // 用自定义地址（中转）时不开，很多中转不认识这个 beta 参数。
  const withFallback = !baseURL && ["claude-fable-5-1", "claude-opus-5"].includes(model.model);
  const params = {
    model: model.model,
    max_tokens: model.maxTokens ?? 32000,
    system: prompt.system,
    messages: [{ role: "user" as const, content: prompt.user }],
    ...(model.effort ? { output_config: { effort: model.effort } } : {}),
    ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
  };
  // 输出可能很长，用流式避免 HTTP 超时，再取完整消息。
  const stream = client.beta.messages.stream(params as Parameters<typeof client.beta.messages.stream>[0]);
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("模型拒绝回答（stop_reason = refusal）");
  if (message.stop_reason === "max_tokens") throw new Error("输出被 max_tokens 截断，请在配置里调大 maxTokens");
  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  return { text, tokensIn: message.usage.input_tokens, tokensOut: message.usage.output_tokens };
}

async function callClaudeBridge(
  provider: Extract<ProviderConfig, { kind: "claude_cli" }>,
  model: RoleModel,
  prompt: { system: string; user: string },
): Promise<RawResult> {
  const res = await fetch(`${provider.bridgeUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.model, system: prompt.system, prompt: prompt.user }),
  }).catch(() => {
    throw new Error(`连不上本机 claude 桥（${provider.bridgeUrl}）。请先在另一个终端运行 npm run claude-bridge`);
  });
  const body = (await res.json()) as { text?: string; tokensIn?: number; tokensOut?: number; error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `claude 桥返回 HTTP ${res.status}`);
  return { text: body.text ?? "", tokensIn: body.tokensIn ?? null, tokensOut: body.tokensOut ?? null };
}

/** 从模型输出里抽出 JSON：容忍 ```json 代码块和前后多余的文字。 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* 落到下面 */
      }
    }
    throw new Error("输出里找不到合法的 JSON");
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`)
    .join("\n");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}
