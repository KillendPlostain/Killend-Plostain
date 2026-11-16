"use client";
// 首页（新建练习）的画面：远山、晨日、薄雾、小河、飞鸟、花枝、书本，全部是内联 SVG，不加载任何图片。
// 山水层按 slice 铺满舞台（窄屏时从两边裁切）；花枝和书本单独定位、按视口宽度缩放，保证任何尺寸下都不压住内容。

/** 水彩山水（public/scene/landscape.svg）。用 <img> 引用：浏览器栅格化一次后缓存，展开书卷、按钮动画时不会重画这张带滤镜的大图。 */
export function Landscape() {
  // eslint-disable-next-line @next/next/no-img-element -- 矢量图，next/image 的压缩对它没用
  return <img className="scene-landscape" src="/scene/landscape.svg" alt="" draggable={false} />;
}

/** 两只飞鸟（单独定位，不随山水裁切，免得压到标题）。 */
export function Birds({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 110 60" aria-hidden>
      <g fill="none" stroke="#9E8590" strokeLinecap="round">
        <path d="M4 30 C 14 22 22 22 29 28 C 35 16 44 8 56 5" strokeWidth="1.8" />
        <path d="M70 52 C 76 48 80 48 84 51 C 87 45 92 41 98 40" strokeWidth="1.3" />
      </g>
    </svg>
  );
}

/** 一枝小花（樱 / 梅一类的五瓣花），fill 用暖粉，枝干用梅子灰。 */
function Blossom({ x, y, r, rot = 0, tone = "#E9C7C9" }: { x: number; y: number; r: number; rot?: number; tone?: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="0" cy={-r * 0.62} rx={r * 0.46} ry={r * 0.62} fill={tone} transform={`rotate(${a})`} />
      ))}
      <circle r={r * 0.26} fill="#C9918F" />
    </g>
  );
}

const BRANCH_FLOWERS: [number, number, number, number][] = [
  [118, 92, 7, 10], [150, 70, 6, 30], [176, 118, 8, 0], [212, 96, 5, 20], [92, 150, 6, 40], [140, 168, 7, 15],
  [60, 214, 6, 5], [104, 236, 5, 25], [210, 150, 6, 50], [246, 132, 4, 0], [36, 276, 5, 35], [182, 44, 4, 10],
];

/** 左侧伸进画面的花枝。 */
export function Branch({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 280 360" aria-hidden>
      <g fill="none" stroke="#B79AA0" strokeLinecap="round">
        <path d="M0 340 C 40 300 70 250 100 200 C 130 150 160 110 196 52" strokeWidth="2.2" />
        <path d="M100 200 C 140 180 190 160 250 128" strokeWidth="1.6" />
        <path d="M64 262 C 90 250 112 240 140 170" strokeWidth="1.3" />
        <path d="M150 116 C 170 112 196 104 214 94" strokeWidth="1.2" />
        <path d="M30 300 C 44 292 56 270 62 214" strokeWidth="1.2" />
      </g>
      {BRANCH_FLOWERS.map(([x, y, r, rot], i) => (
        <Blossom key={i} x={x} y={y} r={r} rot={rot} tone={i % 3 === 0 ? "#EDD2D3" : "#E6C2C5"} />
      ))}
      {[[128, 128], [196, 72], [80, 186], [232, 118], [48, 248]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.6" fill="#D9AFB3" />
      ))}
    </svg>
  );
}

/** 品牌小标：山坡上站着一个人。 */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="logo-mark">
      <path d="M2 42 C 12 36 20 34 26 35 C 32 36 40 39 46 43" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="24" cy="10" r="3" fill="currentColor" />
      <path d="M24 14 C 21 15 20.5 19 20.8 24 L 20 34 L 22.4 34 L 24 26 L 25.6 34 L 28 34 L 27.2 24 C 27.5 19 27 15 24 14 Z" fill="currentColor" />
    </svg>
  );
}

/** 书卷的纸（public/scene/paper.svg）：撕边 + 纸纹，按容器拉伸。同样用 <img>，只画一次。 */
export function ScrollPaper() {
  // eslint-disable-next-line @next/next/no-img-element -- 矢量图，next/image 的压缩对它没用
  return <img className="scroll-paper" src="/scene/paper.svg" alt="" draggable={false} />;
}

/** “个性化出题”下面那一笔淡蓝水墨。 */
export function InkStroke() {
  return (
    <svg className="ink-stroke" viewBox="0 0 420 120" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#D9DFEE" stopOpacity="0" />
          <stop offset="0.12" stopColor="#CCD5EA" />
          <stop offset="0.55" stopColor="#C2CDE6" />
          <stop offset="0.9" stopColor="#CDD4EA" />
          <stop offset="1" stopColor="#DCE1EF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M4 70 C 40 52 80 40 120 34 C 170 26 210 22 260 18 C 300 15 350 20 392 28 C 410 32 418 44 412 58 C 404 76 380 86 350 92 C 300 102 250 104 200 102 C 150 100 100 98 60 92 C 36 88 16 82 4 70 Z"
        fill="url(#ink)"
      />
      <path d="M40 60 C 120 44 220 36 380 42" fill="none" stroke="#E3E8F3" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      <path d="M70 84 C 160 92 260 92 360 76" fill="none" stroke="#B7C3DF" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** 从水墨按钮伸向书卷的一缕墨线（展开时画出来）。 */
export function InkTendril() {
  return (
    <svg className="ink-tendril" viewBox="0 0 300 160" preserveAspectRatio="none" aria-hidden>
      <path d="M0 120 C 70 128 140 118 190 86 C 230 60 260 22 300 4" fill="none" stroke="#AEBBDA" strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
