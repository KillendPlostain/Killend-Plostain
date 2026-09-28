// Plostain 模型配置：换模型只改这个文件。
// 密钥不写在这里，只写“去哪个环境变量读”（环境变量放在 .env，不进仓库）。
import type { PlostainConfig } from "./lib/plostain/config.ts";

const config: PlostainConfig = {
  providers: {
    // 固定 JSON，不花钱，用于开发和测试。
    mock: { kind: "mock" },

    // 智谱 GLM（OpenAI 兼容接口）。Codex 已在 .env 里配好了 LLM_ENDPOINT / LLM_API_KEY。
    glm: { kind: "openai_compatible", endpointEnv: "LLM_ENDPOINT", apiKeyEnv: "LLM_API_KEY" },

    // Anthropic API（服务端保存 key）。两套配置，各自的地址 / 密钥 / 模型都写在 .env。
    // 地址留空 = Anthropic 官方地址。
    fable: { kind: "anthropic_api", baseUrlEnv: "FABLE_ENDPOINT", apiKeyEnv: "FABLE_API_KEY", modelEnv: "FABLE_MODEL" },
    opus: { kind: "anthropic_api", baseUrlEnv: "OPUS_ENDPOINT", apiKeyEnv: "OPUS_API_KEY", modelEnv: "OPUS_MODEL" },

    // 本机 `claude -p`，走个人订阅。仅限本人本机：先运行 `npm run claude-bridge`。
    claude_cli: { kind: "claude_cli", bridgeUrl: "http://127.0.0.1:8790" },
  },

  // 角色 → (provider, model)。按花钱多少排：
  //   glm         智谱，便宜
  //   claude_cli  本机订阅（Max），不额外花钱；只有 Opus 5.5 能用，Fable 5.1 在订阅里要另买用量
  //   opus/fable  中转 API，按量付费——只有出题用 Fable，opus 备用
  // 出题用 Fable；审核、诊断走订阅 Opus；其余用 GLM。
  // solver 用 GLM，正好和出题的 Opus 不同源，更容易发现题目问题。
  roles: {
    mapper: { provider: "glm", model: "glm-5.3-flash" },
    // 出题决定整张卷的质量，用中转 API 的 Fable 5.1（按量付费，每张卷约一次调用）。
    // effort 调成 "high" 更仔细但更贵；想省钱就换回 { provider: "claude_cli", model: "claude-opus-5-5" }。
    generator: { provider: "fable", model: "claude-fable-5-1", effort: "medium" },
    solver: { provider: "glm", model: "glm-5.3-flash" },
    reviewer: { provider: "claude_cli", model: "claude-opus-5-5" },
    grader: { provider: "glm", model: "glm-5.3-flash" },
    diagnostician: { provider: "claude_cli", model: "claude-opus-5-5" },
  },

  limits: {
    materialMaxChars: 8000, // 超过直接拒绝并提示拆分，不静默截断
    minQuestions: 4, // 审核后少于这个数就提示“材料撑不起这张卷”（快速诊断为 3）
  },
};

export default config;
