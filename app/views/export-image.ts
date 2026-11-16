"use client";
// 导出长图：把一个页面元素按 3 倍分辨率画成 PNG 下载。
// 浏览器“另存为 PDF”会把中文字体转成 Type 3，阅读器里没有字形微调、显得发细；长图按真实像素输出，手机上看最清楚。
//
// 字体：思源宋体按字符分成了几百个小文件（unicode-range）。导出时只嵌入“这个元素里实际出现的字”所在的那几块，
// 不把几十 MB 的字全塞进去；公式用的 KaTeX 字体只在页面上有公式时才嵌入。

type FontFaceRule = { family: string; css: string; url: string; ranges: [number, number][] };

function parseRanges(unicodeRange: string): [number, number][] {
  if (!unicodeRange) return [[0, 0x10ffff]];
  return unicodeRange.split(",").map((part) => {
    const r = part.trim().replace(/^U\+/i, "");
    if (r.includes("-")) {
      const [a, b] = r.split("-");
      return [parseInt(a, 16), parseInt(b, 16)];
    }
    if (r.includes("?")) return [parseInt(r.replace(/\?/g, "0"), 16), parseInt(r.replace(/\?/g, "F"), 16)];
    const n = parseInt(r, 16);
    return [n, n];
  });
}

function collectFontFaces(): FontFaceRule[] {
  const out: FontFaceRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨域样式表读不了，跳过
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const style = rule.style;
      const family = style.getPropertyValue("font-family").replace(/["']/g, "").trim();
      const src = style.getPropertyValue("src");
      // 优先 woff2
      const woff2 = src.match(/url\(["']?([^"')]+\.woff2[^"')]*)["']?\)/);
      const any = src.match(/url\(["']?([^"')]+)["']?\)/);
      const url = (woff2 ?? any)?.[1];
      if (!url) continue;
      const absolute = new URL(url, sheet.href ?? location.href).href;
      out.push({ family, css: rule.cssText, url: absolute, ranges: parseRanges(style.getPropertyValue("unicode-range")) });
    }
  }
  return out;
}

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 只为元素里出现过的字生成 @font-face（字体文件转成 data URL 内嵌）。 */
async function buildFontEmbedCss(node: HTMLElement): Promise<string> {
  const codePoints = new Set<number>();
  for (const ch of node.innerText) codePoints.add(ch.codePointAt(0)!);
  const hasMath = !!node.querySelector(".katex");
  const used = collectFontFaces().filter((f) => {
    if (f.family.startsWith("KaTeX")) return hasMath;
    if (f.family !== "Noto Serif SC") return false;
    return f.ranges.some(([a, b]) => {
      for (const cp of codePoints) if (cp >= a && cp <= b) return true;
      return false;
    });
  });
  const parts = await Promise.all(
    used.map(async (f) => {
      const data = await toDataUrl(f.url);
      // 把原规则里的 src 换成内嵌数据，其余（字重、unicode-range、font-display）保留
      return f.css.replace(/src:[^;]+;/, `src: url(${data}) format("woff2");`);
    }),
  );
  return parts.join("\n");
}

/**
 * 导出长图。pixelRatio 默认 3；页面特别长时自动降一点，保证画布不超过浏览器上限（单边约 32000 像素）。
 */
export async function exportLongImage(node: HTMLElement, fileName: string, pixelRatio = 3): Promise<void> {
  const { toPng } = await import("html-to-image");
  await document.fonts.ready;
  const ratio = Math.max(1, Math.min(pixelRatio, Math.floor((32000 / Math.max(node.scrollHeight, 1)) * 10) / 10));
  const fontEmbedCSS = await buildFontEmbedCss(node);
  const background = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "white";
  const dataUrl = await toPng(node, { pixelRatio: ratio, backgroundColor: background, fontEmbedCSS, cacheBust: false });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  a.click();
}
