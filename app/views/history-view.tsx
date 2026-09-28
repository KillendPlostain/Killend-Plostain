"use client";
// 历史：按时间列出所有练习卷。
import type { ObjectiveMode } from "@/lib/plostain/types";
import { api, Busy, ErrorBox, fmtTime, go, OBJECTIVE_TEXT, PageHeading, Pill, STATUS_TEXT, useLoad } from "./shared";

type Row = {
  id: string;
  material_id: string;
  material_title: string;
  objective: ObjectiveMode;
  mode: "self" | "teacher";
  status: string;
  created_at: string;
  question_count: number;
  correct_count: number;
  hit_rate: number | null;
  is_followup: boolean;
};

export default function HistoryPage() {
  const { data, error, reload } = useLoad(() => api<Row[]>("/api/history"), []);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Busy label="加载中…" />;
  return (
    <>
      <PageHeading eyebrow="HISTORY" title="历史练习" desc="所有数据都保存在本机数据库里，关掉程序再打开也还在。" />
      <section className="panel">
        {data.length === 0 ? (
          <div className="pad muted">还没有练习。</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>材料</th>
                <th>目标</th>
                <th>模式</th>
                <th>状态</th>
                <th>成绩</th>
                <th>押注命中率</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => go(`#/s/${r.id}`)}>
                  <td>{fmtTime(r.created_at)}</td>
                  <td>
                    {r.material_title}
                    {r.is_followup && <span className="muted small"> · 追踪卷</span>}
                  </td>
                  <td>{OBJECTIVE_TEXT[r.objective]}</td>
                  <td>{r.mode === "self" ? "自测" : "教师"}</td>
                  <td>
                    <Pill tone={r.status === "diagnosed" ? "green" : "plain"}>{STATUS_TEXT[r.status]}</Pill>
                  </td>
                  <td>{r.status === "diagnosed" ? `${r.correct_count} / ${r.question_count}` : `${r.question_count} 题`}</td>
                  <td>{r.hit_rate == null ? "—" : `${Math.round(r.hit_rate * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
