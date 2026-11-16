import type { Role } from "./types.ts";

export type ProviderConfig =
  | { kind: "mock" }
  | { kind: "openai_compatible"; endpointEnv: string; apiKeyEnv: string }
  // baseUrlEnv 留空 = 官方地址；modelEnv 有值时覆盖 roles 里写的模型名
  | { kind: "anthropic_api"; apiKeyEnv: string; baseUrlEnv?: string; modelEnv?: string }
  | { kind: "claude_cli"; bridgeUrl: string };

export interface RoleModel {
  provider: string; // providers 里的名字
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max"; // 仅 anthropic_api 使用
  maxTokens?: number;
  // 主模型两次都失败时（中转断线、输出不合格等）改用的备用模型
  fallback?: Omit<RoleModel, "fallback">;
}

export interface PlostainConfig {
  providers: Record<string, ProviderConfig>;
  roles: Record<Role, RoleModel>;
  limits: { materialMaxChars: number; minQuestions: number };
  // 画知识体系图时是否让模型联网搜索（只有 claude_cli 支持；其他 provider 靠模型自己的知识）
  atlas?: { webSearch?: boolean };
  // 筑城者对话时是否允许联网搜索（同样只有 claude_cli 支持）
  builder?: { webSearch?: boolean };
  verifierUrl?: string; // 验算服务地址，默认 http://127.0.0.1:8790/verify（本机桥）
}

export type Env = Record<string, string | undefined>;

/** 环境变量 PLOSTAIN_PROVIDER=mock 可临时把所有角色切到 mock（测试、演示用）。 */
export function resolveRole(config: PlostainConfig, role: Role, env: Env): { name: string; provider: ProviderConfig; model: RoleModel } {
  const forced = env.PLOSTAIN_PROVIDER?.trim();
  const roleModel = forced ? { ...config.roles[role], provider: forced } : config.roles[role];
  const provider = config.providers[roleModel.provider];
  if (!provider) throw new Error(`plostain.config.ts 里没有名为 "${roleModel.provider}" 的 provider（角色 ${role}）`);
  if (provider.kind === "mock") return { name: roleModel.provider, provider, model: { ...roleModel, model: "mock" } };
  const envModel = provider.kind === "anthropic_api" && provider.modelEnv ? env[provider.modelEnv]?.trim() : "";
  return { name: roleModel.provider, provider, model: envModel ? { ...roleModel, model: envModel } : roleModel };
}
