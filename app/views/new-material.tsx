"use client";
// 第 1 步：新建练习。
// 画面：中间放材料（拖文件 / 点击上传 / 直接粘贴），下面一笔水墨“个性化出题”；右侧一卷纸，平时留白，
// 点了“个性化出题”才展开练习设置（模式、目标、来源）和“生成材料地图”。
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, ClipboardPaste, FilePlus2, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ObjectiveMode, SourceType, WorkMode } from "@/lib/plostain/types";
import { api, Busy, ErrorBox, go, OBJECTIVE_HINT, OBJECTIVE_TEXT } from "./shared";
import { ACCEPT, extractText, guessSource, splitText, titleFromName } from "./import-file";
import { Birds, Branch, InkStroke, InkTendril, Landscape, ScrollPaper } from "./scene";

export const MAX_CHARS = 20000; // 与 plostain.config.ts 的 materialMaxChars 保持一致
const MIN_CHARS = 80;

export const SAMPLE = `Python 的变量、列表与拷贝

变量是对象的引用。执行 b = a 不会复制对象，而是让两个变量指向同一个对象。列表是可变对象，修改其中的元素会影响所有指向该列表的引用。

浅拷贝：a.copy() 或 a[:] 会创建一个新的外层列表，但内部元素仍是原对象的引用。若元素是嵌套列表，对内部列表的修改会反映在两个副本中；替换外层列表中的一个元素则不会影响另一个外层列表。

深拷贝：copy.deepcopy(a) 会递归复制嵌套的可变对象，使副本中的嵌套列表与原列表独立。需要先 import copy。

列表的 append(x) 原地添加一个元素，返回 None。判断 a is b 比较对象身份，a == b 比较值。两个不同的列表可以具有相同的值。

示例：
a = [[1, 2], [3, 4]]
b = a.copy()
b[0].append(5)
此时 a[0] 也是 [1, 2, 5]，因为两者共享内部列表。`;

const SOURCE_TEXT: Record<SourceType, string> = { notes: "笔记", textbook: "教材", dialogue: "学习对话", errors: "错题", other: "其他" };
const MODE_TEXT: Record<WorkMode, [string, string]> = {
  self: ["自测", "自动审核后直接作答，答案和易错点交卷后再解锁。"],
  teacher: ["教师", "先看答案与设计卡，改好、删好再开始作答。"],
};

export function Flow({ current }: { current: number }) {
  return (
    <div className="flow">
      {["添加材料", "查看材料地图", "生成与审核", "作答与诊断"].map((x, i) => (
        <div className={i === current ? "flow-step current" : i < current ? "flow-step done" : "flow-step"} key={x}>
          <span>{i < current ? <Check size={13} /> : String(i + 1).padStart(2, "0")}</span>
          {x}
          {i < 3 && <ChevronRight size={16} />}
        </div>
      ))}
    </div>
  );
}

export default function NewMaterial() {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<SourceType>("notes");
  const [mode, setMode] = useState<WorkMode>("self");
  const [objective, setObjective] = useState<ObjectiveMode>("comprehensive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // 导入的文件太长时切成几段，用户选导入第几段
  const [parts, setParts] = useState<{ title: string; chunks: string[]; index: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [typing, setTyping] = useState(false); // 选了“直接粘贴文字”
  const [open, setOpen] = useState(false); // 右侧书卷是否展开
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const editing = typing || text.length > 0;

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setImporting(true);
    try {
      const content = await extractText(file);
      const base = titleFromName(file.name);
      setSource(guessSource(file.name, content));
      if (content.length <= MAX_CHARS) {
        setParts(null);
        setText(content);
        setTitle(base);
      } else {
        const chunks = splitText(content, MAX_CHARS - 500);
        setParts({ title: base, chunks, index: 0 });
        setText(chunks[0]);
        setTitle(`${base}（第1段/共${chunks.length}段）`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const pickPart = (i: number) => {
    if (!parts) return;
    setParts({ ...parts, index: i });
    setText(parts.chunks[i]);
    setTitle(`${parts.title}（第${i + 1}段/共${parts.chunks.length}段）`);
  };
  const reset = () => {
    setText("");
    setTitle("");
    setParts(null);
    setTyping(false);
    setError(null);
  };

  // 还没放材料时，在页面任意空白处 Ctrl+V 也能直接贴进来
  useEffect(() => {
    if (editing) return;
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable]")) return;
      const pasted = e.clipboardData?.getData("text") ?? "";
      if (!pasted.trim()) return;
      e.preventDefault();
      setText(pasted);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [editing]);

  // 窄屏时书卷排在下面，展开后滚过去
  useEffect(() => {
    if (open && window.matchMedia("(max-width: 1023px)").matches) scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  const tooLong = text.length > MAX_CHARS;
  const tooShort = text.trim().length < MIN_CHARS;
  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const { material } = await api<{ material: { id: string } }>("/api/materials", {
        body: { title, text, source_type: source, mode, objective },
      });
      go(`#/m/${material.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={["stage", open && "open", editing && "filled"].filter(Boolean).join(" ")}>
      {/* 左下角的书和大花枝画在侧栏里（见 workspace.tsx），这里是山水、飞鸟和中间下方的一小枝花 */}
      <div className="scene" aria-hidden>
        <Landscape />
        <Birds className="scene-birds" />
        <Branch className="scene-branch" />
      </div>

      <section className="stage-center">
        <h1 className="stage-title">Puzzled then Plostain</h1>
        <span className="stage-rule" />
        <p className="stage-sub">把刚学过的内容放进来，找到真正值得练习的地方。</p>

        <div
          className={["drop-card", dragOver && "over", editing && "filled"].filter(Boolean).join(" ")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            importFile(e.dataTransfer.files[0]);
          }}
        >
          <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={(e) => importFile(e.target.files?.[0])} />
          {importing ? (
            <div className="drop-empty">
              <Busy label="正在读取文件…" timer={false} />
            </div>
          ) : !editing ? (
            <>
              <button type="button" className="drop-empty" onClick={() => fileInput.current?.click()}>
                <FilePlus2 size={46} strokeWidth={1.2} />
                <strong>拖拽文件到这里，或点击上传</strong>
                <span>支持 .txt .md .pdf .docx，也可以直接 Ctrl+V 粘贴</span>
              </button>
              <div className="drop-alt">
                <button type="button" onClick={() => setTyping(true)}>
                  <ClipboardPaste size={15} /> 直接输入文字
                </button>
                <i />
                <button
                  type="button"
                  onClick={() => {
                    setText(SAMPLE);
                    setTitle("Python 变量、列表与拷贝");
                  }}
                >
                  <Sparkles size={15} /> 载入示例
                </button>
              </div>
            </>
          ) : (
            <div className="drop-filled">
              <div className="drop-head">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="材料标题（选填）" aria-label="材料标题" />
                <Button variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw size={15} /> 换一份
                </Button>
              </div>
              <Textarea
                autoFocus={typing && !text}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="学习材料"
                placeholder={"在这里粘贴你刚学过的内容…\n\n一节课的笔记、教材中的一个小节，或与 AI 的学习对话。\n保留原文和例子，材料越具体，练习越有依据。"}
                className="material-input"
              />
              {parts && (
                <div className="parts-row">
                  <span className="small">文件太长，已按段落切成 {parts.chunks.length} 段（每段出一张卷）。现在导入的是：</span>
                  {parts.chunks.map((c, i) => (
                    <button key={i} className={i === parts.index ? "part active" : "part"} onClick={() => pickPart(i)}>
                      第{i + 1}段 <span>{c.length.toLocaleString()}字</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="editor-footer">
                <span>
                  <ShieldCheck size={14} />
                  保存在本机数据库，只用于出题
                </span>
                <span className={tooLong ? "over" : ""}>
                  {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} 字{tooLong && " · 超过上限，请拆成几段"}
                </span>
              </div>
            </div>
          )}
          {dragOver && <div className="drop-hint">松开鼠标，导入这个文件</div>}
        </div>
        {!open && <ErrorBox error={error} />}

        <div className="ink-row">
          {/* 平原：全屏的场景，里面有筑城者（用提问帮你定学习目标）和学习日志 */}
          <button type="button" className="latte-button" onClick={() => go("#/plain")}>
            <span>平原</span>
            <ArrowRight size={22} className="latte-arrow" />
          </button>
          <button
            type="button"
            className={!tooShort && !tooLong && !open ? "ink-button ready" : "ink-button"}
            aria-expanded={open}
            aria-controls="practice-scroll"
            onClick={() => setOpen((o) => !o)}
          >
            <InkStroke />
            <span>{open ? "收起设置" : "个性化出题"}</span>
            <ArrowRight size={20} className="ink-arrow" />
          </button>
          <InkTendril />
        </div>
      </section>

      <aside className="scroll" id="practice-scroll" ref={scrollRef} aria-label="练习设置">
        <ScrollPaper />
        {/* 收起时整卷留白；inert 让里面的按钮在收起时不能被 Tab 选中 */}
        <div className="scroll-body" inert={!open}>
          <div className="scroll-head">
            <span className="scroll-tag">
              <SlidersHorizontal size={17} /> 练习设置
            </span>
          </div>

          <div className="scroll-field">
            <h3>练习模式</h3>
            <div className="seg-pills">
              {(Object.keys(MODE_TEXT) as WorkMode[]).map((k) => (
                <button key={k} type="button" className={mode === k ? "lav-pill on" : "lav-pill"} aria-pressed={mode === k} onClick={() => setMode(k)}>
                  {MODE_TEXT[k][0]}
                </button>
              ))}
            </div>
            <p className="scroll-hint">{MODE_TEXT[mode][1]}</p>
          </div>

          <div className="scroll-field">
            <h3>练习目标</h3>
            <div className="seg-pills grid2">
              {(Object.keys(OBJECTIVE_TEXT) as ObjectiveMode[]).map((k) => (
                <button key={k} type="button" className={objective === k ? "lav-pill on" : "lav-pill"} aria-pressed={objective === k} onClick={() => setObjective(k)}>
                  {OBJECTIVE_TEXT[k]}
                </button>
              ))}
            </div>
            <p className="scroll-hint">{OBJECTIVE_HINT[objective]}</p>
          </div>

          <div className="scroll-field">
            <h3>材料来源</h3>
            <div className="seg-pills wrap">
              {(Object.keys(SOURCE_TEXT) as SourceType[]).map((k) => (
                <button key={k} type="button" className={source === k ? "lav-pill on" : "lav-pill"} aria-pressed={source === k} onClick={() => setSource(k)}>
                  {SOURCE_TEXT[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="scroll-go">
            {busy ? (
              <Busy label="正在读材料、画地图…" />
            ) : (
              <button type="button" className="go-button" disabled={tooShort || tooLong} onClick={submit}>
                <Sparkles size={20} />
                生成材料地图
                <ArrowRight size={20} />
              </button>
            )}
            <p className="scroll-hint center">
              {tooLong ? "材料超过 2 万字，请先换一段" : tooShort ? `先在左边放入材料（至少 ${MIN_CHARS} 字）` : "下一步先看材料地图，确认后再出题"}
            </p>
            {open && <ErrorBox error={error} />}
          </div>
        </div>
      </aside>
    </div>
  );
}
