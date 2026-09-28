// npm run dev：启动网站，同时在后台启动本机 claude 桥（订阅额度）。
// 桥已经在运行（比如另一个终端开着）就不再重复启动。关掉网站时桥也一起关掉。
import { spawn } from "node:child_process";

const bridgeUp = await fetch("http://127.0.0.1:8790/run", { method: "POST", signal: AbortSignal.timeout(1500) })
  .then(() => true)
  .catch(() => false);
if (!bridgeUp) {
  const bridge = spawn(process.execPath, [new URL("./claude-bridge.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { stdio: "inherit" });
  const stop = () => bridge.kill();
  process.on("exit", stop);
  process.on("SIGINT", () => process.exit(0));
}
process.argv = [process.argv[0], "run-framework", "dev", ...process.argv.slice(2)];
await import("./run-framework.mjs");
