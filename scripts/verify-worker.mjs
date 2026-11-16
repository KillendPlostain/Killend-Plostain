// 在单独的线程里用 Pyodide（WebAssembly 版 Python）运行验算程序。
// Pyodide 只有自己的虚拟文件系统，碰不到电脑上的真实文件；
// 加载后先把 Python 通往 JavaScript 的入口（js、pyodide.code 等）拿掉，防止程序借道 JS 做别的事。
// 加载一次（约 1 秒），之后逐个接收 { id, code } 运行，每段程序用一个全新的命名空间。
import { parentPort } from "node:worker_threads";
import { loadPyodide } from "pyodide";

const py = await loadPyodide();
let stdout = "";
let stderr = "";
py.setStdout({ batched: (s) => (stdout += s + "\n") });
py.setStderr({ batched: (s) => (stderr += s + "\n") });
py.runPython(`
import sys
for _m in ["js", "pyodide_js", "pyodide", "pyodide.code", "pyodide.ffi", "pyodide.http", "pyodide.webloop", "_pyodide", "micropip"]:
    sys.modules[_m] = None
del _m
`);
const newDict = py.globals.get("dict");

parentPort.on("message", async ({ id, code }) => {
  stdout = "";
  stderr = "";
  const scope = newDict();
  try {
    await py.runPythonAsync(code, { globals: scope });
    parentPort.postMessage({ id, status: "ok", stdout, stderr });
  } catch (e) {
    // 只保留 Python 报错的最后几行，够看清是哪一行出了什么错
    const msg = String(e?.message ?? e).trim().split("\n").slice(-6).join("\n");
    parentPort.postMessage({ id, status: "error", stdout, stderr: (stderr + msg).trim() });
  } finally {
    scope.destroy();
  }
});
parentPort.postMessage({ ready: true });
