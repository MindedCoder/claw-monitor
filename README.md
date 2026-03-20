# openclaw-infra-services

OpenClaw 基础设施服务插件 — 监控面板 + frpc 公网隧道 + 飞书「处理中」通知，支持插件安装和独立 Skill 两种部署方式。

## 项目结构

```
openclaw-infra-services/
├── openclaw.plugin.json      # 插件清单（id、configSchema）
├── package.json
├── config.example.json        # 配置示例
├── setup.sh                   # 独立 Skill 部署脚本
├── TOOLS.example.md           # TOOLS.md 示例
├── skills/
│   └── infra-services/
│       └── SKILL.md           # 对话式 Skill（一键 bash 脚本）
├── src/
│   ├── index.js               # 插件入口，注册 hook + tool
│   ├── monitor.js             # 监控面板（HTTP 服务 + 实时仪表盘）
│   ├── hook-status-page.js    # 飞书「处理中」通知 hook
│   ├── tool-infra.js          # infra_services 工具 handler
│   └── setup-frpc.js          # postinstall：自动下载 frpc
└── bin/                       # （预留）
```

## 安装

### 方式一：插件安装（推荐）

```bash
openclaw plugins install openclaw-infra-services
```

安装时自动下载 frpc 到 `~/bin/`（支持 macOS / Linux，arm64 / x64）。

### 方式二：独立 Skill 部署

适用于不走插件体系、只想通过对话触发的场景：

```bash
bash setup.sh
```

该脚本会将 `SKILL.md` 部署到 `~/.openclaw/workspace/skills/claw-monitor/`，并在 `TOOLS.md` 中注册。之后在对话中说「启动监控」即可触发一键部署。

## 配置

在 `~/.openclaw/openclaw.json` 的插件配置中添加（参考 `config.example.json`）：

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

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `statusPageUrl` | 监控面板公网地址（飞书通知中的链接） | — |
| `feishuAppId` / `feishuAppSecret` | 飞书机器人凭证，不填则从环境变量 `OPENCLAW_FEISHU_APP_ID` / `OPENCLAW_FEISHU_APP_SECRET` 读取 | — |
| `frpc.serverAddr` | frp 服务器 IP | — |
| `frpc.serverPort` | frp 服务端口 | `7000` |
| `frpc.remotePort` | 远程映射端口 | `19090` |
| `monitor.port` | 本地监控面板端口 | `9001` |

## 使用

在对话中说「启动基础设施服务」，或直接使用工具：

- **启动全部**：`infra_services start all`
- **启动单个**：`infra_services start monitor` / `infra_services start frpc`
- **停止全部**：`infra_services stop all`
- **查看状态**：`infra_services status`

## 功能详情

### 1. 监控面板 (monitor)

独立 HTTP 服务，提供实时 Web 仪表盘：

- **服务状态**：进程 PID、CPU、内存、运行时长、版本、认证方式
- **AI 状态**：实时检测 AI 是否空闲 / 思考中 / 刚回复完（基于 gateway.log 解析）
- **健康检查**：定时轮询 `/health` 端点，记录可用率、连续失败次数，宕机时飞书告警
- **模型信息**：当前模型、提供商、对话数、Token 用量估算
- **飞书会话**：活跃用户列表、最近会话时间线
- **系统日志**：实时解析 gateway.log / gateway.err.log / JSON 日志，英文日志自动翻译成中文
- **健康历史条形图**：最近 100 次检查的可视化

面板每 1.5 秒自动刷新，移动端适配。

#### API 端点

| 路径 | 说明 |
|------|------|
| `GET /` | 完整仪表盘 HTML 页面 |
| `GET /api/status` | JSON 格式的完整状态数据 |
| `GET /api/html` | 仪表盘内部 HTML 片段（用于局部刷新） |

### 2. frpc 隧道

- 将本地监控面板端口映射到公网
- 自动生成 `frpc.toml` 配置
- 安装时通过 `postinstall` 自动下载 frpc v0.61.1
- frpc 二进制查找路径：`~/bin/frpc` → `~/.local/bin/frpc` → `/usr/local/bin/frpc`

### 3. 飞书「处理中」通知 (hook)

- 收到用户消息 → 自动发送「⏳ 正在处理中请稍后，点击查看进度」卡片
- AI 回复后 → 自动撤回通知
- 兜底机制：
  - 用户连续发消息时，先撤回上一条再发新通知
  - 3 分钟无回复自动撤回
- 仅对飞书渠道生效

## License

MIT
