"use client";
// 第 4 步：作答。只显示题干和选项；每题要标信心（稳 / 犹豫 / 蒙）；整卷交一次。
import { useEffect, useState } from "react";
import { Clock, Send, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Confidence, ExerciseSet, QuestionType } from "@/lib/plostain/types";
import { ApiError, api, Busy, CONF_TEXT, ErrorBox, go, OBJECTIVE_TEXT, PageHeading, safeStorage, Stem, TYPE_TEXT, useLoad, useNow } from "./shared";
import { Flow } from "./new-material";

type StudentQuestion = { id: string; label: string; type: QuestionType; stem: string; options: { key: string; text: string }[] };
type StudentView = { set: ExerciseSet; material: { title: string }; questions: StudentQuestion[] };
type Draft = { answers: Record<string, { answer: string; confidence?: Confidence }>; startedAt: number; minutes?: string };

function loadDraft(key: string): Draft {
  try {
    const saved = safeStorage()?.getItem(key);
    if (saved) return JSON.parse(saved) as Draft;
  } catch {
    /* 没有草稿 */
  }
  return { answers: {}, startedAt: Date.now() };
}

export default function AnswerPage({ setId }: { setId: string }) {
  const { data, error, reload } = useLoad(() => api<StudentView>(`/api/sets/${setId}?as=student`), [setId]);
  const key = `plostain-draft-${setId}`;
  // 草稿存在本浏览器里，刷新页面不丢。（这个页面只在浏览器里渲染，可以直接读。）
  const [draft, setDraft] = useState<Draft>(() => loadDraft(key));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const now = useNow(15000);

  useEffect(() => {
    try {
      safeStorage()?.setItem(key, JSON.stringify(draft));
    } catch {
      /* 存不了就算了 */
    }
  }, [key, draft]);

  if (error) {
    if (error instanceof ApiError && error.message.includes("交过")) {
      return (
        <div className="panel pad">
          <p>这张卷已经交过了。</p>
          <Button onClick={() => go(`#/s/${setId}/result`)}>查看结果</Button>
        </div>
      );
    }
    return <ErrorBox error={error} onRetry={reload} />;
  }
  if (!data) return <Busy label="加载中…" />;

  const setAnswer = (id: string, patch: Partial<Draft["answers"][string]>) =>
    setDraft((d) => ({ ...d, answers: { ...d.answers, [id]: { ...(d.answers[id] ?? { answer: "" }), ...patch } } }));
  const elapsed = Math.max(1, Math.round((now - draft.startedAt) / 60000));
  const missingConf = data.questions.filter((q) => !draft.answers[q.id]?.confidence);
  const blank = data.questions.filter((q) => !draft.answers[q.id]?.answer?.trim());

  const submit = async () => {
    if (blank.length && !confirm(`${blank.map((q) => q.label).join("、")} 还没有作答，确定交卷吗？`)) return;
    setSubmitError(null);
    setSubmitting(true);
    const minutes = draft.minutes?.trim() ? Number(draft.minutes) : Math.max(1, Math.round((Date.now() - draft.startedAt) / 60000));
    try {
      await api(`/api/sets/${setId}/submit`, {
        body: {
          answers: data.questions.map((q) => ({ question_id: q.id, answer: draft.answers[q.id]?.answer ?? "", confidence: draft.answers[q.id]?.confidence })),
          total_minutes: minutes,
        },
      });
      safeStorage()?.removeItem(key);
      go(`#/s/${setId}/result`);
    } catch (e) {
      setSubmitError(e);
      // 作答已保存但诊断失败时，结果页可以重跑诊断。
      if (e instanceof ApiError && e.message.includes("作答记录")) go(`#/s/${setId}/result`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeading
        eyebrow="ANSWER SHEET"
        title={data.material.title}
        desc={`${OBJECTIVE_TEXT[data.set.objective.mode]} · ${data.questions.length} 道题。题目不按知识点分块、也不写题型标签——认出该用什么，本身就是要练的。做完整卷再交。`}
        right={
          <span className="outline-tag">
            <Clock size={14} /> 已用 {elapsed} 分钟
          </span>
        }
      />
      <Flow current={3} />
      {data.set.warnings.length > 0 && (
        <div className="warn-box">
          <TriangleAlert size={17} />
          <ul>
            {data.set.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="q-list">
        {data.questions.map((q) => {
          const a = draft.answers[q.id];
          return (
            <article key={q.id} className="panel q-card">
              <div className="q-head">
                <span className="q-label">{q.label}</span>
                <span className="muted small">{TYPE_TEXT[q.type]}</span>
              </div>
              <Stem text={q.stem} />
              {q.type === "single_choice" ? (
                <div className="choice-list" role="radiogroup">
                  {q.options.map((o) => (
                    <label key={o.key} className={a?.answer === o.key ? "choice active" : "choice"}>
                      <input type="radio" name={q.id} checked={a?.answer === o.key} onChange={() => setAnswer(q.id, { answer: o.key })} />
                      <b>{o.key}.</b> {o.text}
                    </label>
                  ))}
                </div>
              ) : q.type === "short_answer" ? (
                <input className="answer-input" placeholder="你的答案" value={a?.answer ?? ""} onChange={(e) => setAnswer(q.id, { answer: e.target.value })} />
              ) : (
                <textarea className="answer-input" rows={3} placeholder="用一两句话说明" value={a?.answer ?? ""} onChange={(e) => setAnswer(q.id, { answer: e.target.value })} />
              )}
              <div className="conf-row">
                <span className="muted small">有多确定？</span>
                {(Object.keys(CONF_TEXT) as Confidence[]).map((c) => (
                  <button key={c} className={a?.confidence === c ? `conf conf-${c} active` : `conf conf-${c}`} onClick={() => setAnswer(q.id, { confidence: c })}>
                    {CONF_TEXT[c]}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      <ErrorBox error={submitError} />
      <div className="sticky-actions">
        <label className="minutes">
          总用时
          <input value={draft.minutes ?? ""} placeholder={String(elapsed)} onChange={(e) => setDraft((d) => ({ ...d, minutes: e.target.value.replace(/[^\d.]/g, "") }))} />
          分钟（选填，默认按计时）
        </label>
        {submitting ? (
          <Busy label="批改并诊断中…" />
        ) : (
          <Button onClick={submit} disabled={missingConf.length > 0}>
            <Send size={15} /> {missingConf.length ? `还有 ${missingConf.length} 题没标信心` : "交卷"}
          </Button>
        )}
      </div>
    </>
  );
}
