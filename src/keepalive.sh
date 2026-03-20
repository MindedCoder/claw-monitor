#!/bin/bash
# 保活脚本：检查 monitor 和 frpc 是否运行，没有就拉起
export HOME="/Users/sub2api"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$HOME/bin"
MONITOR_DIR="$HOME/Documents/openclaw-monitor"

# monitor
if ! pgrep -f "node.*monitor.js" >/dev/null 2>&1; then
  cd "$MONITOR_DIR"
  nohup /opt/homebrew/bin/node monitor.js > monitor.log 2> monitor.err.log &
  echo "$(date) restarted monitor (pid $!)" >> "$MONITOR_DIR/keepalive.log"
fi

# frpc
if ! pgrep -f "frpc.*frpc.toml" >/dev/null 2>&1; then
  nohup "$HOME/bin/frpc" -c "$MONITOR_DIR/frpc.toml" >> "$MONITOR_DIR/frpc.log" 2>&1 &
  echo "$(date) restarted frpc (pid $!)" >> "$MONITOR_DIR/keepalive.log"
fi
