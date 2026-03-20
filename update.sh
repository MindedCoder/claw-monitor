#!/bin/bash
# 更新 claw-monitor 到最新版本并重启服务
# 用法: curl -fsSL https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/update.sh | bash
set -e

echo "📡 正在更新 claw-monitor..."

# 1. 拉取最新代码
rm -rf /tmp/claw-monitor-tmp
git clone --depth 1 https://github.com/MindedCoder/claw-monitor.git /tmp/claw-monitor-tmp 2>/dev/null

# 2. 更新 monitor.js + deploy-static.sh
cp /tmp/claw-monitor-tmp/src/monitor.js ~/Documents/openclaw-monitor/monitor.js
echo "  ✅ monitor.js"
if [ -f /tmp/claw-monitor-tmp/src/deploy-static.sh ]; then
  cp /tmp/claw-monitor-tmp/src/deploy-static.sh ~/Documents/openclaw-monitor/deploy-static.sh
  chmod +x ~/Documents/openclaw-monitor/deploy-static.sh
  echo "  ✅ deploy-static.sh"
fi

# 3. 更新所有 skills
for skill_dir in /tmp/claw-monitor-tmp/skills/*/; do
  skill_name=$(basename "$skill_dir")
  mkdir -p "$HOME/.openclaw/workspace/skills/$skill_name"
  cp "$skill_dir"* "$HOME/.openclaw/workspace/skills/$skill_name/" 2>/dev/null
  echo "  ✅ skill/$skill_name"
done

rm -rf /tmp/claw-monitor-tmp

# 4. 重启服务
OS_TYPE=$(uname -s)
if [ "$OS_TYPE" = "Darwin" ]; then
  pkill -f "node.*monitor.js" 2>/dev/null || true
  pkill -f "frpc.*frpc.toml" 2>/dev/null || true
  sleep 1
  PLIST_MON="$HOME/Library/LaunchAgents/com.openclaw.monitor.plist"
  PLIST_FRP="$HOME/Library/LaunchAgents/com.openclaw.frpc.plist"
  if [ -f "$PLIST_MON" ]; then
    launchctl bootout gui/$(id -u) "$PLIST_MON" 2>/dev/null || true
    sleep 1
    launchctl bootstrap gui/$(id -u) "$PLIST_MON"
    echo "  ✅ monitor 服务已重启"
    sleep 3
  fi
  if [ -f "$PLIST_FRP" ]; then
    launchctl bootout gui/$(id -u) "$PLIST_FRP" 2>/dev/null || true
    sleep 1
    launchctl bootstrap gui/$(id -u) "$PLIST_FRP"
    echo "  ✅ frpc 服务已重启"
  fi
else
  systemctl --user restart openclaw-monitor.service 2>/dev/null && echo "  ✅ monitor 服务已重启" || true
  systemctl --user restart openclaw-frpc.service 2>/dev/null && echo "  ✅ frpc 服务已重启" || true
fi

echo "🎉 更新完成"
