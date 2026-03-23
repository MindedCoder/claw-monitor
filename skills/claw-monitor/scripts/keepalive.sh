#!/bin/bash
# 保活脚本：检查 monitor 和 frpc 是否运行，没有就拉起
# 由 cron 每分钟调用
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$HOME/bin"
MONITOR_DIR="$HOME/Documents/openclaw-monitor"
NODE_BIN=$(command -v node 2>/dev/null)
[ -z "$NODE_BIN" ] && exit 1

# monitor
if ! pgrep -f "node.*monitor.js" >/dev/null 2>&1; then
  cd "$MONITOR_DIR"
  nohup "$NODE_BIN" monitor.js > monitor.log 2> monitor.err.log &
  echo "$(date) restarted monitor (pid $!)" >> "$MONITOR_DIR/keepalive.log"
fi

# frpc
if ! pgrep -f "frpc.*frpc.toml" >/dev/null 2>&1; then
  FRPC_BIN=$(command -v frpc 2>/dev/null || echo "$HOME/bin/frpc")
  nohup "$FRPC_BIN" -c "$MONITOR_DIR/frpc.toml" >> "$MONITOR_DIR/frpc.log" 2>&1 &
  echo "$(date) restarted frpc (pid $!)" >> "$MONITOR_DIR/keepalive.log"
fi
