// 本机 claude CLI 桥：让网站后端通过 `claude -p` 走个人订阅额度。
// 仅限本人、本机使用——只监听 127.0.0.1，给别人用必须改走 API（provider: fable / opus）。
//
// 用法：另开一个终端运行 `npm run claude-bridge`，
// 然后在 plostain.config.ts 里把某个角色设为 { provider: "claude_cli", model: "fable" }。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT ?? 8790);
// 官方安装脚本把 claude 装在 ~/.local/bin，但不一定加进了 PATH；找得到就直接用完整路径。
const LOCAL = join(homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
const CLAUDE = process.env.CLAUDE_BIN ?? (existsSync(LOCAL) ? LOCAL : "claude");

function runClaude({ model, system, prompt }) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json"];
    if (model) args.push("--model", model);
    // 系统提示词和用户输入一起从 stdin 传入，避免 Windows 命令行转义问题。
    const child = spawn(CLAUDE, args, { shell: CLAUDE === "claude" && process.platform === "win32", stdio: ["pipe", "pipe", "pipe"] });
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

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/run") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const started = Date.now();
  try {
    const result = await runClaude(JSON.parse(body));
    console.log(`[claude-bridge] ok ${((Date.now() - started) / 1000).toFixed(1)}s`);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
  } catch (e) {
    console.error("[claude-bridge]", e.message);
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: e.message }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`claude 桥已启动：http://127.0.0.1:${PORT}（仅本机）`));
