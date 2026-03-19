# openclaw-infra-services

OpenClaw 基础设施服务插件，一键启动监控面板 + frpc 隧道 + 飞书「处理中」通知。

## 安装

```bash
openclaw plugins install openclaw-infra-services
```

安装时自动下载 frpc 到 `~/bin/`（支持 macOS/Linux, arm64/x64）。

## 配置

在 `~/.openclaw/openclaw.json` 中添加插件配置：

```json
{
  "plugins": {
    "entries": {
      "infra-services": {
        "enabled": true,
        "config": {
          "statusPageUrl": "https://your-domain.com/monitor",
          "feishuAppId": "cli_xxx",
          "feishuAppSecret": "xxx",
          "frpc": {
            "serverAddr": "1.2.3.4",
            "serverPort": 7000,
            "remotePort": 19090
          },
          "monitor": {
            "port": 9001
          }
        }
      }
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `statusPageUrl` | 监控面板公网地址（飞书通知中的链接） |
| `feishuAppId` / `feishuAppSecret` | 飞书机器人凭证（不填则从 channel config 读取） |
| `frpc.serverAddr` | 你的 frp 服务器 IP |
| `frpc.serverPort` | frp 服务端口，默认 7000 |
| `frpc.remotePort` | 远程映射端口 |
| `monitor.port` | 本地监控面板端口，默认 9001 |

## 使用

在对话中说「启动基础设施服务」，或直接使用工具：

- **启动全部**：`infra_services start all`
- **停止全部**：`infra_services stop all`
- **查看状态**：`infra_services status`

## 包含功能

### 1. 监控面板 (monitor)
- OpenClaw 健康状态实时监控
- Web 界面展示进程状态、AI 活动、模型用量
- 飞书告警（服务宕机时推送通知）

### 2. frpc 隧道
- 将本地监控面板映射到公网
- 自动生成 frpc 配置
- 安装时自动下载 frpc 二进制

### 3. 飞书「处理中」通知 (hook)
- 收到用户消息 → 自动发送「⏳ 正在处理中请稍后，点击查看进度」
- AI 回复后 → 自动撤回通知
- 兜底：用户下次发消息时撤回 / 3 分钟后自动撤回

## License

MIT
