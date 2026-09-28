"use client";
// 第 2 步：材料地图。可以重新生成；确认后选目标、生成练习。
import { useState } from "react";
import { ArrowRight, BookOpen, FileText, LockKeyhole, Network, RefreshCw, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExerciseSet, Material, MaterialMap, ObjectiveMode } from "@/lib/plostain/types";
import { api, Busy, ErrorBox, fmtTime, go, OBJECTIVE_HINT, OBJECTIVE_TEXT, PageHeading, Pill, STATUS_TEXT, useLoad } from "./shared";
import { Flow } from "./new-material";
import { useGenerate } from "./generate";

type MapView = MaterialMap & { misconceptions_hidden: number };
type MaterialView = { material: Material; map: MapView | null; sets: ExerciseSet[] };

const HOW_TEXT: Record<string, string> = { run: "运行验证", substitute: "代入验证", lookup: "查原文", argument_only: "只能论证" };

export default function MapPage({ materialId }: { materialId: string }) {
  const { data, error, reload, setData } = useLoad(() => api<MaterialView>(`/api/materials/${materialId}`), [materialId]);
  const [picked, setObjective] = useState<ObjectiveMode | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<unknown>(null);
  const gen = useGenerate();

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Busy label="加载中…" />;
  const { material, map, sets } = data;
  const objective = picked ?? material.objective;

  const regenerate = async () => {
    setRegenError(null);
    setRegenerating(true);
    try {
      setData(await api<MaterialView>(`/api/materials/${materialId}/map`, { method: "POST" }));
    } catch (e) {
      setRegenError(e);
    } finally {
      setRegenerating(false);
    }
  };

  const kpName = (id: string) => map?.data.knowledge_points.find((k) => k.id === id)?.name ?? id;

  return (
    <>
      <PageHeading
        eyebrow="MATERIAL MAP"
        title={material.title}
        desc="地图是出题用的索引：它管覆盖和边界，原文管题目的质感。确认它读懂了材料，再生成练习。"
        right={<Pill tone={material.mode === "self" ? "blue" : "green"}>{material.mode === "self" ? "自测模式" : "教师模式"}</Pill>}
      />
      <Flow current={1} />
      <div className="content-grid">
        <section className="panel">
          <div className="panel-title">
            <div>
              <Network size={19} />
              <h2>材料地图</h2>
            </div>
            {map && <span className="muted small">{map.model} · {map.prompt_version} · {fmtTime(map.created_at)}</span>}
          </div>
          {!map ? (
            <div className="editor-inner">地图还没有生成。</div>
          ) : (
            <div className="map-body">
              <h3 className="section-h">知识点</h3>
              <div className="kp-list">
                {map.data.knowledge_points.map((k) => (
                  <div className="kp" key={k.id}>
                    <div className="kp-head">
                      <span className="kp-id">{k.id}</span>
                      <strong>{k.name}</strong>
                      <Pill tone={k.tier === "core" ? "green" : "plain"}>{k.tier === "core" ? "主干" : "次级"}</Pill>
                    </div>
                    {k.summary && <p>{k.summary}</p>}
                    <blockquote>“{k.anchor}”</blockquote>
                  </div>
                ))}
              </div>

              <div className="two-col">
                <div>
                  <h3 className="section-h">依赖</h3>
                  <ul className="plain-list">
                    {map.data.dependencies.map((d, i) => (
                      <li key={i}>
                        <b>{d.to_kp}</b> 依赖 <b>{d.from_kp}</b>
                        {d.note && <span className="muted"> — {d.note}</span>}
                      </li>
                    ))}
                    {!map.data.dependencies.length && <li className="muted">无</li>}
                  </ul>
                  <h3 className="section-h">隐含前置（材料默认你已会）</h3>
                  <ul className="plain-list">
                    {map.data.implicit_prereqs.map((p, i) => (
                      <li key={i}>
                        {p.name}
                        {p.note && <span className="muted"> — {p.note}</span>}
                      </li>
                    ))}
                    {!map.data.implicit_prereqs.length && <li className="muted">无</li>}
                  </ul>
                </div>
                <div>
                  <h3 className="section-h">边界</h3>
                  <ul className="plain-list">
                    {map.data.boundaries.map((b, i) => (
                      <li key={i}>
                        <Pill tone={b.kind === "not_deep" ? "amber" : "plain"}>{b.kind === "not_deep" ? "没讲透" : "紧邻未涉及"}</Pill> {b.description}
                      </li>
                    ))}
                  </ul>
                  <h3 className="section-h">可验证性</h3>
                  <ul className="plain-list">
                    {map.data.verifiability.map((v, i) => (
                      <li key={i}>
                        {v.kp_id} {kpName(v.kp_id)}：{HOW_TEXT[v.how] ?? v.how}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <h3 className="section-h">易错处</h3>
              {map.misconceptions_hidden ? (
                <div className="locked">
                  <LockKeyhole size={16} /> 自测模式：{map.misconceptions_hidden} 条易错处已封存，交卷后解锁——提前看到等于被预习。
                </div>
              ) : (
                <ul className="plain-list">
                  {map.data.misconceptions.map((m) => (
                    <li key={m.id}>
                      <b>{m.id}</b> {m.description} <span className="muted">（{m.kp_ids.join("、")} · {m.source === "material" ? "材料明示" : "模型判断"}）</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="suit">
                <p>
                  <b>适合出：</b>
                  {map.data.suitability.good_for}
                </p>
                <p>
                  <b>不适合：</b>
                  {map.data.suitability.bad_for}
                </p>
                <p>
                  <b>为什么：</b>
                  {map.data.suitability.why}
                </p>
              </div>
              <details className="raw-text">
                <summary>
                  <FileText size={15} /> 查看原文
                </summary>
                <pre>{material.text}</pre>
              </details>
            </div>
          )}
          <div className="panel-actions">
            <span>地图不对？可以重新生成一次。</span>
            {regenerating ? (
              <Busy label="重新生成地图…" />
            ) : (
              <Button variant="outline" onClick={regenerate} disabled={gen.busy}>
                <RefreshCw size={15} /> 重新生成地图
              </Button>
            )}
          </div>
          <div className="pad">
            <ErrorBox error={regenError} />
          </div>
        </section>

        <aside className="right-column">
          <section className="panel mode-panel">
            <div className="mini-heading">
              <Target size={17} />
              <h2>练习目标</h2>
            </div>
            <div className="objective-list">
              {(Object.keys(OBJECTIVE_TEXT) as ObjectiveMode[]).map((k) => (
                <button key={k} disabled={gen.busy} className={objective === k ? "objective active" : "objective"} onClick={() => setObjective(k)}>
                  <strong>{OBJECTIVE_TEXT[k]}</strong>
                  <span>{OBJECTIVE_HINT[k]}</span>
                </button>
              ))}
            </div>
            <Button className="wide" disabled={!map || gen.busy || regenerating} onClick={() => gen.run({ materialId, objective })}>
              生成练习 <ArrowRight size={16} />
            </Button>
            {gen.view}
          </section>
          {sets.length > 0 && (
            <section className="panel mode-panel">
              <div className="mini-heading">
                <BookOpen size={17} />
                <h2>这份材料出过的卷</h2>
              </div>
              <ul className="set-links">
                {sets.map((s) => (
                  <li key={s.id}>
                    <button className="link-button" onClick={() => go(`#/s/${s.id}`)}>
                      {OBJECTIVE_TEXT[s.objective.mode]} · {fmtTime(s.created_at)}
                    </button>
                    <Pill>{STATUS_TEXT[s.status]}</Pill>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
