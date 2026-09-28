"use client";
// 生成练习卷的前端流程：出题并封存 → 盲解 + 审核 → 进入审题页（教师）或作答页（自测）。
// 两步分开请求，这样页面能显示进度；中途刷新也能在练习卷页面继续审核。
import { useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import type { ExerciseSet } from "@/lib/plostain/types";
import { api, ErrorBox, go, useElapsed } from "./shared";

type Stage = "idle" | "generating" | "reviewing" | "done";

export function useGenerate() {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<unknown>(null);
  const [setId, setSetId] = useState<string | null>(null);

  async function review(id: string) {
    setStage("reviewing");
    const { set } = await api<{ set: ExerciseSet }>(`/api/sets/${id}/review`, { method: "POST" });
    setStage("done");
    go(set.status === "published" ? `#/s/${id}/answer` : `#/s/${id}/review`);
  }

  async function run(input: { materialId: string; objective?: string; parentSetId?: string }) {
    setError(null);
    try {
      setStage("generating");
      const { set } = await api<{ set: ExerciseSet }>("/api/sets", { body: input });
      setSetId(set.id);
      await review(set.id);
    } catch (e) {
      setError(e);
      setStage("idle");
    }
  }

  async function resume(id: string) {
    setError(null);
    setSetId(id);
    try {
      await review(id);
    } catch (e) {
      setError(e);
      setStage("idle");
    }
  }

  const busy = stage === "generating" || stage === "reviewing";
  const view = (
    <>
      {busy && <GenerateProgress key={stage} stage={stage} />}
      <ErrorBox error={error} onRetry={setId ? () => resume(setId) : undefined} />
    </>
  );
  return { run, resume, busy, view };
}

function GenerateProgress({ stage }: { stage: Stage }) {
  const secs = useElapsed(); // key={stage}：每进入一步重新计时
  const steps: [Stage, string, string][] = [
    ["generating", "出题并封存设计卡", "先定每道题要抓的误解和错答押注，再写题干；设计卡写入即封存。"],
    ["reviewing", "盲解 + 审核", "独立解题者看不到答案先做一遍；审题人对比后逐题检查，有问题的修改一次再审。"],
  ];
  const idx = steps.findIndex(([s]) => s === stage);
  return (
    <div className="progress-card">
      {steps.map(([s, title, desc], i) => (
        <div key={s} className={i < idx ? "p-step done" : i === idx ? "p-step current" : "p-step"}>
          <span className="p-icon">{i < idx ? <Check size={14} /> : i === idx ? <LoaderCircle size={14} className="spin" /> : i + 1}</span>
          <div>
            <strong>
              {title}
              {i === idx && <em> · {secs} 秒</em>}
            </strong>
            <p>{desc}</p>
          </div>
        </div>
      ))}
      <p className="muted small">真实模型每一步可能需要一到几分钟，请不要关闭页面。</p>
    </div>
  );
}
