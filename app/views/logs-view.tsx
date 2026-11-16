"use client";
// 模型与调用日志：当前的角色 → 模型映射，以及每一次模型调用的记录（供 A/B 与后续研究）。
import type { LLMCall } from "@/lib/plostain/types";
import { api, Busy, ErrorBox, fmtTime, PageHeading, Pill, useLoad } from "./shared";

type RoleRow = { role: string; provider: string; kind: string; model: string; keyConfigured: boolean };

const ROLE_CN: Record<string, string> = {
  mapper: "地图 mapper",
  cartographer: "制图 cartographer",
  generator: "出题 generator",
  solver: "盲解 solver",
  reviewer: "审核 reviewer",
  grader: "批改 grader",
  diagnostician: "诊断 diagnostician",
  builder: "筑城者 builder",
};

export default function LogsPage() {
  const { data, error, reload } = useLoad(() => api<{ roles: RoleRow[]; calls: LLMCall[] }>("/api/logs"), []);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Busy label="加载中…" />;
  const totalIn = data.calls.reduce((s, c) => s + (c.tokens_in ?? 0), 0);
  const totalOut = data.calls.reduce((s, c) => s + (c.tokens_out ?? 0), 0);
  return (
    <>
      <PageHeading
        eyebrow="MODELS & LOGS"
        title="模型与调用日志"
        desc={
          <>
            换模型只改项目根目录的 <code>plostain.config.ts</code>；密钥放在 <code>.env</code>，只在服务端读取。
          </>
        }
      />
      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>角色</th>
              <th>provider</th>
              <th>模型</th>
              <th>密钥</th>
            </tr>
          </thead>
          <tbody>
            {data.roles.map((r) => (
              <tr key={r.role}>
                <td>{ROLE_CN[r.role] ?? r.role}</td>
                <td>
                  {r.provider} <span className="muted small">({r.kind})</span>
                </td>
                <td>
                  <code>{r.model}</code>
                </td>
                <td>{r.keyConfigured ? <Pill tone="green">已配置</Pill> : <Pill tone="red">缺少</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <h2 className="list-h">
        最近 {data.calls.length} 次调用 <span className="muted small">· 输入 {totalIn.toLocaleString()} tokens · 输出 {totalOut.toLocaleString()} tokens</span>
      </h2>
      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>角色</th>
              <th>模型</th>
              <th>提示词版本</th>
              <th>解析</th>
              <th>tokens 入/出</th>
              <th>耗时</th>
            </tr>
          </thead>
          <tbody>
            {data.calls.map((c) => (
              <tr key={c.id}>
                <td>{fmtTime(c.created_at)}</td>
                <td>{ROLE_CN[c.role] ?? c.role}</td>
                <td>
                  {c.provider}/<code>{c.model}</code>
                </td>
                <td>{c.prompt_version}</td>
                <td>
                  {c.parsed_ok ? (
                    <Pill tone="green">通过</Pill>
                  ) : (
                    <details>
                      <summary>
                        <Pill tone="red">失败</Pill>
                      </summary>
                      <p className="small">{c.error}</p>
                      {c.output_raw && <pre className="code">{c.output_raw.slice(0, 3000)}</pre>}
                    </details>
                  )}
                </td>
                <td>
                  {c.tokens_in ?? "—"} / {c.tokens_out ?? "—"}
                </td>
                <td>{(c.latency_ms / 1000).toFixed(1)} 秒</td>
              </tr>
            ))}
            {!data.calls.length && (
              <tr>
                <td colSpan={7} className="muted">
                  还没有调用记录。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
