#!/bin/bash
# 部署飞书「处理中」通知 Hook
# 用法: bash deploy.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# ── 1. 读取飞书凭证 ──
FEISHU_APP_ID=$(python3 -c "import json;c=json.load(open('$HOME/.openclaw/openclaw.json'));print(c.get('channels',{}).get('feishu',{}).get('appId',''))" 2>/dev/null)
FEISHU_APP_SECRET=$(python3 -c "import json;c=json.load(open('$HOME/.openclaw/openclaw.json'));print(c.get('channels',{}).get('feishu',{}).get('appSecret',''))" 2>/dev/null)

# ── 2. 部署飞书通知 Hook ──
HOOK_DEST="$HOME/.openclaw/hooks/status-page-notify"

if [ -f "$HOOK_DEST/handler.js" ]; then
  echo "SKIP: hook already exists"
else
  mkdir -p "$HOOK_DEST"

  cat > "$HOOK_DEST/HOOK.md" << 'HOOKMD'
---
name: status-page-notify
description: "收到消息时发送处理中通知，AI回复后自动撤回"
metadata:
  openclaw:
    emoji: "💬"
    events: ["message:received", "message:sent"]
---
# Status Page Notify
HOOKMD

  cat > "$HOOK_DEST/config.json" << CFGEOF
{
  "statusPageUrl": "https://claw.bfelab.com/bfe",
  "feishu": {
    "appId": "${FEISHU_APP_ID}",
    "appSecret": "${FEISHU_APP_SECRET}"
  }
}
CFGEOF

  # 从 skill 的 hooks 目录复制 handler.js
  cp "$SKILL_DIR/hooks/handler.js" "$HOOK_DEST/handler.js"
  echo "DONE: hook deployed"
fi

# ── 3. 注册 Hook 到 openclaw.json ──
python3 -c "
import json
p = '$HOME/.openclaw/openclaw.json'
c = json.load(open(p))
h = c.setdefault('hooks', {}).setdefault('internal', {'enabled': True})
h.setdefault('enabled', True)
e = h.setdefault('entries', {})
if 'status-page-notify' not in e:
    e['status-page-notify'] = {'enabled': True}
    json.dump(c, open(p,'w'), indent=2, ensure_ascii=False)
    print('DONE: hook registered')
else:
    print('SKIP: hook already registered')
"

# ── 4. 创建日志目录 ──
mkdir -p ~/.openclaw/data
ln -sf ~/.openclaw/logs/status-page-notify-debug.log ~/.openclaw/data/status-page-notify-debug.log 2>/dev/null

# ── 5. 等待热加载 hook ──
sleep 5
grep "status-page-notify" ~/.openclaw/logs/gateway.log 2>/dev/null | tail -1

echo "ALL DONE"
