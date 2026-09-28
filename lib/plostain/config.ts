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
}

export interface PlostainConfig {
  providers: Record<string, ProviderConfig>;
  roles: Record<Role, RoleModel>;
  limits: { materialMaxChars: number; minQuestions: number };
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
