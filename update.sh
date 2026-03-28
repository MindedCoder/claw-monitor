#!/bin/bash
# 更新 claw-monitor 到最新版本并重启服务
# 用法: curl -fsSL https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/update.sh | bash
set -e

echo "📡 正在更新 claw-monitor..."

# 1. 拉取最新代码
rm -rf /tmp/claw-monitor-tmp
git clone --depth 1 https://github.com/MindedCoder/claw-monitor.git /tmp/claw-monitor-tmp 2>/dev/null

# 2. 更新 monitor.js + deploy-static.sh（不覆盖 config.json）
cp /tmp/claw-monitor-tmp/skills/claw-monitor/src/monitor.js ~/Documents/openclaw-monitor/monitor.js
echo "  ✅ monitor.js"
if [ ! -f ~/Documents/openclaw-monitor/config.json ]; then
  cp /tmp/claw-monitor-tmp/skills/claw-monitor/references/config.example.json ~/Documents/openclaw-monitor/config.json
  echo "  ✅ config.json（新建）"
else
  echo "  ⏭️  config.json（已存在，跳过）"
fi
if [ -f /tmp/claw-monitor-tmp/skills/static-deploy/scripts/deploy-static.sh ]; then
  cp /tmp/claw-monitor-tmp/skills/static-deploy/scripts/deploy-static.sh ~/Documents/openclaw-monitor/deploy-static.sh
  chmod +x ~/Documents/openclaw-monitor/deploy-static.sh
  echo "  ✅ deploy-static.sh"
fi

# 3. 更新所有 skills（保留完整目录结构）
for skill_dir in /tmp/claw-monitor-tmp/skills/*/; do
  skill_name=$(basename "$skill_dir")
  target_dir="$HOME/.openclaw/workspace/skills/$skill_name"
  mkdir -p "$target_dir"
  # 递归复制整个 skill 目录结构
  cp -r "$skill_dir"* "$target_dir/" 2>/dev/null
  # 确保脚本可执行
  find "$target_dir/scripts" -name "*.sh" -exec chmod +x {} \; 2>/dev/null
  echo "  ✅ skill/$skill_name"
done

rm -rf /tmp/claw-monitor-tmp

# 4. 清理旧的 crontab 和 launchd（如有）
crontab -l 2>/dev/null | grep -v "keepalive.sh" | crontab - 2>/dev/null
if [ "$(uname -s)" = "Darwin" ]; then
  for p in "$HOME/Library/LaunchAgents/"*claw*monitor*.plist "$HOME/Library/LaunchAgents/"*openclaw*.plist; do
    [ -f "$p" ] && launchctl unload "$p" 2>/dev/null || true && rm -f "$p"
  done
fi

# 5. 重启服务
MONITOR_DIR="$HOME/Documents/openclaw-monitor"
NODE_BIN=""
if command -v node &>/dev/null; then
  NODE_BIN=$(command -v node)
elif [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN=$(find "$HOME/.nvm/versions/node" -maxdepth 3 -name node -type f 2>/dev/null | sort -V | tail -1)
elif [ -d "$HOME/.local/share/fnm" ]; then
  NODE_BIN=$(find "$HOME/.local/share/fnm" -maxdepth 4 -name node -type f 2>/dev/null | sort -V | tail -1)
fi
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found"; exit 1
fi

pkill -f "node.*monitor.js" 2>/dev/null || true
pkill -f "frpc.*frpc.toml" 2>/dev/null || true
pkill -f "claw-monitor-start" 2>/dev/null || true
sleep 1

# nohup 启动 + while 循环保活
cd "$MONITOR_DIR"
nohup bash -c "while true; do \"$NODE_BIN\" monitor.js; echo \"\$(date) monitor exited, restarting in 3s...\" >> monitor.keepalive.log; sleep 3; done" > monitor.log 2> monitor.err.log &
echo "  ✅ monitor 已启动（带自动重启保活）"

echo "🎉 更新完成"
