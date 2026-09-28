"use client";
// 前端共用：API 请求、中文标签、小组件。
import { useEffect, useState, type ReactNode } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import type { Confidence, ObjectiveMode, QuestionType } from "@/lib/plostain/types";

export class ApiError extends Error {
  raw?: string;
  constructor(message: string, raw?: string) {
    super(message);
    this.raw = raw;
  }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({ error: `服务器返回 HTTP ${res.status}` }))) as { error?: string; raw?: string };
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, data.raw);
  return data as T;
}

export const go = (hash: string) => {
  window.location.hash = hash;
};

export const ROLE_TEXT: Record<string, string> = {
  basic_check: "基础确认",
  unlabeled_recognition: "无标签识别",
  confusable_pair: "易混淆辨析",
  transfer: "迁移",
  sentinel: "哨兵",
  synthesis: "综合",
};
export const TYPE_TEXT: Record<QuestionType, string> = { single_choice: "单选", short_answer: "短答", open_explain: "简述" };
export const OBJECTIVE_TEXT: Record<ObjectiveMode, string> = { comprehensive: "全面练习", transfer: "综合迁移", quick_diagnosis: "快速诊断" };
export const OBJECTIVE_HINT: Record<ObjectiveMode, string> = {
  comprehensive: "覆盖主干知识点，各能力层级都有",
  transfer: "偏重无标签识别、同构不同貌、迁移",
  quick_diagnosis: "3～5 题，优先哨兵题",
};
export const CONF_TEXT: Record<Confidence, string> = { sure: "稳", unsure: "犹豫", guess: "蒙" };
export const ISSUE_TEXT: Record<string, string> = {
  wrong_answer: "答案错误",
  ambiguous: "有歧义",
  off_target: "考偏",
  contamination: "考点污染",
  bypassable: "可绕过",
  irrelevant_difficulty: "无关难度",
  duplicate: "重复",
};
export const STATUS_TEXT: Record<string, string> = {
  draft: "待审核",
  reviewed: "审核通过",
  revised: "审核后修订",
  dropped: "已删除",
  teacher_edited: "教师已修改",
  generated: "待审核",
  published: "待作答",
  diagnosed: "已诊断",
};
export const VERDICT_TEXT: Record<string, string> = { keep: "保留", revise: "修改", drop: "删除" };
export const CONF_LEVEL_TEXT: Record<string, string> = { low: "低", mid: "中", high: "高" };
export const ESTIMATE_TEXT: Record<string, string> = {
  mastered: "目前看来已掌握",
  shaky: "目前看来不稳",
  not_mastered: "目前看来未掌握",
  unknown: "证据不足",
};
export const CHECK_TEXT: Record<string, string> = {
  correctness: "正确性",
  unambiguous: "无歧义",
  purity: "考点纯度",
  not_bypassable: "不可绕过",
  required_step: "必经目标步骤",
  no_irrelevant_difficulty: "无关难度",
  non_duplicate: "不重复",
};

/** 题干里的代码段（整段都是 ASCII 且带运算符）用等宽字体显示。 */
export function Stem({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className="stem">
      {blocks.map((b, i) =>
        /^[\x20-\x7E\n\t]+$/.test(b) && /[=()[\]{}:]/.test(b) ? (
          <pre key={i} className="code">{b}</pre>
        ) : (
          <p key={i}>{b}</p>
        ),
      )}
    </div>
  );
}

export function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "green" | "red" | "amber" | "blue" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/** 当前时间，按间隔刷新（在渲染里直接读时钟会让结果不稳定）。 */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** 从组件挂载起经过的秒数。 */
export function useElapsed() {
  const [start] = useState(() => Date.now());
  return Math.floor((useNow() - start) / 1000);
}

export function Busy({ label, timer = true }: { label: string; timer?: boolean }) {
  const secs = useElapsed();
  return (
    <div className="busy">
      <LoaderCircle className="spin" size={18} />
      <span>{label}</span>
      {timer && secs > 0 && <span className="muted small">{secs} 秒</span>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="error-box" role="alert">
      <TriangleAlert size={18} />
      <div>
        <strong>出错了</strong>
        <p>{e.message ?? String(error)}</p>
        {e.raw && (
          <details>
            <summary>模型原始输出</summary>
            <pre className="code">{e.raw}</pre>
          </details>
        )}
        {onRetry && (
          <button className="link-button" onClick={onRetry}>
            重试
          </button>
        )}
      </div>
    </div>
  );
}

/** 页面加载数据的小 hook。 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    fn()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  const reload = () => {
    setError(null);
    setVersion((v) => v + 1);
  };
  return { data, error, reload, setData };
}

export function PageHeading({ eyebrow, title, desc, right }: { eyebrow: string; title: string; desc?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
