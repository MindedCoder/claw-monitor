#!/bin/bash
# 帮用户装 OpenClaw 时一并执行，把 claw-monitor skill 部署好
# 用法：在装完 openclaw 后运行一次即可

SKILL_DIR="$HOME/.openclaw/workspace/skills/claw-monitor"
TOOLS_MD="$HOME/.openclaw/workspace/TOOLS.md"

# 1. 下载 SKILL.md
mkdir -p "$SKILL_DIR"
curl -fsSL https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/skills/infra-services/SKILL.md -o "$SKILL_DIR/SKILL.md"

# 2. 在 TOOLS.md 中注册 skill（如果还没有）
if ! grep -q "claw-monitor" "$TOOLS_MD" 2>/dev/null; then
  cat >> "$TOOLS_MD" << 'EOF'

## 可用 Skills

### claw-monitor
一键部署基础设施服务（监控面板 + frpc 隧道 + 飞书处理中通知）。
当用户说「启动监控」「部署监控」「start monitor」时，读取 `skills/claw-monitor/SKILL.md` 并按其中的步骤用 exec 工具依次执行。
EOF
  echo "✅ TOOLS.md 已更新"
fi

echo "✅ claw-monitor skill 已安装，用户对话中说「启动监控」即可"
