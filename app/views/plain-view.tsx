"use client";
// “平原”：一片起雾的平原，中间站着提灯的女孩。
//   筑城者 → 镜头拉近到她和她手里的书，在书上点一下，打开和“筑城者”的对话（用提问帮你把学习目标说清楚）
//   日志   → 镜头转到她脚边的石头，点石头，打开学习日志
// 画面有两种画法：plain-scene3d.ts（three.js 实时 3D，优先）和 plain-scene.ts（canvas 2D，后备）。这里管镜头、文字标签和两块半透明的面板。
import { useCallback, useEffect, useRef, useState } from "react";
import type { JournalEntry, LearningGoal } from "@/lib/plostain/types";
import { api, ErrorBox, go, safeStorage } from "./shared";
import { Rich } from "./rich";
import { createRenderer2D } from "./plain-scene";
import type { PlainRenderer, Shot } from "./plain-types";

type Mode = "far" | "builder" | "journal";
type Panel = null | "chat" | "journal";
type Msg = { role: "agent" | "user"; text: string };

const DURATION: Record<Mode, number> = { far: 1.6, builder: 2.4, journal: 3.2 };

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixShot = (a: Shot, b: Shot, t: number): Shot => a.map((v, i) => mix(v, b[i], t));
// 只有 2D 画法用：分辨率分级升高，像素一级一级“化开”
const sharpness = (e: number) => (e < 0.22 ? 0.2 : e < 0.42 ? 0.25 : e < 0.6 ? 0.34 : e < 0.78 ? 0.5 : 1);

const GREETING = "这里雾大，不急。你想学会什么？想到哪说到哪就行。";
const CHAT_KEY = "plostain-builder-chat";

/** force2d：不加载 3D，直接用 2D 画法（地址 #/plain/2d，用来对比或在带不动 3D 的电脑上用）。 */
export default function PlainPage({ force2d = false }: { force2d?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const builderLabel = useRef<HTMLButtonElement>(null);
  const journalLabel = useRef<HTMLButtonElement>(null);
  const stoneHit = useRef<HTMLButtonElement>(null);
  const book = useRef<HTMLDivElement>(null);
  const fieldHit = useRef<HTMLButtonElement>(null);
  const [kind, setKind] = useState<"3d" | "2d">(force2d ? "2d" : "3d");
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("far");
  const [arrived, setArrived] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  // 动画循环读这几个 ref，不用每次状态变化都重建循环
  const anim = useRef({ mode: "far" as Mode, start: 0, from: { shot: [] as Shot, turn: 0, hold: 0, q: 0.2 }, now: { shot: [] as Shot, turn: 0, hold: 0, q: 0.2 }, arrived: true, panel: false });

  const enter = useCallback((next: Mode) => {
    const a = anim.current;
    a.from = { ...a.now };
    a.mode = next;
    a.start = performance.now();
    a.arrived = false;
    setMode(next);
    setArrived(false);
    setPanel(null);
  }, []);

  useEffect(() => {
    anim.current.panel = panel !== null;
  }, [panel]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: PlainRenderer | null = null;
    let cancelled = false;
    let raf = 0;
    let tick = 0;
    let announced = false;
    const t0 = performance.now();

    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      const r = renderer!;
      const a = anim.current;
      if (!announced) {
        announced = true;
        setReady(true);
      }
      // 面板开着或系统要求减少动效时，降低刷新频率
      if ((a.panel || still) && a.arrived && tick++ % 4) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const p = still ? 1 : Math.min(1, (time - a.start) / 1000 / DURATION[a.mode]);
      const e = ease(p);
      const f = a.from;
      if (a.mode === "builder") a.now = { shot: mixShot(f.shot, r.shots.builder, e), turn: mix(f.turn, 0, e), hold: mix(f.hold, 1, ease(Math.max(0, p * 2 - 1))), q: Math.max(f.q, sharpness(e)) };
      else if (a.mode === "journal") {
        // 前四成：靠近她，她侧过身；后六成：镜头滑到石头上
        const p1 = Math.min(1, p / 0.4);
        const p2 = Math.max(0, (p - 0.4) / 0.6);
        a.now = { shot: p2 > 0 ? mixShot(r.shots.beside, r.shots.journal, ease(p2)) : mixShot(f.shot, r.shots.beside, ease(p1)), turn: mix(f.turn, 1, ease(p1)), hold: mix(f.hold, 0, e), q: Math.max(f.q, sharpness(e)) };
      } else a.now = { shot: mixShot(f.shot, r.shots.far, e), turn: mix(f.turn, 0, e), hold: mix(f.hold, 0, e), q: p >= 1 ? 0.2 : Math.min(f.q, sharpness(1 - e)) };
      if (p >= 1 && !a.arrived) {
        a.arrived = true;
        setArrived(true);
      }
      const at = r.draw(vw, vh, { t: (time - t0) / 1000, ...a.now });

      // 文字标签贴着提灯和石头；书的右下角贴着她伸出来的那只手；石头上盖一块透明的可点区域
      if (builderLabel.current) builderLabel.current.style.transform = `translate(${at.lantern.x.toFixed(1)}px, ${at.lantern.y.toFixed(1)}px)`;
      if (journalLabel.current) journalLabel.current.style.transform = `translate(${at.stone.x.toFixed(1)}px, ${at.stone.y.toFixed(1)}px)`;
      if (book.current) {
        const w = Math.max(280, Math.min(660, vw * 0.47, at.hand.x - 16));
        Object.assign(book.current.style, { width: `${w}px`, left: `${at.hand.x - w + 6}px`, top: `${at.hand.y - (w / 1.46) * 0.8}px` });
      }
      if (fieldHit.current && at.field) Object.assign(fieldHit.current.style, { left: `${at.field.x}px`, top: `${at.field.y}px`, width: `${at.field.w}px`, height: `${at.field.h}px` });
      if (stoneHit.current) Object.assign(stoneHit.current.style, { left: `${at.stone.x - at.stone.w / 2}px`, top: `${at.stone.y}px`, width: `${at.stone.w}px`, height: `${at.stone.h}px` });
    };
    const begin = (r: PlainRenderer) => {
      renderer = r;
      const a = anim.current;
      // 换了画法，机位的数字含义不同：从这种画法的“当前模式”机位重新开始
      const shot = a.mode === "far" ? r.shots.far : r.shots[a.mode];
      a.now = { ...a.now, shot };
      a.from = { ...a.now };
      raf = requestAnimationFrame(loop);
    };

    if (kind === "2d") begin(createRenderer2D(canvas));
    else
      import("./plain-scene3d")
        .then((m) => !cancelled && begin(m.createRenderer3D(canvas)))
        .catch((error) => {
          // 显卡或浏览器不支持：退回 2D 画法
          console.warn("[平原] 3D 画面没能启动，改用 2D：", error);
          if (!cancelled) setKind("2d");
        });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      renderer?.dispose();
    };
  }, [kind]);

  // Esc：先关面板，再退回远景
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (panel) setPanel(null);
      else if (mode !== "far") enter("far");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, mode, enter]);

  return (
    <div className="plain" data-kind={kind} data-ready={ready} data-mode={mode} data-arrived={arrived} data-panel={panel ?? ""}>
      {/* key：3D 启动失败改用 2D 时要换一块新画布（同一块画布不能既当 3D 又当 2D） */}
      <canvas key={kind} ref={canvasRef} className="plain-canvas" aria-label="起雾的平原上，一个女孩高举着提灯" role="img" />
      <div className="plain-vignette" aria-hidden />
      {!ready && <p className="plain-loading">雾正在升起……</p>}

      <button className="plain-back" onClick={() => (mode === "far" ? go("#/") : enter("far"))}>
        {mode === "far" ? "← 回到工作台" : "← 退后一步"}
      </button>

      <button ref={builderLabel} className="plain-label label-builder" onClick={() => enter("builder")} tabIndex={mode === "far" ? 0 : -1}>
        <svg className="plain-arrow" width="92" height="74" viewBox="0 0 92 74" aria-hidden>
          <path d="M84 6 C 60 10, 34 26, 14 60" />
          <path d="M11 44 L 13 62 L 30 55" />
        </svg>
        <span>筑城者</span>
      </button>
      <button ref={journalLabel} className="plain-label label-journal" onClick={() => enter("journal")} tabIndex={mode === "far" ? 0 : -1}>
        <span>
          日志<sup>beta</sup>
        </span>
        <svg className="plain-arrow" width="86" height="70" viewBox="0 0 86 70" aria-hidden>
          <path d="M6 8 C 30 8, 58 22, 74 56" />
          <path d="M58 52 L 76 59 L 79 41" />
        </svg>
      </button>

      {/* 2D 画法：书是网页元素。3D 画法：书在场景里，这里只在“写在这里”那一格上盖一块透明按钮 */}
      {mode === "builder" && kind === "2d" && <Book ref={book} shown={arrived && panel === null} onOpen={() => setPanel("chat")} />}
      {mode === "builder" && kind === "3d" && <button ref={fieldHit} className="field-hit" onClick={() => setPanel("chat")} aria-label="在书上写下你想学会的事，打开和筑城者的对话" />}
      {mode === "journal" && (
        <button ref={stoneHit} className="stone-hit" onClick={() => setPanel("journal")} aria-label="石头上刻着一行字。点一下，翻开学习日志">
          <span>点一下石头</span>
        </button>
      )}

      {panel === "chat" && <ChatPanel onClose={() => setPanel(null)} />}
      {panel === "journal" && <JournalPanel onClose={() => setPanel(null)} />}
    </div>
  );
}

/** 她右手托着的旧书：左页画着小人和“筑城者”，右页空着，点一下就打开对话。 */
function Book({ shown, onOpen, ref }: { shown: boolean; onOpen: () => void; ref: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={shown ? "book shown" : "book"} aria-hidden={!shown}>
      <div className="book-cover" />
      <div className="book-page book-left">
        <svg viewBox="0 0 200 190" className="book-doodle" aria-hidden>
          {/* 一个小人，正往墙上垒一块砖 */}
          <g fill="none" stroke="#4a3622" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="64" cy="52" r="13" />
            <path d="M64 65 L64 112 M64 112 L48 148 M64 112 L80 148 M64 80 L42 96 M64 80 L96 70" />
            <path d="M96 60 h26 v16 h-26 z" />
            <path d="M108 150 h30 v-16 h-30 z M138 150 h30 v-16 h-30 z M123 134 h30 v-16 h-30 z M153 134 h15 v-16 h-15 z M138 118 h30 v-16 h-30 z" />
            <path d="M30 150 H178" />
            <path d="M59 50 h1 M68 50 h1 M60 57 q4 3 8 0" />
          </g>
        </svg>
        <div className="book-title">筑城者</div>
        <p className="book-note">一块一块来。</p>
      </div>
      <div className="book-page book-right">
        <p className="book-prompt">你想学会什么？</p>
        <button className="book-field" onClick={onOpen} tabIndex={shown ? 0 : -1}>
          <span>写在这里……</span>
          <i aria-hidden />
        </button>
        <p className="book-note">她不会替你回答，只会接着问。</p>
      </div>
      <div className="book-spine" aria-hidden />
      {/* 压在书页上的拇指：手臂在画布里，从书后面伸过来 */}
      <svg className="book-hand" viewBox="0 0 80 60" aria-hidden>
        <path d="M78 16 Q52 6 30 12 Q8 18 8 32 Q10 44 30 44 Q54 44 78 46 Z" fill="#f4dfcd" />
        <path d="M22 22 Q30 18 42 20" fill="none" stroke="#dcbca6" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function Glass({ title, tag, onClose, children }: { title: string; tag?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="glass-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="glass" role="dialog" aria-modal="true" aria-label={title}>
        <header className="glass-head">
          <h2>
            {title}
            {tag && <sup>{tag}</sup>}
          </h2>
          <button className="glass-close" onClick={onClose}>
            合上
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function loadChat(): Msg[] {
  try {
    const saved = JSON.parse(safeStorage()?.getItem(CHAT_KEY) ?? "null") as Msg[] | null;
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    /* 存的东西坏了就重新开始 */
  }
  return [{ role: "agent", text: GREETING }];
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>(loadChat);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [goal, setGoal] = useState<LearningGoal | null>(null);
  const [saved, setSaved] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    safeStorage()?.setItem(CHAT_KEY, JSON.stringify(messages));
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, goal]);
  useEffect(() => input.current?.focus(), []);

  const ask = async (history: Msg[]) => {
    setError(null);
    setBusy(true);
    try {
      const out = await api<{ reply: string; goal: LearningGoal | null }>("/api/plain/chat", { body: { messages: history } });
      setMessages([...history, { role: "agent", text: out.reply }]);
      if (out.goal) {
        setGoal(out.goal);
        setSaved(false);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    const history: Msg[] = [...messages, { role: "user", text }];
    setMessages(history);
    setDraft("");
    void ask(history);
  };
  const restart = () => {
    setMessages([{ role: "agent", text: GREETING }]);
    setGoal(null);
    setError(null);
  };
  const keep = async () => {
    if (!goal) return;
    try {
      await api("/api/plain/journal", { body: { goal } });
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Glass title="筑城者" onClose={onClose}>
      <div className="chat-list" ref={list} aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "agent" ? "bubble agent" : "bubble user"}>
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="bubble agent thinking" aria-label="筑城者在想">
            <i />
            <i />
            <i />
          </div>
        )}
        {goal && (
          <div className="goal-card">
            <h3>{goal.topic}</h3>
            <dl>
              {(
                [
                  ["要去", goal.destination],
                  ["现在", goal.start],
                  ["怎样算到", goal.evidence],
                  ["先不管", goal.scope_out],
                  ["第一步", goal.first_step],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            {saved ? (
              <span className="goal-saved">已经记进日志了。</span>
            ) : (
              <button className="glass-action" onClick={keep}>
                记进日志
              </button>
            )}
          </div>
        )}
        <ErrorBox error={error} onRetry={messages.at(-1)?.role === "user" ? () => void ask(messages) : undefined} />
      </div>
      <div className="chat-input">
        <textarea
          ref={input}
          value={draft}
          rows={2}
          placeholder="慢慢说。回车发送，Shift + 回车换行。"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="chat-actions">
          <button className="glass-quiet" onClick={restart} disabled={busy}>
            重新开始
          </button>
          <button className="glass-action" onClick={send} disabled={busy || !draft.trim()}>
            送出
          </button>
        </div>
      </div>
    </Glass>
  );
}

const stamp = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function JournalPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<{ entries: JournalEntry[] }>("/api/plain/journal")
      .then((d) => setEntries(d.entries))
      .catch(setError);
  }, []);
  return (
    <Glass title="日志" tag="beta" onClose={onClose}>
      <div className="journal-list">
        <ErrorBox error={error} />
        {!entries && !error && <p className="journal-empty">正在翻……</p>}
        {entries?.length === 0 && <p className="journal-empty">还什么都没有。做完一张卷，或者在筑城者那里定下一个目标，这里就会多一行。</p>}
        {entries?.map((e) => (
          <article key={e.id} className="journal-entry">
            <header>
              <time dateTime={e.at}>[{stamp(e.at)}]</time> <b>{e.kind === "goal" ? "定了一个目标" : "做了一张卷"}</b> <span>{e.title}</span>
            </header>
            {e.lines.map((l, i) => (
              <p key={i}>
                <i>{l.key}</i>
                <span>
                  <Rich text={l.text} />
                </span>
              </p>
            ))}
            {e.set_id && (
              <button className="glass-quiet" onClick={() => go(`#/s/${e.set_id}/result`)}>
                看这张卷的诊断 →
              </button>
            )}
          </article>
        ))}
      </div>
    </Glass>
  );
}
