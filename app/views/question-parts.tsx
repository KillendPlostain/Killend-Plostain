"use client";
// 题目相关的展示块：题面、设计卡、来源与出题理由、审核记录。审题页和结果页共用。
import type { MaterialMap, Question, Review } from "@/lib/plostain/types";
import type { CoverageReport } from "@/lib/plostain/coverage";
import { CHECK_TEXT, ISSUE_TEXT, Pill, ROLE_TEXT, Stem, TYPE_TEXT, VERDICT_TEXT } from "./shared";
import { Rich } from "./rich";
import { RELATION_TEXT } from "@/lib/plostain/lint";

const VERIFY_PILL = {
  pass: { tone: "green", text: "验算通过" },
  fail: { tone: "red", text: "验算未通过" },
  error: { tone: "amber", text: "验算程序出错" },
  none: { tone: "plain", text: "无法程序验算" },
  skipped: { tone: "plain", text: "未验算" },
} as const;

export function QuestionHead({ q, children }: { q: Question; children?: React.ReactNode }) {
  return (
    <div className="q-head">
      <span className="q-label">{q.label}</span>
      <Pill>{TYPE_TEXT[q.type]}</Pill>
      <Pill tone="blue">{ROLE_TEXT[q.role] ?? q.role}</Pill>
      <Pill>{q.target_ability}</Pill>
      {q.pair_group && (
        <Pill tone="amber">
          对照 {q.pair_group}
          {RELATION_TEXT[q.pair_relation] ? ` · ${RELATION_TEXT[q.pair_relation]}` : ""}
        </Pill>
      )}
      {q.verification && (
        <span title={q.verification.detail}>
          <Pill tone={VERIFY_PILL[q.verification.status].tone}>{VERIFY_PILL[q.verification.status].text}</Pill>
        </span>
      )}
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
              <b>{o.key}.</b> <Rich text={o.text} />
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
      {showAnswer && q.explanation && (
        <p className="explain">
          <Rich text={q.explanation} />
        </p>
      )}
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
      <div className="verify-block">
        <b>程序验算：</b>
        {q.verification ? (
          <span>
            <Pill tone={VERIFY_PILL[q.verification.status].tone}>{VERIFY_PILL[q.verification.status].text}</Pill> {q.verification.detail}
          </span>
        ) : (
          <span className="muted">还没有验算</span>
        )}
        {q.check.note && <p className="small muted">验算思路：{q.check.note}</p>}
        {q.check.code && (
          <details>
            <summary className="small">验算程序{q.verification?.output ? "和运行输出" : ""}</summary>
            <pre className="code">{q.check.code}</pre>
            {q.verification?.output && <pre className="code verify-output">{q.verification.output}</pre>}
          </details>
        )}
      </div>
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

/** 覆盖情况：主干知识点测到了几个，材料前 / 中 / 后段各有多少题。由代码统计，不是模型自评。 */
export function CoverageCard({ c }: { c: CoverageReport }) {
  const full = c.core_covered === c.core_total;
  return (
    <section className="panel pad coverage">
      <div className="coverage-head">
        <h2 className="panel-h">覆盖情况</h2>
        <Pill tone={full ? "green" : "amber"}>
          主干知识点 {c.core_covered} / {c.core_total}
        </Pill>
      </div>
      <div className="seg-row">
        {c.segments.map((s) => (
          <div key={s.name} className="seg">
            <span>材料{s.name}</span>
            <strong>{s.questions} 题涉及</strong>
            <em>
              知识点 {s.kp_covered}/{s.kp_total} 有题
            </em>
          </div>
        ))}
      </div>
      {c.uncovered.length > 0 && (
        <p className="small">
          <b>没有题测到：</b>
          {c.uncovered.map((u) => `${u.kp_id} ${u.name}`).join("；")}
        </p>
      )}
      <p className="small muted">一道题可能同时测好几段的知识点，所以三段的题数加起来可能多于总题数。</p>
      {c.unlocated > 0 && <p className="small muted">有 {c.unlocated} 个知识点的原文锚点在材料里没找到（多半是模型改动了措辞），没有计入分段统计。</p>}
    </section>
  );
}
