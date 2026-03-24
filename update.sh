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

# 4. 更新 keepalive 保活脚本
if [ -f /tmp/claw-monitor-tmp/skills/claw-monitor/scripts/keepalive.sh ]; then
  cp /tmp/claw-monitor-tmp/skills/claw-monitor/scripts/keepalive.sh ~/Documents/openclaw-monitor/keepalive.sh
  chmod +x ~/Documents/openclaw-monitor/keepalive.sh
  echo "  ✅ keepalive.sh"
fi

rm -rf /tmp/claw-monitor-tmp

# 5. 清理旧的 launchd 服务（如有）
if [ "$(uname -s)" = "Darwin" ]; then
  launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/com.openclaw.monitor.plist" 2>/dev/null || true
  launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/com.openclaw.frpc.plist" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.openclaw.monitor.plist" "$HOME/Library/LaunchAgents/com.openclaw.frpc.plist"
fi

# 6. 注册 cron 保活（如果还没有）
if ! crontab -l 2>/dev/null | grep -q "keepalive.sh"; then
  (crontab -l 2>/dev/null; echo "* * * * * /bin/bash $HOME/Documents/openclaw-monitor/keepalive.sh") | crontab -
  echo "  ✅ cron 保活已注册"
fi

# 7. 重启服务
pkill -f "node.*monitor.js" 2>/dev/null || true
pkill -f "frpc.*frpc.toml" 2>/dev/null || true
sleep 1
cd ~/Documents/openclaw-monitor
NODE_BIN=$(command -v node)
nohup "$NODE_BIN" monitor.js > monitor.log 2> monitor.err.log &
echo "  ✅ monitor 已重启"
sleep 3
FRPC_BIN=$(command -v frpc 2>/dev/null || echo "$HOME/bin/frpc")
nohup "$FRPC_BIN" -c ~/Documents/openclaw-monitor/frpc.toml >> frpc.log 2>&1 &
echo "  ✅ frpc 已重启"

echo "🎉 更新完成"
