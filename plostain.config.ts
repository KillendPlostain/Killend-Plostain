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

  // 角色 → (provider, model)。可选的有：
  //   claude_cli  本机订阅（Max），不额外花钱；只有 Opus 5.5 能用，Fable 5.1 在订阅里要另买用量
  //   glm         智谱，便宜但慢（一次画地图约 9 分钟）
  //   opus/fable  中转 API，按量付费
  // 盲解（solver）用 GLM，其余全部走本机订阅的 Opus 5.5。
  // 盲解和出题用不同的模型，出题模型自己的盲点才更容易被发现。
  roles: {
    mapper: { provider: "claude_cli", model: "claude-opus-5-5" },
    // 制图：把材料放回整个主题里，画完整的知识体系图（只用来画图，不参与出题）
    cartographer: { provider: "claude_cli", model: "claude-opus-5-5" },
    generator: { provider: "claude_cli", model: "claude-opus-5-5" },
    solver: { provider: "glm", model: "glm-5.3-flash" },
    reviewer: { provider: "claude_cli", model: "claude-opus-5-5" },
    grader: { provider: "claude_cli", model: "claude-opus-5-5" },
    diagnostician: { provider: "claude_cli", model: "claude-opus-5-5" },
    // 筑城者：“平原”里用提问帮你确认学习目标的向导
    builder: { provider: "claude_cli", model: "claude-opus-5-5" },
  },

  // 画知识体系图前先联网查资料（教材目录、课程大纲）。只有走本机订阅（claude_cli）时生效。
  atlas: { webSearch: true },
  // 筑城者遇到不熟的领域时，允许它联网查一下再提问
  builder: { webSearch: true },

  limits: {
    materialMaxChars: 20000, // 超过直接拒绝并提示拆分，不静默截断（导入文件时会自动按段切）
    minQuestions: 4, // 审核后少于这个数就提示“材料撑不起这张卷”（快速诊断为 3）
  },
};

export default config;
