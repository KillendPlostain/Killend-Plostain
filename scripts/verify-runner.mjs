// 批量运行验算程序：起一个沙箱线程（加载一次 Python），逐个运行。
// 某段程序超时，就结束这个线程、换一个新的继续跑剩下的。
// 由本机桥（claude-bridge.mjs 的 /verify）调用，测试里也直接调用。
import { Worker } from "node:worker_threads";

const WORKER = new URL("./verify-worker.mjs", import.meta.url);

/**
 * @param {{ id: string; code: string }[]} items
 * @param {{ timeoutMs?: number; loadTimeoutMs?: number }} [opts]
 * @returns {Promise<{ id: string; status: "ok" | "error" | "timeout"; stdout: string; stderr: string }[]>}
 */
export async function runChecks(items, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 8000; // 每段程序
  const loadTimeoutMs = opts.loadTimeoutMs ?? 30000; // 加载 Python
  const results = [];
  /** @type {{ worker: Worker; ready: Promise<void> } | null} */
  let sandbox = null;

  const start = () => {
    const worker = new Worker(WORKER, { resourceLimits: { maxOldGenerationSizeMb: 512 } });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Python 沙箱启动超时")), loadTimeoutMs);
      worker.once("message", (m) => (clearTimeout(timer), m?.ready ? resolve() : reject(new Error("Python 沙箱启动失败"))));
      worker.once("error", (e) => (clearTimeout(timer), reject(e)));
    });
    return { worker, ready };
  };
  const stop = () => {
    sandbox?.worker.terminate();
    sandbox = null;
  };

  try {
    for (const item of items) {
      sandbox ??= start();
      try {
        await sandbox.ready;
      } catch (e) {
        stop();
        results.push({ id: item.id, status: "error", stdout: "", stderr: String(e?.message ?? e) });
        continue;
      }
      results.push(await runOne(sandbox.worker, item, timeoutMs, stop));
    }
  } finally {
    stop();
  }
  return results;
}

function runOne(worker, { id, code }, timeoutMs, stop) {
  return new Promise((resolve) => {
    const finish = (r) => {
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      resolve({ id, stdout: "", stderr: "", ...r });
    };
    const onMessage = (m) => m?.id === id && finish(m);
    const onError = (e) => (stop(), finish({ status: "error", stderr: String(e?.message ?? e) }));
    const onExit = (c) => (stop(), finish({ status: "error", stderr: `运行线程意外退出（${c}）` }));
    const timer = setTimeout(() => (stop(), finish({ status: "timeout", stderr: `运行超过 ${timeoutMs / 1000} 秒，已强制停止` })), timeoutMs);
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    worker.postMessage({ id, code });
  });
}
