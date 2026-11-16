"use client";
// 第 3 步（仅教师模式）：审题。看答案和设计卡，删除 / 编辑 / 单题重出，然后发布给学生。
import { useState } from "react";
import { FileDown, Pencil, RefreshCw, Send, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ErrorMapEntry, ExerciseSet, MaterialMap, Question, Review } from "@/lib/plostain/types";
import { api, Busy, ErrorBox, go, OBJECTIVE_TEXT, PageHeading, Pill, STATUS_TEXT, useLoad, openPrint } from "./shared";
import { CoverageCard, DesignCard, QuestionBody, QuestionHead, ReviewLog, SourceCard } from "./question-parts";
import type { CoverageReport } from "@/lib/plostain/coverage";
import type { LintResult } from "@/lib/plostain/lint";
import { Flow } from "./new-material";
import { useGenerate } from "./generate";

type TeacherView = { set: ExerciseSet; material: { id: string; title: string }; questions: Question[]; reviews: Review[]; map: MaterialMap; coverage: CoverageReport | null; lint: LintResult };

export default function ReviewPage({ setId }: { setId: string }) {
  const { data, error, reload } = useLoad(() => api<TeacherView>(`/api/sets/${setId}?as=teacher`), [setId]);
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const gen = useGenerate();

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Busy label="加载中…" />;
  const { set, questions, reviews, map } = data;
  const activeQs = questions.filter((q) => q.status !== "dropped");
  const dropped = questions.filter((q) => q.status === "dropped");

  const act = async (id: string, label: string, fn: () => Promise<unknown>) => {
    setActionError(null);
    setBusy({ id, label });
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(null);
    }
  };

  const publish = () =>
    act("publish", "发布中…", async () => {
      await api(`/api/sets/${setId}/publish`, { method: "POST" });
      go(`#/s/${setId}/answer`);
    });

  return (
    <>
      <PageHeading
        eyebrow="TEACHER REVIEW"
        title={`审题 · ${data.material.title}`}
        desc={`${OBJECTIVE_TEXT[set.objective.mode]} · ${activeQs.length} 道题。每道题都可以删、改、单题重出——AI 不是最终裁判。`}
        right={<Pill tone="green">{STATUS_TEXT[set.status]}</Pill>}
      />
      <Flow current={2} />

      {set.status === "generated" && (
        <div className="panel pad">
          <p>这张卷已经出好并封存，但还没有完成自动审核（可能是上次中途关闭了页面）。</p>
          <Button onClick={() => gen.resume(setId)} disabled={gen.busy}>
            继续审核
          </Button>
          {gen.view}
        </div>
      )}

      {set.warnings.length > 0 && (
        <div className="warn-box">
          <TriangleAlert size={17} />
          <ul>
            {set.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {data.coverage && <CoverageCard c={data.coverage} />}

      {data.lint.setLevel.length > 0 && (
        <div className="warn-box">
          <TriangleAlert size={17} />
          <div>
            <b>程序检查（整卷）</b>
            <ul>
              {data.lint.setLevel.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {set.generator_notes && (
        <details className="panel pad notes">
          <summary>出题备注（给开发者）</summary>
          <p>{set.generator_notes}</p>
        </details>
      )}

      {set.coverage_table.length > 0 && (
        <details className="panel pad notes">
          <summary>覆盖表（知识点 × 能力层级）</summary>
          <table className="mini-table">
            <tbody>
              {set.coverage_table.map((c) => (
                <tr key={c.kp_id}>
                  <td>
                    <b>{c.kp_id}</b> {map.data.knowledge_points.find((k) => k.id === c.kp_id)?.name}
                  </td>
                  <td>{c.abilities.join("、")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <ErrorBox error={actionError} />

      <div className="q-list">
        {activeQs.map((q) => (
          <TeacherQuestion
            key={q.id}
            q={q}
            map={map}
            reviews={reviews.filter((r) => r.question_id === q.id)}
            checks={data.lint.perQuestion[q.label] ?? []}
            busy={busy?.id === q.id ? busy : null}
            disabled={!!busy || set.status === "generated"}
            onDelete={() => {
              if (confirm(`确定删除 ${q.label}？删除后会保留记录，但不再出现在卷面上。`))
                act(q.id, "删除中…", () => api(`/api/sets/${setId}/questions/${q.id}`, { method: "DELETE" }));
            }}
            onRegenerate={() => {
              const note = prompt(`单题重出 ${q.label}。有什么要求吗？（可留空）`);
              if (note !== null)
                act(q.id, "重出并审核中…", () => api(`/api/sets/${setId}/questions/${q.id}/regenerate`, { body: { note } }));
            }}
            onSave={(patch) => act(q.id, "保存中…", () => api(`/api/sets/${setId}/questions/${q.id}`, { method: "PATCH", body: patch }))}
          />
        ))}
      </div>

      {dropped.length > 0 && (
        <details className="panel pad notes">
          <summary>已删除的题（{dropped.length}）</summary>
          {dropped.map((q) => (
            <div key={q.id} className="dropped-q">
              <b>{q.label}</b> <span className="muted">{q.drop_reason}</span>
              <QuestionBody q={q} showAnswer />
              <ReviewLog reviews={reviews.filter((r) => r.question_id === q.id)} />
            </div>
          ))}
        </details>
      )}

      <div className="sticky-actions">
        <span className="muted small">发布后进入作答页。作答开始后，题目和设计卡将封存为只读。</span>
        <span className="export-buttons">
          <Button variant="outline" disabled={set.status === "generated" || !activeQs.length} onClick={() => openPrint(setId, "paper")}>
            <FileDown size={15} /> 导出试卷
          </Button>
          <Button variant="outline" disabled={set.status === "generated" || !activeQs.length} onClick={() => openPrint(setId, "answers")}>
            <FileDown size={15} /> 导出答案解析
          </Button>
        </span>
        {busy?.id === "publish" ? (
          <Busy label={busy.label} />
        ) : (
          <Button onClick={publish} disabled={!!busy || set.status !== "reviewed" || !activeQs.length}>
            <Send size={15} /> 发布给学生
          </Button>
        )}
      </div>
    </>
  );
}

function TeacherQuestion(props: {
  q: Question;
  map: MaterialMap;
  reviews: Review[];
  checks: string[];
  busy: { label: string } | null;
  disabled: boolean;
  onDelete: () => void;
  onRegenerate: () => void;
  onSave: (patch: Partial<Question>) => void;
}) {
  const { q, map, reviews, busy, disabled } = props;
  const [editing, setEditing] = useState(false);
  return (
    <article className="panel q-card" id={`q-${q.label}`}>
      <QuestionHead q={q}>
        <Pill tone={q.status === "revised" ? "amber" : q.status === "teacher_edited" ? "blue" : "green"}>{STATUS_TEXT[q.status]}</Pill>
      </QuestionHead>
      {props.checks.length > 0 && (
        <ul className="q-checks">
          {props.checks.map((c, i) => (
            <li key={i}>程序检查：{c}</li>
          ))}
        </ul>
      )}
      {q.verification?.status === "fail" && <p className="q-checks">程序验算未通过：{q.verification.detail}</p>}
      {editing ? (
        <QuestionEditor
          q={q}
          onCancel={() => setEditing(false)}
          onSave={(patch) => {
            setEditing(false);
            props.onSave(patch);
          }}
        />
      ) : (
        <QuestionBody q={q} showAnswer />
      )}
      <details>
        <summary>设计卡（诊断目的 · 错答押注）</summary>
        <DesignCard q={q} map={map} />
      </details>
      <details>
        <summary>来源与出题理由</summary>
        <SourceCard q={q} map={map} />
      </details>
      <details>
        <summary>审核记录（{reviews.length}）</summary>
        <ReviewLog reviews={reviews} />
      </details>
      <div className="q-actions">
        {busy ? (
          <Busy label={busy.label} />
        ) : (
          <>
            <Button variant="outline" size="sm" disabled={disabled || editing} onClick={() => setEditing(true)}>
              <Pencil size={14} /> 编辑
            </Button>
            <Button variant="outline" size="sm" disabled={disabled} onClick={props.onRegenerate}>
              <RefreshCw size={14} /> 单题重出
            </Button>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={props.onDelete}>
              <Trash2 size={14} /> 删除
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

function QuestionEditor({ q, onSave, onCancel }: { q: Question; onSave: (p: Partial<Question>) => void; onCancel: () => void }) {
  const [stem, setStem] = useState(q.stem);
  const [options, setOptions] = useState(q.options.map((o) => `${o.key}. ${o.text}`).join("\n"));
  const [answer, setAnswer] = useState(q.answer);
  const [accepted, setAccepted] = useState(q.accepted_answers.join("\n"));
  const [explanation, setExplanation] = useState(q.explanation);
  const [purpose, setPurpose] = useState(q.diagnostic_purpose);
  const [errorMap, setErrorMap] = useState<ErrorMapEntry[]>(q.error_map);

  const save = () =>
    onSave({
      stem,
      options:
        q.type === "single_choice"
          ? options
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l, i) => {
                const m = l.match(/^([A-Ha-h])[.、．:：)\s]\s*(.*)$/);
                return m ? { key: m[1].toUpperCase(), text: m[2] } : { key: String.fromCharCode(65 + i), text: l };
              })
          : [],
      answer,
      accepted_answers: accepted.split("\n").map((s) => s.trim()).filter(Boolean),
      explanation,
      diagnostic_purpose: purpose,
      error_map: errorMap.filter((e) => e.wrong_answer.trim()),
    });

  const setRow = (i: number, patch: Partial<ErrorMapEntry>) => setErrorMap((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="editor-form">
      <label>题干</label>
      <textarea rows={6} value={stem} onChange={(e) => setStem(e.target.value)} />
      {q.type === "single_choice" && (
        <>
          <label>选项（每行一个，如 “A. 文本”）</label>
          <textarea rows={4} value={options} onChange={(e) => setOptions(e.target.value)} />
        </>
      )}
      <label>标准答案</label>
      <input value={answer} onChange={(e) => setAnswer(e.target.value)} />
      {q.type === "short_answer" && (
        <>
          <label>也接受的写法（每行一个）</label>
          <textarea rows={2} value={accepted} onChange={(e) => setAccepted(e.target.value)} />
        </>
      )}
      <label>解析</label>
      <textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      <label>诊断目的</label>
      <textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      <label>错答押注（改了题面，押注也要跟着改）</label>
      {errorMap.map((e, i) => (
        <div className="em-row" key={i}>
          <input placeholder="错答" value={e.wrong_answer} onChange={(ev) => setRow(i, { wrong_answer: ev.target.value })} />
          <input placeholder="误解编号" value={e.misconception_id} onChange={(ev) => setRow(i, { misconception_id: ev.target.value })} />
          <input placeholder="为什么会这样答" value={e.reasoning} onChange={(ev) => setRow(i, { reasoning: ev.target.value })} />
          <button className="link-button" onClick={() => setErrorMap((rows) => rows.filter((_, k) => k !== i))}>
            移除
          </button>
        </div>
      ))}
      <button className="link-button" onClick={() => setErrorMap((rows) => [...rows, { wrong_answer: "", misconception_id: "", reasoning: "" }])}>
        + 添加一条押注
      </button>
      <div className="q-actions">
        <Button size="sm" onClick={save}>
          保存（重新封存）
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
