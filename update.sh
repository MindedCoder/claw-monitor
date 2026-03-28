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

# 4. 清理旧的 crontab（如有）
crontab -l 2>/dev/null | grep -v "keepalive.sh" | crontab - 2>/dev/null

# 5. 重启服务
MONITOR_DIR="$HOME/Documents/openclaw-monitor"
PLIST_LABEL="com.claw.monitor"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
NODE_BIN=$(command -v node)
OS_TYPE=$(uname -s)

# 停止旧进程
if [ "$OS_TYPE" = "Darwin" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
  # 清理旧版分体 plist
  launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.openclaw.monitor.plist" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.openclaw.frpc.plist" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.openclaw.monitor.plist" "$HOME/Library/LaunchAgents/com.openclaw.frpc.plist"
fi
pkill -f "node.*monitor.js" 2>/dev/null || true
pkill -f "frpc.*frpc.toml" 2>/dev/null || true
sleep 1

# 启动服务
if [ "$OS_TYPE" = "Darwin" ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${MONITOR_DIR}/monitor.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${MONITOR_DIR}</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${MONITOR_DIR}/monitor.log</string>
    <key>StandardErrorPath</key>
    <string>${MONITOR_DIR}/monitor.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${HOME}/bin</string>
    </dict>
</dict>
</plist>
PLIST
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  echo "  ✅ monitor 已通过 launchd 启动（KeepAlive 保活）"
else
  cd "$MONITOR_DIR"
  nohup "$NODE_BIN" monitor.js > monitor.log 2> monitor.err.log &
  echo "  ✅ monitor 已重启（nohup）"
fi

echo "🎉 更新完成"
