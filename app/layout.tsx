import type { Metadata } from "next";
// 全站衬线体：思源宋体（Noto Serif SC）自托管，按字符分块（unicode-range），浏览器只下载页面上用到的字。
// 500 正文、600 小标题和按钮、900 大标题；字体文件自带 font-display: swap。
import "@fontsource/noto-serif-sc/500.css";
import "@fontsource/noto-serif-sc/600.css";
import "@fontsource/noto-serif-sc/900.css";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/cormorant-garamond/latin-500-italic.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "@fontsource/cormorant-garamond/latin-600-italic.css";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plostain · 诊断练习工作台",
  description: "从学习材料出发，用有证据的诊断练习，看见真正的理解。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

// 横屏且宽度 ≥ 900 时进入“等比”模式：--z = 视口与设计稿（1586×992）的较小比值；手机和竖屏仍用普通的响应式布局
const FIT_SCRIPT = `(function(){var d=document.documentElement;function f(){var w=innerWidth,h=innerHeight,fit=w>=900&&w/h>=1.15;d.classList.toggle("fit",fit);d.style.setProperty("--z",fit?String(Math.min(1.5,Math.max(0.5,Math.min(w/1586,h/992)))):"1");}f();addEventListener("resize",f);})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首页按例图的比例（1586×992）整体缩放：先于页面绘制算好缩放倍数，避免闪一下 */}
        <script dangerouslySetInnerHTML={{ __html: FIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
