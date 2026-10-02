#!/bin/zsh
# 发布到 GitHub（双击运行）
# 自动完成：清理沙盒残留 → git 提交 → 创建 GitHub 仓库（gh 已登录时）→ 推送
# 过程写入 发布日志.txt；如遇问题把日志发给 Claude 即可
cd "$(dirname "$0")"

REPO="isochoric-gas-workbench-c-kimi-k3"
DESC="气体等容变化数字化实验工作台（C+KIMI K3）：仪器软件屏幕OCR采集 × 实景摄像头 × Maxwell-Boltzmann 3D微观仿真 × p-T图像与复盘回放，宏微观证据链闭环"

{
echo "==============================================="
echo "  发布到 GitHub: $REPO"
echo "  时间: $(date)"
echo "==============================================="

# 1. 清理沙盒/构建残留（Mac 上可正常删除）
echo "[1/5] 清理临时文件…"
rm -rf .git
rm -f vite.config.ts.timestamp-*.mjs 启动日志.txt

# 2. 初始化仓库并提交
echo "[2/5] git 初始化与提交…"
git init -b main || { echo "git init 失败"; exit 1; }
# 优先使用你机器上已有的 git 身份；没有则用 GitHub noreply 地址（不泄露真实邮箱）
if ! git config user.name >/dev/null 2>&1; then
  git config user.name "WUHAO19831214"
fi
if ! git config user.email >/dev/null 2>&1; then
  git config user.email "WUHAO19831214@users.noreply.github.com"
fi
git add -A
git commit -m "feat: 气体的等容变化——实验数据采集与微观可视化工作台 (C+KIMI K3)

- 三栏课堂投屏工作台：屏幕OCR数据采集 / 实景摄像头 / MB分布3D微观仿真
- 复用 physics-software-sensors v0.6.0 核心包（screen.capture + ocr.number）
- OCR: 本地离线资源、屏幕小字体放大、多尝试多数表决、识别器串行闸门
- 数据质量: 置信度阈值 + 物理范围 + 历史基线交叉验证
- p-T散点/实时描点/最小二乘拟合; 复盘回放三区联动(倍速/进度条)
- 微观HUD因式分解看板: (f/f0)x(I/I0) ≈ T/T0 对照实测 p/p0
- 演示模式(DEMO标记) / CSV+JSON导出导入 / localStorage会话恢复
- 13项单元测试 + Playwright端到端验证全部通过" || { echo "git commit 失败"; exit 1; }
echo "提交完成"

# 3. 推送
echo "[3/5] 检查 GitHub CLI…"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "[4/5] 使用 gh 创建公开仓库并推送…"
  gh repo create "$REPO" --public --source=. --push --description "$DESC" && {
    echo "[5/5] 完成 ✓"
    echo "仓库地址: https://github.com/WUHAO19831214/$REPO"
    open "https://github.com/WUHAO19831214/$REPO"
    exit 0
  }
  echo "gh 创建失败（可能仓库已存在），尝试直接推送…"
  git remote remove origin 2>/dev/null
  git remote add origin "https://github.com/WUHAO19831214/$REPO.git"
  git push -u origin main && { echo "完成 ✓"; exit 0; }
fi

# 4. 无 gh：引导网页建库 + git 推送（Mac 钥匙串通常已存 GitHub 凭据）
echo "[4/5] 未检测到已登录的 gh，改用网页建库 + git 推送"
echo "  已在浏览器打开新建仓库页面，请："
echo "  ① Repository name 填: $REPO"
echo "  ② 选 Public，不要勾选任何 Initialize 选项"
echo "  ③ 点 Create repository 后回到本窗口按回车继续"
open "https://github.com/new?name=$REPO&description=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$DESC" 2>/dev/null || echo "")"
read "?建好后按回车继续推送…"
git remote remove origin 2>/dev/null
git remote add origin "https://github.com/WUHAO19831214/$REPO.git"
echo "[5/5] 推送中（如弹出登录窗口请完成授权）…"
git push -u origin main && {
  echo "完成 ✓ 仓库地址: https://github.com/WUHAO19831214/$REPO"
  open "https://github.com/WUHAO19831214/$REPO"
} || echo "推送失败：请把本日志发给 Claude 排查（一般是凭据或网络问题）"
} 2>&1 | tee 发布日志.txt
