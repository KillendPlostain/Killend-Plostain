// npm run dev：启动网站，同时在后台启动本机桥（claude 订阅 + 沙箱验算）。
// 桥已经在运行（比如另一个终端开着）就不再重复启动。关掉网站时桥也一起关掉。
//
// 可选的环境变量（桌面快捷方式 Plostain.cmd 会设置）：
//   PLOSTAIN_OPEN_BROWSER=1          网站就绪后自动打开浏览器
//   PLOSTAIN_AUTO_STOP_MINUTES=180   运行这么多分钟后自动关闭；到点时模型还在出题 / 验算，就等它跑完再关
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITE = "http://localhost:5173";
const BRIDGE = "http://127.0.0.1:8790";
const openBrowser = process.env.PLOSTAIN_OPEN_BROWSER === "1";
const autoStopMinutes = Number(process.env.PLOSTAIN_AUTO_STOP_MINUTES) || 0;

const isUp = (url) =>
  fetch(url, { signal: AbortSignal.timeout(1500) })
    .then(() => true)
    .catch(() => false);
// Windows 用 start，Mac 用 open
const open = (url) =>
  (process.platform === "win32"
    ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true })
    : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" })
  )
    .on("error", () => console.log(`请手动在浏览器打开 ${url}`))
    .unref();
const time = () => new Date().toTimeString().slice(0, 5);

// 网站已经开着：直接打开网页，不重复启动
if (await isUp(`${SITE}/api/history`)) {
  console.log("Plostain 已经在运行了。");
  if (openBrowser) open(SITE);
  process.exit(0);
}

if (!(await isUp(`${BRIDGE}/status`))) {
  // fileURLToPath 会把 %E5%BC%A0 这类编码还原成中文路径
  const bridge = spawn(process.execPath, [fileURLToPath(new URL("./claude-bridge.mjs", import.meta.url))], { stdio: "inherit" });
  process.on("exit", () => bridge.kill());
  process.on("SIGINT", () => process.exit(0));
}

if (openBrowser) {
  (async () => {
    for (let i = 0; i < 120 && !(await isUp(`${SITE}/api/history`)); i++) await new Promise((r) => setTimeout(r, 1000));
    open(SITE);
  })();
}

if (autoStopMinutes > 0) {
  const deadline = Date.now() + autoStopMinutes * 60_000;
  let warned = false;
  console.log(`\n[Plostain] 将在 ${autoStopMinutes} 分钟后自动关闭（到点时模型还在工作就等它跑完）。\n`);
  setInterval(async () => {
    const left = deadline - Date.now();
    if (!warned && left <= 10 * 60_000 && left > 0) {
      warned = true;
      console.log(`\n[Plostain] ${time()} 再过约 10 分钟自动关闭。答题草稿会保存在浏览器里，重新打开还在。\n`);
    }
    if (left > 0) return;
    const status = await fetch(`${BRIDGE}/status`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .catch(() => ({ active: 0 }));
    if (status.active > 0) {
      console.log(`[Plostain] ${time()} 到时间了，但模型还在工作（${status.active} 个任务），等它跑完再关。`);
      return;
    }
    console.log(`\n[Plostain] ${time()} 已运行 ${autoStopMinutes} 分钟，自动关闭。下次双击桌面上的 Plostain 重新打开。\n`);
    // 连同桥和后台的预览进程一起结束（Windows 下按进程树结束最干净）
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(process.pid), "/T", "/F"]);
    // Mac 上相当于按一次 Ctrl+C，让网站自己收尾
    else process.kill(process.pid, "SIGINT");
    if (process.platform === "win32") process.exit(0);
  }, 30_000).unref();
}

process.argv = [process.argv[0], "run-framework", "dev", ...process.argv.slice(2)];
await import("./run-framework.mjs");
