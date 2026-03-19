#!/bin/bash
# 帮用户装 OpenClaw 时一并执行，把 claw-monitor skill 部署好
# 用法：在装完 openclaw 后运行一次即可

SKILL_DIR="$HOME/.openclaw/workspace/skills/claw-monitor"
mkdir -p "$SKILL_DIR"
curl -fsSL https://raw.githubusercontent.com/MindedCoder/claw-monitor/main/skills/infra-services/SKILL.md -o "$SKILL_DIR/SKILL.md"
echo "✅ claw-monitor skill 已安装，用户对话中说「启动监控」即可"
