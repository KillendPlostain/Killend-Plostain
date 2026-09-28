"use client";
// 第 1 步：新建练习（粘贴材料、选来源、选模式、选目标）。界面沿用 Codex 的初版设计。
import { useState } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, ClipboardPaste, FlaskConical, LockKeyhole, Network, Settings2, ShieldCheck, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ObjectiveMode, SourceType, WorkMode } from "@/lib/plostain/types";
import { api, Busy, ErrorBox, go, OBJECTIVE_HINT, OBJECTIVE_TEXT, PageHeading } from "./shared";

export const MAX_CHARS = 8000; // 与 plostain.config.ts 的 materialMaxChars 保持一致

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

  const tooLong = text.length > MAX_CHARS;
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
    <>
      <PageHeading
        eyebrow="YOUR LEARNING, IN FOCUS"
        title="从一份材料，开始理解。"
        desc="把刚学过的内容放在这里，下一步，我们一起找到真正值得练习的地方。"
        right={
          <span className="outline-tag">
            <FlaskConical size={14} />
            Prototype 0.1
          </span>
        }
      />
      <Flow current={0} />
      <div className="content-grid">
        <section className="panel editor-panel">
          <div className="panel-title">
            <div>
              <BookOpen size={19} />
              <h2>学习材料</h2>
            </div>
            <span className="muted small">支持纯文本</span>
          </div>
          <div className="editor-inner">
            <div className="title-row">
              <div>
                <label htmlFor="material-title">
                  材料标题 <span className="muted">（选填）</span>
                </label>
                <Input id="material-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：Python 列表与浅拷贝" className="title-input" />
              </div>
              <div>
                <label htmlFor="source-type">来源</label>
                <select id="source-type" className="select" value={source} onChange={(e) => setSource(e.target.value as SourceType)}>
                  {Object.entries(SOURCE_TEXT).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="text-label">
              <label htmlFor="material">粘贴你的材料</label>
              <span>笔记 / 教材 / 课堂对话</span>
            </div>
            <Textarea
              id="material"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"在这里粘贴你刚学过的内容…\n\n一节课的笔记、教材中的一个小节，或与 AI 的学习对话。\n保留原文和例子，材料越具体，练习越有依据。"}
              className="material-input"
            />
            <div className="editor-footer">
              <span>
                <ShieldCheck size={14} />
                保存在本机数据库，只用于出题
              </span>
              <span className={tooLong ? "over" : ""}>
                {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} 字{tooLong && " · 超过上限，请拆成几段分别出卷"}
              </span>
            </div>
            <div className="sample-row">
              <span className="sample-icon">
                <ClipboardPaste size={20} />
              </span>
              <div>
                <strong>还没有准备好材料？</strong>
                <p>用一份 Python 学习笔记试试看</p>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setText(SAMPLE);
                  setTitle("Python 变量、列表与拷贝");
                }}
              >
                载入示例 <ArrowUpRight size={16} />
              </Button>
            </div>
            <ErrorBox error={error} />
          </div>
          <div className="panel-actions">
            <span>
              <LockKeyhole size={14} />
              {mode === "self" ? "自测模式下，易错点会保持封存" : "教师模式下，你会先审题再发布"}
            </span>
            {busy ? (
              <Busy label="正在读材料、画地图…" />
            ) : (
              <Button disabled={text.trim().length < 80 || tooLong} onClick={submit}>
                生成材料地图 <ArrowRight size={17} />
              </Button>
            )}
          </div>
        </section>
        <aside className="right-column">
          <section className="panel mode-panel">
            <div className="mini-heading">
              <Settings2 size={17} />
              <h2>本轮练习模式</h2>
            </div>
            <Tabs value={mode} onValueChange={(v) => setMode(v as WorkMode)}>
              <TabsList className="mode-tabs">
                <TabsTrigger value="self">自测模式</TabsTrigger>
                <TabsTrigger value="teacher">教师模式</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="mode-detail">
              <span className="round-icon">
                <ShieldCheck size={23} />
              </span>
              <h3>{mode === "self" ? "先思考，再看答案" : "先审题，再交给学生"}</h3>
              <p>
                {mode === "self"
                  ? "自动审核后直接进入作答。答案、易错点和题目设计卡，在交卷后一起解锁。"
                  : "查看答案与诊断设计，自由修改、删除或重新生成单题，再开始作答。"}
              </p>
              <span className="green-line">
                <Check size={14} />
                {mode === "self" ? "避免剧透，保留真实诊断价值" : "每一道题，你都有最终决定权"}
              </span>
            </div>
          </section>
          <section className="panel mode-panel">
            <div className="mini-heading">
              <Target size={17} />
              <h2>练习目标</h2>
            </div>
            <div className="objective-list">
              {(Object.keys(OBJECTIVE_TEXT) as ObjectiveMode[]).map((k) => (
                <button key={k} className={objective === k ? "objective active" : "objective"} onClick={() => setObjective(k)}>
                  <strong>{OBJECTIVE_TEXT[k]}</strong>
                  <span>{OBJECTIVE_HINT[k]}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="next-card">
            <div className="mini-heading">
              <Network size={18} />
              <h2>接下来，会发生什么？</h2>
            </div>
            {[
              ["读懂材料", "提取知识主干，标记原文依据"],
              ["明确边界", "区分材料讲过的和没讲透的"],
              ["再决定怎么练", "先确认地图，再生成诊断练习"],
            ].map(([a, b], i) => (
              <div className="vertical-step" key={a}>
                <span>{i + 1}</span>
                <div>
                  <strong>{a}</strong>
                  <p>{b}</p>
                </div>
              </div>
            ))}
            <p className="next-footer">地图是索引，原文始终是出题依据。</p>
          </section>
        </aside>
      </div>
    </>
  );
}
