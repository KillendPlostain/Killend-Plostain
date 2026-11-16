// “平原”的两种画法（3D 和 2D）对页面暴露同一套接口：页面只管镜头走到哪、文字标签贴在哪。

/** 一个机位，用一串数字表示（2D：x, y, 缩放；3D：相机位置、看向哪里、视角、焦点距离）。页面只做逐项插值，不关心含义。 */
export type Shot = number[];
export type ShotName = "far" | "builder" | "beside" | "journal";

/** 画面里几个东西在屏幕上的位置（CSS 像素）：文字标签、书、石头的点击区域靠它定位。 */
export interface Anchors {
  lantern: { x: number; y: number };
  stone: { x: number; y: number; w: number; h: number }; // x, y = 石头顶部中点
  hand: { x: number; y: number }; // 托书的那只手
  field?: { x: number; y: number; w: number; h: number }; // 只有 3D：书页上“写在这里”那一格
}

export interface DrawInput {
  t: number; // 秒
  shot: Shot;
  q: number; // 只有 2D 用：画布分辨率 ÷ 屏幕分辨率
  turn: number; // 0 = 正面，1 = 侧过身
  hold: number; // 0 = 右手垂着，1 = 伸出去托书
}

export interface PlainRenderer {
  kind: "2d" | "3d";
  shots: Record<ShotName, Shot>;
  draw(vw: number, vh: number, f: DrawInput): Anchors;
  dispose(): void;
}
