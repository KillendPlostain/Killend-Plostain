// 本机桥：/run 让网站后端通过 `claude -p` 走个人订阅额度；/verify 在沙箱 Python 里运行验算程序。
// 仅限本人、本机使用——只监听 127.0.0.1，给别人用必须改走 API（provider: fable / opus）。
//
// 用法：另开一个终端运行 `npm run claude-bridge`，
// 然后在 plostain.config.ts 里把某个角色设为 { provider: "claude_cli", model: "fable" }。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks } from "./verify-runner.mjs";

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT ?? 8790);
// 官方安装脚本把 claude 装在 ~/.local/bin，但不一定加进了 PATH；找得到就直接用完整路径。
const LOCAL = join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
const CLAUDE = process.env.CLAUDE_BIN ?? (existsSync(LOCAL) ? LOCAL : "claude");

// claude 在一个空文件夹里运行：这样它读不到项目里的任何文件（包括 .env），
// 也不会把项目的 CLAUDE.md 当成指令带进出题、批改的提示词里。
const SANDBOX_DIR = join(tmpdir(), "plostain-claude-empty");
mkdirSync(SANDBOX_DIR, { recursive: true });
// 网站可以请求打开的工具。目前只有联网搜索（画知识体系图时用），其他一律不给。
const TOOLS_ALLOWED = new Set(["WebSearch"]);

function runClaude({ model, system, prompt, tools }) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json"];
    if (model) args.push("--model", model);
    // 工具收紧到“只有点名的这几个”：默认一个都没有（不能运行命令、不能读写文件），也不加载任何 MCP 服务和技能。
    // 这样即使材料或搜索结果里夹带了指令，模型也没有手可以动。
    const useShell = CLAUDE === "claude" && process.platform === "win32";
    const allowed = (Array.isArray(tools) ? tools : []).filter((t) => TOOLS_ALLOWED.has(t));
    args.push("--tools", allowed.length ? allowed.join(",") : useShell ? '""' : "");
    if (allowed.length) args.push("--allowedTools", allowed.join(","));
    args.push("--strict-mcp-config", "--disable-slash-commands");
    // 系统提示词和用户输入一起从 stdin 传入，避免 Windows 命令行转义问题。
    const child = spawn(CLAUDE, args, {
      shell: useShell,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: SANDBOX_DIR,
      windowsHide: true, // 不弹黑窗口；父进程没有控制台时也能正常启动
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const result = JSON.parse(out);
        if (result.is_error) return reject(new Error(result.result || "claude 返回错误"));
        resolve({
          text: result.result ?? "",
          tokensIn: result.usage?.input_tokens ?? null,
          tokensOut: result.usage?.output_tokens ?? null,
        });
      } catch {
        reject(new Error(`claude 退出码 ${code}：${(err || out).slice(0, 2000)}`));
      }
    });
    child.stdin.end(`${system}\n\n---\n\n${prompt}`);
  });
}

// 正在进行的任务数：启动脚本到点自动关闭前会先问这里，有任务就等它跑完
let active = 0;

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ active }));
    return;
  }
  if (req.method !== "POST" || (req.url !== "/run" && req.url !== "/verify")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const started = Date.now();
  active++;
  res.on("close", () => active--);
  if (req.url === "/verify") {
    // 验算：在沙箱 Python（Pyodide）里运行题目的验算程序
    try {
      const { items } = JSON.parse(body);
      const results = await runChecks(items ?? []);
      console.log(`[verify] ${results.length} 题 ${((Date.now() - started) / 1000).toFixed(1)}s`);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ results }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  try {
    const result = await runClaude(JSON.parse(body));
    console.log(`[claude-bridge] ok ${((Date.now() - started) / 1000).toFixed(1)}s`);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
  } catch (e) {
    console.error("[claude-bridge]", e.message);
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: e.message }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`claude 桥已启动：http://127.0.0.1:${PORT}（仅本机）`));
