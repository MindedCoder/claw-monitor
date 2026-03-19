---
name: infra-services
description: "启动/停止/检查 OpenClaw 基础设施服务（监控面板 + frpc 隧道 + 飞书通知）"
metadata:
  openclaw:
    emoji: "🏗️"
    os: ["darwin", "linux"]
---

# 基础设施服务管理

使用 `infra_services` 工具来管理服务。

## 启动全部服务

调用工具：
```json
{ "tool": "infra_services", "action": "start", "service": "all" }
```

## 停止全部服务

```json
{ "tool": "infra_services", "action": "stop", "service": "all" }
```

## 查看状态

```json
{ "tool": "infra_services", "action": "status" }
```

## 单独管理某个服务

`service` 可选值：`all`（默认）、`monitor`、`frpc`

```json
{ "tool": "infra_services", "action": "start", "service": "frpc" }
{ "tool": "infra_services", "action": "stop", "service": "monitor" }
```

## 服务说明

- **monitor**：OpenClaw 健康监控面板，提供 Web 界面展示运行状态
- **frpc**：FRP 隧道客户端，将 monitor 面板映射到公网
- **飞书通知**：自动 hook，收到消息时发送「处理中」通知，AI 回复后自动撤回（无需手动管理）
