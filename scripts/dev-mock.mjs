// 用 mock provider 启动开发服务器：整个流程不调用任何真实模型。
process.env.PLOSTAIN_PROVIDER = "mock";
process.argv = [process.argv[0], new URL("./run-framework.mjs", import.meta.url).pathname, "dev", ...process.argv.slice(2)];
await import("./run-framework.mjs");
