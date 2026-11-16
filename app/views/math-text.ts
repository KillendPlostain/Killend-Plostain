// 把文字切成“普通文字 / 公式”几段：$…$ 是行内公式，$$…$$ 是独占一行的公式。
// 单独放在 .ts 文件里，测试可以直接用（不依赖网页）。
type Part = { math: false; text: string } | { math: true; display: boolean; text: string };

/** 把文字切成“普通文字 / 公式”几段。前面带反斜杠的 \$ 当普通的美元符号。 */
export function splitMath(text: string): Part[] {
  const parts: Part[] = [];
  const re = /\$\$([\s\S]+?)\$\$|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ math: false, text: text.slice(last, m.index) });
    parts.push(m[1] !== undefined ? { math: true, display: true, text: m[1] } : { math: true, display: false, text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ math: false, text: text.slice(last) });
  return parts.map((p) => (p.math ? p : { ...p, text: p.text.replace(/\\\$/g, "$") }));
}

export const hasMath = (text: string) => splitMath(text).some((p) => p.math);
