"use client";
// 导出页：像正常试卷 / 答案册一样排版，用浏览器的“打印 → 另存为 PDF”导出。
//   #/s/<卷id>/print/paper    试卷（只有题目）
//   #/s/<卷id>/print/answers  答案与解析
import { useEffect, useRef, useState } from "react";
import { ImageDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ObjectiveMode, QuestionType } from "@/lib/plostain/types";
import { api, Busy, ErrorBox, OBJECTIVE_TEXT, safeStorage, Stem, useLoad } from "./shared";
import { Rich } from "./rich";
import { exportLongImage } from "./export-image";

type PrintQuestion = {
  id: string;
  type: QuestionType;
  stem: string;
  options: { key: string; text: string }[];
  answer?: string;
  accepted_answers?: string[];
  explanation?: string;
};
type PrintView = { title: string; objective: ObjectiveMode; created_at: string; answersAllowed: boolean; questions: PrintQuestion[] };

export default function PrintPage({ setId, kind, auto }: { setId: string; kind: "paper" | "answers"; auto: boolean }) {
  const { data, error } = useLoad(() => api<PrintView>(`/api/sets/${setId}/print`), [setId]);
  const blocked = kind === "answers" && data && !data.answersAllowed;
  // 卷子标题可以改（默认是材料标题，常常是文件名）；试卷和答案共用，记在本浏览器里
  const titleKey = `plostain-print-title-${setId}`;
  const [customTitle, setCustomTitle] = useState<string | null>(() => safeStorage()?.getItem(titleKey) ?? null);
  const title = customTitle ?? cleanTitle(data?.title ?? "");
  const changeTitle = (t: string) => {
    setCustomTitle(t);
    try {
      safeStorage()?.setItem(titleKey, t);
    } catch {
      /* 存不了就算了 */
    }
  };

  // 导出长图（3 倍分辨率 PNG）
  const pageRef = useRef<HTMLElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const exportImage = async () => {
    if (!pageRef.current) return;
    setExportError(null);
    setExporting(true);
    try {
      await exportLongImage(pageRef.current, `${title} - ${kind === "paper" ? "试卷" : "答案与解析"}`);
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!data || blocked) return;
    // 浏览器把页面标题当作 PDF 的默认文件名
    document.title = `${title} - ${kind === "paper" ? "试卷" : "答案与解析"}`;
  }, [data, blocked, kind, title]);
  useEffect(() => {
    if (!data || blocked || !auto) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [data, blocked, auto]);

  if (error) return <div className="print-shell"><ErrorBox error={error} /></div>;
  if (!data) return <div className="print-shell"><Busy label="正在排版…" /></div>;

  return (
    <div className="print-shell">
      <div className="print-toolbar">
        <div className="print-toolbar-main">
          <strong>{kind === "paper" ? "导出试卷" : "导出答案与解析"}</strong>
          <label className="print-title-edit">
            卷子标题：
            <input value={title} onChange={(e) => changeTitle(e.target.value)} placeholder="例如：第 11 章 整式的乘法 诊断练习" />
          </label>
          <p>
            打印 / PDF：在打印窗口的“目标打印机”里选 <b>另存为 PDF</b>。长图：3 倍分辨率 PNG，手机上看最清楚。
          </p>
        </div>
        {!blocked && (
          <div className="print-toolbar-actions">
            <Button onClick={() => window.print()}>
              <Printer size={16} /> 打印 / 另存为 PDF
            </Button>
            {exporting ? (
              <Busy label="正在生成长图…" />
            ) : (
              <Button variant="outline" onClick={exportImage}>
                <ImageDown size={16} /> 导出长图（3 倍 PNG）
              </Button>
            )}
          </div>
        )}
      </div>
      {!!exportError && (
        <div className="print-toolbar">
          <ErrorBox error={exportError} />
        </div>
      )}

      {blocked ? (
        <div className="print-page">
          <p>自测模式：交卷后才能导出答案与解析。</p>
        </div>
      ) : (
        <article className="print-page" ref={pageRef}>
          <header className="print-head">
            <h1>{title}</h1>
            <p className="print-sub">
              {kind === "paper" ? "诊断练习卷" : "答案与解析"} · {OBJECTIVE_TEXT[data.objective]} · 共 {data.questions.length} 题
            </p>
            {kind === "paper" && (
              <p className="print-fill">
                姓名：<span /> 日期：<span /> 用时：<span />
              </p>
            )}
          </header>

          {kind === "paper" ? (
            <ol className="print-list">
              {data.questions.map((q) => (
                <li key={q.id} className="print-q">
                  <Stem text={q.stem} />
                  {q.type === "single_choice" && (
                    <ul className={q.options.every((o) => o.text.length <= 14) ? "print-options short" : "print-options"}>
                      {q.options.map((o) => (
                        <li key={o.key}>
                          {o.key}. <Rich text={o.text} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.type === "short_answer" && <div className="print-blank">答：</div>}
                  {q.type === "open_explain" && (
                    <div className="print-lines">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <ol className="print-list">
              {data.questions.map((q) => (
                <li key={q.id} className="print-q">
                  <p>
                    <b>【答案】</b>
                    <span className="print-answer">{q.answer}</span>
                    {!!q.accepted_answers?.length && <span className="print-muted">（也接受：{q.accepted_answers.join(" / ")}）</span>}
                  </p>
                  {q.explanation && (
                    <div className="print-explain">
                      <b>【解析】</b>
                      <Stem text={q.explanation} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </article>
      )}
    </div>
  );
}

/** 材料标题常常是文件名：去掉“提取自”、末尾的 (1) 之类的序号。 */
function cleanTitle(t: string): string {
  return t.replace(/^提取自/, "").replace(/\s*[（(]\d+[)）]\s*$/, "").trim();
}
