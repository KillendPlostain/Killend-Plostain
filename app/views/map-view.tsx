"use client";
// 第 2 步：材料地图。主体是一张知识体系图（脑图）：材料讲到的节点是实心的，材料之外的淡显，选一张卷可以把考到的节点点亮。
// 出题用的细节（依赖、边界、可验证性……）折叠在“出题依据”里。确认后选目标、生成练习。
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowRight, BookOpen, FileText, Globe, LockKeyhole, Network, RefreshCw, Sparkles, Target, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExerciseSet, Material, MaterialMap, ObjectiveMode } from "@/lib/plostain/types";
import { fallbackAtlas } from "@/lib/plostain/atlas";
import { api, Busy, ErrorBox, fmtTime, go, OBJECTIVE_HINT, OBJECTIVE_TEXT, PageHeading, Pill, STATUS_TEXT, useLoad } from "./shared";
import { Flow } from "./new-material";
import { useGenerate } from "./generate";
import { KnowledgeGraph, structureTones, ToneSwatch, type Tone } from "./knowledge-graph";

type MapView = MaterialMap & { misconceptions_hidden: number };
type MaterialView = { material: Material; map: MapView | null; sets: ExerciseSet[]; lit: Record<string, string[]> };

const HOW_TEXT: Record<string, string> = { run: "运行验证", substitute: "代入验证", lookup: "查原文", argument_only: "只能论证" };
const KIND_TEXT: Record<string, string> = { prereq: "前置知识", extension: "后续延伸", topic: "同一主题" };

// 正在画的体系图。放在组件外面：同一张地图只发一次请求，切走再回来也能接着看到“正在画”。
const drawing = new Set<string>();
const drawFailed = new Map<string, unknown>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const emit = () => listeners.forEach((l) => l());

function drawAtlas(materialId: string, mapId: string, force: boolean, onDone: (v: MaterialView) => void) {
  if (drawing.has(mapId)) return;
  drawing.add(mapId);
  drawFailed.delete(mapId);
  emit();
  api<MaterialView>(`/api/materials/${materialId}/atlas`, { method: "POST", body: { force } })
    .then(onDone)
    .catch((e) => drawFailed.set(mapId, e))
    .finally(() => {
      drawing.delete(mapId);
      emit();
    });
}

export default function MapPage({ materialId }: { materialId: string }) {
  const { data, error, reload, setData } = useLoad(() => api<MaterialView>(`/api/materials/${materialId}`), [materialId]);
  const [picked, setObjective] = useState<ObjectiveMode | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<unknown>(null);
  const [litPick, setLitPick] = useState<string | null | undefined>(undefined); // undefined = 默认点亮最新一卷；null = 不点亮
  const [selected, setSelected] = useState<string | null>(null);
  const [cardSide, setCardSide] = useState<1 | -1>(1);
  const pick = (id: string | null, side?: 1 | -1) => {
    setSelected(id);
    if (side) setCardSide(side);
  };
  const gen = useGenerate();

  const map = data?.map ?? null;
  const mapId = map?.id ?? "";
  const drawState = useSyncExternalStore(
    subscribe,
    () => (drawing.has(mapId) ? "busy" : drawFailed.has(mapId) ? "failed" : "idle"),
    () => "idle",
  );

  // 刚生成的地图：自动去画完整的体系图。老地图不自动画（那是一次模型调用），留一个按钮。
  const createdAt = map?.created_at;
  const hasAtlas = !!map?.atlas;
  useEffect(() => {
    if (!mapId || !createdAt || hasAtlas || drawFailed.has(mapId)) return;
    if (Date.now() - Date.parse(createdAt) < 15 * 60 * 1000) drawAtlas(materialId, mapId, false, setData);
  }, [materialId, mapId, createdAt, hasAtlas, setData]);

  const title = data?.material.title ?? "";
  const atlas = useMemo(() => (map ? map.atlas ?? fallbackAtlas(map.data, title) : null), [map, title]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Busy label="加载中…" />;
  const { material, sets, lit } = data;
  const objective = picked ?? material.objective;

  const regenerate = async () => {
    setRegenError(null);
    setRegenerating(true);
    setSelected(null);
    try {
      setData(await api<MaterialView>(`/api/materials/${materialId}/map`, { method: "POST" }));
    } catch (e) {
      setRegenError(e);
    } finally {
      setRegenerating(false);
    }
  };

  const kp = (id: string) => map?.data.knowledge_points.find((k) => k.id === id);
  const kpName = (id: string) => kp(id)?.name ?? id;

  // 点亮哪一卷：默认最新的一张
  const ordered = [...sets].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const litSet = litPick === undefined ? ordered.at(-1) ?? null : ordered.find((s) => s.id === litPick) ?? null;
  const litKps = new Set(litSet ? lit[litSet.id] ?? [] : []);
  const tones: Record<string, Tone> = atlas ? structureTones(atlas) : {};
  for (const n of atlas?.nodes ?? []) if (n.kp_ids.some((k) => litKps.has(k))) tones[n.id] = "lit";
  const inCount = atlas?.nodes.filter((n) => n.kp_ids.length).length ?? 0;
  const node = atlas?.nodes.find((n) => n.id === selected) ?? null;

  return (
    <>
      <PageHeading
        eyebrow="MATERIAL MAP"
        title={material.title}
        right={<Pill tone={material.mode === "self" ? "blue" : "green"}>{material.mode === "self" ? "自测模式" : "教师模式"}</Pill>}
      />
      <Flow current={1} />

      <section className="panel graph-panel">
        <div className="graph-head">
          <h2>
            <Network size={20} /> 知识体系图
          </h2>
          <div className="kg-legend">
            <ToneSwatch tone="in">材料讲到</ToneSwatch>
            <ToneSwatch tone="out">材料之外</ToneSwatch>
            <ToneSwatch tone="lit">这张卷考到</ToneSwatch>
          </div>
        </div>
        {!!map?.warnings?.length && (
          <div className="graph-note">
            <TriangleAlert size={18} />
            <ul>
              {map.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {!map || !atlas ? (
          <div className="editor-inner">地图还没有生成。</div>
        ) : (
          <>
            <div className="graph-body">
              <KnowledgeGraph key={map.id + (map.atlas ? "-full" : "-draft")} atlas={atlas} tones={tones} selected={selected} onSelect={pick} />
              {node && (
                <aside className={cardSide === 1 ? "node-card left" : "node-card"} aria-live="polite">
                  <div className="node-card-head">
                    <strong>{node.name}</strong>
                    <button className="node-card-close" onClick={() => setSelected(null)} aria-label="关闭">
                      <X size={18} />
                    </button>
                  </div>
                  <div>
                    {node.kp_ids.length ? (
                      <Pill tone={tones[node.id] === "lit" ? "amber" : "blue"}>{tones[node.id] === "lit" ? "这张卷考到" : "材料讲到"}</Pill>
                    ) : tones[node.id] === "branch" ? (
                      <Pill>分支 · 下面有材料讲到的内容</Pill>
                    ) : (
                      <Pill>材料之外 · {KIND_TEXT[node.kind]}</Pill>
                    )}
                  </div>
                  {node.note && <p>{node.note}</p>}
                  {tones[node.id] === "out" && <p className="muted small">材料没有讲到这里，练习不会考它。</p>}
                  {node.kp_ids.map((id) => {
                    const k = kp(id);
                    return k ? (
                      <div className="kp-line" key={id}>
                        {k.name !== node.name && <b>{k.name}</b>}
                        <blockquote>“{k.anchor}”</blockquote>
                      </div>
                    ) : null;
                  })}
                </aside>
              )}
            </div>
            <div className="graph-foot">
              <div className="lit-row">
                {ordered.length ? (
                  <>
                    <Sparkles size={16} /> 点亮：
                    {ordered.map((s, i) => (
                      <button key={s.id} className={litSet?.id === s.id ? "lit-chip active" : "lit-chip"} onClick={() => setLitPick(s.id)} aria-pressed={litSet?.id === s.id}>
                        第 {i + 1} 卷 · {OBJECTIVE_TEXT[s.objective.mode]}
                      </button>
                    ))}
                    <button className={litSet ? "lit-chip" : "lit-chip active"} onClick={() => setLitPick(null)} aria-pressed={!litSet}>
                      不点亮
                    </button>
                  </>
                ) : (
                  <span>
                    材料讲到 {inCount} 个节点{map.atlas ? `，整张图 ${atlas.nodes.length} 个` : ""}。点任意节点看说明；生成练习后，考到的节点会亮起来。
                  </span>
                )}
              </div>
              {drawState === "busy" ? (
                <Busy label={map.atlas ? "正在重画体系图…" : "正在查资料，补全整张体系图…"} />
              ) : map.atlas ? (
                <details>
                  <summary>
                    {map.atlas_meta?.searched && map.atlas.sources.length ? `联网核对过 · ${map.atlas.sources.length} 个来源` : "体系图由模型绘制"}
                  </summary>
                  <ul>
                    {map.atlas.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noreferrer noopener">
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p>材料之外的节点只帮你看清全貌，不会出题。</p>
                  <button className="ghost-button" onClick={() => drawAtlas(materialId, map.id, true, setData)} disabled={gen.busy || regenerating}>
                    <RefreshCw size={14} /> 重画体系图
                  </button>
                </details>
              ) : (
                <span className="lit-row">
                  现在只画了材料里的知识点。
                  <button className="ghost-button" onClick={() => drawAtlas(materialId, map.id, false, setData)} disabled={gen.busy || regenerating}>
                    <Globe size={14} /> 查资料，补全整张体系图
                  </button>
                </span>
              )}
            </div>
            {drawState === "failed" && (
              <div className="pad">
                <ErrorBox error={drawFailed.get(map.id)} onRetry={() => drawAtlas(materialId, map.id, !!map.atlas, setData)} />
              </div>
            )}
          </>
        )}
      </section>

      <div className={sets.length ? "map-lower" : "map-lower single"}>
        <section className="panel goal-panel">
          <div className="mini-heading" style={{ marginBottom: 0 }}>
            <Target size={17} />
            <h2>练习目标</h2>
          </div>
          <div className="goal-pills">
            {(Object.keys(OBJECTIVE_TEXT) as ObjectiveMode[]).map((k) => (
              <button key={k} disabled={gen.busy} className={objective === k ? "goal-pill active" : "goal-pill"} onClick={() => setObjective(k)} aria-pressed={objective === k}>
                {OBJECTIVE_TEXT[k]}
              </button>
            ))}
          </div>
          <p className="goal-hint">{OBJECTIVE_HINT[objective]}</p>
          <div className="goal-go">
            <Button disabled={!map || gen.busy || regenerating} onClick={() => gen.run({ materialId, objective })}>
              生成练习 <ArrowRight size={16} />
            </Button>
          </div>
          {gen.view}
        </section>
        {sets.length > 0 && (
          <section className="panel mode-panel">
            <div className="mini-heading">
              <BookOpen size={17} />
              <h2>出过的卷</h2>
            </div>
            <ul className="set-links">
              {ordered.map((s, i) => (
                <li key={s.id}>
                  <button className="link-button" onClick={() => go(`#/s/${s.id}`)}>
                    第 {i + 1} 卷 · {fmtTime(s.created_at)}
                  </button>
                  <Pill>{STATUS_TEXT[s.status]}</Pill>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {map && (
        <details className="panel pad fold">
          <summary>
            <h2 className="panel-h">
              <FileText size={18} /> 出题依据
            </h2>
          </summary>
          <div className="fold-body">
            <h3 className="section-h">材料里的知识点</h3>
            <div className="kp-rows">
              {map.data.knowledge_points.map((k) => (
                <div key={k.id}>
                  <div className="kp-head">
                    <span className="kp-id">{k.id}</span>
                    <strong>{k.name}</strong>
                    <Pill tone={k.tier === "core" ? "green" : "plain"}>{k.tier === "core" ? "主干" : "次级"}</Pill>
                  </div>
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
                      <b>{kpName(d.to_kp)}</b> 依赖 <b>{kpName(d.from_kp)}</b>
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
                      {kpName(v.kp_id)}：{HOW_TEXT[v.how] ?? v.how}
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
                    {m.description} <span className="muted">（{m.kp_ids.map(kpName).join("、")} · {m.source === "material" ? "材料明示" : "模型判断"}）</span>
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
            <div className="fold-actions">
              <span>
                {map.model} · {map.prompt_version} · {fmtTime(map.created_at)}
              </span>
              {regenerating ? (
                <Busy label="重新生成地图…" />
              ) : (
                <Button variant="outline" onClick={regenerate} disabled={gen.busy || drawState === "busy"}>
                  <RefreshCw size={15} /> 重新生成地图
                </Button>
              )}
            </div>
            <ErrorBox error={regenError} />
          </div>
        </details>
      )}
    </>
  );
}
