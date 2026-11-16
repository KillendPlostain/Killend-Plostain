#!/bin/bash
# ==== Plostain 一键启动（Mac 版）====
# 双击运行。想改自动关闭时间，就改下面这行的数字（单位：分钟；写 0 表示不自动关闭）
export PLOSTAIN_AUTO_STOP_MINUTES=180

export PLOSTAIN_OPEN_BROWSER=1
cd "$(dirname "$0")" || exit 1
# Claude 官方安装脚本把 claude 装在 ~/.local/bin；只在这个窗口里加进 PATH，不改系统设置
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

pause() { echo; read -r -p "按回车键关闭这个窗口…"; }

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先到 https://nodejs.org 下载 LTS 版安装包装好，再双击 Plostain。"
  pause; exit 1
fi

if [ ! -d node_modules ]; then
  echo "第一次启动，正在安装依赖（大约需要几分钟）…"
  if ! npm run install:ci; then
    echo "依赖安装失败。请检查网络后再双击 Plostain 重试，或者把上面的报错发给 Claude。"
    pause; exit 1
  fi
fi

# 启动前先检查 Claude 订阅是否还登录着；过期了就先登录
if command -v claude >/dev/null 2>&1; then
  if ! claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
    echo "Claude 订阅还没登录或已过期，出题会失败。"
    echo "马上会打开浏览器，请用你的订阅账号登录并点授权，完成后回到这个窗口。"
    echo
    claude auth login
    if claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
      echo "登录成功。"
    else
      echo "登录没有成功。Plostain 仍会启动，但用 Claude 的角色会调用失败。"
      echo "可以关掉这个窗口，再双击 Plostain 重试。"
      pause
    fi
    echo
  fi
else
  echo "提示：没有找到 claude 命令，出题会失败。安装方法见《Mac使用指南》第 3 步。"
  echo
fi

echo "正在启动 Plostain（网站 + 本机桥），浏览器会自动打开…"
echo "用的时候不要关这个窗口；想提前关闭，按 Control + C 或直接关掉这个窗口。"
echo
npm run dev || pause
