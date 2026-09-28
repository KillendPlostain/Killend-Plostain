"use client";
// 题目相关的展示块：题面、设计卡、来源与出题理由、审核记录。审题页和结果页共用。
import type { MaterialMap, Question, Review } from "@/lib/plostain/types";
import { CHECK_TEXT, ISSUE_TEXT, Pill, ROLE_TEXT, Stem, TYPE_TEXT, VERDICT_TEXT } from "./shared";

export function QuestionHead({ q, children }: { q: Question; children?: React.ReactNode }) {
  return (
    <div className="q-head">
      <span className="q-label">{q.label}</span>
      <Pill>{TYPE_TEXT[q.type]}</Pill>
      <Pill tone="blue">{ROLE_TEXT[q.role] ?? q.role}</Pill>
      <Pill>{q.target_ability}</Pill>
      <span className="q-head-right">{children}</span>
    </div>
  );
}

export function QuestionBody({ q, showAnswer }: { q: Question; showAnswer?: boolean }) {
  return (
    <>
      <Stem text={q.stem} />
      {q.type === "single_choice" && (
        <ul className="options">
          {q.options.map((o) => (
            <li key={o.key} className={showAnswer && o.key.toUpperCase() === q.answer.trim().toUpperCase().charAt(0) ? "correct" : ""}>
              <b>{o.key}.</b> {o.text}
            </li>
          ))}
        </ul>
      )}
      {showAnswer && (
        <div className="answer-line">
          <b>标准答案：</b>
          <code>{q.answer}</code>
          {q.accepted_answers.length > 0 && <span className="muted small">（也接受：{q.accepted_answers.join(" / ")}）</span>}
        </div>
      )}
      {showAnswer && q.explanation && <p className="explain">{q.explanation}</p>}
    </>
  );
}

export function DesignCard({ q, map }: { q: Question; map?: MaterialMap | null }) {
  const mis = (id: string) => map?.data.misconceptions.find((m) => m.id === id)?.description;
  return (
    <div className="card-block">
      <dl className="kv">
        <dt>诊断目的</dt>
        <dd>{q.diagnostic_purpose || "—"}</dd>
        <dt>难在哪</dt>
        <dd>{q.difficulty_source || "—"}</dd>
        {q.paired_with.length > 0 && (
          <>
            <dt>配对题</dt>
            <dd>{q.paired_with.join("、")}</dd>
          </>
        )}
        <dt>封存时间</dt>
        <dd>{new Date(q.sealed_at).toLocaleString()}</dd>
      </dl>
      <table className="mini-table">
        <thead>
          <tr>
            <th>押注的错答</th>
            <th>对应误解</th>
            <th>为什么会这样答</th>
          </tr>
        </thead>
        <tbody>
          {q.error_map.map((e, i) => (
            <tr key={i}>
              <td>
                <code>{e.wrong_answer}</code>
              </td>
              <td>
                <b>{e.misconception_id}</b> {mis(e.misconception_id)}
              </td>
              <td>{e.reasoning}</td>
            </tr>
          ))}
          {!q.error_map.length && (
            <tr>
              <td colSpan={3} className="muted">
                没有错答押注
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SourceCard({ q, map }: { q: Question; map?: MaterialMap | null }) {
  return (
    <div className="card-block">
      {q.kp_ids.map((id) => {
        const kp = map?.data.knowledge_points.find((k) => k.id === id);
        return (
          <div key={id} className="source-kp">
            <b>{id}</b> {kp?.name ?? "（地图中没有这个知识点）"}
            {kp && <blockquote>“{kp.anchor}”</blockquote>}
          </div>
        );
      })}
      <p>
        <b>出题理由：</b>
        {q.rationale || "—"}
      </p>
    </div>
  );
}

export function ReviewLog({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) return <p className="muted small">还没有审核记录。</p>;
  return (
    <div className="card-block">
      {reviews.map((r) => (
        <div key={r.id} className="review-round">
          <div className="review-head">
            第 {r.round} 轮 · 审核结论 <Pill tone={r.data.verdict === "keep" ? "green" : r.data.verdict === "revise" ? "amber" : "red"}>{VERDICT_TEXT[r.data.verdict]}</Pill>
          </div>
          <p>
            <b>盲解答案：</b>
            <code>{r.solver_answer || "（无）"}</code> <span className="muted small">{r.solver_reasoning}</span>
          </p>
          {r.data.solver_mismatch_judgement && (
            <p>
              <b>答案不一致的判定：</b>
              {r.data.solver_mismatch_judgement}
            </p>
          )}
          {r.data.issues.length > 0 && (
            <ul className="plain-list">
              {r.data.issues.map((i, k) => (
                <li key={k}>
                  <Pill tone="red">{ISSUE_TEXT[i.kind] ?? i.kind}</Pill> {i.detail}
                </li>
              ))}
            </ul>
          )}
          {r.data.surface_checks && Object.keys(r.data.surface_checks).length > 0 && (
            <details>
              <summary className="small">卷面评估</summary>
              <dl className="kv small">
                {Object.entries(r.data.surface_checks).map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>{CHECK_TEXT[k] ?? k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
