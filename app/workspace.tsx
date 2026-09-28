"use client";
// 工作台外壳：左侧导航 + 顶栏 + 按地址栏 # 路由切换页面。
//   #/               新建练习
//   #/m/<材料id>      材料地图
//   #/s/<卷id>        按状态自动跳到 审题 / 作答 / 结果
//   #/s/<卷id>/review 审题（教师模式）
//   #/s/<卷id>/answer 作答
//   #/s/<卷id>/result 诊断与讲评
//   #/history        历史
//   #/logs           模型与调用日志
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BookOpen, ChartNoAxesCombined, ChevronRight, FileText, History, Layers3, LockKeyhole, Network, Plus, Settings2, ShieldCheck } from "lucide-react";
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
import { useGenerate } from "./views/generate";

type Route =
  | { page: "new" }
  | { page: "map"; materialId: string }
  | { page: "set"; setId: string; sub: "" | "review" | "answer" | "result" }
  | { page: "history" }
  | { page: "logs" };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "m" && parts[1]) return { page: "map", materialId: parts[1] };
  if (parts[0] === "s" && parts[1]) {
    const sub = parts[2] === "review" || parts[2] === "answer" || parts[2] === "result" ? parts[2] : "";
    return { page: "set", setId: parts[1], sub };
  }
  if (parts[0] === "history") return { page: "history" };
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
  const crumb =
    route.page === "new" ? "新建练习" : route.page === "map" ? "材料地图" : route.page === "history" ? "历史记录" : route.page === "logs" ? "模型与调用日志" : route.sub === "review" ? "审题" : route.sub === "result" ? "诊断与讲评" : "练习卷";

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/">
          <span className="brandmark">
            <Layers3 size={23} />
          </span>
          <span>
            plostain<span className="brandby">BY KILLEND</span>
          </span>
        </a>
        <Button className="new-button" onClick={() => go("#/")}>
          <Plus size={17} />
          新建练习<span>↗</span>
        </Button>
        <div className="nav-label">学习工作台</div>
        <nav>
          {nav.map(({ icon: Icon, label, target, active }) => (
            <button
              className={active ? "nav-item active" : target ? "nav-item" : "nav-item disabled"}
              key={label}
              aria-label={label}
              onClick={() => (target ? go(target) : setNotice(label === "诊断与讲评" ? "交卷后才有诊断。" : "先添加材料并生成地图，即可继续。"))}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="side-note">
            <ShieldCheck size={20} />
            <strong>每个判断，都有依据。</strong>
            <p>
              从材料出发，让练习看见
              <br />
              你真正理解了什么。
            </p>
          </div>
          <button className={route.page === "logs" ? "nav-item active" : "nav-item"} aria-label="模型与调用日志" onClick={() => go("#/logs")}>
            <Settings2 size={18} />
            模型与调用日志
          </button>
          <div className="profile">
            <span className="avatar">K</span>
            <div>
              我的工作台<small>本机 · 个人空间</small>
            </div>
            <span className="version">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>
            工作台 <ChevronRight size={15} /> <b>{crumb}</b>
          </span>
          <span className="private">
            <LockKeyhole size={13} />
            私密空间
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
