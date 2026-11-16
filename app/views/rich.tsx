"use client";
// 公式渲染：文字里 $…$（行内）和 $$…$$（独占一行）之间的 LaTeX 用 KaTeX 排版。
// 数学、物理都用 LaTeX；化学式用 \ce{…}（mhchem 扩展）。
import { Fragment } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import { splitMath } from "./math-text";

export { hasMath } from "./math-text";

function renderMath(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", output: "html" });
}

/** 行内富文本：普通文字 + 公式。写错的公式会显示成红字，不会让页面崩掉。 */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {splitMath(text).map((p, i) =>
        p.math ? (
          <span key={i} className={p.display ? "math-block" : "math"} dangerouslySetInnerHTML={{ __html: renderMath(p.text, p.display) }} />
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
