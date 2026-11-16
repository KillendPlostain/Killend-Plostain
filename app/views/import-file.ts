"use client";
// 导入文件：在浏览器里把 .txt / .md / .pdf / .docx 转成纯文本。文件不会上传。
import type { SourceType } from "@/lib/plostain/types";

export const ACCEPT = ".txt,.md,.markdown,.pdf,.docx";

export async function extractText(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  let text: string;
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    text = await file.text();
  } else if (ext === "docx") {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else if (ext === "pdf") {
    text = await extractPdf(file);
  } else {
    throw new Error("只支持 .txt、.md、.pdf、.docx 文件。");
  }
  return clean(text);
}

async function extractPdf(file: File): Promise<string> {
  // 不单独开 Web Worker：开发服务器会往 worker 里注入只能在页面里跑的脚本（报 “window is not defined”）。
  // pdf.js 发现 globalThis.pdfjsWorker 已经加载时，会直接在页面里解析，课堂记录这种大小的 PDF 没有明显影响。
  const g = globalThis as { pdfjsWorker?: unknown };
  g.pdfjsWorker ??= await import("pdfjs-dist/build/pdf.worker.min.mjs");
  const pdfjs = await import("pdfjs-dist");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let page = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      page += item.str + (item.hasEOL ? "\n" : "");
    }
    pages.push(page);
  }
  const text = pages.join("\n\n");
  if (!text.trim()) throw new Error("这个 PDF 里提取不到文字，可能是扫描件（图片）。请换成电子版，或者复制文字粘贴进来。");
  return text;
}

// PDF 里的部分汉字会被读成长得一样的“部首字符”（如 ⽇ ⻓ ⼩），换回正常汉字。
// 康熙部首区可以用 NFKC 还原；部首补充区没有标准映射，列出常见的几个。
const RADICAL_SUPPLEMENT: Record<string, string> = {
  "⻓": "长", "⻔": "门", "⻢": "马", "⻛": "风", "⻜": "飞", "⻅": "见", "⻆": "角", "⻋": "车", "⻉": "贝",
  "⻚": "页", "⻩": "黄", "⻰": "龙", "⻮": "齿", "⻥": "鱼", "⻦": "鸟", "⻨": "麦", "⻁": "虎", "⻄": "西",
  "⻘": "青", "⻝": "食", "⻣": "骨", "⻤": "鬼", "⻬": "齐", "⻭": "齿", "⻳": "龟", "⻊": "足", "⻈": "讠",
};

function fixRadicals(text: string): string {
  return text
    .replace(/[⼀-⿕]/g, (c) => c.normalize("NFKC"))
    .replace(/[⺀-⻳]/g, (c) => RADICAL_SUPPLEMENT[c] ?? c);
}

function clean(text: string): string {
  return fixRadicals(text)
    .replace(/\r\n?/g, "\n")
    .replace(/Socratopia · 苏格拉底式情境学习系统\s*\n?\s*www\.socratopia\.app/g, "") // 破卷导出 PDF 的页眉页脚
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 超过上限时按段落切成几段，每段不超过 limit 字。单个段落太长就按句号切。 */
export function splitText(text: string, limit: number): string[] {
  const pieces: string[] = [];
  for (let p of text.split(/\n\s*\n/)) {
    p = p.trim();
    if (!p) continue;
    while (p.length > limit) {
      let cut = p.lastIndexOf("。", limit);
      cut = cut > limit / 2 ? cut + 1 : limit;
      pieces.push(p.slice(0, cut));
      p = p.slice(cut);
    }
    pieces.push(p);
  }
  const chunks: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > limit) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += p + "\n\n";
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/** 根据文件名和内容猜来源，用户可以再改。 */
export function guessSource(name: string, text: string): SourceType {
  if (/笔记|回顾|notes?/i.test(name) || /^---\s*\ntitle:\s*课后笔记/.test(text)) return "notes";
  if (/对话|课堂记录|chat|dialog/i.test(name)) return "dialogue";
  if (/错题/.test(name)) return "errors";
  if (/教材|课本|textbook/i.test(name)) return "textbook";
  return "notes";
}

export function titleFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}-\d{2}\s+/, "").slice(0, 40);
}
