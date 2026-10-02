#!/bin/zsh
# 气体的等容变化 · 实验工作台启动器（双击运行）
# 自动检测环境、修复跨平台依赖、启动服务、打开浏览器
# 启动过程写入 启动日志.txt 供排查
cd "$(dirname "$0")"

LOG="启动日志.txt"
{
echo "==============================================="
echo "  气体的等容变化 · 实验工作台"
echo "  启动时间: $(date)"
echo "==============================================="
echo "环境检测:"
echo "  node:    $(command -v node || echo '未安装')"
echo "  npm:     $(command -v npm || echo '未安装')"
echo "  python3: $(command -v python3 || echo '未安装')"
node --version 2>/dev/null | sed 's/^/  node 版本: /'
python3 --version 2>/dev/null | sed 's/^/  python3 版本: /'

PORT=5180
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $PORT 已被占用，改用 5181"
  PORT=5181
fi
URL="http://localhost:$PORT"
echo "服务地址: $URL"

# 服务就绪后自动打开浏览器
(while ! curl -s -o /dev/null "$URL"; do sleep 0.5; done; open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || true) &

if command -v npm >/dev/null 2>&1; then
  # node_modules 若由其他平台生成，npm 会为 rollup/esbuild 的所有平台建目录，
  # 但只有原平台的目录里有实际二进制（其余是空目录）——必须检查内容而非目录存在性，
  # 否则 Mac 上表现为 "Cannot find module @rollup/rollup-darwin-arm64"
  if [ -d node_modules ]; then
    case "$(uname)-$(uname -m)" in
      Darwin-arm64)   RK=rollup-darwin-arm64;     EB=darwin-arm64 ;;
      Darwin-x86_64)  RK=rollup-darwin-x64;       EB=darwin-x64 ;;
      Linux-aarch64)  RK=rollup-linux-arm64-gnu;  EB=linux-arm64 ;;
      *)              RK=rollup-linux-x64-gnu;    EB=linux-x64 ;;
    esac
    if [ ! -f "node_modules/@rollup/$RK/package.json" ] || [ ! -f "node_modules/@esbuild/$EB/bin/esbuild" ]; then
      echo "检测到依赖与本机平台不匹配（node_modules 由其他系统生成），正在自动修复…"
      echo "（删除旧依赖并重新安装，约需 1~3 分钟，请稍候）"
      rm -rf node_modules package-lock.json
    fi
  fi
  if [ ! -d node_modules ]; then
    echo "正在安装依赖…"
    # 使用项目本地缓存，绕开 ~/.npm 中可能存在的 root 权限残留文件（npm 老 bug）
    npm install --cache "$PWD/.npm-cache" || {
      echo "依赖安装失败，请检查网络后重试"
      echo "（若网络不畅，可在终端执行: npm config set registry https://registry.npmmirror.com 后重试）"
      exit 1
    }
    echo "依赖安装完成"
  fi
  echo "以开发模式启动（Node.js）…"
  if [ "$PORT" != "5180" ]; then
    npm run dev -- --port $PORT
  else
    npm run dev
  fi
elif command -v python3 >/dev/null 2>&1; then
  if [ -d dist ] && [ -f dist/index.html ]; then
    echo "未检测到 Node.js，改用 Python 托管已构建的版本（功能相同）…"
    echo "提示: 安装 Node.js 后双击本启动器可获得开发模式（修改代码自动刷新）"
    cd dist && python3 -m http.server $PORT
  else
    echo "错误: 未安装 Node.js，且 dist/ 构建产物不存在。"
    echo "请先安装 Node.js (https://nodejs.org) 后重新双击本文件。"
    exit 1
  fi
else
  echo "错误: 未检测到 Node.js 或 Python3，无法启动。"
  echo "请先安装 Node.js: https://nodejs.org"
  exit 1
fi
} 2>&1 | tee "$LOG"
