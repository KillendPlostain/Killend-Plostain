// 验算：把每道题的验算程序交给沙箱 Python 运行，按输出判定 PASS / FAIL。
// 运行在本机桥（scripts/claude-bridge.mjs 的 /verify）；测试里可以通过 ctx.runChecks 直接注入。
import type { Question, Verification } from "./types.ts";
import type { LLMContext } from "./llm.ts";
import { now } from "./store.ts";

export type CheckRunner = (
  items: { id: string; code: string }[],
) => Promise<{ id: string; status: "ok" | "error" | "timeout"; stdout: string; stderr: string }[]>;

const DEFAULT_URL = "http://127.0.0.1:8790/verify";

function lastLine(s: string): string {
  return s.trim().split("\n").filter(Boolean).pop()?.trim() ?? "";
}

/** 返回每道题的验算结果（key 是题目 id）。没有验算程序的题标为 none。 */
export async function verifyQuestions(
  ctx: LLMContext & { runChecks?: CheckRunner },
  questions: Question[],
): Promise<Map<string, Verification>> {
  const out = new Map<string, Verification>();
  const items = questions.filter((q) => q.check.code.trim()).map((q) => ({ id: q.id, code: withAnswerVars(q) }));
  for (const q of questions) {
    if (!q.check.code.trim()) out.set(q.id, { status: "none", detail: q.check.note || "这道题没有验算程序", output: "", at: now() });
  }
  if (!items.length) return out;

  let results: Awaited<ReturnType<CheckRunner>>;
  try {
    results = ctx.runChecks ? await ctx.runChecks(items) : await viaBridge(ctx.config.verifierUrl ?? DEFAULT_URL, items);
  } catch (e) {
    const detail = `没能运行验算（${e instanceof Error ? e.message : String(e)}）`;
    for (const it of items) out.set(it.id, { status: "skipped", detail, output: "", at: now() });
    return out;
  }
  for (const r of results) {
    const output = (r.stdout + (r.stderr ? `\n${r.stderr}` : "")).trim().slice(-2000);
    const last = lastLine(r.stdout);
    let v: Verification;
    if (r.status === "timeout") v = { status: "error", detail: "验算程序运行超时", output, at: now() };
    else if (r.status === "error") v = { status: "error", detail: `验算程序出错：${lastLine(r.stderr) || "未知错误"}`, output, at: now() };
    else if (/^PASS\b/i.test(last)) v = { status: "pass", detail: "验算通过", output, at: now() };
    else if (/^FAIL\b/i.test(last)) v = { status: "fail", detail: last.replace(/^FAIL:?\s*/i, "") || "验算不通过", output, at: now() };
    else v = { status: "error", detail: "验算程序没有在最后一行打印 PASS 或 FAIL", output, at: now() };
    out.set(r.id, v);
  }
  return out;
}

/**
 * 在验算程序前面放上卷面上当前的答案：ANSWER（标准答案）、ACCEPTED（等价写法）、OPTIONS（选项字母 → 文字）。
 * 程序拿 ANSWER 比对，而不是把答案抄进代码——这样老师改了答案，验算会按新答案重新判断。
 * JSON 的字符串、列表、对象写法同时也是合法的 Python 写法。
 */
function withAnswerVars(q: Question): string {
  const options = Object.fromEntries(q.options.map((o) => [o.key, o.text]));
  return [
    `ANSWER = ${JSON.stringify(q.answer)}`,
    `ACCEPTED = ${JSON.stringify(q.accepted_answers)}`,
    `OPTIONS = ${JSON.stringify(options)}`,
    q.check.code,
  ].join("\n");
}

async function viaBridge(url: string, items: { id: string; code: string }[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  }).catch(() => {
    throw new Error("连不上本机桥，请用 npm run dev 启动网站（会自动启动桥）");
  });
  const body = (await res.json()) as { results?: Awaited<ReturnType<CheckRunner>>; error?: string };
  if (!res.ok || !body.results) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.results;
}
