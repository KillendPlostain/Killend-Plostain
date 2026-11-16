# Plostain · Mac 使用指南

> 写于 2026-11-08，在 Windows 电脑上打包时一起写的。
> 你在 Mac 上用 Claude 时，它看不到 Windows 那边的聊天记录，所以这份指南把需要知道的都写在这里了。
> **最省事的用法：** 做完第 1～4 步后，对 Mac 上的 Claude 说“请按照 Mac使用指南.md 帮我完成安装”，剩下的交给它。

---

## 目录

1. 把压缩包传到 Mac 上并解压
2. 安装 Node.js
3. 安装 Claude（桌面应用 + claude 命令）
4. 用 Claude 打开 Plostain 文件夹
5. 补上密钥文件 .env
6. 第一次启动
7. 日常使用
8. 用 Claude 学习和修改源代码
9. 两台电脑之间怎么传改动
10. 常见问题
11. 附录：给 Claude 的安装清单

---

## 0. 这个压缩包里有什么、没有什么

| 带过来了 | 没带（为什么） |
| --- | --- |
| 全部源代码（界面、出题流程、提示词、验算） | `node_modules`：依赖包，Mac 和 Windows 的版本不一样，第一次启动时会自动重新下载 |
| 模型配置 `plostain.config.ts` | `.env`：里面是密钥，不放进压缩包，第 5 步手动补 |
| 首页的画面素材 `public/scene/` | `learning/`：学习资料，按你的要求不带 |
| 练习记录（截至打包时的历史卷子） | `.git`：版本记录。Mac 没装 git，带过来反而会不停弹窗让你装开发者工具 |
| 使用说明书 `docs/使用说明书.md` | 浏览器里的小东西：答题草稿、侧边栏收起状态。它们存在 Windows 的浏览器里，带不走 |
| Mac 版一键启动 `Plostain.command` | |

---

## 1. 把压缩包传到 Mac 上并解压

1. 把 Windows 桌面上的 **Plostain-Mac.zip** 传到 Mac。U 盘、微信 / QQ 的“文件传输助手”、网盘、发邮件给自己都可以，压缩包只有 1～2 MB。
2. 在 Mac 上双击压缩包，会解压出一个叫 **Plostain** 的文件夹。
3. 把 **Plostain** 文件夹放到你的“个人文件夹”（就是以你用户名命名、有个小房子图标的那个文件夹）：
   - 在“访达”（Finder）里按 `Shift + Command + H` 就能打开个人文件夹；
   - 把 Plostain 拖进去。
   - 放好后的位置是 `~/Plostain`，后面都按这个位置写。

> **为什么不放桌面或“文稿”？** 很多 Mac 开了“iCloud 云盘同步桌面与文稿”。Plostain 第一次启动会下载几万个依赖小文件，放在那里会被 iCloud 疯狂同步，又慢又占空间。

---

## 2. 安装 Node.js

Plostain 的网站是用 Node.js 跑的，需要 **22.13 或更高版本**。

1. 用浏览器打开 https://nodejs.org
2. 点绿色的 **LTS** 版本下载按钮，下载得到一个 `.pkg` 安装包。
3. 双击安装包，一路点“继续”“同意”“安装”，中间要输入 Mac 的开机密码。

**检查是否装好（可选）：** 打开“终端”（在启动台搜索“终端”，或按 `Command + 空格` 输入“终端”），输入下面这行后按回车：

```bash
node -v
```

显示 `v22.13.0` 或更大的数字（比如 `v24.x.x`）就对了。

---

## 3. 安装 Claude（桌面应用 + claude 命令）

这里要装**两样东西**，作用不同：

| 装什么 | 用来干什么 |
| --- | --- |
| **Claude 桌面应用** | 你在里面和 Claude 聊天、让它读代码、改代码（和你在 Windows 上用的是同一个应用） |
| **claude 命令** | Plostain 出题时，网站在后台通过它调用你的订阅额度。没有它，出题、批改、诊断都会失败 |

### 3.1 安装桌面应用

1. 打开 https://claude.ai/download ，下载 Mac 版。
2. 打开下载好的文件，把 Claude 图标拖进“应用程序”文件夹。
3. 打开 Claude，用你的账号登录（和 Windows 上同一个账号）。

### 3.2 安装 claude 命令

打开“终端”，复制下面这一整行，粘贴后按回车：

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

等它显示安装完成即可。**登录不用现在做**，第 6 步第一次启动时会自动提示你登录。

> 这一步也可以等第 4 步打开 Claude 之后，让 Claude 帮你装。

---

## 4. 用 Claude 打开 Plostain 文件夹

1. 打开 Claude 桌面应用。
2. 切换到 **Code**（写代码的那个界面，和你在 Windows 上现在用的一样）。
3. 选择文件夹时，选中 `~/Plostain`（个人文件夹里的 Plostain）。
4. 打开后，Claude 会自动读到文件夹里的 `CLAUDE.md`，知道这是什么项目、你在用它学习。

**这时就可以把剩下的事交给 Claude 了。** 对它说：

> 请按照 Mac使用指南.md 第 11 节的清单，帮我在这台 Mac 上把 Plostain 装好并启动。

它会帮你检查 Node.js、安装依赖、解除 macOS 对启动文件的拦截、检查 claude 命令。遇到需要你自己操作的地方（比如登录、输入密码），它会停下来告诉你。

下面第 5、6 步是你自己要知道的部分。

---

## 5. 补上密钥文件 .env

Plostain 的 6 个角色里，**“盲解”（solver）用的是智谱 GLM**，需要 GLM 的密钥；其余 5 个角色走你的 Claude 订阅，不需要密钥。密钥放在项目文件夹里一个叫 `.env` 的文件里。

**有两种办法，选一种：**

### 办法 A：把 Windows 上的 .env 文件拷过来（推荐）

1. 在 Windows 上找到项目文件夹里的 `.env` 文件（和 `package.json` 在同一层）。
2. **用 U 盘**拷到 Mac 上，放进 `~/Plostain` 文件夹里，文件名必须正好是 `.env`。
   - 尽量不要用微信、网盘传这个文件，它里面是能花钱的密钥。
3. 注意：Mac 默认**隐藏**以点开头的文件，所以放进去后在“访达”里看不到它，这是正常的。想看到它，在“访达”里按 `Shift + Command + .`（句号），再按一次就重新隐藏。

### 办法 B：在 Mac 上重新填一份

1. 在 `~/Plostain` 里找到 `.env.example`（同样是隐藏文件，按 `Shift + Command + .` 显示）。
2. 复制一份，把副本改名为 `.env`。
3. 用“文本编辑”打开 `.env`，在 `LLM_ENDPOINT=` 和 `LLM_API_KEY=` 后面填上 GLM 的地址和密钥（和 Windows 上那份一样），保存。

> **重要：** 不要把密钥粘贴到和 Claude 的聊天里，也不要让 Claude 把密钥写进代码。需要改密钥就自己打开 `.env` 改。

> **没有 .env 会怎样？** 网站能打开、能看历史卷子，但生成新练习时“盲解”这一步会失败。

---

## 6. 第一次启动

1. 在“访达”里打开 `~/Plostain`，**双击 `Plostain.command`**。
2. 会弹出一个“终端”窗口，第一次启动时依次发生：
   - **安装依赖**：自动下载，大约几分钟，屏幕上会滚很多字，正常。
   - **登录 Claude 订阅**：如果 claude 命令还没登录，会自动打开浏览器，请用你的订阅账号登录并点授权，然后回到终端窗口。
   - **启动网站**：浏览器自动打开 http://localhost:5173 ，看到 Plostain 首页就成功了。
3. **用的时候别关那个终端窗口**，关掉网站就停了。

### 如果双击 Plostain.command 被拦住

macOS 对从网上、聊天软件收到的文件会弹出“无法打开”“无法验证开发者”之类的提示。三种解决方法，任选一种：

- **最简单**：让 Claude 帮你解除（第 11 节清单里已经包含这一步）。
- **自己在终端里解除**：粘贴下面这行，按回车：
  ```bash
  xattr -dr com.apple.quarantine ~/Plostain
  ```
- **用系统设置放行**：打开“系统设置 → 隐私与安全性”，往下翻，找到关于 Plostain.command 的提示，点“仍要打开”。

如果提示“没有权限”或“无法执行”，在终端里粘贴下面这行，按回车：

```bash
chmod +x ~/Plostain/Plostain.command
```

**第一次运行时**，“终端”可能会弹窗问能不能访问某些文件夹，点“好”。

---

## 7. 日常使用

### 打开 Plostain

- **方法 1：** 双击 `~/Plostain/Plostain.command`。
  - 想放到程序坞（Dock）方便点：把 `Plostain.command` 拖到程序坞右侧（废纸篓旁边）。
  - 想放到桌面：在“访达”里右键 `Plostain.command` → “制作替身”，把替身拖到桌面。
- **方法 2：** 在 Claude 的 Code 界面里对它说“启动 Plostain”，它会在后台启动，并可以在 Claude 自带的浏览器面板里直接打开预览。

### 关闭 Plostain

- 直接关掉那个终端窗口，或者在终端窗口里按 `Control + C`。
- 不关的话，默认 **3 小时后自动关闭**（到点时如果模型还在出题，会等它跑完）。想改时长，用“文本编辑”打开 `Plostain.command`，改第 4 行的数字（写 0 表示不自动关闭）。

### 不想花额度、只看界面

在 Claude 里说“用 mock 模式启动 Plostain”，或者在终端里进入文件夹后运行：

```bash
cd ~/Plostain && npm run dev:mock
```

mock 模式不调用任何模型，不管贴什么材料，出的都是同一套示例题。适合改界面时看效果。

### 怎么用 Plostain 本身

Plostain 的完整用法（贴材料、看材料地图、做题、看诊断）写在 `docs/使用说明书.md`。说明书里写的 Windows 路径，在 Mac 上换成 `~/Plostain` 即可，其他操作完全一样。

---

## 8. 用 Claude 学习和修改源代码

在 Claude 的 Code 界面打开 `~/Plostain` 后，就可以直接和它聊。

### 先从这些问题开始

- “这个项目是做什么的？用最简单的话讲一遍整体流程。”
- “从我在首页贴材料，到出现练习卷，代码里依次经过了哪些文件？”
- “`lib/plostain/pipeline.ts` 是干什么的？挑最重要的 30 行给我讲。”
- “6 个角色（mapper、generator、solver、reviewer、grader、diagnostician）分别在哪个提示词文件里？”
- “出一道小题考考我，看我懂没懂 XX。”

### 改东西时这样说

- “把首页标题的颜色改深一点，改之前先告诉你打算改哪个文件。”
- “用 mock 模式启动，让我看看效果。”
- “刚才那个改动不好看，撤回。”

### 项目地图（哪里放着什么）

| 位置 | 内容 |
| --- | --- |
| `app/workspace.tsx` | 整个网页的外框：左侧栏、顶部栏、页面切换 |
| `app/views/new-material.tsx` | 首页：标题、贴材料的卡片、“个性化出题”、书卷、“沉浸模式”按钮 |
| `app/views/scene.tsx` | 首页画面里的小元素（飞鸟、花枝、小人标志等） |
| `app/plostain.css` | 全站样式：颜色、字体、侧栏 |
| `app/plostain-stage.css` | 首页专用样式：各元素的位置、书卷展开动画 |
| `public/scene/` | 首页的背景图片 |
| `lib/plostain/pipeline.ts` | 出题流程的总指挥：材料 → 地图 → 出题 → 盲解 + 审核 → 批改 → 诊断 |
| `lib/plostain/prompts/` | 6 个角色的提示词 |
| `lib/plostain/llm.ts` | 调用模型的统一入口 |
| `plostain.config.ts` | 每个角色用哪个模型。**换模型只改这个文件** |
| `scripts/claude-bridge.mjs` | “本机桥”：网站通过它调用你的 Claude 订阅，以及运行验算 |
| `tests/` | 自动测试，对 Claude 说“跑一下测试”即可 |
| `docs/使用说明书.md` | 给使用者看的完整说明书 |

### 改坏了怎么办

- Claude 改过的东西可以让它撤回：直接说“撤回刚才的修改”。
- **改大东西之前先备份**：在“访达”里右键 `Plostain` 文件夹 → “复制”，就会多出一个“Plostain 副本”。改坏了，删掉原来的，把副本改回原名即可。
  - 复制前先关掉 Plostain；`node_modules` 很大，复制会慢一点，属于正常现象。

---

## 9. 两台电脑之间怎么传改动

现在 Mac 和 Windows 上是**两份各自独立的副本**，不会自动同步。

**把 Mac 上的改动带回 Windows：**

1. 对 Mac 上的 Claude 说：
   > 把这个项目打成一个 zip 压缩包放到桌面，不要包含 node_modules、.env、.wrangler 和 .DS_Store。
2. 把压缩包传回 Windows。
3. 在 Windows 的 Claude 里说：
   > 这是我在 Mac 上改过的 Plostain，请对比后把改动合并进来，合并前先告诉我改了哪些地方。

   Windows 那份有版本记录，Claude 能看清两边的差别再合并。

**把 Windows 上的新改动带到 Mac：** 反过来，让 Windows 的 Claude 重新打包一份 Mac 版压缩包（不含 learning），在 Mac 上解压后，让 Mac 的 Claude 帮你把新文件覆盖进 `~/Plostain`。注意不要覆盖掉 `.env` 和 `node_modules`。

> **最容易出问题的情况：** 两边同时改了同一个文件，又都没同步。尽量一段时间只在一台电脑上改。

> 以后如果想自动同步（比如通过 GitHub），可以让 Claude 帮你在 Mac 上装 git，到时候再说。

---

## 10. 常见问题

| 现象 | 原因和解决办法 |
| --- | --- |
| 双击 `Plostain.command` 弹出“无法打开”“无法验证开发者” | macOS 拦截了收到的文件。见第 6 步“如果双击被拦住” |
| 终端里显示“没有找到 Node.js” | 第 2 步没装好，或者装完没重新打开终端。装好后关掉终端窗口，再双击一次 |
| 依赖安装失败、一直卡住 | 多半是网络问题。换个网络，或开着代理再试一次。把报错发给 Claude，让它帮你看 |
| 网页打开了，但生成练习时显示“模型调用失败” | ① Claude 订阅登录过期：关掉 Plostain 再双击启动，会自动提示登录；② 缺 `.env` 或 GLM 密钥填错：见第 5 步 |
| 浏览器显示“无法访问此网站” | 网站还没启动完（第一次要等久一点），或者终端窗口被关了。看终端窗口是否还在 |
| 提示 5173 端口被占用 | Plostain 已经在另一个窗口开着了。关掉多余的终端窗口，再重新打开 |
| 在“访达”里找不到 `.env` | 正常，它是隐藏文件。按 `Shift + Command + .` 显示 |
| 侧栏状态、答题草稿和 Windows 上不一样 | 这些存在各自的浏览器里，本来就不同步 |

---

## 11. 附录：给 Claude 的安装清单

> 这一节是写给 Mac 上的 Claude 看的。用户会让你“按第 11 节帮我安装”。每一步做完告诉用户结果；需要用户本人操作的（登录、输入开机密码、放置 `.env`），停下来用简单的中文说明怎么做。

项目位置：`~/Plostain`（如果不在这里，先问用户放在哪了）。

1. **检查 Node.js**：运行 `node -v`，需要 ≥ 22.13。没装或版本太低 → 让用户按第 2 步从 nodejs.org 安装 LTS 版。不要用 Homebrew 之类的工具替用户安装。
2. **解除隔离、加执行权限**：
   ```bash
   xattr -dr com.apple.quarantine ~/Plostain
   chmod +x ~/Plostain/Plostain.command
   ```
3. **安装依赖**：在 `~/Plostain` 里运行 `npm run install:ci`（第一次需要几分钟）。
4. **检查 claude 命令**：运行 `~/.local/bin/claude --version`。
   - 不存在 → 征得用户同意后运行 `curl -fsSL https://claude.ai/install.sh | bash` 安装。
   - 然后运行 `~/.local/bin/claude auth status`，看 `loggedIn` 是不是 `true`。如果不是，**不要替用户登录**，告诉用户：双击 `Plostain.command` 时会自动打开浏览器让他登录；或者让他自己在终端运行 `~/.local/bin/claude auth login`。
5. **检查 .env**：只检查 `~/Plostain/.env` 文件是否存在，以及 `LLM_ENDPOINT`、`LLM_API_KEY` 两行是否有值。**不要读出、显示或复述密钥的内容。** 缺失 → 让用户按第 5 步处理。
6. **跑一遍测试**：运行 `npm test`，应该全部通过。测试只用 mock，不花钱。
7. **启动**：让用户双击 `Plostain.command`；或者用 `.claude/launch.json` 里名为 `plostain` 的配置启动预览。打开 http://localhost:5173 确认能看到首页。

**注意事项（请遵守）：**
- 密钥只放在 `.env`，不要写进代码，也不要出现在聊天里。
- `scripts/claude-bridge.mjs` 调用的是用户本人的 Claude 订阅，只能本人、本机使用。不要把网站开放到局域网或公网。
- 不要修改系统设置（包括全局 PATH）。
