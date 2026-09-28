import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
