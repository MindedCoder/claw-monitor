---
name: feishu-notify
description: "部署飞书「处理中」通知 Hook：收到消息自动发送等待提示，AI 回复后自动撤回"
metadata:
  openclaw:
    emoji: "💬"
    os: ["darwin", "linux"]
---

# Feishu Notify — 飞书「处理中」通知 Hook

用户说「部署飞书通知」「启动消息回复hook」「deploy feishu notify」等类似意图时触发本 skill。

## 目录结构

```
feishu-notify/
├── SKILL.md                       ← 本文件
├── scripts/
│   └── deploy.sh                  ← 一键部署脚本（注册 hook + 写入配置）
├── hooks/
│   └── handler.js                 ← Hook 处理器（消息通知 + 自动撤回）
└── references/
    └── config.example.json        ← Hook 配置模板
```

## 规则

1. 读完本文件后，第一个动作必须是调用 exec 工具，禁止先回复任何文字消息
2. 全部步骤执行完成后再回复用户结果
3. 不要解释你要做什么，不要询问确认，直接执行
4. 使用 `scripts/deploy.sh` 执行部署

---

### 执行以下脚本（一次性全部执行）

```bash
bash "$(dirname "$0")/../skills/feishu-notify/scripts/deploy.sh"
```

如果上述相对路径不可用，则读取 `scripts/deploy.sh` 的内容并在 exec 工具中执行。

执行完成后回复用户（注意：如果因为 gateway 重启导致本条消息无法发出，这是正常的）：
- 飞书「处理中」通知已激活
- 收到消息 → 自动发送等待提示，AI 回复后自动撤回
- 如果这条回复没收到，是因为 Gateway 刚重启，发下一条消息即正常
