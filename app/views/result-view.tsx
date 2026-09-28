"use client";
// 第 5 步：结果。诊断分三层（事实 / 推测 / 证据不足），每条推测都能点回证据题；打开封存区对照错答押注。
import { useState } from "react";
import { ArrowRight, ClipboardCheck, Lightbulb, LockOpen, Microscope, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Diagnosis, ExerciseSet, Grading, MaterialMap, Question, ResponseRecord, Review } from "@/lib/plostain/types";
import { api, Busy, CONF_LEVEL_TEXT, CONF_TEXT, ErrorBox, ESTIMATE_TEXT, OBJECTIVE_TEXT, PageHeading, Pill, useLoad } from "./shared";
import { DesignCard, QuestionBody, QuestionHead, ReviewLog, SourceCard } from "./question-parts";
import { useGenerate } from "./generate";

type ResultView = {
  set: ExerciseSet;
  material: { id: string; title: string };
  questions: Question[];
  dropped: Question[];
  reviews: Review[];
  responses: ResponseRecord[];
  gradings: Grading[];
  diagnosis: Diagnosis | null;
  map: MaterialMap;
};

const GRADE_TEXT = { true: "对", false: "错", partial: "部分对" } as const;

function jump(label: string) {
  const el = document.getElementById(`r-${label}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

function Evidence({ labels }: { labels: string[] }) {
  return (
    <span className="evidence">
      {labels.map((l) => (
        <button key={l} className="chip" onClick={() => jump(l)} title="跳到这道题">
          {l}
        </button>
      ))}
    </span>
  );
}

export default function ResultPage({ setId }: { setId: string }) {
  const { data, error, reload } = useLoad(() => api<ResultView>(`/api/sets/${setId}?as=result`), [setId]);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagError, setDiagError] = useState<unknown>(null);
  const gen = useGenerate();

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Busy label="加载中…" />;
  const { set, questions, responses, gradings, diagnosis: d, map, reviews } = data;
  const rByQ = new Map(responses.map((r) => [r.question_id, r]));
  const gByQ = new Map(gradings.map((g) => [g.question_id, g]));
  const correct = questions.filter((q) => gByQ.get(q.id)?.correct === "true").length;
  const wrongSure = questions.filter((q) => gByQ.get(q.id)?.correct !== "true" && rByQ.get(q.id)?.confidence === "sure").length;
  const rightGuess = questions.filter((q) => gByQ.get(q.id)?.correct === "true" && rByQ.get(q.id)?.confidence === "guess").length;
  const kpName = (id: string) => map.data.knowledge_points.find((k) => k.id === id)?.name ?? id;
  const misName = (id: string) => map.data.misconceptions.find((m) => m.id === id)?.description ?? "";

  const rediagnose = async () => {
    setDiagError(null);
    setDiagBusy(true);
    try {
      await api(`/api/sets/${setId}/diagnose`, { method: "POST" });
      reload();
    } catch (e) {
      setDiagError(e);
    } finally {
      setDiagBusy(false);
    }
  };

  return (
    <>
      <PageHeading
        eyebrow="DIAGNOSIS"
        title={`诊断与讲评 · ${data.material.title}`}
        desc={`${OBJECTIVE_TEXT[set.objective.mode]}${set.parent_set_id ? " · 按上一轮建议出的卷" : ""}。下面的“推测”是目前看来的假设，每条都附证据题，新的证据可以推翻它。`}
      />

      <div className="stat-row">
        <div className="stat">
          <span>答对</span>
          <strong>
            {correct} / {questions.length}
          </strong>
        </div>
        <div className="stat">
          <span>错且“稳”</span>
          <strong className={wrongSure ? "red" : ""}>{wrongSure}</strong>
        </div>
        <div className="stat">
          <span>对但“蒙”</span>
          <strong>{rightGuess}</strong>
        </div>
        <div className="stat">
          <span>错答押注命中率</span>
          <strong>{d?.error_map_check.hit_rate == null ? "—" : `${Math.round(d.error_map_check.hit_rate * 100)}%`}</strong>
        </div>
        <div className="stat">
          <span>用时</span>
          <strong>{set.total_minutes ? `${set.total_minutes} 分钟` : "—"}</strong>
        </div>
      </div>

      {!d && (
        <div className="panel pad">
          <p>作答已保存，但诊断没有完成（可能是模型调用出错）。</p>
          {diagBusy ? <Busy label="诊断中…" /> : <Button onClick={rediagnose}>重新诊断</Button>}
          <ErrorBox error={diagError} />
        </div>
      )}

      {d && (
        <>
          <section className="panel pad">
            <h2 className="panel-h">
              <Microscope size={18} /> 诊断
            </h2>
            <h3 className="section-h">① 观察到的事实</h3>
            <ul className="plain-list">
              {d.observations.map((o, i) => (
                <li key={i}>
                  {o.text} <Evidence labels={o.question_labels} />
                </li>
              ))}
            </ul>

            <h3 className="section-h">② 推测的学生状态</h3>
            <div className="inference-list">
              {d.inferences.map((inf, i) => (
                <div key={i} className="inference">
                  <div className="inference-head">
                    <strong>{inf.claim}</strong>
                    <Pill tone={inf.confidence === "high" ? "green" : inf.confidence === "mid" ? "amber" : "plain"}>置信度 {CONF_LEVEL_TEXT[inf.confidence]}</Pill>
                  </div>
                  <p className="small">
                    证据：
                    <Evidence labels={inf.question_labels} />
                    {inf.confidence_reason && <span className="muted"> {inf.confidence_reason}</span>}
                  </p>
                  {(inf.misconception_id || inf.kp_ids.length > 0) && (
                    <p className="small muted">
                      {inf.kp_ids.map((k) => `${k} ${kpName(k)}`).join("；")}
                      {inf.misconception_id && ` · ${inf.misconception_id} ${misName(inf.misconception_id)}`}
                    </p>
                  )}
                  {inf.ruled_out && <p className="small">排除：{inf.ruled_out}</p>}
                </div>
              ))}
              {!d.inferences.length && <p className="muted">没有足够证据支持的推测。</p>}
            </div>

            <h3 className="section-h">③ 证据不足</h3>
            <ul className="plain-list">
              {d.insufficient.map((x, i) => (
                <li key={i}>
                  <b>{x.what}</b> <span className="muted">— {x.why}</span>
                </li>
              ))}
              {!d.insufficient.length && <li className="muted">无</li>}
            </ul>
            {d.rule_adjustments.length > 0 && (
              <div className="rule-note">
                <b>系统规则修正：</b>
                {d.rule_adjustments.join(" ")}
              </div>
            )}
          </section>

          <section className="panel pad">
            <h2 className="panel-h">
              <LockOpen size={18} /> 封存区对照：错答押注
            </h2>
            <div className="three-col">
              <div>
                <h3 className="section-h">命中</h3>
                <ul className="plain-list">
                  {d.error_map_check.hit.map((h, i) => (
                    <li key={i}>
                      <Evidence labels={[h.label]} /> <code>{h.answer}</code> → {h.misconception_id} <span className="muted small">{misName(h.misconception_id)}</span>
                    </li>
                  ))}
                  {!d.error_map_check.hit.length && <li className="muted">无</li>}
                </ul>
              </div>
              <div>
                <h3 className="section-h">预测外的错答</h3>
                <ul className="plain-list">
                  {d.error_map_check.unexpected.map((u, i) => (
                    <li key={i}>
                      <Evidence labels={[u.label]} /> <code>{u.answer}</code>
                    </li>
                  ))}
                  {!d.error_map_check.unexpected.length && <li className="muted">无</li>}
                </ul>
              </div>
              <div>
                <h3 className="section-h">押注了但没出现</h3>
                <ul className="plain-list small">
                  {d.error_map_check.missed.map((m, i) => (
                    <li key={i}>
                      {m.label} <code>{m.wrong_answer}</code> ({m.misconception_id})
                    </li>
                  ))}
                  {!d.error_map_check.missed.length && <li className="muted">无</li>}
                </ul>
              </div>
            </div>
            {d.error_map_commentary && <p className="explain">{d.error_map_commentary}</p>}
          </section>

          {(d.lecture.length > 0 || d.connections) && (
            <section className="panel pad">
              <h2 className="panel-h">
                <Lightbulb size={18} /> 讲评
              </h2>
              {d.lecture.map((l, i) => {
                const q = questions.find((x) => x.label === l.question_label);
                const r = q ? rByQ.get(q.id) : undefined;
                return (
                  <div key={i} className="lecture">
                    <div className="inference-head">
                      <Evidence labels={[l.question_label]} />
                      {r && <Pill tone={r.confidence === "sure" ? "red" : "plain"}>错且{CONF_TEXT[r.confidence]}</Pill>}
                    </div>
                    <p>
                      <b>旧画面：</b>
                      {l.old_picture}
                    </p>
                    <p>
                      <b>新画面：</b>
                      {l.new_picture}
                    </p>
                    <p>
                      <b>用新画面走一遍：</b>
                      {l.walkthrough}
                    </p>
                  </div>
                );
              })}
              {d.connections && (
                <p className="explain">
                  <b>题与题之间：</b>
                  {d.connections}
                </p>
              )}
            </section>
          )}

          {d.student_state.length > 0 && (
            <section className="panel pad">
              <h2 className="panel-h">
                <ClipboardCheck size={18} /> 目前看来（学生状态快照）
              </h2>
              <table className="mini-table">
                <tbody>
                  {d.student_state.map((s) => (
                    <tr key={s.kp_id}>
                      <td>
                        <b>{s.kp_id}</b> {kpName(s.kp_id)}
                      </td>
                      <td>
                        <Pill tone={s.estimate === "mastered" ? "green" : s.estimate === "not_mastered" ? "red" : s.estimate === "shaky" ? "amber" : "plain"}>{ESTIMATE_TEXT[s.estimate]}</Pill>
                      </td>
                      <td>
                        <Evidence labels={s.evidence_question_labels} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      <h2 className="list-h">逐题</h2>
      <div className="q-list">
        {questions.map((q) => {
          const r = rByQ.get(q.id);
          const g = gByQ.get(q.id);
          return (
            <article key={q.id} className="panel q-card" id={`r-${q.label}`}>
              <QuestionHead q={q}>
                {g && <Pill tone={g.correct === "true" ? "green" : g.correct === "partial" ? "amber" : "red"}>{GRADE_TEXT[g.correct]}</Pill>}
              </QuestionHead>
              <QuestionBody q={q} showAnswer />
              <div className="your-answer">
                <b>你的答案：</b>
                <code>{r?.answer || "（未作答）"}</code>
                {r && <Pill tone={r.confidence === "sure" ? "blue" : "plain"}>{CONF_TEXT[r.confidence]}</Pill>}
                {g && (
                  <span className="muted small">
                    {g.method === "rule" ? "规则判" : "模型判"}：{g.rationale}
                  </span>
                )}
              </div>
              <details>
                <summary>设计卡（已解锁）</summary>
                <DesignCard q={q} map={map} />
              </details>
              <details>
                <summary>来源与出题理由</summary>
                <SourceCard q={q} map={map} />
              </details>
              <details>
                <summary>审核记录</summary>
                <ReviewLog reviews={reviews.filter((x) => x.question_id === q.id)} />
              </details>
            </article>
          );
        })}
      </div>

      {d && (
        <section className="panel pad">
          <h2 className="panel-h">
            <RefreshCw size={18} /> 下一轮建议
          </h2>
          <ol className="plain-list">
            {d.next_round.map((n, i) => (
              <li key={i}>
                <b>{n.focus}</b> <span className="muted">— {n.reason}</span>
              </li>
            ))}
          </ol>
          <Button onClick={() => gen.run({ materialId: set.material_id, objective: set.objective.mode, parentSetId: set.id })} disabled={gen.busy || !d.next_round.length}>
            按建议再出一卷 <ArrowRight size={15} />
          </Button>
          {gen.view}
        </section>
      )}

      {(d?.developer_notes || set.generator_notes) && (
        <details className="panel pad notes">
          <summary>
            <Wrench size={15} /> 给开发者的备注
          </summary>
          {d?.developer_notes && (
            <p>
              <b>诊断：</b>
              {d.developer_notes}
            </p>
          )}
          {set.generator_notes && (
            <p>
              <b>出题：</b>
              {set.generator_notes}
            </p>
          )}
        </details>
      )}

      <details className="panel pad notes">
        <summary>材料地图的易错处（已解锁）</summary>
        <ul className="plain-list">
          {map.data.misconceptions.map((m) => (
            <li key={m.id}>
              <b>{m.id}</b> {m.description} <span className="muted">（{m.source === "material" ? "材料明示" : "模型判断"}）</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
