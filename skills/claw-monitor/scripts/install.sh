#!/bin/bash
# claw-monitor 安装脚本：安装 frpc + 部署监控面板 + 注册保活
# 用法: bash install.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# ── 0. 定位 Node 二进制 ──
NODE_BIN=""
if command -v node &>/dev/null; then
  NODE_BIN=$(command -v node)
elif [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN=$(find "$HOME/.nvm/versions/node" -maxdepth 3 -name node -type f 2>/dev/null | sort -V | tail -1)
elif [ -d "$HOME/.local/share/fnm" ]; then
  NODE_BIN=$(find "$HOME/.local/share/fnm" -maxdepth 4 -name node -type f 2>/dev/null | sort -V | tail -1)
fi
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found. Please install Node.js first."
  exit 1
fi
echo "Using node: $NODE_BIN ($($NODE_BIN --version))"

# ── 1. 安装 frpc ──
if command -v frpc &>/dev/null || [ -f ~/bin/frpc ]; then
  echo "SKIP: frpc already installed"
else
  ARCH=$(uname -m)
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  [ "$ARCH" = "arm64" ] && ARCH_FRP="arm64" || ARCH_FRP="amd64"
  [ "$OS" = "darwin" ] && OS_FRP="darwin" || OS_FRP="linux"
  VER="0.61.1"
  URL="https://github.com/fatedier/frp/releases/download/v${VER}/frp_${VER}_${OS_FRP}_${ARCH_FRP}.tar.gz"
  mkdir -p ~/bin
  curl -sL "$URL" | tar -xz -C /tmp/
  cp "/tmp/frp_${VER}_${OS_FRP}_${ARCH_FRP}/frpc" ~/bin/frpc
  chmod +x ~/bin/frpc
  echo "DONE: frpc installed"
fi

# ── 2. 下载/更新全部代码、skills 和脚本 ──
mkdir -p ~/Documents/openclaw-monitor
rm -rf /tmp/claw-monitor-tmp
git clone --depth 1 https://github.com/MindedCoder/claw-monitor.git /tmp/claw-monitor-tmp 2>/dev/null || true
if [ -d /tmp/claw-monitor-tmp ]; then
  # 更新 monitor.js
  cp /tmp/claw-monitor-tmp/skills/claw-monitor/src/monitor.js ~/Documents/openclaw-monitor/monitor.js
  echo "UPDATED: monitor.js"
  # 更新 deploy-static.sh
  if [ -f /tmp/claw-monitor-tmp/skills/static-deploy/scripts/deploy-static.sh ]; then
    cp /tmp/claw-monitor-tmp/skills/static-deploy/scripts/deploy-static.sh ~/Documents/openclaw-monitor/deploy-static.sh
    chmod +x ~/Documents/openclaw-monitor/deploy-static.sh
    echo "UPDATED: deploy-static.sh"
  fi
  # 更新所有 skills
  for skill_dir in /tmp/claw-monitor-tmp/skills/*/; do
    skill_name=$(basename "$skill_dir")
    mkdir -p "$HOME/.openclaw/workspace/skills/$skill_name"
    cp -r "$skill_dir"* "$HOME/.openclaw/workspace/skills/$skill_name/" 2>/dev/null
    echo "UPDATED: skill/$skill_name"
  done
  echo "DONE: all components updated"
else
  echo "WARN: failed to download from GitHub"
  [ ! -f ~/Documents/openclaw-monitor/monitor.js ] && echo "ERROR: no monitor.js available" && exit 1
  echo "Using existing files"
fi
rm -rf /tmp/claw-monitor-tmp

# ── 3. 创建配置 ──
FEISHU_APP_ID=$(python3 -c "import json;c=json.load(open('$HOME/.openclaw/openclaw.json'));f=c.get('channels',{}).get('feishu',{});print(f.get('appId') or f.get('accounts',{}).get('main',{}).get('appId','') or f.get('accounts',{}).get('default',{}).get('appId',''))" 2>/dev/null)
FEISHU_APP_SECRET=$(python3 -c "import json;c=json.load(open('$HOME/.openclaw/openclaw.json'));f=c.get('channels',{}).get('feishu',{});print(f.get('appSecret') or f.get('accounts',{}).get('main',{}).get('appSecret','') or f.get('accounts',{}).get('default',{}).get('appSecret',''))" 2>/dev/null)
GW_TOKEN=$(python3 -c "import json;c=json.load(open('$HOME/.openclaw/openclaw.json'));print(c.get('gateway',{}).get('auth',{}).get('token',''))" 2>/dev/null)

INSTANCE_NAME="${INSTANCE_NAME:-}"
cat > ~/Documents/openclaw-monitor/config.json << CONF
{
  "instanceName": "${INSTANCE_NAME}",
  "healthUrl": "http://127.0.0.1:18789/health",
  "openclawProcessName": "openclaw",
  "checkIntervalMs": 5000,
  "failThreshold": 3,
  "workspace": "$HOME/.openclaw",
  "feishu": {
    "appId": "${FEISHU_APP_ID}",
    "appSecret": "${FEISHU_APP_SECRET}",
    "alertOpenId": ""
  },
  "chatProbe": {
    "enabled": true,
    "intervalMs": 60000,
    "url": "http://127.0.0.1:18789/v1/chat/completions",
    "token": "${GW_TOKEN}",
    "model": "gpt-4o-mini",
    "testMessage": "hi",
    "timeoutMs": 30000
  },
  "pingProbe": {
    "enabled": true,
    "intervalMs": 30000,
    "url": "https://www.google.com",
    "timeoutMs": 10000
  }
}
CONF

cat > ~/Documents/openclaw-monitor/frpc.toml << 'CONF'
serverAddr = "8.135.54.217"
serverPort = 7000

# 心跳保活 + 断线自动重连
transport.heartbeatInterval = 10
transport.heartbeatTimeout = 30
transport.protocol = "tcp"
loginFailExit = false

[[proxies]]
name = "monitor"
type = "tcp"
localIP = "127.0.0.1"
localPort = 9001
remotePort = 19090
CONF
echo "DONE: config created"

# ── 4. 开启 gateway chatCompletions 端点 ──
python3 -c "
import json
p = '$HOME/.openclaw/openclaw.json'
c = json.load(open(p))
gw = c.setdefault('gateway', {})
http = gw.setdefault('http', {})
ep = http.setdefault('endpoints', {})
if not ep.get('chatCompletions', {}).get('enabled'):
    ep['chatCompletions'] = {'enabled': True}
    json.dump(c, open(p, 'w'), indent=2, ensure_ascii=False)
    print('DONE: chatCompletions endpoint enabled')
else:
    print('SKIP: chatCompletions already enabled')
"

# ── 4.5. 为 OpenClaw chatCompletions 打 usage 补丁（让 claw-monitor 可读到 usage） ──
python3 - <<'PY'
from pathlib import Path
import sys

cand = sorted(Path('/opt/homebrew/lib/node_modules/openclaw/dist').glob('gateway-cli-*.js'))
if not cand:
    print('WARN: gateway-cli dist not found, skip usage patch')
    raise SystemExit(0)
p = cand[-1]
text = p.read_text(errors='replace')
changed = False

old1 = '''\tif (!stream) {\n\t\ttry {\n\t\t\tconst content = resolveAgentResponseText(await agentCommandFromIngress(commandInput, defaultRuntime, deps));\n\t\t\tsendJson$1(res, 200, {\n\t\t\t\tid: runId,\n\t\t\t\tobject: "chat.completion",\n\t\t\t\tcreated: Math.floor(Date.now() / 1e3),\n\t\t\t\tmodel,\n\t\t\t\tchoices: [{\n\t\t\t\t\tindex: 0,\n\t\t\t\t\tmessage: {\n\t\t\t\t\t\trole: "assistant",\n\t\t\t\t\t\tcontent\n\t\t\t\t\t},\n\t\t\t\t\tfinish_reason: "stop"\n\t\t\t\t}],\n\t\t\t\tusage: {\n\t\t\t\t\tprompt_tokens: 0,\n\t\t\t\t\tcompletion_tokens: 0,\n\t\t\t\t\ttotal_tokens: 0\n\t\t\t\t}\n\t\t\t});\n\t\t} catch (err) {'''
new1 = '''\tif (!stream) {\n\t\ttry {\n\t\t\tconst result = await agentCommandFromIngress(commandInput, defaultRuntime, deps);\n\t\t\tconst content = resolveAgentResponseText(result);\n\t\t\tconst usage = extractUsageFromResult(result);\n\t\t\tsendJson$1(res, 200, {\n\t\t\t\tid: runId,\n\t\t\t\tobject: "chat.completion",\n\t\t\t\tcreated: Math.floor(Date.now() / 1e3),\n\t\t\t\tmodel,\n\t\t\t\tchoices: [{\n\t\t\t\t\tindex: 0,\n\t\t\t\t\tmessage: {\n\t\t\t\t\t\trole: "assistant",\n\t\t\t\t\t\tcontent\n\t\t\t\t\t},\n\t\t\t\t\tfinish_reason: "stop"\n\t\t\t\t}],\n\t\t\t\tusage\n\t\t\t});\n\t\t} catch (err) {'''
if old1 in text:
    text = text.replace(old1, new1, 1)
    changed = True

old2 = '''function createEmptyUsage() {\n\treturn {\n\t\tinput_tokens: 0,\n\t\toutput_tokens: 0,\n\t\ttotal_tokens: 0\n\t};\n}'''
new2 = '''function createEmptyUsage() {\n\treturn {\n\t\tinput_tokens: 0,\n\t\toutput_tokens: 0,\n\t\tprompt_tokens: 0,\n\t\tcompletion_tokens: 0,\n\t\ttotal_tokens: 0\n\t};\n}'''
if old2 in text:
    text = text.replace(old2, new2, 1)
    changed = True

old3 = '''\treturn {\n\t\tinput_tokens: Math.max(0, input),\n\t\toutput_tokens: Math.max(0, output),\n\t\ttotal_tokens: Math.max(0, total)\n\t};'''
new3 = '''\treturn {\n\t\tinput_tokens: Math.max(0, input),\n\t\toutput_tokens: Math.max(0, output),\n\t\tprompt_tokens: Math.max(0, input),\n\t\tcompletion_tokens: Math.max(0, output),\n\t\ttotal_tokens: Math.max(0, total)\n\t};'''
if old3 in text:
    text = text.replace(old3, new3, 1)
    changed = True

if changed:
    p.write_text(text)
    print(f'DONE: OpenClaw usage patch applied to {p}')
else:
    if 'extractUsageFromResult(result)' in text and 'prompt_tokens: Math.max(0, input)' in text:
        print(f'SKIP: OpenClaw usage patch already present in {p}')
    else:
        print(f'WARN: OpenClaw usage patch target not found in {p}')
PY

# ── 5. 停止旧服务 ──
MONITOR_DIR="$HOME/Documents/openclaw-monitor"
FRPC_BIN="$HOME/bin/frpc"
PLIST_LABEL="com.claw.monitor"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

OS_TYPE=$(uname -s)
if [ "$OS_TYPE" = "Darwin" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  # 清理旧版分体 plist
  launchctl unload "$HOME/Library/LaunchAgents/com.openclaw.monitor.plist" 2>/dev/null || true
  launchctl unload "$HOME/Library/LaunchAgents/com.openclaw.frpc.plist" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.openclaw.monitor.plist" "$HOME/Library/LaunchAgents/com.openclaw.frpc.plist"
fi
pkill -f "node.*monitor.js" 2>/dev/null || true
pkill -f "frpc.*frpc.toml" 2>/dev/null || true
sleep 1

# ── 6. 启动服务 ──
if [ "$OS_TYPE" = "Darwin" ]; then
  # macOS: 用 launchd 保活（进程挂了自动重启 + 登录自动启动）
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
  launchctl load -w "$PLIST_PATH"
  echo "DONE: launchd service registered (KeepAlive + RunAtLoad)"
else
  # Linux: nohup 启动
  cd "$MONITOR_DIR"
  nohup "$NODE_BIN" monitor.js > monitor.log 2> monitor.err.log &
  echo "DONE: monitor started via nohup (pid $!)"
fi
sleep 3

# ── 7. 验证服务 ──
INSTANCE=$(python3 -c "import json;c=json.load(open('$HOME/Documents/openclaw-monitor/config.json'));print(c.get('instanceName',''))" 2>/dev/null)
BASE=""
[ -n "$INSTANCE" ] && BASE="/$INSTANCE"
curl -s --noproxy '*' "http://127.0.0.1:9001${BASE}/api/status" | python3 -c "import sys,json;d=json.load(sys.stdin);print('Monitor: OK')" 2>/dev/null || echo "Monitor: starting..."
pgrep -f "frpc.*frpc.toml" >/dev/null && echo "frpc: OK" || echo "frpc: starting..."

echo "ALL DONE"
