"use client";
// 第 5 步：结果。从上到下按“要紧程度”排：
// 最该先处理的一件事 → 知识体系图上的掌握情况 → 其余薄弱点 → 下一轮建议 → 逐题（答对且稳的默认收起）→ 折叠的分析详情。
import { useMemo, useState } from "react";
import { ArrowRight, FileDown, Flag, Lightbulb, LockOpen, Map as MapIcon, Microscope, RefreshCw, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Diagnosis, ExerciseSet, Grading, MaterialMap, Question, ResponseRecord, Review } from "@/lib/plostain/types";
import { api, Busy, CONF_LEVEL_TEXT, CONF_TEXT, ErrorBox, ESTIMATE_TEXT, OBJECTIVE_TEXT, PageHeading, Pill, useLoad, openPrint } from "./shared";
import { CoverageCard, DesignCard, QuestionBody, QuestionHead, ReviewLog, SourceCard } from "./question-parts";
import type { CoverageReport } from "@/lib/plostain/coverage";
import { useGenerate } from "./generate";
import { Rich } from "./rich";
import { fallbackAtlas } from "@/lib/plostain/atlas";
import { KnowledgeGraph, structureTones, ToneSwatch, type Tone } from "./knowledge-graph";

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
  coverage: CoverageReport | null;
};

const GRADE_TEXT = { true: "对", false: "错", partial: "部分对" } as const;

type Estimate = Diagnosis["student_state"][number]["estimate"];
type Inference = Diagnosis["inferences"][number];
const TONE_OF: Record<Estimate, Tone> = { mastered: "mastered", shaky: "shaky", not_mastered: "weak", unknown: "unknown" };
// 一个节点挂着几个知识点时，取最需要注意的那个状态
const SEVERITY: Tone[] = ["weak", "shaky", "mastered", "unknown"];
const CONF_N = { low: 1, mid: 2, high: 3 } as const;

/** 旧的诊断没有短标题：从长句里截第一句，太长再在逗号处截断。 */
function firstSentence(text: string, max = 44) {
  const first = text.split(/[。；;！？]/)[0].trim();
  if (first.length <= max) return first;
  const cut = Math.max(first.lastIndexOf("，", max), first.lastIndexOf("、", max), first.lastIndexOf(",", max));
  return first.slice(0, cut > 12 ? cut : max) + "…";
}

function jump(label: string) {
  const el = document.getElementById(`r-${label}`);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
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

/** 把握程度：三个小圆点。 */
function ConfDots({ level }: { level: "low" | "mid" | "high" }) {
  return (
    <span className="conf-dots" role="img" aria-label={`把握${CONF_LEVEL_TEXT[level]}`} title={`把握${CONF_LEVEL_TEXT[level]}`}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={i <= CONF_N[level] ? "on" : ""} />
      ))}
    </span>
  );
}

/** 得分环。 */
function ScoreRing({ correct, total }: { correct: number; total: number }) {
  const r = 54;
  const len = 2 * Math.PI * r;
  const filled = total ? (correct / total) * len : 0;
  return (
    <div className="dx-ring" role="img" aria-label={`答对 ${correct} 题，共 ${total} 题`}>
      <svg viewBox="0 0 132 132">
        <circle className="track" cx="66" cy="66" r={r} />
        <circle className="arc" cx="66" cy="66" r={r} strokeDasharray={`${filled} ${len}`} style={{ "--len": filled } as React.CSSProperties} />
      </svg>
      <div className="dx-ring-text">
        <strong>
          {correct}/{total}
        </strong>
        <span>答对</span>
      </div>
    </div>
  );
}

/** 一道题的讲评：旧画面在哪失效 → 新画面 → 用新画面走一遍。放在题目卡片里、答案下面。 */
function Lecture({ l, tag }: { l: Diagnosis["lecture"][number]; tag: string }) {
  return (
    <div className="lecture in-card">
      <div className="lecture-title">
        <Lightbulb size={16} /> 讲评{tag && <Pill tone={tag.startsWith("错且稳") ? "red" : "amber"}>{tag}</Pill>}
      </div>
      <p>
        <b>旧画面：</b>
        <Rich text={l.old_picture} />
      </p>
      <p>
        <b>新画面：</b>
        <Rich text={l.new_picture} />
      </p>
      <p>
        <b>用新画面走一遍：</b>
        <Rich text={l.walkthrough} />
      </p>
    </div>
  );
}

export default function ResultPage({ setId }: { setId: string }) {
  const { data, error, reload } = useLoad(() => api<ResultView>(`/api/sets/${setId}?as=result`), [setId]);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagError, setDiagError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cardSide, setCardSide] = useState<1 | -1>(1);
  const pick = (id: string | null, side?: 1 | -1) => {
    setSelected(id);
    if (side) setCardSide(side);
  };
  const gen = useGenerate();
  const mapRecord = data?.map;
  const materialTitle = data?.material.title ?? "";
  const atlas = useMemo(() => (mapRecord ? mapRecord.atlas ?? fallbackAtlas(mapRecord.data, materialTitle) : null), [mapRecord, materialTitle]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Busy label="加载中…" />;
  const { set, questions, responses, gradings, diagnosis: d, map, reviews } = data;
  const rByQ = new Map(responses.map((r) => [r.question_id, r]));
  const gByQ = new Map(gradings.map((g) => [g.question_id, g]));
  const correct = questions.filter((q) => gByQ.get(q.id)?.correct === "true").length;
  const wrongSure = questions.filter((q) => gByQ.get(q.id)?.correct !== "true" && rByQ.get(q.id)?.confidence === "sure").length;
  const rightGuess = questions.filter((q) => gByQ.get(q.id)?.correct === "true" && rByQ.get(q.id)?.confidence === "guess").length;
  const lectureByLabel = new Map((d?.lecture ?? []).map((l) => [l.question_label, l]));
  const kpName = (id: string) => map.data.knowledge_points.find((k) => k.id === id)?.name ?? id;
  const misName = (id: string) => map.data.misconceptions.find((m) => m.id === id)?.description ?? "";

  // 每个知识点目前的状态 → 图上每个节点的颜色
  const stateByKp = new Map((d?.student_state ?? []).map((s) => [s.kp_id, s]));
  const tones: Record<string, Tone> = atlas ? structureTones(atlas) : {};
  for (const n of atlas?.nodes ?? []) {
    const found = n.kp_ids.map((k) => stateByKp.get(k)).filter((x) => !!x).map((x) => TONE_OF[x.estimate]);
    const worst = SEVERITY.find((t) => found.includes(t));
    if (worst) tones[n.id] = worst;
  }
  const kpsIn = (e: Estimate) => (d?.student_state ?? []).filter((s) => s.estimate === e);
  const weakKps = new Set([...kpsIn("not_mastered"), ...kpsIn("shaky")].map((s) => s.kp_id));
  const isWeak = (id: string) => stateByKp.get(id)?.estimate === "not_mastered";

  // 最该先处理的：碰到“没掌握”的推测排最前，其次“不稳”，再看有没有对应的误解、把握高低
  const wrongSureLabels = new Set(questions.filter((q) => gByQ.get(q.id)?.correct !== "true" && rByQ.get(q.id)?.confidence === "sure").map((q) => q.label));
  const score = (inf: Inference) =>
    (inf.kp_ids.some(isWeak) ? 100 : 0) +
    (inf.kp_ids.some((k) => weakKps.has(k)) ? 50 : 0) +
    (inf.misconception_id ? 20 : 0) +
    CONF_N[inf.confidence] * 5 +
    inf.question_labels.filter((l) => wrongSureLabels.has(l)).length * 3;
  const gaps = (d?.inferences ?? []).filter((inf) => inf.kp_ids.some((k) => weakKps.has(k))).sort((a, b) => score(b) - score(a));
  const headline = gaps[0] ?? null;
  const wrongCount = questions.length - correct;
  const node = atlas?.nodes.find((n) => n.id === selected) ?? null;
  const gapCard = (inf: Inference, i: number) => (
    <article key={i} className={inf.kp_ids.some(isWeak) ? "dx-gap" : "dx-gap shaky"}>
      <p className="dx-gap-claim">
        <Rich text={inf.title || firstSentence(inf.claim, 36)} />
      </p>
      <div className="dx-gap-kps">
        {inf.kp_ids.map((k) => (
          <Pill key={k} tone={isWeak(k) ? "red" : weakKps.has(k) ? "amber" : "plain"}>
            {kpName(k)}
          </Pill>
        ))}
      </div>
      <div className="dx-meta" style={{ marginTop: 0 }}>
        <span>
          证据 <Evidence labels={inf.question_labels} />
        </span>
        <span>
          <ConfDots level={inf.confidence} /> 把握{CONF_LEVEL_TEXT[inf.confidence]}
        </span>
      </div>
      <details>
        <summary>展开说</summary>
        <p>
          <Rich text={inf.claim} />
        </p>
        {inf.confidence_reason && <p>{inf.confidence_reason}</p>}
        {inf.ruled_out && <p>排除了：{inf.ruled_out}</p>}
      </details>
    </article>
  );
  const needsLook = (q: Question) => gByQ.get(q.id)?.correct !== "true" || rByQ.get(q.id)?.confidence === "guess" || lectureByLabel.has(q.label);
  const firstLine = (text: string) => text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

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
        desc={`${OBJECTIVE_TEXT[set.objective.mode]}${set.parent_set_id ? " · 按上一轮建议出的卷" : ""}`}
        right={
          <span className="export-buttons">
            <Button variant="outline" size="sm" onClick={() => openPrint(setId, "paper")}>
              <FileDown size={14} /> 导出试卷
            </Button>
            <Button variant="outline" size="sm" onClick={() => openPrint(setId, "answers")}>
              <FileDown size={14} /> 导出答案解析
            </Button>
          </span>
        }
      />

      <section className="dx-hero">
        <ScoreRing correct={correct} total={questions.length} />
        <div>
          {!d ? (
            <>
              <div className="dx-kicker">诊断没有完成</div>
              <p className="dx-headline">作答已保存，但诊断这一步出错了。</p>
              <div className="dx-meta">{diagBusy ? <Busy label="诊断中…" /> : <Button onClick={rediagnose}>重新诊断</Button>}</div>
              <ErrorBox error={diagError} />
            </>
          ) : headline ? (
            <>
              <div className="dx-kicker">
                <Flag size={16} /> 最该先处理的一件事
              </div>
              <p className="dx-headline">
                <Rich text={d.headline || headline.title || firstSentence(headline.claim)} />
              </p>
              <div className="dx-meta">
                <span>
                  证据 <Evidence labels={headline.question_labels} />
                </span>
                <span>
                  <ConfDots level={headline.confidence} /> 把握{CONF_LEVEL_TEXT[headline.confidence]}
                </span>
              </div>
              <details className="dx-why">
                <summary>展开说</summary>
                <p>
                  <Rich text={headline.claim} />
                </p>
                {headline.ruled_out && <p className="muted">排除了：{headline.ruled_out}</p>}
                <p className="muted">这是目前看来的假设，新的证据可以推翻它。</p>
              </details>
            </>
          ) : (
            <>
              <div className="dx-kicker good">这一卷的结论</div>
              <p className="dx-headline">{wrongCount === 0 ? "这一卷没有发现明显的缺口。" : `错了 ${wrongCount} 道，但证据还不够下结论。`}</p>
              <div className="dx-meta">
                <span>{rightGuess > 0 ? `有 ${rightGuess} 道是蒙对的，还不能算稳。` : wrongCount === 0 ? "可以按下面的建议换个角度再测一卷。" : "错的题见下面的逐题讲评。"}</span>
              </div>
            </>
          )}
        </div>
        <div className="dx-facts">
          <span className={wrongSure ? "dx-fact alert" : "dx-fact"} title="很确定却答错：往往是一个顽固的误解，最值得先看">
            <b>{wrongSure}</b> 错且“稳”
          </span>
          <span className="dx-fact" title="答对了但自己标的是“蒙”：不算掌握">
            <b>{rightGuess}</b> 对但“蒙”
          </span>
          <span className="spacer" />
          {set.total_minutes ? <span>用时 {set.total_minutes} 分钟</span> : null}
        </div>
      </section>

      {d && atlas && (
        <section className="panel graph-panel">
          <div className="graph-head">
            <h2>
              <MapIcon size={20} /> 知识地图上的你
            </h2>
            <div className="kg-legend">
              <ToneSwatch tone="weak">
                没掌握 <b>{kpsIn("not_mastered").length}</b>
              </ToneSwatch>
              <ToneSwatch tone="shaky">
                不稳 <b>{kpsIn("shaky").length}</b>
              </ToneSwatch>
              <ToneSwatch tone="mastered">
                稳 <b>{kpsIn("mastered").length}</b>
              </ToneSwatch>
              <ToneSwatch tone="in">这卷没考</ToneSwatch>
              <ToneSwatch tone="out">材料之外</ToneSwatch>
            </div>
          </div>
          <div className="graph-body">
            <KnowledgeGraph atlas={atlas} tones={tones} selected={selected} onSelect={pick} />
            {node && (
              <aside className={cardSide === 1 ? "node-card left" : "node-card"} aria-live="polite">
                <div className="node-card-head">
                  <strong>{node.name}</strong>
                  <button className="node-card-close" onClick={() => setSelected(null)} aria-label="关闭">
                    <X size={18} />
                  </button>
                </div>
                {!node.kp_ids.length && <p className="muted small">{tones[node.id] === "branch" ? "这是一个分支，具体情况看它下面的节点。" : "材料没有讲到这里，这一卷没有考。"}</p>}
                {node.kp_ids.map((id) => {
                  const st = stateByKp.get(id);
                  const related = d.inferences.filter((inf) => inf.kp_ids.includes(id));
                  return (
                    <div className="kp-line" key={id}>
                      <b>{kpName(id)}</b>
                      <span>
                        <Pill tone={st?.estimate === "mastered" ? "green" : st?.estimate === "not_mastered" ? "red" : st?.estimate === "shaky" ? "amber" : "plain"}>{st ? ESTIMATE_TEXT[st.estimate] : "这一卷没考到"}</Pill>{" "}
                        {st && <Evidence labels={st.evidence_question_labels} />}
                      </span>
                      {related.map((inf, i) => (
                        <span key={i} className="small">
                          <Rich text={inf.title || firstSentence(inf.claim, 60)} />
                        </span>
                      ))}
                    </div>
                  );
                })}
              </aside>
            )}
          </div>
          {kpsIn("mastered").length > 0 && (
            <div className="dx-steady">
              已经稳的：
              {kpsIn("mastered").map((s) => (
                <span className="tag" key={s.kp_id}>
                  {kpName(s.kp_id)}
                </span>
              ))}
            </div>
          )}
          {(kpsIn("unknown").length > 0 || d.insufficient.length > 0) && (
            <details className="dx-quiet">
              <summary>还看不出的（{kpsIn("unknown").length + d.insufficient.length}）</summary>
              <ul>
                {kpsIn("unknown").map((s) => (
                  <li key={s.kp_id}>
                    <b>{kpName(s.kp_id)}</b>：这一卷的证据不够判断
                  </li>
                ))}
                {d.insufficient.map((x, i) => (
                  <li key={i}>
                    <b>{x.what}</b> — {x.why}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {gaps.length > 1 && (
        <>
          <h2 className="list-h">其余要留意的</h2>
          <div className="dx-gaps">{gaps.slice(1, 4).map(gapCard)}</div>
          {gaps.length > 4 && (
            <details className="dx-more">
              <summary>还有 {gaps.length - 4} 条，把握更低或不那么要紧</summary>
              <div className="dx-gaps">{gaps.slice(4).map(gapCard)}</div>
            </details>
          )}
        </>
      )}

      {d && d.next_round.length > 0 && (
        <details className="dx-next">
          <summary>
            <RefreshCw size={18} /> 下一卷测什么
          </summary>
          <ol>
            {d.next_round.map((n, i) => (
              <li key={i} title={`${n.focus}：${n.reason}`}>
                <b>{n.focus}</b>
                <span>{n.reason}</span>
              </li>
            ))}
          </ol>
          <Button onClick={() => gen.run({ materialId: set.material_id, objective: set.objective.mode, parentSetId: set.id })} disabled={gen.busy}>
            按建议再出一卷 <ArrowRight size={15} />
          </Button>
          {gen.view}
        </details>
      )}

      <h2 className="list-h">
        逐题 <span className="muted small">答对且稳的默认收起</span>
      </h2>
      <div className="q-list">
        {questions.map((q) => {
          const r = rByQ.get(q.id);
          const g = gByQ.get(q.id);
          return (
            <details key={q.id} className="panel q-card q-fold" id={`r-${q.label}`} open={needsLook(q)}>
              <summary>
                <span className="q-label">{q.label}</span>
                {g && <Pill tone={g.correct === "true" ? "green" : g.correct === "partial" ? "amber" : "red"}>{GRADE_TEXT[g.correct]}</Pill>}
                {r && <Pill tone={r.confidence === "sure" ? "blue" : "plain"}>{CONF_TEXT[r.confidence]}</Pill>}
                <span className="q-peek">{firstLine(q.stem)}</span>
              </summary>
              <QuestionHead q={q} />
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
              {lectureByLabel.get(q.label) && <Lecture l={lectureByLabel.get(q.label)!} tag={g && r ? `${g.correct === "true" ? "对但" : "错且"}${CONF_TEXT[r.confidence]}` : ""} />}
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
            </details>
          );
        })}
      </div>

      {d && (
        <>
          <h2 className="list-h">
            分析详情 <span className="muted small">点标题展开</span>
          </h2>
          <details className="panel pad fold">
            <summary>
              <h2 className="panel-h">
              <Microscope size={18} /> 诊断
            </h2>
            </summary>
            <h3 className="section-h">① 观察到的事实</h3>
            <ul className="plain-list">
              {d.observations.map((o, i) => (
                <li key={i}>
                  <Rich text={o.text} /> <Evidence labels={o.question_labels} />
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
          </details>

          <details className="panel pad fold">
            <summary>
              <h2 className="panel-h">
              <LockOpen size={18} /> 封存区对照：错答押注
            </h2>
            </summary>
            <p className="small muted">错答押注命中率：{d.error_map_check.hit_rate == null ? "—" : `${Math.round(d.error_map_check.hit_rate * 100)}%`}（出题时押的“有某种误解的人会这样答”，猜中了多少）</p>
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
          </details>

          {(d.lecture.length > 0 || d.connections) && (
            <details className="panel pad fold">
              <summary>
                <h2 className="panel-h">
                <Lightbulb size={18} /> 讲评
              </h2>
              </summary>
              {d.lecture.length > 0 && (
                <p className="small">
                  按“错且稳 → 错且犹豫 → 对但蒙”的顺序，讲评写在上面每道题里：
                  <Evidence labels={d.lecture.map((l) => l.question_label)} />
                </p>
              )}
              {d.connections && (
                <p className="explain">
                  <b>题与题之间：</b>
                  <Rich text={d.connections} />
                </p>
              )}
            </details>
          )}

        </>
      )}

      {data.coverage && (
        <details className="panel pad fold">
          <summary>
            <h2 className="panel-h">覆盖情况</h2>
          </summary>
          <CoverageCard c={data.coverage} />
        </details>
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
