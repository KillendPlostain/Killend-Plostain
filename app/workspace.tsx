"use client";
// 工作台外壳：左侧导航 + 顶栏 + 按地址栏 # 路由切换页面。
//   #/               新建练习
//   #/m/<材料id>      材料地图
//   #/s/<卷id>        按状态自动跳到 审题 / 作答 / 结果
//   #/s/<卷id>/review 审题（教师模式）
//   #/s/<卷id>/answer 作答
//   #/s/<卷id>/result 诊断与讲评
//   #/s/<卷id>/print/paper|answers[/auto]  导出试卷 / 答案解析（单独页面，没有侧栏；/auto 自动弹出打印窗口）
//   #/plain[/2d]     平原（全屏：筑城者对话、学习日志；/2d = 不用 3D，用 2D 画法）
//   #/history        历史
//   #/logs           模型与调用日志
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BookOpen, ChartNoAxesCombined, ChevronLeft, ChevronRight, FileText, History, LockKeyhole, Network, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExerciseSet } from "@/lib/plostain/types";
import { api, Busy, ErrorBox, go, safeStorage } from "./views/shared";
import NewMaterial from "./views/new-material";
import MapPage from "./views/map-view";
import ReviewPage from "./views/review-view";
import AnswerPage from "./views/answer-view";
import ResultPage from "./views/result-view";
import HistoryPage from "./views/history-view";
import LogsPage from "./views/logs-view";
import PrintPage from "./views/print-view";
import PlainPage from "./views/plain-view";
import { useGenerate } from "./views/generate";
import { LogoMark } from "./views/scene";

type Route =
  | { page: "new" }
  | { page: "map"; materialId: string }
  | { page: "set"; setId: string; sub: "" | "review" | "answer" | "result" }
  | { page: "print"; setId: string; kind: "paper" | "answers"; auto: boolean }
  | { page: "history" }
  | { page: "plain"; flat: boolean }
  | { page: "logs" };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "m" && parts[1]) return { page: "map", materialId: parts[1] };
  if (parts[0] === "s" && parts[1] && parts[2] === "print") return { page: "print", setId: parts[1], kind: parts[3] === "answers" ? "answers" : "paper", auto: parts[4] === "auto" };
  if (parts[0] === "s" && parts[1]) {
    const sub = parts[2] === "review" || parts[2] === "answer" || parts[2] === "result" ? parts[2] : "";
    return { page: "set", setId: parts[1], sub };
  }
  if (parts[0] === "history") return { page: "history" };
  if (parts[0] === "plain") return { page: "plain", flat: parts[1] === "2d" };
  if (parts[0] === "logs") return { page: "logs" };
  return { page: "new" };
}

type Current = { materialId?: string; setId?: string; setStatus?: string; setSubmitted?: boolean };
type Meta = { set: ExerciseSet; material: { id: string; title: string; mode: string } };

// 地址栏 # 是路由；用 useSyncExternalStore 订阅，服务端渲染时视为首页。
const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

// “当前材料 / 当前卷”记在本浏览器里，让左侧导航能直接跳回去。
const CURRENT_KEY = "plostain-current";
// 侧栏收起 / 展开，也记在本浏览器里
const SIDEBAR_KEY = "plostain-sidebar";
const subscribeSidebar = (cb: () => void) => {
  window.addEventListener(SIDEBAR_KEY, cb);
  return () => window.removeEventListener(SIDEBAR_KEY, cb);
};
const subscribeCurrent = (cb: () => void) => {
  window.addEventListener("plostain-current", cb);
  return () => window.removeEventListener("plostain-current", cb);
};
function saveCurrent(c: Current) {
  try {
    safeStorage()?.setItem(CURRENT_KEY, JSON.stringify(c));
  } catch {
    /* 存不了就算了 */
  }
  window.dispatchEvent(new Event("plostain-current"));
}

export default function Workspace() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const route = useMemo(() => parse(hash), [hash]);
  const currentRaw = useSyncExternalStore(subscribeCurrent, () => safeStorage()?.getItem(CURRENT_KEY) ?? "", () => "");
  const current = useMemo<Current>(() => {
    try {
      return currentRaw ? (JSON.parse(currentRaw) as Current) : {};
    } catch {
      return {};
    }
  }, [currentRaw]);

  useEffect(() => {
    if (route.page === "map" && route.materialId !== current.materialId) saveCurrent({ materialId: route.materialId });
    if (route.page === "set") {
      api<Meta>(`/api/sets/${route.setId}?as=meta`)
        .then(({ set }) => saveCurrent({ materialId: set.material_id, setId: set.id, setStatus: set.status, setSubmitted: !!set.submitted_at }))
        .catch(() => {});
    }
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const hasResult = current.setStatus === "diagnosed" || current.setSubmitted;
  const nav: { icon: typeof BookOpen; label: string; target: string | null; active: boolean }[] = [
    { icon: BookOpen, label: "学习材料", target: "#/", active: route.page === "new" },
    { icon: Network, label: "材料地图", target: current.materialId ? `#/m/${current.materialId}` : null, active: route.page === "map" },
    {
      icon: FileText,
      label: "练习卷",
      target: current.setId ? `#/s/${current.setId}` : null,
      active: route.page === "set" && route.sub !== "result",
    },
    {
      icon: ChartNoAxesCombined,
      label: "诊断与讲评",
      target: current.setId && hasResult ? `#/s/${current.setId}/result` : null,
      active: route.page === "set" && route.sub === "result",
    },
    { icon: History, label: "历史记录", target: "#/history", active: route.page === "history" },
  ];
  const [notice, setNotice] = useState("");
  const collapsed = useSyncExternalStore(subscribeSidebar, () => safeStorage()?.getItem(SIDEBAR_KEY) === "collapsed", () => false);
  const toggleSidebar = () => {
    try {
      safeStorage()?.setItem(SIDEBAR_KEY, collapsed ? "open" : "collapsed");
    } catch {
      /* 存不了就算了 */
    }
    window.dispatchEvent(new Event(SIDEBAR_KEY));
  };
  // 导出页单独显示，没有侧栏和顶栏（所有 hook 都在这一行之前）
  if (route.page === "print") return <PrintPage key={`${route.setId}-${route.kind}`} setId={route.setId} kind={route.kind} auto={route.auto} />;

  // “平原”是全屏的场景，同样不带侧栏
  if (route.page === "plain") return <PlainPage key={route.flat ? "2d" : "3d"} force2d={route.flat} />;

  const crumb =
    route.page === "new" ? "新建练习" : route.page === "map" ? "材料地图" : route.page === "history" ? "历史记录" : route.page === "logs" ? "模型与调用日志" : route.sub === "review" ? "审题" : route.sub === "result" ? "诊断与讲评" : "练习卷";

  return (
    <div className={["shell", collapsed && "collapsed", route.page === "new" && "home"].filter(Boolean).join(" ")}>
      {/* 首页的整幅背景（例图去掉界面元素后的画面）：从侧栏一直铺到右边的书卷 */}
      {route.page === "new" && <div className="home-backdrop" aria-hidden />}
      <aside className="sidebar">
        <div className="brand-row">
          <a className="brand" href="#/" aria-label="plostain 首页">
            {/* 宽屏用例图里的字标图（山坡上的人和太阳）；侧栏收起或手机上用小图标 */}
            {/* eslint-disable-next-line @next/next/no-img-element -- 2KB 的小图，next/image 帮不上忙 */}
            <img className="brand-img" src="/scene/logo.webp" alt="" draggable={false} />
            <LogoMark size={42} />
          </a>
          <button className="collapse-btn" onClick={toggleSidebar} aria-label={collapsed ? "展开侧栏" : "收起侧栏"} title={collapsed ? "展开侧栏" : "收起侧栏"}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        <nav>
          {nav.map(({ icon: Icon, label, target, active }) => (
            <button
              className={active ? "nav-item active" : target ? "nav-item" : "nav-item disabled"}
              key={label}
              aria-label={label}
              title={label}
              onClick={() => (target ? go(target) : setNotice(label === "诊断与讲评" ? "交卷后才有诊断。" : "先添加材料并生成地图，即可继续。"))}
            >
              <Icon size={22} strokeWidth={1.6} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {/* 侧栏底部的书和花（取自例图）。首页上由整幅背景画出来，这里隐藏 */}
        {/* eslint-disable-next-line @next/next/no-img-element -- 小装饰图，next/image 帮不上忙 */}
        <img className="side-art" src="/scene/side-bottom.webp" alt="" draggable={false} />
      </aside>
      <div className={route.page === "new" ? "main main-stage" : "main"}>
        <header className="topbar">
          <span>
            工作台 <ChevronRight size={15} /> <b>{crumb}</b>
          </span>
          <span className="top-actions">
            <button className={route.page === "logs" ? "top-icon active" : "top-icon"} onClick={() => go("#/logs")} title="模型与调用日志" aria-label="模型与调用日志">
              <Settings2 size={20} />
            </button>
            <span className="private">
              <LockKeyhole size={13} />
              私密空间
            </span>
          </span>
        </header>
        <main className="workspace">
          {route.page === "new" && <NewMaterial />}
          {route.page === "map" && <MapPage key={route.materialId} materialId={route.materialId} />}
          {route.page === "set" && route.sub === "" && <SetRedirect key={route.setId} setId={route.setId} />}
          {route.page === "set" && route.sub === "review" && <ReviewPage key={route.setId} setId={route.setId} />}
          {route.page === "set" && route.sub === "answer" && <AnswerPage key={route.setId} setId={route.setId} />}
          {route.page === "set" && route.sub === "result" && <ResultPage key={route.setId} setId={route.setId} />}
          {route.page === "history" && <HistoryPage />}
          {route.page === "logs" && <LogsPage />}
          {notice && (
            <div role="status" className="notice" onClick={() => setNotice("")}>
              {notice}
              <span>×</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/** #/s/<id>：看卷的状态，跳到该去的页面。 */
function SetRedirect({ setId }: { setId: string }) {
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<Meta | null>(null);
  const gen = useGenerate();
  useEffect(() => {
    api<Meta>(`/api/sets/${setId}?as=meta`)
      .then((meta) => {
        const { set } = meta;
        if (set.status === "diagnosed" || set.submitted_at) go(`#/s/${setId}/result`);
        else if (set.status === "published") go(`#/s/${setId}/answer`);
        else if (set.status === "reviewed" && set.mode === "teacher") go(`#/s/${setId}/review`);
        else setPending(meta);
      })
      .catch(setError);
  }, [setId]);
  if (error) return <ErrorBox error={error} />;
  if (!pending) return <Busy label="加载中…" />;
  return (
    <div className="panel pad">
      <p>这张卷已经出好并封存，但还没有完成自动审核（可能是上次中途关闭了页面）。</p>
      <Button onClick={() => gen.resume(setId)} disabled={gen.busy}>
        继续审核
      </Button>
      {gen.view}
    </div>
  );
}
