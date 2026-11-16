# Killend Plostain

把一份学习材料变成一张“每道题都有诊断目的”的小型综合练习卷；做完后告诉你卡在哪一步、证据是哪几道题，并据此建议下一卷测什么。

完整流程：`材料 → 材料地图 → 出题（设计卡封存）→ 盲解 + 审核 → 作答 → 批改 → 基于证据的诊断`

**第一次用，请先看 [使用说明书](docs/使用说明书.md)。**

## 运行

需要 Node.js 22.13 以上。

```bash
npm run install:ci     # 第一次：安装依赖
npm run dev:mock       # 用 mock 模型启动（不花钱，适合看界面、调流程）
npm run dev            # 用 plostain.config.ts 里配置的真实模型启动
npm test               # 用 mock 跑完整流程的测试
```

启动后打开 http://localhost:5173 。只监听本机。

## 克隆到自己电脑上运行

1. 安装 [Node.js](https://nodejs.org) 22.13 以上（选 LTS 版）和 git。
2. 克隆并安装依赖：

   ```bash
   git clone https://github.com/KillendPlostain/Killend-Plostain.git
   cd Killend-Plostain
   npm run install:ci
   ```

3. 先用 mock 模式跑起来，不需要任何账号和密钥：

   ```bash
   npm run dev:mock
   ```

   打开 http://localhost:5173 。mock 模式下出的题是固定的示例，但所有界面都能看：材料地图（知识体系图）、作答、诊断页，以及首页的“平原”（实时 3D 场景，里面有筑城者对话和学习日志）。
4. 想用真实模型出题，二选一：
   - **走 API**：把 `.env.example` 复制一份改名为 `.env`，填上自己的密钥，再在 `plostain.config.ts` 里把各个角色改成 `glm` / `opus` / `fable`。
   - **走自己的 Claude 订阅**：安装 claude 命令并运行 `claude auth login`。`plostain.config.ts` 默认就是大部分角色走本机订阅（`claude_cli`），盲解走 GLM（需要在 `.env` 里填 GLM 的密钥）。

   然后用 `npm run dev` 启动。

注意：

- 每个人用自己的密钥和订阅。`.env` 不会进仓库，也不要互相发送。
- 练习记录存在各自电脑上（`.wrangler/state`），不会同步。
- “平原”需要支持 WebGL2 的显卡；带不动时会自动退回 2D 版，也可以直接打开 `http://localhost:5173/#/plain/2d`。
- Mac 用户可以参考 [Mac使用指南.md](Mac使用指南.md)，其中“传压缩包”的步骤换成上面的 `git clone` 即可；装好后双击 `Plostain.command` 也能启动。

## 换模型

只改 [`plostain.config.ts`](plostain.config.ts)：

- `providers`：`mock`、`glm`（OpenAI 兼容接口）、`fable` / `opus`（Anthropic API，两套配置）、`claude_cli`（本机 `claude -p`）
- `roles`：各个角色（地图、制图、出题、盲解、审核、批改、诊断、筑城者）各自用哪个 provider、哪个模型

密钥写在 `.env`（参考 `.env.example`），只在服务端读取。
用个人 Claude 订阅：另开一个终端 `npm run claude-bridge`，再把角色设为 `{ provider: "claude_cli", model: "fable" }`。这只限本人本机使用；给别人用必须走 API。

## 目录

| 位置 | 内容 |
| --- | --- |
| `lib/plostain/types.ts` | 核心数据对象（需求说明第 8 节）和模型输出的 schema |
| `lib/plostain/pipeline.ts` | 流水线编排、审核轮次、诊断规则兜底、各视图的可见性 |
| `lib/plostain/prompts/` | 各个角色的提示词，每个带版本号 |
| `lib/plostain/atlas.ts` | 知识体系图（脑图）：整理模型画的图、排版 |
| `lib/plostain/llm.ts` | provider 抽象：调用 → 抽 JSON → 校验 → 重试一次 → 写调用日志 |
| `lib/plostain/grading.ts` | 规则批改、错答地图对照 |
| `lib/plostain/store.ts` | SQLite 读写（本机开发时数据在 `.wrangler/state`） |
| `lib/plostain/mock.ts` | mock 输出：第 16 节示例，Q3 故意埋错用来检验审核 |
| `app/api/` | 网站后端接口 |
| `app/views/` | 页面：新建、地图、审题、作答、结果、历史、日志；`plain-*` 是“平原”（3D 场景、筑城者对话、学习日志） |
| `tests/` | `pipeline.test.ts`（mock 全流程）；`manual/real-run.ts`（真实模型跑一遍示例，会花 token） |

## 几条由代码保证的约束

- 出题时设计卡（含错答押注）立即写库并打封存时间；有作答后题目和设计卡只读。
- solver 只拿到题干和选项。
- 自测模式下，交卷前服务端不返回答案、设计卡和地图的易错处。
- 每条诊断推测必须引用卷中真实存在的题号；只有一道题支持的，置信度自动降到“中”。
- 材料超过上限直接拒绝，不截断；审核后题量不足时提示“材料撑不起”，不凑数。

原模板（OpenAI Sites / vinext）的说明见 [docs/sites-template.md](docs/sites-template.md)。
