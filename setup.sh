#!/bin/bash
# 帮用户装 OpenClaw 时一并执行，把两个 skill 部署好
# 用法：在装完 openclaw 后运行一次即可

SKILLS_BASE="$HOME/.openclaw/workspace/skills"
TOOLS_MD="$HOME/.openclaw/workspace/TOOLS.md"
REPO_RAW="https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/skills"

# 1. 下载 claw-monitor skill
mkdir -p "$SKILLS_BASE/claw-monitor"
curl -fsSL "$REPO_RAW/claw-monitor/SKILL.md" -o "$SKILLS_BASE/claw-monitor/SKILL.md"
echo "✅ claw-monitor skill 已安装"

# 2. 下载 feishu-notify skill
mkdir -p "$SKILLS_BASE/feishu-notify"
curl -fsSL "$REPO_RAW/feishu-notify/SKILL.md" -o "$SKILLS_BASE/feishu-notify/SKILL.md"
echo "✅ feishu-notify skill 已安装"

# 3. 在 TOOLS.md 中注册 skill（如果还没有）
if ! grep -q "claw-monitor" "$TOOLS_MD" 2>/dev/null; then
  cat >> "$TOOLS_MD" << 'EOF'

## 可用 Skills

### claw-monitor
一键部署监控面板 + frpc 公网隧道。
当用户说「启动监控」「部署监控」「start monitor」时，读取 `skills/claw-monitor/SKILL.md` 并按其中的步骤用 exec 工具依次执行。
EOF
  echo "✅ TOOLS.md 已注册 claw-monitor"
fi

if ! grep -q "feishu-notify" "$TOOLS_MD" 2>/dev/null; then
  cat >> "$TOOLS_MD" << 'EOF'

### feishu-notify
部署飞书「处理中」通知 Hook：收到消息自动发送等待提示，AI 回复后自动撤回。
当用户说「部署飞书通知」「启动消息回复hook」「deploy feishu notify」时，读取 `skills/feishu-notify/SKILL.md` 并按其中的步骤用 exec 工具依次执行。
EOF
  echo "✅ TOOLS.md 已注册 feishu-notify"
fi

echo "✅ 全部安装完成，对话中说「启动监控」或「部署飞书通知」即可"
